import React, { useState, useEffect, useLayoutEffect, useRef, useImperativeHandle, forwardRef, useMemo, useCallback } from 'react';
import { Stage, Layer, Line, Rect, Circle, Arrow, Image as KonvaImage, Group, Transformer, Text } from 'react-konva';
import useImage from 'use-image';
import TextEditorOverlay from './TextEditorOverlay';
import CanvasDebugHud from './CanvasDebugHud';
import { renderShapeFactory } from './ShapeRenderer';
function generateUUID() { return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16); }); }
const DEBUG_MODE = (typeof window !== 'undefined') && (new URLSearchParams(window.location.search).get('diag') === '1' || localStorage.getItem('debugPaintLayer') === '1' || import.meta.env.VITE_DEBUG === 'true');

// ★ CRITICAL: fileUrlを正規化（クエリ違いを同一ファイルとして扱う）
function normalizeFileUrl(url) {
  if (!url) return "";
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`; // queryを無視
  } catch {
    return String(url).split("?")[0]; // フォールバック
  }
}

// ★★★ CRITICAL: commentId解決ユーティリティ（キー揺れ完全吸収、入れ子対応）★★★
const resolveCommentId = (s) => {
  const v = s?.comment_id ?? s?.commentId ?? s?.commentID ?? 
            s?.comment?.id ?? 
            s?.data?.comment_id ?? s?.data?.commentId ?? s?.data?.commentID ??
            s?.shape?.comment_id ?? s?.shape?.commentId ?? s?.shape?.commentID;
  return v == null ? null : String(v);
};

// ★★★ CRITICAL: shape正規化（入れ子を平坦化、comment_id を canonical 化）★★★
// defaultCommentId: shapeにcomment_idが無い場合のみ使用（既存値は上書きしない）
const normalizeShape = (s, defaultCommentId = null) => {
  if (!s) return null;
  const base = s.data ? { ...s, ...s.data } : (s.shape ? { ...s, ...s.shape } : s);
  let commentId = resolveCommentId(base);
  if (commentId == null || commentId === '') {
    commentId = defaultCommentId != null ? String(defaultCommentId) : null;
  }
  return {
    ...base,
    comment_id: commentId,
    id: base.id ?? base.client_shape_id ?? base._local_id ?? (base._local_id = generateUUID()),
  };
};

const shapeCommentId = resolveCommentId;  // 後方互換エイリアス
const sameId = (a, b) => String(a ?? '') === String(b ?? '');

// 背景画像コンポーネント（チラつき防止：前の画像を保持）
function BackgroundImage({ src, onLoad }) {
  const [image, status] = useImage(src, 'anonymous');
  const lastImageRef = useRef(null);
  const onLoadCalledRef = useRef(false);
  
  useEffect(() => {
    console.log('[BackgroundImage] Load status:', { src: src?.substring(0, 50), status, hasImage: !!image });
    
    if (status === 'failed') {
      console.error('[BackgroundImage] Failed to load image:', src);
      onLoadCalledRef.current = false;
    }
    
    if (image && !onLoadCalledRef.current) {
      lastImageRef.current = image;
      onLoadCalledRef.current = true;
      console.log('[P0-FIX] BackgroundImage onLoad CALLED:', { width: image.width, height: image.height });
      if (onLoad) {
        onLoad({ width: image.width, height: image.height });
      }
    }
  }, [image, status, onLoad, src]);
  
  const imgToRender = image || lastImageRef.current;
  
  if (status === 'loading') {
    console.log('[BackgroundImage] Loading...', src?.substring(0, 50));
  }
  
  return imgToRender ? (
    <KonvaImage 
      image={imgToRender} 
      width={imgToRender.width} 
      height={imgToRender.height} 
      listening={false} 
    />
  ) : null;
}

const ViewerCanvas = forwardRef(({
  fileUrl,
  mimeType,
  pageNumber = 1,
  existingShapes = [],
  comments = [],
  activeCommentId = null,
  onCommentClick,
  onShapesChange, // CRITICAL: 親への同期コールバック
  onSaveShape,
  onDeleteShape,
  onBeginPaint,
  paintMode = false,
  draftReady = false, // ★★★ CRITICAL: draft hydrate完了フラグ ★★★
  tool = 'select',
  strokeColor = '#ff0000',
  strokeWidth = 2,
  zoom = 100,
  fitMode = 'all', // ★★★ P1-FIT: 'all' | 'width' | 'height' ★★★
  onToolChange,
  onStrokeColorChange,
  onStrokeWidthChange,
  showBoundingBoxes = false,
  showAllPaint = false,
  debugInfo = null,
  clearAfterSubmitNonce = 0,
  forceClearToken = 0, // ★★★ P2: 明示クリア用トークン ★★★
  draftCommentId = null, // ★★★ A: ShareViewからの新規コメント用ID ★★★
  renderTargetCommentId = null, // ★★★ REQUIRED: 表示対象commentId（リロード後の下書き復元用） ★★★
  canvasContextKey = null, // ★★★ P1: 内部リセット用キー（paintContextId含む）★★★
  isCanvasTransitioning = false, // ★★★ D: 遷移中フラグ（incoming empty時のMap保持用）★★★
  hidePaintOverlay = false, // ★★★ 案B: 新規コメント入力中は描画を非表示 ★★★
  onBgLoad = null, // ★★★ FIT: 背景ロード完了時のコールバック ★★★
  externalPan = null, // ★★★ FIT: 親からのpan制御 ★★★
  onPanChange = null, // ★★★ FIT: pan変更を親に通知 ★★★
  onScaleInfoChange = null, // ★★★ SCALE: 実表示倍率を親に通知 ★★★
  showDraftOnly = false, // ★★★ P0-V5: 未選択時 draft のみ表示フラグ ★★★
}, ref) => {
  const containerRef = useRef(null);
  const stageRef = useRef(null);
  const contentGroupRef = useRef(null);
  const paintLayerRef = useRef(null);
  const stableFileUrlRef = useRef(fileUrl);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [bgSize, setBgSize] = useState({ width: 800, height: 600 });
  const [error, setError] = useState(null);
  const [bgReady, setBgReady] = useState(false); // P2 FIX: 背景ロード完了フラグ
  
  // ★★★ P0-V5: contentReady判定（bgReady フラグベース、リロード時フラッシュ防止）★★★
  const contentReady = bgReady && bgSize.width > 0 && bgSize.height > 0;

  
  // 描画状態（CRITICAL: Map方式で置換禁止）
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentShape, setCurrentShape] = useState(null);
  const shapesMapRef = useRef(new Map()); // ★ CRITICAL: Mapが唯一の真実
  const [shapesVersion, setShapesVersion] = useState(0); // 再描画トリガー
  const [selectedId, setSelectedId] = useState(null);
  const transformerRef = useRef(null);
  const shapeRefs = useRef({});
  
  // Map操作ヘルパー
  // A) 無限ループ対策: bumpの参照を安定化
  const bump = useCallback(() => setShapesVersion(v => v + 1), []);
  const getAllShapes = () => Array.from(shapesMapRef.current.values());
  
  // 後方互換用（shapesRef.currentを参照している箇所向け）
  const shapesRef = { get current() { return getAllShapes(); } };
  // ★★★ CRITICAL: 描画開始時のview/scale情報を固定（ジャンプ防止の核心）★★★
  const drawViewRef = useRef(null); // { viewX, viewY, contentScale } を描画開始時に保存
  const isInteractingRef = useRef(false); // ★ B) 操作中はtrue（drag/transform）
  const pendingIncomingShapesRef = useRef(null); // ★ B) 操作中に保留された外部Shapes
  const isDraggingRef = useRef(false); // CRITICAL: ドラッグ中フラグ（残像防止）
  const dragRafRef = useRef(null); // RAF間引き用
  const pendingDragRef = useRef(null); // ドラッグ座標バッファ
  
  const isDrawingRef2 = useRef(false);
  const currentShapeRef2 = useRef(null);
  
  // CRITICAL: activeCommentId変化検知用
  const prevActiveCommentIdRef = useRef(activeCommentId);
  const draftCommentIdRef = useRef(null); // 仮コメントID（描画開始時にactiveCommentIdが無い場合）
  // ★★★ REMOVED: lastStableCommentIdRef - fallback禁止のため完全削除 ★★★
  
  // ★★★ CRITICAL: 描画コンテキスト変化検知用（Map残留根絶）★★★
  const prevCanvasContextKeyRef = useRef(null);
  const pendingCtxRef = useRef(null); // ★ FIX-PENDING: 新ctx待機用（Map即クリア禁止）
  const prevEmptyCountRef = useRef(0); // Hunk E: empty連続カウント（2回連続でクリア）
  const lastEmptyAppliedCtxRef = useRef(null); // ★★★ P0-FIX: 意図的空表示の重複防止 ★★★
  
  const debugHudLogsRef = useRef([]);
  
  // ★★★ P0-COORD-DIAG: ペイント座標診断用ref（?diag=1で観測、ロジック変更なし）★★★
  const coordDiagRef = useRef({
    paintEnterSeq: 0,        // paintMode ON回数
    strokeSeqInSession: 0,   // 同一paintEnterSeq内のストローク回数
    firstStroke: false,      // 最初のストロークか
    lastPointerEvent: null,  // 'down'|'move'|'up'
    lastPointerRaw: null,    // {clientX, clientY}
    lastPointerStage: null,  // {x, y}
    lastPointerImage: null,  // {x, y, stageX, stageY}
    viewAtEvent: null, ptrDiagStr: null, commitDiagStr: null, downK: null, firstPtr: null, firstCmt: null, lastPtr: null, lastCmt: null,
  });
  const [diagTick, setDiagTick] = useState(0); // HUD更新用tick
  
  // ★ Map方式では shapes state は不要（getAllShapes()を使う）
  // 後方互換のためのダミー（実際はMapを参照）
  const shapes = useMemo(() => getAllShapes(), [shapesVersion]);
  
  // setShapes互換関数（★★★ CRITICAL: 必ず新しいMapを作成して不変更新 ★★★）
  const setShapes = (updater) => {
    let next;
    if (typeof updater === 'function') {
      const current = getAllShapes();
      next = updater(current);
    } else {
      next = updater ?? [];
    }
    // ★★★ CRITICAL: 新しいMap参照を作成（不変更新）★★★
    shapesMapRef.current = new Map(next.map(s => [s.id, s]));
    bump();
  };
  
  // CRITICAL: 描画状態をrefに同期（activeCommentIdリセットガード用）
  useEffect(() => {
    isDrawingRef2.current = isDrawing;
  }, [isDrawing]);
  
  useEffect(() => {
    currentShapeRef2.current = currentShape;
  }, [currentShape]);
  
  // パン状態（★★★ FIT: 親制御とローカル制御の統合 ★★★）
  const [localPan, setLocalPan] = useState({ x: 0, y: 0 });
  const pan = externalPan || localPan;
  const setPan = onPanChange || setLocalPan;
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0, px: 0, py: 0 });

  // ★★★ FIT-FIX: clampPan をここで定義（TDZ回避のため useEffect より前に配置）★★★
  // ★★★ P1-FIX: 同値ガード追加（無限更新防止）、prevPan引数追加 ★★★
  const clampPan = useCallback((nx, ny, currentScaledW, currentScaledH, prevPan = null) => {
    // overflow判定（1px epsilon で揺れ防止）
    const overflowX = currentScaledW > containerSize.width + 1;
    const overflowY = currentScaledH > containerSize.height + 1;
    
    if (!overflowX) {
      nx = 0; // 中央寄せ（はみ出していない軸は固定）
    } else {
      const minX = containerSize.width - currentScaledW;
      const maxX = 0;
      nx = Math.min(maxX, Math.max(minX, nx));
    }
    
    if (!overflowY) {
      ny = 0; // 中央寄せ（はみ出していない軸は固定）
    } else {
      const minY = containerSize.height - currentScaledH;
      const maxY = 0;
      ny = Math.min(maxY, Math.max(minY, ny));
    }
    
    // ★★★ 同値ガード: 変化がなければ同じ参照を返す（無限更新防止）★★★
    if (prevPan && nx === prevPan.x && ny === prevPan.y) {
      return prevPan;
    }
    
    return { x: nx, y: ny };
  }, [containerSize.width, containerSize.height]);
  
  // テキスト入力用
  const [textEditor, setTextEditor] = useState({
    visible: false,
    x: 0,
    y: 0,
    value: '',
    shapeId: null,
    imgX: 0,
    imgY: 0,
    openedAt: 0,
  });
  const [isComposing, setIsComposing] = useState(false);
  const textInputRef = useRef(null);

  const hidePaintUntilSelectRef = useRef(false);
  
  // Undo/Redo
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  
  // デバッグ用（refベースで再レンダー削減）
  const debugRef = useRef({ lastEvent: 'none', pointerPos: null, imgPos: null, saveStatus: 'idle', error: null, mutation: null, payload: null, successId: null });
  const [isSaving, setIsSaving] = useState({});
  
  const isImage = mimeType?.startsWith('image/');
  const isEditMode = tool === 'select';
  const isDrawMode = !isEditMode && (paintMode || tool === 'text');
  
  // ★ CRITICAL: fileUrlを正規化してリセット判定に使う（クエリ違いでリセットしない）
  const fileIdentity = useMemo(() => normalizeFileUrl(fileUrl), [fileUrl]);
  
  // ★ CRITICAL: 選択に使うIDは activeCommentId または draftCommentId（ShareViewからの仮ID）
  // ★★★ A: draftCommentIdRef.currentではなく、propsのdraftCommentIdを優先 ★★★
  const effectiveActiveId = activeCommentId ?? draftCommentId ?? draftCommentIdRef.current ?? null;

  // ★★★ FIX-1: 権限分離（新規描画と既存編集を完全分離）★★★
  const isSelectTool = tool === 'select';
  const canDrawNew = !!paintMode;                          // 新規描画：paintMode だけでOK（T1/T2）
  const canCommitNew = !!paintMode;                        // 新規確定：paintMode だけでOK
  const canSelectExisting = !!paintMode && isSelectTool;   // 既存選択：paintMode && selectツール
  const canMutateExisting = !!paintMode && !!draftReady && isSelectTool;  // 既存編集：paintMode && draftReady && selectツール（T2編集）
  const canEdit = canMutateExisting;                       // 後方互換
  // ★★★ FIX-DELETE: 削除は isEditMode && paintMode で許可（draftReady不要）★★★
  const canDeleteExisting = !!paintMode && isEditMode;     // 削除：paintMode && selectツール のみ
  
  // ★★★ NEW: 削除専用フラグ（paintMode不問、targetIdがあれば削除可能）★★★
  const targetIdForDelete = effectiveActiveId != null ? String(effectiveActiveId) : '';
  const canEditPaint = targetIdForDelete !== '';  // 削除操作の可否

  // ★★★ FIX-DELETE: 選択可能性（編集モード時はDB shapeも選択可能に）★★★
  const isSelectableShape = (shape) => {
    // ★★★ CRITICAL: paintMode && selectツール の時のみ選択可能 ★★★
    if (!paintMode || !isSelectTool) return false;
    if (effectiveActiveId == null) return false;
    return sameId(shapeCommentId(shape), effectiveActiveId);
  };

  // ★★★ CRITICAL: 編集可能性（選択可能 = 編集可能）★★★
  const isEditableShape2 = (shape) => isSelectableShape(shape);
  
  // CRITICAL: 描画に使うcomment_idを取得（paintContextId = draftCommentId が最優先）
  // ★★★ CRITICAL: draftCommentId（= paintContextId）を最優先、UUID生成禁止 ★★★
  const getCommentIdForDrawing = () => {
    if (draftCommentId != null && draftCommentId !== '') return String(draftCommentId);
    if (renderTargetCommentId != null && renderTargetCommentId !== '') return String(renderTargetCommentId);
    if (activeCommentId != null && activeCommentId !== '') return String(activeCommentId);
    console.error('[ViewerCanvas] getCommentIdForDrawing: no paintContextId available');
    return null;
  };
  
  // ★★★ P0-V5: 表示対象決定（統一ルール固定：showDraftOnly 最優先）★★★
  const renderedShapes = useMemo(() => {
    const mapShapes = getAllShapes();
    let sourceShapes = mapShapes;

    // 描画中のshapeは常に除外（後で別途描画するため）
    if (currentShape?.id) {
      sourceShapes = sourceShapes.filter(s => s.id !== currentShape.id);
    }

    // ★★★ P0-V5: showDraftOnly 最優先（未選択時 draft のみ表示、確定描画は出さない）★★★
    if (showDraftOnly) {
      const draftsOnly = sourceShapes.filter(s => {
        if (s.isDraft === true) return true;
        const cid = resolveCommentId(s);
        return cid && String(cid).startsWith('temp_');
      });
      console.log('[ViewerCanvas] renderedShapes: showDraftOnly=TRUE, returning drafts only', {
        sourceCount: sourceShapes.length,
        draftCount: draftsOnly.length,
      });
      return draftsOnly;
    }

    // ★★★ P0-V5: ID正規化（入口で1回だけ）★★★
    const normalizeNullableId = (v) => (v == null || v === 'null' || v === 'undefined' || v === '' ? null : v);
    const targetId = normalizeNullableId(renderTargetCommentId);

    // ★★★ P0-V5: showAllPaint 優先（選択中でも全表示ON時は全描画）★★★
    if (showAllPaint) {
      console.log('[ViewerCanvas] renderedShapes: showAllPaint=TRUE, returning all', { count: sourceShapes.length });
      return sourceShapes;
    }

    // ★★★ P0-V5: targetId あり（選択中）→ 選択コメント紐づきのみ ★★★
    if (targetId) {
      const filtered = sourceShapes.filter(s => resolveCommentId(s) === targetId);
      console.log('[ViewerCanvas] renderedShapes: targetId set, filtered by commentId', { 
        targetId: targetId.substring(0, 12), 
        filteredCount: filtered.length,
        sourceCount: sourceShapes.length,
      });
      return filtered;
    }

    // ★★★ P0-V5: targetId なし + showDraftOnly=false → 空（フォールバック）★★★
    console.log('[ViewerCanvas] renderedShapes: fallback to empty', { sourceCount: sourceShapes.length });
    return [];
  }, [shapesVersion, showAllPaint, renderTargetCommentId, currentShape, showDraftOnly]);

  // ★★★ Hunk1: hidePaintOverlay時は描画を確実に空にする（表示レイヤー制御）★★★
  const renderedShapesFinal = hidePaintOverlay ? [] : renderedShapes;
  
  // P0-DIAG: 最終表示配列
  if (DEBUG_MODE) console.log('[VC] final:', { hide: hidePaintOverlay, cnt: renderedShapesFinal.length, cur: !!currentShape });
  
  // ★ CRITICAL: editableIds は existingShapes + activeCommentId から作る
  const editableIds = useMemo(() => {
    if (!existingShapes?.length || activeCommentId == null) return new Set();
    return new Set(existingShapes.filter(s => sameId(shapeCommentId(s), activeCommentId)).map(s => s.id));
  }, [existingShapes, activeCommentId]);

  // CRITICAL: 編集可能かをcomment_id一致で判定（sameId使用）
  const isEditableShape = (shape) => {
    if (!canEdit) return false;                  // paintMode && draftReady && tool==='select' の時だけ編集OK
    if (effectiveActiveId == null) return false;
    return sameId(shapeCommentId(shape), effectiveActiveId);
  };
  
  // fileUrl安定化（最後の有効URLを保持）
  useEffect(() => {
    if (fileUrl) {
      stableFileUrlRef.current = fileUrl;
    }
  }, [fileUrl]);

  // ★★★ P0: hidePaintOverlay時は選択解除のみ（Map破壊禁止、Layer key切替で残像根絶）★★★
  useEffect(() => {
    if (hidePaintOverlay && selectedId) {
      setSelectedId(null);
      console.log('[P0] hidePaintOverlay=true: selection cleared (Map preserved)');
    }
  }, [hidePaintOverlay, selectedId]);



  // CRITICAL: activeCommentId変化時の完全リセット
  // ★★★ FIX: コメント切替時は全ての編集状態を完全クリア（前コメントの描画残り防止）★★★
  useEffect(() => {
    const prev = prevActiveCommentIdRef.current;
    prevActiveCommentIdRef.current = activeCommentId;

    // ★ 同じIDへの変更は無視（型も統一して比較）
    if (String(prev ?? '') === String(activeCommentId ?? '')) return;

    // ★★★ CRITICAL: コメント切替時は全ての編集状態を完全リセット ★★★
    // currentShape（描画中オブジェクト）
    setCurrentShape(null);
    currentShapeRef2.current = null;
    
    // isDrawing / tool状態に紐づく一時フラグ
    setIsDrawing(false);
    isDrawingRef2.current = false;
    
    hidePaintUntilSelectRef.current = false;
    
    // 選択中shapeId
    setSelectedId(null);
    
    // テキストエディタ
    setTextEditor({ visible: false, x: 0, y: 0, value: '', shapeId: null, imgX: 0, imgY: 0, openedAt: 0 });

    // ★★★ CRITICAL: draftCommentIdRefをクリア（前コメントのドラフト参照をリセット）★★★
    draftCommentIdRef.current = null;
    
    // ★★★ CRITICAL: drawViewRefもクリア（座標系の混乱防止）★★★
    drawViewRef.current = null;

    // ★★★ CRITICAL: activeCommentId変更時に必ずbump()でrenderedShapesを再計算させる ★★★
    bump();

    requestAnimationFrame(() => {
      if (transformerRef.current) {
        transformerRef.current.nodes([]);
        const layer = transformerRef.current.getLayer();
        if (layer?.batchDraw) {
          layer.batchDraw();
        }
      }
    });
  }, [activeCommentId]);
  
  // ★★★ REMOVED: lastStableCommentIdRef更新処理 - fallback禁止のため削除 ★★★

  // CRITICAL: 送信完了後のキャンバスクリア（nonce変化で発火）
  const prevNonceRef = useRef(clearAfterSubmitNonce);
  useEffect(() => {
    if (clearAfterSubmitNonce !== prevNonceRef.current) {
      prevNonceRef.current = clearAfterSubmitNonce;

      // ★★★ CRITICAL: 送信完了後は全ての編集状態を完全リセット ★★★
      // draftCommentIdRef（前コメントのドラフト参照）
      draftCommentIdRef.current = null;
      
      // 選択中shapeId
      setSelectedId(null);
      
      // currentShape（描画中オブジェクト）
      setCurrentShape(null);
      
      // isDrawing
      setIsDrawing(false);
      
      // テキストエディタ
      setTextEditor({ visible: false, x: 0, y: 0, value: '', shapeId: null, imgX: 0, imgY: 0, openedAt: 0 });

      // Transformer解除
      if (transformerRef.current) {
        transformerRef.current.nodes([]);
        const layer = transformerRef.current.getLayer();
        if (layer?.batchDraw) {
          layer.batchDraw();
        }
      }
    }
  }, [clearAfterSubmitNonce]);

  // ★★★ REMOVED: hidePaintUntilSelect解除処理 - 不要なフラグ操作を削除 ★★★

  // CRITICAL: 仮commentIdで描いたshapeを、activeCommentId確定後に付け替える
  useEffect(() => {
    if (!activeCommentId) return;
    if (!draftCommentIdRef.current) return;

    const draftId = draftCommentIdRef.current;
    if (DEBUG_MODE) console.log('[ViewerCanvas] attaching draft shapes to real comment', { draftId, activeCommentId });

    setShapes(prev => prev.map(s => s.comment_id === draftId ? { ...s, comment_id: activeCommentId } : s));
    draftCommentIdRef.current = null;
  }, [activeCommentId]);

  // ★★★ B) コンテキスト変更時は即座にMapをクリア（描画混在防止）★★★
  useLayoutEffect(() => {
    if (!canvasContextKey) return;

    const prev = prevCanvasContextKeyRef.current;
    if (prev !== canvasContextKey) {
      console.log('[B-FIX] CTX CHANGED -> Map/pending/lastNonEmpty/emptyStreak cleared', { prev, next: canvasContextKey });

      // B) 描画混在対策: コンテキスト変更時は即座にMapをクリアし、古い描画の残留を根絶
      shapesMapRef.current = new Map();
      pendingCtxRef.current = null;
      // ★★★ Hunk1: lastNonEmpty/emptyStreakを必ずリセット（跨ぎ温存防止）★★★
      lastNonEmptyShapesRef.current = { key: null, shapes: null };
      emptyStreakCountRef.current = 0;
      prevEmptyCountRef.current = 0;
      lastEmptyAppliedCtxRef.current = null;
      bump(); // 画面を確実に更新

      setSelectedId(null);
      setCurrentShape(null);
      setIsDrawing(false);
      prevCanvasContextKeyRef.current = canvasContextKey;

      console.log('[B-FIX] CTX CHANGED complete: shapesVersion bumped, Map size=0');
    }
  }, [canvasContextKey, bump]);

  // ★★★ P0-V4: reset は fileIdentity/pageNumber 変更時のみ（externalPan除外で誤reset防止）★★★
  const prevFileIdentityRef = useRef(fileIdentity);
  useEffect(() => {
    const prev = prevFileIdentityRef.current;
    const next = fileIdentity;
    
    // ★★★ P0-FIT: 空→空 または 空→実値 の初回確定では reset しない ★★★
    if (!prev && !next) return;
    if (!prev && next) {
      prevFileIdentityRef.current = next;
      prevFileIdentityRef.pageNumber = pageNumber;
      console.log('[P0-V5] fileIdentity first set, NO reset (pageNumber also saved):', { fileId: next?.substring(0, 30), pageNumber });
      return;
    }
    
    // ★★★ P0-FIT: 同値なら何もしない ★★★
    if (prev === next && pageNumber === prevFileIdentityRef.pageNumber) return;
    
    prevFileIdentityRef.current = next;
    prevFileIdentityRef.pageNumber = pageNumber;
    
    console.log('[P0-V4] fileIdentity/pageNumber CHANGED, resetting state:', { prev: prev?.substring(0, 30), next: next?.substring(0, 30), pageNumber, mapSizeBefore: shapesMapRef.current.size });
    shapesMapRef.current = new Map(); // ★ Mapをクリア（ファイル/ページ変更時のみ）
    bump();
    setSelectedId(null);
    setCurrentShape(null);
    setUndoStack([]);
    setRedoStack([]);
    // ★★★ FIT-FIX: pan リセットは親制御時のみローカルに適用（外部制御なら親が責任を持つ）★★★
    if (!externalPan) {
      setLocalPan({ x: 0, y: 0 });
    }
    setBgReady(false); // P2 FIX: ファイル変更時に背景ロード状態をリセット
    console.log('[P0-V4] bgReady reset to false (file changed)');
  }, [fileIdentity, pageNumber]); // ★★★ P0-V4: externalPan を依存配列から除外（pan変更でresetさせない）★★★

  // zoom変更時はpanのクランプのみ（shapesは触らない）
  // ★★★ FIT-FIX: pan/setPanを依存配列から除外（無限ループ防止）★★★
  // ★★★ panの現在値はrefで参照、変化検知はzoom/containerSize/bgSizeのみ ★★★
  const panRef = useRef(pan);
  panRef.current = pan;
  
  // ★★★ CRITICAL: setPan も ref 経由で参照（依存配列に入れると再生成で無限ループ）★★★
  const setPanRef = useRef(setPan);
  setPanRef.current = setPan;
  
  useEffect(() => {
    // contentScale をここで計算（定義前に参照できないため）
    const localFitScale = Math.min(
      containerSize.width / bgSize.width,
      containerSize.height / bgSize.height
    ) || 1;
    const localContentScale = localFitScale * (zoom / 100);
    
    const currentScaledWidth = bgSize.width * localContentScale;
    const currentScaledHeight = bgSize.height * localContentScale;
    
    // ★★★ CRITICAL: panRef経由で現在値を取得（依存配列に入れない）★★★
    const currentPan = panRef.current;
    const clamped = clampPan(currentPan.x, currentPan.y, currentScaledWidth, currentScaledHeight);
    
    // 同値ガード（無限ループ防止）
    if (clamped.x !== currentPan.x || clamped.y !== currentPan.y) {
      console.log('[FIT] zoom/size changed, clamping pan:', { from: currentPan, to: clamped });
      setPanRef.current(clamped);
    } else if (DEBUG_MODE) {
      console.log('[FIT] zoom/size changed, pan already clamped (skip setPan)');
    }
  }, [zoom, containerSize.width, containerSize.height, bgSize.width, bgSize.height, clampPan]);

  // ★★★ P0: forceClearToken は UI状態のみリセット（Map破壊禁止、Layer key切替で対応）★★★
  const prevForceClearTokenRef = useRef(forceClearToken);
  useEffect(() => {
    if (forceClearToken === prevForceClearTokenRef.current) return;
    prevForceClearTokenRef.current = forceClearToken;

    console.log('[P0] forceClearToken changed, clearing UI state only (Map preserved):', {
      forceClearToken,
      canvasContextKey: canvasContextKey?.substring(0, 20) || 'null',
    });

    // ★★★ P0: UI状態のみクリア（Map/lastNonEmpty/emptyStreakは保持）★★★
    setSelectedId(null);
    setCurrentShape(null);
    setIsDrawing(false);
    setTextEditor({ visible: false, x: 0, y: 0, value: '', shapeId: null, imgX: 0, imgY: 0, openedAt: 0 });
    if (transformerRef.current) {
      transformerRef.current.nodes([]);
      transformerRef.current.getLayer()?.batchDraw();
    }

    console.log('[P0] forceClearToken complete: UI cleared, Map preserved');
    }, [forceClearToken]);

  // ★★★ FIX-PENDING: existingShapes FULL SYNC（pendingCtx対応版）★★★
  // ★★★ P0-FLICKER: 送信後のrefetch瞬間emptyを無視（ちらつき防止）★★★
  // ★★★ Hunk1: lastNonEmpty をコンテキストキー付きに変更（跨ぎ温存防止）★★★
  const lastNonEmptyShapesRef = useRef({ key: null, shapes: null }); // { key: canvasContextKey, shapes: [...] }
  const emptyStreakCountRef = useRef(0); // 連続empty回数

  // ★★★ 案B: temp_新規 × 非ペイント × showAllPaint=false → 空を意図的に許可 ★★★
  const isTempCtx = String(renderTargetCommentId || '').startsWith('temp_');
  const allowIntentionalEmpty = isTempCtx && !paintMode && !showAllPaint;

  useLayoutEffect(() => {
    // ★★★ P0: hidePaintOverlay時はMap破壊禁止（Layer key切替で残像根絶）★★★
    if (hidePaintOverlay) {
      console.log('[P0] hidePaintOverlay=true -> SYNC SKIP (Map preserved, Layer will remount)');
      return;
    }
    
    // ★ 操作中は更新を保留し、pending に保存
    if (isInteractingRef.current) {
      console.log('[SYNC] Interaction in progress, deferring SYNC');
      pendingIncomingShapesRef.current = existingShapes;
      return;
    }

    // ★ 保留されていた shapes を優先的に使用
    const incomingRaw = pendingIncomingShapesRef.current || existingShapes;
    pendingIncomingShapesRef.current = null; // 処理後にクリア

    if (!incomingRaw) return;

    // ★★★ Hunk1: renderTargetCommentIdでフィルタ（表示ターゲット以外を除外）★★★
    const incoming = (!showAllPaint && renderTargetCommentId)
      ? (Array.isArray(incomingRaw) ? incomingRaw : []).filter(s => String(resolveCommentId(s) || '') === String(renderTargetCommentId))
      : (Array.isArray(incomingRaw) ? incomingRaw : []);
    
    const shapesToSync = incoming;

    // ★★★ P0-TDZ-FIX: prevMapSize を参照より前に必ず宣言 ★★★
    const prevMapSize = shapesMapRef.current.size;
    const ctx = canvasContextKey || 'no-ctx';
    const isPending = !!pendingCtxRef.current;

    // ★★★ Hunk2: 空判定は filtered (incoming) 基準 ★★★
    const incomingEmpty = incoming.length === 0;

    // ★★★ P0-V2: 案B2ガード削除（renderTargetCommentId が activeCommentId なので temp_ で過剰クリア不要）★★★
    // REMOVED: 案B2 Intentional empty block (過剰Map clear の元凶)

    // ★★★ P0-FLICKER: 非空shapesを記録（コンテキストキー付き）★★★
    if (!incomingEmpty) {
      lastNonEmptyShapesRef.current = { key: ctx, shapes: shapesToSync };
      emptyStreakCountRef.current = 0;
    }

    // ★★★ P0-SYNC-GUARD: 送信直後の一瞬empty（refetch中）を無視 ★★★
    // 条件: incoming=0, prevMap>0, ctx同一, 遷移中でない → 保持
    // ★★★ Hunk2: transient emptyガードを同一ctxのみに限定（別コメント混入防止）★★★
    // ★★★ P1 FIX: temp_コンテキスト（新規）では温存禁止（前コメント混入防止）★★★
    const isNewTempCtx = String(renderTargetCommentId || '').startsWith('temp_');
    if (incomingEmpty && prevMapSize > 0 && !isPending && !allowIntentionalEmpty && !hidePaintOverlay && !isNewTempCtx) {
      const lastNonEmpty = lastNonEmptyShapesRef.current;
      const isSameCtx = lastNonEmpty?.key === ctx;
      const lastNonEmptyCount = (isSameCtx && lastNonEmpty?.shapes?.length) || 0;

      // ★★★ CRITICAL: 同一コンテキストかつ連続empty5回未満のみ保持を許可 ★★★
      if (isSameCtx && lastNonEmptyCount > 0 && emptyStreakCountRef.current < 5) {
        emptyStreakCountRef.current += 1;
        console.log('[P0-SYNC-GUARD] SYNC SKIP: transient empty, preserving Map (same ctx, NOT temp_)', {
          ctx: ctx?.substring(0, 20) || 'null',
          prevMapSize,
          emptyStreak: emptyStreakCountRef.current,
          lastNonEmptyCount,
          isNewTempCtx,
        });
        return;
      }
      // ★★★ CRITICAL: コンテキスト不一致なら温存禁止（別コメント混入防止）★★★
      if (!isSameCtx && lastNonEmptyCount > 0) {
        console.log('[P0-SYNC-GUARD] Context mismatch, NOT preserving (prevent cross-comment bleed):', {
          currentCtx: ctx?.substring(0, 20) || 'null',
          lastNonEmptyCtx: lastNonEmpty?.key?.substring(0, 20) || 'null',
        });
      }
    }
    
    // ★★★ P0-V2: 案B allowIntentionalEmpty 削除（renderTargetCommentId=activeCommentId なので不要）★★★
    // REMOVED: allowIntentionalEmpty block (過剰Map clear の元凶)

    // ★★★ FIX-PENDING: pending中のincomingEmpty は何もしない（旧Map保持）★★★
    if (isPending && incomingEmpty) {
      // ★★★ FIX-INIT: prevMapSize=0 の場合は pending解除（空×空で固着防止）★★★
      if (prevMapSize === 0) {
        console.log('[FIX-INIT] pending解除 (empty×empty, no point preserving)', { ctx, prevMapSize });
        pendingCtxRef.current = null;
        return;
      }
      
      // ★★★ FIX-NO-BLANK: isCanvasTransitioning=false なら0件確定でpending解除 ★★★
      if (!isCanvasTransitioning) {
        console.log('[FIX-NO-BLANK] pending解除 (0件確定, transition完了)', { ctx, prevMapSize });
        shapesMapRef.current = new Map();
        pendingCtxRef.current = null;
        bump();
        return;
      }
      
      console.log('[FIX-PENDING] SYNC SKIP: pending ctx, empty incoming, Map preserved', { ctx, prevMapSize });
      return;
    }

    // ★★★ FIX-PENDING: pending中のincomingあり → Map一発置換してpending解除 ★★★
    if (isPending && !incomingEmpty) {
      console.log('[FIX-PENDING] SYNC: pending ctx, incoming arrived, replacing Map', {
        ctx,
        incomingRawLength: incomingRaw.length,
        incomingFilteredLength: incoming.length,
        prevMapSize,
      });
      
      // dirtyShapes保持（既存ロジック）
      const dirtyShapes = new Map();
      for (const [id, shape] of shapesMapRef.current.entries()) {
        if (shape._dirty) {
          dirtyShapes.set(id, shape);
        }
      }

      // newMap構築（既存ロジック）
      const newMap = new Map();
      for (const s of shapesToSync) {
        const normalized = normalizeShape(s, null);
        const cid = resolveCommentId(normalized);
        if (!normalized || !cid) {
          console.log('[ViewerCanvas] Skipping shape with empty comment_id:', s.id?.substring?.(0, 8));
          continue;
        }
        if (dirtyShapes.has(normalized.id)) {
          newMap.set(normalized.id, dirtyShapes.get(normalized.id));
        } else {
          newMap.set(normalized.id, normalized);
        }
      }
      
      for (const [id, shape] of dirtyShapes.entries()) {
        if (!newMap.has(id)) {
          newMap.set(id, shape);
        }
      }

      console.log('[FIX-PENDING] Map replaced, pending cleared:', {
        newSize: newMap.size,
        dirtyCount: dirtyShapes.size,
      });
      shapesMapRef.current = newMap;
      pendingCtxRef.current = null;
      bump();
      return;
    }

    // ★★★ 同一ctx（!isPending）での処理 ★★★
    if (incomingEmpty) {
      // ★★★ P0-FLICKER: emptyストリークをカウント ★★★
      emptyStreakCountRef.current += 1;

      // ★★★ P0-FLICKER: 同一contextKeyかつ前回非空があれば、5回連続emptyまで保持 ★★★
      // ★★★ Hunk2: transient emptyガードを同一ctxのみに限定（別コメント混入防止）★★★
      const lastNonEmpty = lastNonEmptyShapesRef.current;
      const isSameCtx = lastNonEmpty?.key === ctx;
      const lastNonEmptyCount = (isSameCtx && lastNonEmpty?.shapes?.length) || 0;

      // ★★★ CRITICAL: 同一コンテキストかつ連続empty5回未満のみ保持を許可 ★★★
      // ★★★ Hunk2: hidePaintOverlay時は意図的空表示なのでtransient guard無効 ★★★
      if (!allowIntentionalEmpty && !hidePaintOverlay && isSameCtx && lastNonEmptyCount > 0 && emptyStreakCountRef.current < 5) {
        console.log('[P0-FLICKER] SYNC SKIP: transient empty, preserving lastNonEmpty (same ctx)', {
          ctx: ctx?.substring(0, 20) || 'null',
          prevMapSize,
          emptyStreak: emptyStreakCountRef.current,
          lastNonEmptyCount,
          paintMode,
        });
        // ★★★ P0-FLICKER-v2: lastNonEmptyをMapに復元（表示を維持）★★★
        if (prevMapSize === 0 && lastNonEmpty?.shapes) {
          const restoreMap = new Map();
          lastNonEmpty.shapes.forEach(s => restoreMap.set(s.id, s));
          shapesMapRef.current = restoreMap;
          bump();
        }
        return;
      }
      // ★★★ CRITICAL: コンテキスト不一致なら温存禁止（別コメント混入防止）★★★
      if (!isSameCtx && lastNonEmpty?.shapes?.length > 0) {
        console.log('[P0-FLICKER] Context mismatch, NOT preserving (prevent cross-comment bleed):', {
          currentCtx: ctx?.substring(0, 20) || 'null',
          lastNonEmptyCtx: lastNonEmpty?.key?.substring(0, 20) || 'null',
        });
      }

      // ★★★ P0-FINAL: P1 FIX を削除（誤発火でdb>0でもMapクリア→描画消失の原因）★★★
      // renderTargetCommentId だけでは「真に描画がないコメント」か判定できない
      // → ctx変更（canvasContextKey変化）で既にMapクリア済み（L442-459）
      // → 追加の empty判定は不要（二重クリアで誤発火の温床）

      // 既存のロジック：描画がないコメント選択以外のケース（例：初回ロードなど）
      // ★★★ Hunk2: 遷移中でも「空にしたい意図」があれば空にする ★★★
      if (isCanvasTransitioning) {
          // hidePaintOverlay または allowIntentionalEmpty 時は空表示を優先
          if (hidePaintOverlay || allowIntentionalEmpty) {
            // ★★★ P0-FIX: Mapが空のときだけskip、復活後は再クリア可能に ★★★
            if (lastEmptyAppliedCtxRef.current === ctx && shapesMapRef.current.size === 0) {
              console.log('[Hunk2] transitioning clear intent: already applied and Map empty, skipping', { ctx });
              return;
            }
            lastEmptyAppliedCtxRef.current = ctx;

            console.log('[Hunk2] transitioning but clear intent detected, clearing Map:', {
              ctx,
              prevMapSize,
              hidePaintOverlay,
              allowIntentionalEmpty,
            });
            shapesMapRef.current = new Map();
            lastNonEmptyShapesRef.current = { key: null, shapes: null };
            emptyStreakCountRef.current = 0;
            prevEmptyCountRef.current = 0;
            bump();

            // ★★★ P0-FIX: 確実に画面を更新 ★★★
            requestAnimationFrame(() => {
              if (!stageRef.current) {
                console.warn('[P0-GUARD] stageRef.current is null; skip batchDraw');
                return;
              }
              const stage = stageRef.current.getStage?.() || stageRef.current;
              if (!stage?.batchDraw) {
                console.warn('[P0-GUARD] stage.batchDraw unavailable; skip batchDraw');
                return;
              }
              stage.batchDraw();
            });
            return;
          }

          // ★★★ P0-FIX: incoming=0かつprevMap=0のときはスキップしない（空同期を通す）★★★
          if (prevMapSize === 0) {
            console.log('[FIX-3] SYNC SKIP avoided: prevMapSize=0, allowing empty sync', { ctx });
            // fall through to normal processing
          } else {
            console.log('[FIX-3] SYNC SKIP: transitioning (same ctx), Map preserved', { ctx, prevMapSize });
            prevEmptyCountRef.current += 1; // Hunk E: transition中のemptyをカウント
            return;
          }
      }

      // Hunk E: empty連続カウントが2回未満なら保持（一瞬のemptyでクリアしない）
      prevEmptyCountRef.current += 1;
      if (prevEmptyCountRef.current < 2 && prevMapSize > 0) {
        console.log('[Hunk E] SYNC SKIP: first empty, Map preserved (waiting for 2nd)', { ctx, prevMapSize, emptyCount: prevEmptyCountRef.current });
        return;
      }

      // 2回連続empty（または初回から空）なら確定クリア
      if (prevMapSize > 0) {
        console.log('[Hunk E] SYNC: 2nd empty confirmed, Map cleared', { ctx, prevMapSize, emptyCount: prevEmptyCountRef.current });
        shapesMapRef.current = new Map();
        bump();
      }
      prevEmptyCountRef.current = 0; // クリア後はリセット
      emptyStreakCountRef.current = 0; // P0-FLICKER: リセット
      return;
    }

    // ★★★ P0-FLICKER: 非空が来たのでストリークリセット ★★★
    emptyStreakCountRef.current = 0;

    // ★★★ P0-FIX: 非空が来たらlastEmptyAppliedCtxRefもリセット（次の空適用を許可）★★★
    lastEmptyAppliedCtxRef.current = null;

    // Hunk E: 非empty時はカウンターリセット
    prevEmptyCountRef.current = 0;
    
    // ★★★ P0-DIAG: FULL SYNC入口ログ（常に出力） ★★★
    console.log('[ViewerCanvas] FULL SYNC IN', {
      renderTargetCommentId: renderTargetCommentId?.substring(0, 12) || 'null',
      incomingRawLength: incomingRaw.length,
      incomingFilteredLength: incoming.length,
      firstIncomingCommentId: shapesToSync[0] ? resolveCommentId(shapesToSync[0])?.substring(0, 12) : 'none',
      showAllPaint,
      ctx: ctx?.substring(0, 20) || 'null',
      prevMapSize,
    });

    // ★★★ CRITICAL: dirtyなローカルshapeを保持するために一時保存 ★★★
    const dirtyShapes = new Map();
    for (const [id, shape] of shapesMapRef.current.entries()) {
      if (shape._dirty) {
        dirtyShapes.set(id, shape);
      }
    }

    console.log('[ViewerCanvas] existingShapes useEffect (FULL SYNC):', {
      incomingRawLength: incomingRaw.length,
      incomingFilteredLength: incoming.length,
      activeCommentId,
      prevMapSize,
      dirtyCount: dirtyShapes.size,
    });

    // ★★★ CRITICAL: existingShapesのみでMapを作り直す（完全同期）★★★
    const newMap = new Map();

    for (const s of shapesToSync) {
      // ★★★ CRITICAL: normalizeShape で正規化（defaultCommentId=null でDB値保持）★★★
      const normalized = normalizeShape(s, null);

      // comment_idが空のshapeは取り込まない
      const cid = resolveCommentId(normalized);
      if (!normalized || !cid) {
        console.log('[ViewerCanvas] Skipping shape with empty comment_id:', s.id?.substring?.(0, 8));
        continue;
      }

      // dirtyなローカルshapeがあればそちらを優先（描画中の巻き戻り防止）
      if (dirtyShapes.has(normalized.id)) {
        newMap.set(normalized.id, dirtyShapes.get(normalized.id));
      } else {
        newMap.set(normalized.id, normalized);
      }
    }

    // ★★★ CRITICAL: dirtyだがexistingShapesに無いshapeも追加（新規描画中のshape）★★★
    for (const [id, shape] of dirtyShapes.entries()) {
      if (!newMap.has(id)) {
        newMap.set(id, shape);
      }
    }

    console.log('[ViewerCanvas] Map replaced (FULL SYNC):', {
      newSize: newMap.size,
      dirtyCount: dirtyShapes.size,
      ctx,
    });
    shapesMapRef.current = newMap;
    bump();
    if (DEBUG_MODE) {
      console.log('[ViewerCanvas] FULL SYNC END: mapSize=', shapesMapRef.current.size);
    }
  }, [existingShapes, canvasContextKey, isCanvasTransitioning]); // A) shapesVersion は依存から外す（bump呼び出しで再実行防止）

  // ✅ 選択維持（Mapに存在するか確認）
  useEffect(() => {
    if (!selectedId) return;
    if (!shapesMapRef.current.has(selectedId)) {
      setSelectedId(null);
    }
  }, [shapesVersion, selectedId]);

  // mount/unmount debug removed for size

  // ★★★ P0-COORD-DIAG: paintMode ON時に enterSeq++ / strokeSeqInSession=0 ★★★
  useEffect(() => {
    if (paintMode) {
      const cdr = coordDiagRef.current;
      cdr.paintEnterSeq += 1; cdr.strokeSeqInSession = 0; cdr.firstStroke = false; cdr.lastPointerEvent = null;
      cdr.firstPtr = null; cdr.firstCmt = null; cdr.lastPtr = null; cdr.lastCmt = null;
      console.log('[COORD-DIAG] paintMode ON, enterSeq=', cdr.paintEnterSeq);
    }
  }, [paintMode]);
  
  // ★★★ CRITICAL: 描画ツール切替時のみ選択解除（select→pen等の時のみ）★★★
  const prevToolRef = useRef(tool);
  useEffect(() => {
    const prevTool = prevToolRef.current;
    prevToolRef.current = tool;
    
    // select以外のツールに切り替わった時のみ選択解除
    if (prevTool === 'select' && tool !== 'select') {
      setSelectedId(null);
    }
  }, [tool]);

  // Transformer selection（編集モード時のみ、Rect/Circle/Textに対応）
  useEffect(() => {
    if (!transformerRef.current) return;
    
    if (isEditMode && selectedId && shapeRefs.current[selectedId]) {
      const selectedShape = shapes.find(s => s.id === selectedId);
      const canTransform = selectedShape && (selectedShape.tool === 'rect' || selectedShape.tool === 'circle' || selectedShape.tool === 'text' || selectedShape.tool === 'arrow');

      if (canTransform) {
        transformerRef.current.nodes([shapeRefs.current[selectedId]]);
        // テキストの場合：Group内のRectを対象にする
        if (selectedShape.tool === 'text') {
          transformerRef.current.padding(0);
          transformerRef.current.boundBoxFunc(null);
        } else {
          transformerRef.current.padding(0);
          transformerRef.current.boundBoxFunc(null);
        }
        const layer = transformerRef.current.getLayer();
        if (layer?.batchDraw) {
          layer.batchDraw();
        }
      } else {
        transformerRef.current.nodes([]);
        const layer = transformerRef.current.getLayer();
        if (layer?.batchDraw) {
          layer.batchDraw();
        }
      }
    } else {
      transformerRef.current.nodes([]);
      const layer = transformerRef.current.getLayer();
      if (layer?.batchDraw) {
        layer.batchDraw();
      }
    }
    }, [selectedId, isEditMode, shapes]);

  // テキストエディタフォーカス
  useEffect(() => {
    if (textEditor.visible && textInputRef.current) {
      textInputRef.current.focus();
      textInputRef.current.select();
    }
  }, [textEditor.visible]);

  // キーボードショートカット（入力欄フォーカス中は無効）
  useEffect(() => {
    const handleKeyDown = (e) => {
      // 入力欄フォーカス中はショートカット無効
      const target = e.target;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        // ★★★ CRITICAL: paintMode OFF時は削除不可 ★★★
        if (!paintMode) return;
        // ★★★ CRITICAL: 既存shape削除は canDeleteExisting 必須 ★★★
        if (!canDeleteExisting || !selectedId) return;

        const selectedShape = shapes.find(s => s.id === selectedId);
        if (selectedShape) {
          const shapeCommentIdValue = shapeCommentId(selectedShape);
          if (sameId(shapeCommentIdValue, effectiveActiveId)) {
            e.preventDefault();
            handleDelete();
          }
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        performUndo();
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'z') {
        e.preventDefault();
        performRedo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedId, shapes, undoStack, redoStack, canEdit, effectiveActiveId]);

  // ResizeObserver
  useEffect(() => {
    if (!containerRef.current) return;
    
    try {
      const resizeObserver = new ResizeObserver(entries => {
        const entry = entries[0];
        if (entry) {
          const width = entry.contentRect.width;
          const height = entry.contentRect.height;
          // 極小値（50px以下）は無視して瞬断を防止
          if (width > 50 && height > 50) {
            setContainerSize({ width, height });
          }
        }
      });
      
      resizeObserver.observe(containerRef.current);

      const rect = containerRef.current.getBoundingClientRect();
      // 初期値も極小値は無視して瞬断を防止
      if (rect.width > 50 && rect.height > 50) {
        setContainerSize({ width: rect.width, height: rect.height });
      }
      
      return () => resizeObserver.disconnect();
    } catch (e) {
      setError(`ResizeObserver Error: ${e.message}`);
      console.error('ResizeObserver Error:', e);
    }
  }, []);
  
  // ★★★ P1-FIT: スケール計算 - fitModeに応じたbaseFitScaleとユーザーズーム ★★★
  const baseFitScale = useMemo(() => {
    if (!containerSize.width || !containerSize.height || !bgSize.width || !bgSize.height) {
      return 1;
    }
    if (fitMode === 'width') {
      // 横幅フィット: 左右ぴったり（余白があっても拡大）
      return containerSize.width / bgSize.width;
    }
    if (fitMode === 'height') {
      // 縦幅フィット: 上下ぴったり（余白があっても拡大）
      return containerSize.height / bgSize.height;
    }
    // 全体フィット: 全体が収まる（デフォルト）
    return Math.min(
      containerSize.width / bgSize.width,
      containerSize.height / bgSize.height
    );
  }, [fitMode, containerSize.width, containerSize.height, bgSize.width, bgSize.height]);
  
  // 後方互換用（既存コードで fitScale を参照している箇所用）
  const fitScale = baseFitScale;
  
  const userScale = zoom / 100;
  const contentScale = baseFitScale * userScale;
  
  // ★★★ SCALE: 実表示倍率を親に通知（同値ガード付き）★★★
  const prevEffectivePercentRef = useRef(null);
  useEffect(() => {
    if (!onScaleInfoChange) return;
    const effectivePercent = Math.round(contentScale * 100);
    if (prevEffectivePercentRef.current === effectivePercent) return;
    prevEffectivePercentRef.current = effectivePercent;
    onScaleInfoChange({ effectiveScale: contentScale, effectivePercent, fitScale: baseFitScale, zoom });
  }, [contentScale, baseFitScale, zoom, onScaleInfoChange]);
  
  const scaledWidth = bgSize.width * contentScale;
  const scaledHeight = bgSize.height * contentScale;
  
  // 中央寄せオフセット（CRITICAL: Math.max削除で左上スナップ防止）
  const offsetX = (containerSize.width - scaledWidth) / 2;
  const offsetY = (containerSize.height - scaledHeight) / 2;
  
  // 実際の表示位置（パンを考慮）
  const viewX = offsetX + pan.x;
  const viewY = offsetY + pan.y;

  // ★★★ P0-V5: bgLoad完了時に確実にフラグをONし、親に通知（初回のみ）★★★
  const bgLoadCalledRef = useRef(false);
  const handleBgLoad = useCallback((size) => {
    if (bgLoadCalledRef.current) {
      console.log('[P0-V5] bgLoad already called, skipping duplicate');
      return;
    }
    bgLoadCalledRef.current = true;
    setBgSize(size);
    setBgReady(true);
    console.log('[P0-V5] bgLoad SUCCESS, bgReady=true:', { width: size.width, height: size.height });
    if (onBgLoad) {
      onBgLoad(size, containerSize);
    }
  }, [containerSize, onBgLoad]);
  
  // CRITICAL: パンは非ペイント時 or selectツール時（描画ツールとの競合回避）
  // ★★★ FIT: zoom>=100 なら常にパン可能（はみ出し時の移動を復活）★★★
  const canPan = (!paintMode || tool === 'select') && !textEditor.visible && !isDrawing;
  
  // ★★★ clampPan は useEffect より前（L219付近）で定義済み ★★★
  


  // ★★★ CRITICAL: 座標変換（描画中は開始時のview/scaleを使用してジャンプ防止）★★★
  // P0-FIX: viewOverride引数で1点目のズレ防止（frozenViewを渡す）
  const stagePointToImagePoint = (viewOverride) => {
    const stage = stageRef.current;
    if (!stage) return null;
    const p = stage.getPointerPosition();
    if (!p) return null;
    const _branch = viewOverride ? 'override' : (isDrawingRef2.current && drawViewRef.current) ? 'frozen' : 'current';
    const v = viewOverride || (isDrawingRef2.current && drawViewRef.current) || { viewX, viewY, contentScale };
    return { x: (p.x - v.viewX) / v.contentScale, y: (p.y - v.viewY) / v.contentScale, stageX: p.x, stageY: p.y, _branch, _view: v };
  };
  
  // 正規化座標（0-1の範囲）
  const normalizeCoords = (imgX, imgY) => ({
    nx: imgX / bgSize.width,
    ny: imgY / bgSize.height,
  });
  
  const denormalizeCoords = (nx, ny) => ({
    x: nx * bgSize.width,
    y: ny * bgSize.height,
  });
  
  // 操作履歴追加
  const addToUndoStack = (action) => {
    setUndoStack(prev => [...prev, action]);
    setRedoStack([]); // 新しい操作でredoスタックはクリア
  };

  // Undo実行（★★★ CRITICAL: 不変更新で新しいMapを作成 ★★★）
  const performUndo = () => {
    if (undoStack.length === 0) return;
    
    const action = undoStack[undoStack.length - 1];
    setUndoStack(prev => prev.slice(0, -1));
    setRedoStack(prev => [...prev, action]);
    
    // ★★★ CRITICAL: 新しいMapを作成（不変更新）★★★
    const newMap = new Map(shapesMapRef.current);
    if (action.type === 'add') {
      newMap.delete(action.shapeId);
    } else if (action.type === 'update') {
      newMap.set(action.shapeId, action.before);
    } else if (action.type === 'delete') {
      newMap.set(action.shape.id, action.shape);
    }
    shapesMapRef.current = newMap;
    bump();
    onShapesChange?.(getAllShapes());
  };

  // Redo実行（★★★ CRITICAL: 不変更新で新しいMapを作成 ★★★）
  const performRedo = () => {
    if (redoStack.length === 0) return;
    
    const action = redoStack[redoStack.length - 1];
    setRedoStack(prev => prev.slice(0, -1));
    setUndoStack(prev => [...prev, action]);
    
    // ★★★ CRITICAL: 新しいMapを作成（不変更新）★★★
    const newMap = new Map(shapesMapRef.current);
    if (action.type === 'add') {
      // 再追加は困難なので省略
    } else if (action.type === 'update') {
      newMap.set(action.shapeId, action.after);
    } else if (action.type === 'delete') {
      newMap.delete(action.shape.id);
    }
    shapesMapRef.current = newMap;
    bump();
    onShapesChange?.(getAllShapes());
  };

  // CRITICAL: 単体削除（★★★ canMutateExisting で判定、paintMode && draftReady 必須 ★★★）
  const handleDelete = async () => {
    if (!canDeleteExisting || !selectedId) return;
    const selectedShape = shapesMapRef.current.get(selectedId);
    if (!selectedShape) return;
    const shapeCommentIdValue = shapeCommentId(selectedShape);
    if (!sameId(shapeCommentIdValue, effectiveActiveId)) return;
    const shape = selectedShape;
    addToUndoStack({ type: 'delete', shape, index: 0 });
    
    // Transformer解除（先に）
    if (transformerRef.current) {
      transformerRef.current.nodes([]);
      const layer = transformerRef.current.getLayer();
      if (layer?.batchDraw) {
        layer.batchDraw();
      }
    }
    
    // Optimistic update（★★★ CRITICAL: 新しいMapを作成 ★★★）
    const newMap = new Map(shapesMapRef.current);
    newMap.delete(selectedId);
    shapesMapRef.current = newMap;
    bump();
    onShapesChange?.(getAllShapes());
    setSelectedId(null);
    
    // DB削除を実行
    if (onDeleteShape) {
      debugRef.current.mutation = 'delete';
      try {
        console.log('[ViewerCanvas] Calling onDeleteShape...');
        await onDeleteShape(shape);
        debugRef.current.saveStatus = 'success';
        debugRef.current.error = null;
      } catch (err) {
        console.error('[ViewerCanvas] Delete shape error:', err);
        debugRef.current.saveStatus = 'error';
        debugRef.current.error = err.message;
        const revertMap = new Map(shapesMapRef.current);
        revertMap.set(shape.id, shape);
        shapesMapRef.current = revertMap;
        bump();
        onShapesChange?.(getAllShapes());
      }
    }
  };

  // Stage統合ハンドラ：パン、選択解除、描画開始
  const handleStagePointerDown = (e) => {
    const stage = e.target.getStage();
    if (!stage) return;

    if (DEBUG_MODE) {
      console.log('[ViewerCanvas] StagePointerDown', {
        paintMode,
        tool,
        isEditMode,
        isDrawMode,
        isPanMode: canPan,
        textEditorVisible: textEditor.visible
      });
    }

    // 描画モードは従来処理
    if (isDrawMode) {
      handlePointerDown(e);
      return;
    }

    const clickedOnEmpty = e.target === stage;

    // パン開始（背景の空白を掴んだ時のみ）
    if (canPan && clickedOnEmpty && !textEditor.visible) {
      const p = stage.getPointerPosition();
      if (!p) return;
      setIsPanning(true);
      panStartRef.current = { x: pan.x, y: pan.y, px: p.x, py: p.y };
      return;
    }

    // 空白クリックで選択解除
    if (isEditMode && clickedOnEmpty) {
      setSelectedId(null);
    }
  };

  const handleStagePointerMove = (e) => {
    const stage = e.target.getStage();
    if (!stage) return;

    // パン中は他の処理をスキップ
    if (isPanning) {
      const p = stage.getPointerPosition();
      if (!p) return;
      
      // ★★★ P1-FIX: overflow判定を先に行い、はみ出していない軸のdeltaは0にする ★★★
      const currentScaledWidth = bgSize.width * contentScale;
      const currentScaledHeight = bgSize.height * contentScale;
      const overflowX = currentScaledWidth > containerSize.width + 1;
      const overflowY = currentScaledHeight > containerSize.height + 1;
      
      // はみ出していない軸はdeltaを0にして不要な計算/ガタつきを防止
      const dx = overflowX ? (p.x - panStartRef.current.px) : 0;
      const dy = overflowY ? (p.y - panStartRef.current.py) : 0;
      
      // 両軸とも動かないならスキップ
      if (dx === 0 && dy === 0) return;
      
      const nextX = panStartRef.current.x + dx;
      const nextY = panStartRef.current.y + dy;
      const next = clampPan(nextX, nextY, currentScaledWidth, currentScaledHeight, pan);
      
      // ★★★ 同値ガード: clampPanが同じ参照を返したらsetPanしない ★★★
      if (next !== pan) {
        setPan(next);
      }
      return;
    }

    // 描画モードのみ従来のPointerMove
    handlePointerMove(e);
  };

  const handleStagePointerUp = (e) => {
    if (isPanning) {
      setIsPanning(false);
      return;
    }
    // ★★★ P0-FIT: 二重commit防止（window pointerup と競合回避）★★★
    if (commitInFlightRef.current) {
      console.log('[P0-FIT] Stage pointerUp skipped (commit in flight)');
      return;
    }
    commitInFlightRef.current = true;
    handlePointerUp(e);
    requestAnimationFrame(() => {
      commitInFlightRef.current = false;
    });
  };
  
  const commitInFlightRef = useRef(false);
  const handlePointerUpRef = useRef(null);
  const handlePointerDown = (e) => {
    if (DEBUG_MODE) {
      console.log('[🎨 DRAW_DIAG] handlePointerDown ENTRY:', {
        paintMode, tool, isDrawMode, canDrawNew, effectiveActiveId: effectiveActiveId?.substring(0, 12) || 'null',
        renderedShapesLength: renderedShapes.length, mapSize: shapesMapRef.current.size,
      });
    }

    // ★★★ FIX-1: selectツール時は描画開始しない（選択は別処理）★★★
    if (isSelectTool) {
      console.log('[🎨 DRAW_DIAG] PointerDown BLOCKED: isSelectTool=true');
      return;
    }
    
    // ★★★ FIX-1: 新規描画はpaintModeだけでOK（T1/T2即描画）★★★
    if (!paintMode && tool !== 'text') {
      console.warn('[🎨 DRAW_DIAG] PointerDown BLOCKED: paintMode=false', { paintMode, tool });
      return;
    }

    // ★★★ P0-FIX: draftReadyチェックを削除（paintMode ON なら描画開始を許可）★★★
    // draftReady は「既存shape編集」の権限であり、新規描画には不要
    // 描画開始後の commit 時に draftReady をチェックする（L2148）

    // ★★★ CRITICAL: 描画開始時に古いcurrentShapeを強制クリア（前コメントのdraft残り防止）★★★
    // currentShapeのcomment_idがactiveCommentIdと異なる場合は古いdraftなので破棄
    if (currentShape && activeCommentId != null) {
      const currentCid = currentShape.comment_id;
      if (currentCid != null && String(currentCid) !== String(activeCommentId)) {
        if (DEBUG_MODE) console.log('[ViewerCanvas] Clearing stale currentShape from different comment', { currentCid, activeCommentId });
        setCurrentShape(null);
        setIsDrawing(false);
      }
    }

    // ★★★ CRITICAL FIX: 描画開始時にhidePaintUntilSelectを解除しない ★★★
    // この解除が過去shapeを表示させる原因になっている可能性が高い
    // 代わりに、新規描画中はeffectiveActiveId(draftCommentId)のshapeのみ表示される
    // if (hidePaintUntilSelect && paintMode && tool !== 'select') {
    //   if (DEBUG_MODE) console.log('[ViewerCanvas] Clearing hidePaintUntilSelect on draw start');
    //   setHidePaintUntilSelect(false);
    // }

    // ★ CRITICAL: activeCommentIdがnullでもonBeginPaintがあれば描画を許可
    if (activeCommentId == null && tool !== 'select' && !onBeginPaint) {
      console.warn('[🎨 DRAW_DIAG] PointerDown BLOCKED: activeCommentId is null and onBeginPaint is missing');
      return;
    }

    // CRITICAL: tool='text' のときは最優先で処理（paintMode不問）
    if (tool === 'text' && !textEditor.visible) {
      try {
        const imgCoords = stagePointToImagePoint();
        if (!imgCoords) {
          console.error('[ViewerCanvas] Text tool: coords unavailable');
          return;
        }

        console.log('[ViewerCanvas] ✓ Text tool activated:', { 
          tool, 
          paintMode, 
          isDrawMode,
          stage: { x: imgCoords.stageX, y: imgCoords.stageY },
          img: { x: imgCoords.x, y: imgCoords.y }
        });

        setTextEditor({
          visible: true,
          x: imgCoords.stageX,
          y: imgCoords.stageY,
          value: '',
          shapeId: null,
          imgX: Math.max(0, Math.min(bgSize.width, imgCoords.x)),
          imgY: Math.max(0, Math.min(bgSize.height, imgCoords.y)),
          openedAt: Date.now(),
        });
        setIsDrawing(false);
        setCurrentShape(null);
        return;
      } catch (err) {
        console.error('[ViewerCanvas] Text tool error:', err);
        return;
      }
    }
    
    if (!isDrawMode) {
      if (DEBUG_MODE || tool === 'text') {
        console.log('[ViewerCanvas] PointerDown blocked:', { tool, paintMode, isEditMode, isDrawMode });
      }
      return;
    }
    
    // テキスト編集中は処理しない
    if (textEditor.visible) return;
    
    try {
      // ★★★ P0-FIX: 1点目ズレ対策 — (A) pointer座標更新 (B) frozenView先行確保 (C) isDrawingRef先行true ★★★
      if (stageRef.current && e.evt) stageRef.current.setPointersPositions(e.evt);
      const frozenView = { viewX, viewY, contentScale };
      drawViewRef.current = frozenView;
      isDrawingRef2.current = true;
      
      const imgCoords = stagePointToImagePoint(frozenView);
      if (!imgCoords) { drawViewRef.current = null; isDrawingRef2.current = false; return; }
      
      debugRef.current.lastEvent = 'down';
      if (DEBUG_MODE) {
        debugRef.current.pointerPos = { x: imgCoords.stageX, y: imgCoords.stageY };
        debugRef.current.imgPos = { x: imgCoords.x, y: imgCoords.y };
      }
      
      setIsDrawing(true);
      
      // ★ P0-COORD-DIAG: down時の座標情報を記録 + ptrDiag 1行生成
      const rp = { clientX: e.evt?.clientX ?? 0, clientY: e.evt?.clientY ?? 0 };
      const k = stageRef.current?.getPointerPosition() || { x: 0, y: 0 };
      const cd = coordDiagRef.current;
      cd.strokeSeqInSession += 1; cd.firstStroke = (cd.strokeSeqInSession === 1);
      cd.lastPointerEvent = 'down'; cd.lastPointerRaw = rp; cd.lastPointerStage = k;
      cd.lastPointerImage = { x: imgCoords.x, y: imgCoords.y, stageX: imgCoords.stageX, stageY: imgCoords.stageY };
      cd.viewAtEvent = { viewX, viewY, contentScale, offsetX, offsetY, baseFitScale, userScale: zoom / 100, stageW: containerSize.width, stageH: containerSize.height, drawViewRefExists: !!drawViewRef.current, drawViewRefSnapshot: drawViewRef.current ? { ...drawViewRef.current } : null };
      // ptrDiag: k(Konva) vs m(manual from clientXY) + branch/view
      const sr = stageRef.current?.container?.()?.getBoundingClientRect() || { left: 0, top: 0 };
      const m = { x: rp.clientX - sr.left, y: rp.clientY - sr.top };
      const br = imgCoords._branch || '?';
      const vU = imgCoords._view || frozenView;
      cd.downK = { x: k.x, y: k.y };
      cd.ptrDiagStr = `fs=${cd.firstStroke?'Y':'N'} k=(${Math.round(k.x)},${Math.round(k.y)}) m=(${Math.round(m.x)},${Math.round(m.y)}) d=(${Math.round(k.x-m.x)},${Math.round(k.y-m.y)}) br=${br} vX=${Math.round(vU.viewX)} vY=${Math.round(vU.viewY)} sc=${vU.contentScale.toFixed(3)} off=(${Math.round(offsetX)},${Math.round(offsetY)}) tool=${tool}`;
      cd.lastPtr = cd.ptrDiagStr; if (cd.strokeSeqInSession===1 && !cd.firstPtr) cd.firstPtr = cd.ptrDiagStr;
      cd.commitDiagStr = null; setDiagTick(t => t + 1);

      // ★★★ CRITICAL: comment_idを取得（draftCommentId優先、fallback禁止）★★★
      const commentId = getCommentIdForDrawing();
      if (!commentId) {
        console.error('[🎨 DRAW_DIAG] PointerDown BLOCKED: no commentId available', {
          draftCommentId: draftCommentId?.substring(0, 12) || 'null',
          renderTargetCommentId: renderTargetCommentId?.substring(0, 12) || 'null',
          activeCommentId: activeCommentId?.substring(0, 12) || 'null',
        });
        setIsDrawing(false);
        return;
      }

      // ★★★ DEBUG: 描画開始時のcomment_id確認 ★★★
      console.log('[🎨 DRAW_DIAG] Drawing START with commentId:', {
        commentId: commentId?.substring(0, 12),
        draftCommentId: draftCommentId?.substring(0, 12) || 'null',
        effectiveActiveId: effectiveActiveId?.substring(0, 12) || 'null',
        tool,
      });

      // ★★★ DEBUG HUD: 描画開始ログを追加 ★★★
      const drawStartLog = {
        timestamp: new Date().toISOString(),
        event: 'DRAW_START',
        targetId: effectiveActiveId != null ? String(effectiveActiveId) : '',
        activeCommentId: String(activeCommentId ?? ''),
        draftCommentId: String(draftCommentIdRef.current ?? ''),
        commentId,
        tool,
      };
      debugHudLogsRef.current = [...debugHudLogsRef.current.slice(-9), drawStartLog];

      // CRITICAL: clientShapeId は1回だけ発行して固定（移動・編集で絶対に再生成しない）
      const newShape = {
        id: generateUUID(),
        comment_id: commentId,
        tool,
        stroke: strokeColor,
        strokeWidth: strokeWidth,
        startX: imgCoords.x,
        startY: imgCoords.y,
      };
      
      if (tool === 'pen') newShape.points = [imgCoords.x, imgCoords.y];
      // P0-FIX: ref同期セット（useEffect経由だと初回moveでnull→points追記不能→消える）
      currentShapeRef2.current = newShape;
      setCurrentShape(newShape);

      if (onBeginPaint && !activeCommentId) {
        queueMicrotask(() => onBeginPaint(imgCoords.x, imgCoords.y, bgSize.width, bgSize.height));
      }
      } catch (err) {
      console.error('PointerDown Error:', err);
      setError(`PointerDown Error: ${err.message}`);
      }
      };
  
  const handlePointerMove = (e) => {
    if (textEditor.visible) return;
    try {
      // P0-FIX: 描画中は初回moveで座標が古い問題を防止
      if (isDrawingRef2.current && stageRef.current && e.evt) stageRef.current.setPointersPositions(e.evt);
      const imgCoords = stagePointToImagePoint();
      if (!imgCoords) return;
      
      if (DEBUG_MODE && !isDraggingRef.current && !isDrawingRef2.current) {
        debugRef.current.pointerPos = { x: imgCoords.stageX, y: imgCoords.stageY };
        debugRef.current.imgPos = { x: imgCoords.x, y: imgCoords.y };
      }
      
        // P0-COORD-DIAG: move時（最初3点のみ記録）
      if (isDrawingRef2.current && (Math.floor((currentShapeRef2.current?.points?.length ?? 0) / 2)) <= 3) {
        coordDiagRef.current.lastPointerEvent = 'move';
        coordDiagRef.current.lastPointerImage = { x: imgCoords.x, y: imgCoords.y, stageX: imgCoords.stageX, stageY: imgCoords.stageY };
      }
      
      // CRITICAL: refベースで判定（親stateが揺れても描画継続）
      const shape = currentShapeRef2.current;
      if (!isDrawingRef2.current || !shape) return;
      
      debugRef.current.lastEvent = 'move';
      
      const newShape = { ...shape };
      const shapeTool = shape.tool; // CRITICAL: refから取得したshape.tool
      
      if (shapeTool === 'pen') {
        newShape.points = [...(shape.points || []), imgCoords.x, imgCoords.y];
      } else if (shapeTool === 'rect') {
        newShape.x = Math.min(shape.startX, imgCoords.x);
        newShape.y = Math.min(shape.startY, imgCoords.y);
        newShape.width = Math.abs(imgCoords.x - shape.startX);
        newShape.height = Math.abs(imgCoords.y - shape.startY);
      } else if (shapeTool === 'circle') {
        const dx = imgCoords.x - shape.startX;
        const dy = imgCoords.y - shape.startY;
        newShape.radius = Math.sqrt(dx * dx + dy * dy);
        newShape.x = shape.startX;
        newShape.y = shape.startY;
      } else if (shapeTool === 'arrow') {
        newShape.points = [shape.startX, shape.startY, imgCoords.x, imgCoords.y];
      }

      currentShapeRef2.current = newShape; // P0-FIX: ref同期
      setCurrentShape(newShape);
    } catch (err) { console.error('PointerMove Error:', err); }
  };
  
  // Text handlers (extracted to TextHandlers.js)
  const { handleTextConfirm, handleTextCancel, handleTextBlur, handleTextDblClick } = createTextHandlers({
    textInputRef, textEditor, setTextEditor, setIsComposing,
    shapes, shapesMapRef, bump, getAllShapes, onShapesChange,
    addToUndoStack, onSaveShape, onToolChange,
    activeCommentId, getCommentIdForDrawing, onBeginPaint,
    strokeColor, strokeWidth, bgSize, normalizeCoords, denormalizeCoords,
    isEditMode, contentGroupRef, setSelectedId, DEBUG_MODE,
  });

  // PointerUp: 描画終了（CRITICAL: refベースで判定、propsに依存しない）
  const handlePointerUp = async () => {
    if (DEBUG_MODE) {
      console.log('[🎨 DRAW_DIAG] pointerUp ENTRY:', {
        isDrawing: isDrawingRef2.current,
        tool,
        canDrawNew,
        canCommitNew,
        paintMode,
        draftReady,
        renderTargetCommentId: renderTargetCommentId?.substring(0, 12) || 'null',
        draftCommentId: draftCommentId?.substring(0, 12) || 'null',
        currentShapeExists: !!currentShapeRef2.current,
        currentShapeCommentId: currentShapeRef2.current?.comment_id?.substring(0, 12) || 'null',
        mapSize: shapesMapRef.current.size,
      });
    }

    // ★★★ P0-FIT: currentShape がある場合は isDrawing が false でも commit を試みる（取りこぼし防止）★★★
    const shape = currentShapeRef2.current;
    if (!shape) {
      if (DEBUG_MODE) console.log('[DRAW_DEBUG] pointerUp aborted: no currentShape');
      return;
    }
    
    // ★★★ P0-FIT: isDrawing=false でも shape があれば commit 続行（Stage外pointerUp対策）★★★
    if (!isDrawingRef2.current) {
      console.log('[P0-FIT] pointerUp: isDrawing=false but currentShape exists, proceeding with commit');
    }
    
    try {
      debugRef.current.lastEvent = 'up';
      setIsDrawing(false);
      
      const shapeTool = shape.tool; // CRITICAL: refから取得したshape.tool
      
      // しきい値チェック（誤クリック対策）
      if (shapeTool === 'rect') {
        if (!shape.width || !shape.height || shape.width < 5 || shape.height < 5) {
          setCurrentShape(null);
          setIsDrawing(false);
          return;
        }
      } else if (shapeTool === 'circle') {
        if (!shape.radius || shape.radius < 3) {
          setCurrentShape(null);
          setIsDrawing(false);
          return;
        }
      } else if (shapeTool === 'arrow' && shape.points) {
        const dx = shape.points[2] - shape.points[0];
        const dy = shape.points[3] - shape.points[1];
        const length = Math.sqrt(dx * dx + dy * dy);
        if (length < 5) {
          setCurrentShape(null);
          setIsDrawing(false);
          return;
        }
      } else if (shapeTool === 'pen' && shape.points) {
        // Penは最低2点（4座標）必要
        if (shape.points.length < 4) {
          setCurrentShape(null);
          setIsDrawing(false);
          return;
        }
      }

      const resolvedCommentId = shape.comment_id;
      if (!resolvedCommentId) { console.error('[VC] no comment_id, skip'); setCurrentShape(null); setIsDrawing(false); drawViewRef.current = null; return; }
      const normalizedShape = {
        id: shape.id,
        comment_id: resolvedCommentId,
        commentId: resolvedCommentId,
        tool: shapeTool,
        stroke: shape.stroke,
        strokeWidth: shape.strokeWidth,
        bgWidth: bgSize.width,
        bgHeight: bgSize.height,
      };
      
      // ★ console.log：描画確定直後に comment_id が入ってるか確認
      console.log("[paint] normalizedShape ids:", {
        id: normalizedShape?.id,
        comment_id: normalizedShape?.comment_id,
        commentId: normalizedShape?.commentId,
        activeCommentId,
        draftCommentId: draftCommentIdRef.current,
      });

        if (shapeTool === 'pen' && shape.points) {
          const normalizedPoints = [];
          for (let i = 0; i < shape.points.length; i += 2) {
            const { nx, ny } = normalizeCoords(shape.points[i], shape.points[i + 1]);
            normalizedPoints.push(nx, ny);
          }
          normalizedShape.normalizedPoints = normalizedPoints;
        } else if (shapeTool === 'rect') {
          const { nx: nx1, ny: ny1 } = normalizeCoords(shape.x, shape.y);
          const { nx: nx2, ny: ny2 } = normalizeCoords(shape.x + shape.width, shape.y + shape.height);
          normalizedShape.nx = nx1;
          normalizedShape.ny = ny1;
          normalizedShape.nw = nx2 - nx1;
          normalizedShape.nh = ny2 - ny1;
        } else if (shapeTool === 'circle') {
          const { nx, ny } = normalizeCoords(shape.x, shape.y);
          normalizedShape.nx = nx;
          normalizedShape.ny = ny;
          normalizedShape.nr = shape.radius / bgSize.width;
        } else if (shapeTool === 'arrow' && shape.points) {
          const normalizedPoints = [];
          for (let i = 0; i < shape.points.length; i += 2) {
            const { nx, ny } = normalizeCoords(shape.points[i], shape.points[i + 1]);
            normalizedPoints.push(nx, ny);
          }
          normalizedShape.normalizedPoints = normalizedPoints;
        }

      // CRITICAL: 一時フィールドを完全削除（正規化データのみ保存）
      delete normalizedShape.points;
      delete normalizedShape.startX;
      delete normalizedShape.startY;
      delete normalizedShape.x;
      delete normalizedShape.y;
      delete normalizedShape.width;
      delete normalizedShape.height;
      delete normalizedShape.radius;

      // ★★★ P0-FIX: 新規shape確定は canCommitNew のみで判定（draftReady不要）★★★
      // draftReady は「既存shape編集」の権限であり、新規描画の確定には不要
      console.log('[🎨 DRAW_DIAG] commit check:', {
        canCommitNew,
        paintMode,
        draftReady,
        normalizedShapeCommentId: normalizedShape.comment_id?.substring(0, 12) || 'null',
        shapeTool,
      });

      if (!canCommitNew) {
        console.warn('[🎨 DRAW_DIAG] COMMIT BLOCKED: canCommitNew=false', { 
          paintMode, 
          canCommitNew,
          tool: shapeTool,
        });
        setCurrentShape(null);
        setIsDrawing(false);
        drawViewRef.current = null;
        return;
      }

      console.log('[🎨 DRAW_DIAG] COMMIT new shape -> addToMap + onSaveShape:', {
        shapeId: normalizedShape.id.substring(0, 8),
        comment_id: normalizedShape.comment_id?.substring(0, 12),
        tool: shapeTool,
        canCommitNew,
        draftReady,
        mapSizeBefore: shapesMapRef.current.size,
      });

      // Undo履歴に追加
      addToUndoStack({ type: 'add', shapeId: normalizedShape.id });

      // CRITICAL: Map方式でupsert（追加）+ dirty/localTs付与（★★★ 不変更新 ★★★）
      const shapeWithDirty = { ...normalizedShape, _dirty: true, _localTs: Date.now() };
      const newMap = new Map(shapesMapRef.current);
      newMap.set(shapeWithDirty.id, shapeWithDirty);
      shapesMapRef.current = newMap;
      bump();
      console.log('[🎨 DRAW_DIAG] Map updated after commit:', {
        shapeId: shapeWithDirty.id.substring(0, 8),
        comment_id: shapeWithDirty.comment_id?.substring(0, 12),
        tool: shapeWithDirty.tool,
        mapSizeAfter: shapesMapRef.current.size,
        allShapesCount: getAllShapes().length,
      });

      onShapesChange?.(getAllShapes()); // ★ 常に全量を渡す
      console.log('[🎨 DRAW_DIAG] onShapesChange called with count:', getAllShapes().length);
      
      setCurrentShape(null);

      // ★★★ C: 描画確定直後に新規作成したshapeを自動選択（ハンドル/枠が出る）★★★
      setSelectedId(normalizedShape.id);

      // ★★★ C: 自動でselectツールに切り替えて選択状態を維持 ★★★
      if (onToolChange) {
        onToolChange('select');
      }

      // commitDiag: shape確定座標 vs down時k座標（A/B切り分け）
      if (DEBUG_MODE && coordDiagRef.current.downK) { const dK=coordDiagRef.current.downK,cd2=coordDiagRef.current; let ix=0,iy=0; if(normalizedShape.nx!==undefined){const p=denormalizeCoords(normalizedShape.nx,normalizedShape.ny);ix=p.x;iy=p.y;}else if(normalizedShape.normalizedPoints?.length>=2){const p=denormalizeCoords(normalizedShape.normalizedPoints[0],normalizedShape.normalizedPoints[1]);ix=p.x;iy=p.y;} const sx=ix*contentScale+viewX,sy=iy*contentScale+viewY; cd2.commitDiagStr=`img=(${Math.round(ix)},${Math.round(iy)}) stg=(${Math.round(sx)},${Math.round(sy)}) k0=(${Math.round(dK.x)},${Math.round(dK.y)}) Δ=(${Math.round(sx-dK.x)},${Math.round(sy-dK.y)})`; cd2.lastCmt=cd2.commitDiagStr; if(cd2.strokeSeqInSession===1&&!cd2.firstCmt) cd2.firstCmt=cd2.commitDiagStr; setDiagTick(t=>t+1); }

      // 親コンポーネントに保存を依頼（createモード）
      if (onSaveShape) {
        setIsSaving(prev => ({ ...prev, [normalizedShape.id]: true }));
        debugRef.current.saveStatus = 'saving';
        debugRef.current.mutation = 'create';

        console.log('[🎨 DRAW_DIAG] calling onSaveShape:', {
          shapeId: normalizedShape.id.substring(0, 8),
          comment_id: normalizedShape.comment_id?.substring(0, 12),
          mode: 'create',
          tool: normalizedShape.tool,
        });

        try {
          const result = await onSaveShape(normalizedShape, 'create');
          console.log('[🎨 DRAW_DIAG] onSaveShape SUCCESS:', {
            shapeId: normalizedShape.id.substring(0, 8),
            result,
          });
          debugRef.current.saveStatus = 'success';
          debugRef.current.successId = result?.dbId || normalizedShape.id;
          debugRef.current.error = null;

          // CRITICAL: DBから返ってきた_idを既存shapeに上書き + dirty解除（★★★ 不変更新 ★★★）
          const cur = shapesMapRef.current.get(normalizedShape.id);
          if (cur) {
            const newMap = new Map(shapesMapRef.current);
            newMap.set(normalizedShape.id, { ...cur, dbId: result?.dbId, _dirty: false });
            shapesMapRef.current = newMap;
            bump();
            onShapesChange?.(getAllShapes());
          }
        } catch (err) {
          debugRef.current.saveStatus = 'error';
          debugRef.current.error = err.message || String(err);
          console.error('Save Shape Error:', err);
        } finally {
          setIsSaving(prev => ({ ...prev, [normalizedShape.id]: false }));
        }
        }

        // ★★★ CRITICAL: 描画完了時にview固定を解除 ★★★
        drawViewRef.current = null;
        if (DEBUG_MODE) {
          console.log('[ViewerCanvas] drawViewRef cleared (draw complete)');
        }
        } catch (err) {
        console.error('PointerUp Error:', err);
        setError(`PointerUp Error: ${err.message}`);
        debugRef.current.saveStatus = 'error';
        debugRef.current.error = err.message;
        drawViewRef.current = null;
        }
        };
  handlePointerUpRef.current = handlePointerUp;
  useEffect(() => { const h=(e)=>{if(!isDrawingRef2.current||commitInFlightRef.current)return;commitInFlightRef.current=true;handlePointerUpRef.current?.(e);requestAnimationFrame(()=>{commitInFlightRef.current=false;});}; window.addEventListener('pointerup',h); return()=>window.removeEventListener('pointerup',h); }, []);

  // Drag/Transform handlers (extracted to DragTransformHandlers.js)
  const { handleDragStart, handleDragMove, handleDragEnd, handleTransformStart, handleTransformEnd } = createDragTransformHandlers({
    shapesMapRef, bump, getAllShapes, onShapesChange,
    addToUndoStack, onSaveShape, normalizeCoords, denormalizeCoords,
    bgSize, isEditableShape, canMutateExisting, isSaving, setIsSaving,
    isInteractingRef, isDraggingRef, pendingIncomingShapesRef,
    dragRafRef, pendingDragRef, debugRef, setSelectedId,
  });

  // 選択図形にスタイルを適用（CRITICAL: ref基準＆number正規化）
  const applyStyleToSelected = async (patch) => {
    if (!selectedId) return;

    // CRITICAL: shapesRefから取得（stale回避）
    const cur = shapesRef.current || [];
    const prev = cur.find(s => s.id === selectedId);
    if (!prev) return;

    const nextStroke = patch.stroke ?? prev.stroke;

    // strokeWidth は必ず number に正規化（Selectが文字列を返すケース潰し）
    const rawSw = patch.strokeWidth ?? prev.strokeWidth;
    const nextSw = typeof rawSw === 'string' ? Number(rawSw) : rawSw;

    // NaN ガード
    const safeSw = Number.isFinite(nextSw) ? nextSw : prev.strokeWidth;

    // テキストは strokeWidth は保持
    const next = {
      ...prev,
      stroke: nextStroke,
      strokeWidth: (prev.tool === 'text') ? prev.strokeWidth : safeSw,
    };

    // 差分が無ければ保存しない
    if (next.stroke === prev.stroke && next.strokeWidth === prev.strokeWidth) return;

    addToUndoStack({ type: 'update', shapeId: prev.id, before: prev, after: next });

    // まずはローカル更新
    const updated = cur.map(s => s.id === prev.id ? next : s);
    setShapes(updated);

    // ★重要：親にも同期（props巻き戻り防止）
    onShapesChange?.(updated);

    // DB更新
    if (onSaveShape) {
      try {
        const res = await onSaveShape(next, 'upsert');
        if (res?.dbId) {
          setShapes(cur => cur.map(s => s.id === prev.id ? { ...s, dbId: res.dbId } : s));
        }
      } catch (err) {
        console.error('Apply style error:', err);
      }
    }
  };

  // ツールバー変更を選択図形に適用（CRITICAL: applyStyleToSelected不足で無限ループ防止）
  const prevStrokeColorRef = useRef(strokeColor);
  const prevStrokeWidthRef = useRef(strokeWidth);
  
  useEffect(() => {
    if (!canEdit || !selectedId) return;
    if (prevStrokeColorRef.current === strokeColor) return;
    prevStrokeColorRef.current = strokeColor;
    applyStyleToSelected({ stroke: strokeColor });
  }, [strokeColor, canEdit, selectedId]);

  useEffect(() => {
    if (!canEdit || !selectedId) return;
    if (prevStrokeWidthRef.current === strokeWidth) return;
    prevStrokeWidthRef.current = strokeWidth;
    applyStyleToSelected({ strokeWidth });
  }, [strokeWidth, canEdit, selectedId]);

  // ★★★ CRITICAL: debugHudData の useMemo は全ての hooks の後、早期return の前に配置 ★★★
  const debugHudData = useMemo(() => {
    const uniqueCids = [...new Set(renderedShapes.map(s => shapeCommentId(s)).filter(Boolean))].slice(0, 10);
    
    // comment_idごとの件数を集計
    const countsByCommentId = {};
    renderedShapes.forEach(s => {
      const cid = shapeCommentId(s);
      if (cid != null && cid !== '') {
        const cidStr = String(cid).substring(0, 12);
        countsByCommentId[cidStr] = (countsByCommentId[cidStr] || 0) + 1;
      }
    });
    
    const coordDiag = DEBUG_MODE ? {
      paintEnterSeq: coordDiagRef.current.paintEnterSeq,
      strokeSeqInSession: coordDiagRef.current.strokeSeqInSession,
      firstStroke: coordDiagRef.current.firstStroke,
      lastPointerEvent: coordDiagRef.current.lastPointerEvent,
      ptrDiagStr: coordDiagRef.current.ptrDiagStr, commitDiagStr: coordDiagRef.current.commitDiagStr,
      firstPtr: coordDiagRef.current.firstPtr, firstCmt: coordDiagRef.current.firstCmt, lastPtr: coordDiagRef.current.lastPtr, lastCmt: coordDiagRef.current.lastCmt,
    } : null;
    
    return {
      activeCommentId: String(activeCommentId ?? 'null'),
      effectiveActiveId: String(effectiveActiveId ?? 'null'),
      draftCommentId: String(draftCommentIdRef.current ?? 'null'),
      renderedShapesLength: renderedShapes.length,
      uniqueCommentIds: uniqueCids.map(id => String(id).substring(0, 12)),
      countsByCommentId,
      coordDiag, // ★★★ P0-COORD-DIAG: 座標診断データ追加 ★★★
    };
  }, [activeCommentId, effectiveActiveId, renderedShapes, diagTick]);

  // Undo/Redo
  useImperativeHandle(ref, () => ({
    // ★★★ FIT: 外部からサイズ情報を取得可能にする ★★★
    getBgSize: () => bgSize,
    getContainerSize: () => containerSize,
    undo: performUndo,
    redo: performRedo,
    clear: () => {
      // ★ CRITICAL: Mapはクリアしない（existingShapesは保持）
      // draftShapesのみクリア（comment_idがdraftCommentIdRefのもの）（★★★ 不変更新 ★★★）
      const draftId = draftCommentIdRef.current;
      if (draftId) {
        const newMap = new Map(shapesMapRef.current);
        for (const [id, shape] of shapesMapRef.current.entries()) {
          if (shape.comment_id === draftId || shape._dirty) {
            newMap.delete(id);
          }
        }
        shapesMapRef.current = newMap;
      }
      bump();
      setCurrentShape(null);
      setUndoStack([]);
      setRedoStack([]);
      setSelectedId(null);
      setIsDrawing(false);
      draftCommentIdRef.current = null;
    },
    // CRITICAL: 送信完了後の強制クリア（ref経由で確実に実行）
    afterSubmitClear: () => {
      // ★★★ CRITICAL: dirtyなshapeのみ削除（DBに保存済みのshapeは残す）（★★★ 不変更新 ★★★）
      const draftId = draftCommentIdRef.current;
      const newMap = new Map(shapesMapRef.current);
      for (const [id, shape] of shapesMapRef.current.entries()) {
        // draftCommentIdに紐づくshapeまたはdirtyなshapeを削除
        if ((draftId && shape.comment_id === draftId) || shape._dirty) {
          newMap.delete(id);
        }
      }
      shapesMapRef.current = newMap;
      bump();
      
      // ★★★ CRITICAL: draftCommentIdRefをクリア ★★★
      draftCommentIdRef.current = null;
      
      // 選択状態・描画状態をリセット
      setSelectedId(null);
      setCurrentShape(null);
      setIsDrawing(false);
      setUndoStack([]);
      setRedoStack([]);
      setTextEditor({ visible: false, x: 0, y: 0, value: '', shapeId: null, imgX: 0, imgY: 0, openedAt: 0 });
      
      // Transformer解除
      if (transformerRef.current) {
        transformerRef.current.nodes([]);
        const layer = transformerRef.current.getLayer();
        if (layer?.batchDraw) {
          layer.batchDraw();
        }
      }
    },
    delete: handleDelete,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
  }));
  
  const renderShape = renderShapeFactory({ currentShape, selectedId, bgSize, denormalizeCoords, isSelectableShape, isEditableShape2, canEdit, isEditMode, setSelectedId, onStrokeColorChange, onStrokeWidthChange, shapeRefs, handleDragStart, handleDragMove, handleDragEnd, handleTransformStart, handleTransformEnd, handleTextDblClick, DEBUG_MODE });
  
  // エラー表示
  if (error) {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fee', color: '#c00', padding: '20px', fontFamily: 'monospace', fontSize: '14px' }}>
        <div><strong>ViewerCanvas Error:</strong><br/>{error}</div>
      </div>
    );
  }
  
  // コンテナサイズが確定していない場合
  if (containerSize.width === 0 || containerSize.height === 0) {
    return (
      <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden', background: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#666' }}>Loading canvas...</div>
      </div>
    );
  }

  // ★★★ FIX-3: pending中判定（ctx切替でMap空にしない間）★★★
  const isPending = !!pendingCtxRef.current;
  
  if (DEBUG_MODE) {
    console.log('[ViewerCanvas] Render:', { renderedShapesCount: renderedShapes.length, paintMode, isPending, contentReady, bgReady });
  }

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative', overflow: 'auto', background: '#e0e0e0' }}>
      {isPending && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.7)', zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ color: '#666', fontSize: '14px' }}>コメント情報を読み込み中...</div>
        </div>
      )}

      <TextEditorOverlay textEditor={textEditor} setTextEditor={setTextEditor} textInputRef={textInputRef} isComposing={isComposing} setIsComposing={setIsComposing} handleTextConfirm={handleTextConfirm} handleTextCancel={handleTextCancel} handleTextBlur={handleTextBlur} />

      {/* ★★★ FIX-NO-BLANK: Stage全体は常に表示、shapesGroupのみopacity制御 ★★★ */}
      {/* HUNK1: Stage key削除でちらつき防止（強制再マウントは不要） */}
      {/* CONTRACT (P0): Never remount Stage via key. Zoom/Pan must be preserved. */}
      <Stage
        ref={stageRef}
        width={containerSize.width}
        height={containerSize.height}
        onPointerDown={handleStagePointerDown}
        onPointerMove={handleStagePointerMove}
        onPointerUp={handleStagePointerUp}
        onMouseDown={handleStagePointerDown}
        onMouseMove={handleStagePointerMove}
        onMouseUp={handleStagePointerUp}
        onTouchStart={handleStagePointerDown}
        onTouchMove={handleStagePointerMove}
        onTouchEnd={handleStagePointerUp}
        style={{ 
          cursor: isDrawMode ? 'crosshair' : canPan ? (isPanning ? 'grabbing' : 'grab') : 'default',
          touchAction: 'none'
        }}
      >
        {/* 背景Layer（非インタラクティブ） - 常に表示 */}
        <Layer listening={false}>
          <Group
            x={viewX}
            y={viewY}
            scaleX={contentScale}
            scaleY={contentScale}
          >
            {isImage && stableFileUrlRef.current && (
              <BackgroundImage src={stableFileUrlRef.current} onLoad={handleBgLoad} />
            )}
          </Group>
        </Layer>

        {/* 注釈Layer（contentGroup内に配置） */}
        {/* P0-FIX: contentReady（bgSize確定）ベースで表示、paintMode/currentShape時は例外表示 */}
        {/* CONTRACT (P0): Paint layer may remount ONLY as a controlled mechanism to remove ghosting
// when hidePaintOverlay/canvasContextKey changes. Do NOT move this remounting to Stage. */}
        <Layer 
          key={`paint:${hidePaintOverlay ? 'hide' : 'show'}:${forceClearToken}:${canvasContextKey || 'none'}`}
          ref={paintLayerRef}
          listening={!hidePaintOverlay && (contentReady || paintMode || !!currentShape)}
          opacity={(contentReady || paintMode || !!currentShape) ? 1 : 0}
        >
            <Group
              ref={contentGroupRef}
              x={viewX}
              y={viewY}
              scaleX={contentScale}
              scaleY={contentScale}
            >
              {!hidePaintOverlay && (
                  <>
                    {/* P0-V5: contentReady 時のみ描画 */}
                    {contentReady && (
                      <>
                        {renderedShapesFinal.map(s => renderShape(s, true))}
                        {currentShape && renderShape(currentShape, false)}
                      </>
                    )}

                    <Transformer ref={transformerRef} name="paintOverlay" />
                  </>
                )}
            </Group>
        </Layer>
        
        
        </Stage>
      
      {DEBUG_MODE && <CanvasDebugHud debugHudData={debugHudData} debugRef={debugRef} renderedShapes={renderedShapes} bgSize={bgSize} contentScale={contentScale} offsetX={offsetX} offsetY={offsetY} containerSize={containerSize} paintMode={paintMode} draftReady={draftReady} tool={tool} canDrawNew={canDrawNew} canMutateExisting={canMutateExisting} canEdit={canEdit} isDrawing={isDrawing} />}
    </div>
  );
});

ViewerCanvas.displayName = 'ViewerCanvas';

export default ViewerCanvas;