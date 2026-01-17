import React, { useState, useEffect, useLayoutEffect, useRef, useImperativeHandle, forwardRef, useMemo, useCallback } from 'react';
import { Stage, Layer, Line, Rect, Circle, Arrow, Image as KonvaImage, Group, Transformer, Text } from 'react-konva';
import useImage from 'use-image';

// UUID生成（clientShapeId用、再生成されない保証）
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

const DEBUG_MODE = import.meta.env.VITE_DEBUG === 'true';

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
  
  useEffect(() => {
    console.log('[BackgroundImage] Load status:', { src: src?.substring(0, 50), status, hasImage: !!image });
    
    if (status === 'failed') {
      console.error('[BackgroundImage] Failed to load image:', src);
    }
    
    if (image) {
      lastImageRef.current = image;
      console.log('[BackgroundImage] Image loaded successfully:', { width: image.width, height: image.height });
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
  
  // CRITICAL: 描画中の強制リセット防止用ref
  const isDrawingRef2 = useRef(false);
  const currentShapeRef2 = useRef(null);
  const suppressResetRef = useRef(false);
  
  // CRITICAL: activeCommentId変化検知用
  const prevActiveCommentIdRef = useRef(activeCommentId);
  const draftCommentIdRef = useRef(null); // 仮コメントID（描画開始時にactiveCommentIdが無い場合）
  // ★★★ REMOVED: lastStableCommentIdRef - fallback禁止のため完全削除 ★★★
  
  // ★★★ CRITICAL: 描画コンテキスト変化検知用（Map残留根絶）★★★
  const prevCanvasContextKeyRef = useRef(null);
  const pendingCtxRef = useRef(null); // ★ FIX-PENDING: 新ctx待機用（Map即クリア禁止）
  const prevEmptyCountRef = useRef(0); // Hunk E: empty連続カウント（2回連続でクリア）
  const lastEmptyAppliedCtxRef = useRef(null); // ★★★ P0-FIX: 意図的空表示の重複防止 ★★★
  
  // デバッグHUD用ログ履歴
  const [debugHudLogs, setDebugHudLogs] = useState([]);
  
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

  // CRITICAL: 送信後の強制非表示フラグ
  const [hidePaintUntilSelect, setHidePaintUntilSelect] = useState(false);
  
  // Undo/Redo
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  
  // デバッグ用
  const [lastEvent, setLastEvent] = useState('none');
  const [pointerPos, setPointerPos] = useState(null);
  const [imgPos, setImgPos] = useState(null);
  const [lastSaveStatus, setLastSaveStatus] = useState('idle');
  const [lastError, setLastError] = useState(null);
  const [lastMutation, setLastMutation] = useState(null);
  const [lastPayload, setLastPayload] = useState(null);
  const [lastSuccessId, setLastSuccessId] = useState(null);
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
  
  // ★ CRITICAL: Mapが唯一の真実（mergedShapesはMap由来）
  const mergedShapes = useMemo(() => getAllShapes(), [shapesVersion]);
  
  // CRITICAL: 実際に描画するshape配列
  // ★★★ ROOT FIX: fallback完全禁止、effectiveActiveIdのみ使用 ★★★
  const renderedShapes = useMemo(() => {
    const mapShapes = getAllShapes();
    let sourceShapes = mapShapes;

    // 描画中のshapeは常に除外
    if (currentShape?.id) {
      sourceShapes = sourceShapes.filter(s => s.id !== currentShape.id);
    }

    const targetId = renderTargetCommentId ? String(renderTargetCommentId) : '';

    if (DEBUG_MODE) {
      console.log('[ViewerCanvas] renderedShapes UMEMO:', {
        shapesVersion,
        showAllPaint,
        renderTargetCommentId: renderTargetCommentId?.substring(0, 12) || 'null',
        targetId: targetId?.substring(0, 12) || 'null',
        mapShapesCount: mapShapes.length,
        sourceShapesCount: sourceShapes.length,
        currentShapeId: currentShape?.id?.substring(0, 12) || 'null',
      });
    }

    // P1.2 FIX: targetIdが指定されている場合は、showAllPaintに関わらず常にフィルタリングを優先する
    if (targetId) {
      const filtered = sourceShapes.filter(s => resolveCommentId(s) === targetId);

      // Dedupe
      const dedupedMap = new Map();
      filtered.forEach(shape => {
        if (shape.id) {
          dedupedMap.set(shape.id, shape);
        }
      });
      const result = Array.from(dedupedMap.values());
      if (DEBUG_MODE) console.log('[ViewerCanvas] renderedShapes UMEMO: Filtered by targetId', { targetId, filteredCount: result.length });
      return result;
    }

    // P1.2 FIX: targetIdがない場合にのみ、showAllPaintを考慮する
    if (showAllPaint) {
      if (DEBUG_MODE) console.log('[ViewerCanvas] renderedShapes UMEMO: showAllPaint=TRUE, returning all sourceShapes', { count: sourceShapes.length });
      return sourceShapes;
    }

    // デフォルトは空配列
    if (DEBUG_MODE) console.log('[ViewerCanvas] renderedShapes UMEMO: Default to empty (no targetId, showAllPaint=false)');
    return [];
  }, [shapesVersion, showAllPaint, renderTargetCommentId, currentShape]);

  // ★★★ Hunk1: hidePaintOverlay時は描画を確実に空にする（表示レイヤー制御）★★★
  const renderedShapesFinal = hidePaintOverlay ? [] : renderedShapes;
  
  // ★ CRITICAL: activeShapes を existingShapes から抽出（comment_id統一判定）
  const activeShapes = useMemo(() => {
    if (!existingShapes?.length) return [];
    if (activeCommentId == null) return [];
    return existingShapes.filter((s) => sameId(shapeCommentId(s), activeCommentId));
  }, [existingShapes, activeCommentId]);
  
  // ★ CRITICAL: editableIds は activeShapes を元に作る
  const editableIds = useMemo(
    () => new Set(activeShapes.map((s) => s.id)),
    [activeShapes]
  );

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
    
    // hidePaintUntilSelect
    setHidePaintUntilSelect(false);
    
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

  // CRITICAL: fileIdentity/pageNumber変更時のみリセット（Mapをクリア）
  useEffect(() => {
    console.log('[ViewerCanvas] fileIdentity/pageNumber changed, resetting state (INTENDED)', { fileIdentity, pageNumber, mapSizeBefore: shapesMapRef.current.size });
    shapesMapRef.current = new Map(); // ★ Mapをクリア（ファイル/ページ変更時のみ）
    bump();
    setSelectedId(null);
    setCurrentShape(null);
    setUndoStack([]);
    setRedoStack([]);
    setPan({ x: 0, y: 0 });
    setBgReady(false); // P2 FIX: ファイル変更時に背景ロード状態をリセット
  }, [fileIdentity, pageNumber]);

  // zoom変更時はpanのクランプのみ（shapesは触らない）
  useEffect(() => {
    if (DEBUG_MODE) {
      console.log('[ViewerCanvas] zoom changed:', zoom);
    }
    setPan(p => clampPan(p.x, p.y));
  }, [zoom]);

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

    // ★★★ 案B2-修正: temp_新規コメントで「空」を意図している時は、SYNC_GUARDより先に必ず空表示にする ★★★
    const isTempCtx = String(renderTargetCommentId || '').startsWith('temp_');
    if (!showAllPaint && isTempCtx && incomingEmpty && !hidePaintOverlay) {
      console.log('[案B2] Intentional empty BEFORE SYNC_GUARD: clearing Map for temp_ ctx', {
        ctx: ctx?.substring(0, 20) || 'null',
        prevMapSize,
        isTempCtx,
        paintMode,
        showAllPaint,
      });
      // Map / lastNonEmpty / emptyStreak を全部リセット（残像防止）
      shapesMapRef.current = new Map();
      lastNonEmptyShapesRef.current = { key: null, shapes: null };
      emptyStreakCountRef.current = 0;
      bump();
      console.log('[案B2] shapesVersion bumped after Intentional empty clear');
      return;
      }

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
    
    // ★★★ 案B: allowIntentionalEmpty時は即座にMapクリア（前コメント描画を消す）★★★
    if (incomingEmpty && allowIntentionalEmpty) {
      // ★★★ P0-FIX: Mapが空のときだけskip、復活後は再クリア可能に ★★★
      if (lastEmptyAppliedCtxRef.current === ctx && shapesMapRef.current.size === 0) {
        console.log('[案B] Intentional empty: already applied and Map empty, skipping', { ctx });
        return;
      }
      lastEmptyAppliedCtxRef.current = ctx;

      console.log('[案B] Intentional empty: clearing Map for temp_ new comment', {
        ctx,
        prevMapSize,
        isTempCtx,
        paintMode,
        showAllPaint,
      });
      shapesMapRef.current = new Map();
      lastNonEmptyShapesRef.current = { key: null, shapes: null };
      emptyStreakCountRef.current = 0;
      bump();
      console.log('[Hunk2] shapesVersion bumped after transitioning clear (intent)');
      return;
      }

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

  // マウント検知（デバッグ用）
  useEffect(() => {
    if (DEBUG_MODE) {
      console.log('[ViewerCanvas] Component MOUNTED', { fileUrl, pageNumber });
    }
    return () => {
      if (DEBUG_MODE) {
        console.log('[ViewerCanvas] Component UNMOUNTED');
      }
    };
  }, []);

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
  
  // スケール計算 - 画面に収めるfitScaleとユーザーズーム
  const fitScale = Math.min(
    containerSize.width / bgSize.width,
    containerSize.height / bgSize.height
  ) || 1;
  
  const userScale = zoom / 100;
  const contentScale = fitScale * userScale;
  
  const scaledWidth = bgSize.width * contentScale;
  const scaledHeight = bgSize.height * contentScale;
  
  // 中央寄せオフセット（CRITICAL: Math.max削除で左上スナップ防止）
  const offsetX = (containerSize.width - scaledWidth) / 2;
  const offsetY = (containerSize.height - scaledHeight) / 2;
  
  // 実際の表示位置（パンを考慮）
  const viewX = offsetX + pan.x;
  const viewY = offsetY + pan.y;

  // P2 FIX: 背景画像のロードが完了したときに呼ばれ、bgReadyフラグを立てる
  // ★★★ FIT: onBgLoadコールバックを追加（親に通知）★★★
  const handleBgLoad = useCallback((size) => {
    setBgSize(size);
    setBgReady(true);
    console.log('[FIT] bgLoad:', { width: size.width, height: size.height, containerWidth: containerSize.width, containerHeight: containerSize.height });
    // 親に通知（初期フィット計算用）
    if (onBgLoad) {
      onBgLoad(size, containerSize);
    }
  }, [containerSize, onBgLoad]);
  
  // CRITICAL: パンは非ペイント時 or selectツール時（描画ツールとの競合回避）
  // ★★★ FIT: zoom>=100 なら常にパン可能（はみ出し時の移動を復活）★★★
  const canPan = (!paintMode || tool === 'select') && !textEditor.visible && !isDrawing;
  
  // パン範囲のクランプ
  const clampPan = (nx, ny) => {
    if (scaledWidth <= containerSize.width) {
      nx = 0;
    } else {
      const minX = containerSize.width - scaledWidth;
      const maxX = 0;
      nx = Math.min(maxX, Math.max(minX, nx));
    }
    
    if (scaledHeight <= containerSize.height) {
      ny = 0;
    } else {
      const minY = containerSize.height - scaledHeight;
      const maxY = 0;
      ny = Math.min(maxY, Math.max(minY, ny));
    }
    
    return { x: nx, y: ny };
  };
  


  // ★★★ CRITICAL: 座標変換（描画中は開始時のview/scaleを使用してジャンプ防止）★★★
  const stagePointToImagePoint = () => {
    const stage = stageRef.current;
    if (!stage) return null;

    const p = stage.getPointerPosition();
    if (!p) return null;

    // ★★★ CRITICAL: 描画中は開始時に保存したview/scaleを使う（ジャンプ防止の核心）★★★
    let useViewX, useViewY, useScale;
    if (isDrawingRef2.current && drawViewRef.current) {
      // 描画中は固定値を使用
      useViewX = drawViewRef.current.viewX;
      useViewY = drawViewRef.current.viewY;
      useScale = drawViewRef.current.contentScale;
    } else {
      // 非描画中は現在値を使用
      useViewX = viewX;
      useViewY = viewY;
      useScale = contentScale;
    }

    // 手計算で座標変換（Konva transform APIはGroup位置変更でジャンプの原因になる）
    const imgX = (p.x - useViewX) / useScale;
    const imgY = (p.y - useViewY) / useScale;

    return { x: imgX, y: imgY, stageX: p.x, stageY: p.y };
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
    // ★★★ DEBUG: 単体削除の詳細ログ ★★★
    console.log('[ViewerCanvas] ========== HANDLE DELETE START ==========');
    console.log('[ViewerCanvas] handleDelete state:', { 
      selectedId, 
      canMutateExisting, 
      paintMode, 
      draftReady,
      tool,
      shapesMapSize: shapesMapRef.current.size,
    });

    // ★★★ FIX-DELETE: canDeleteExisting で判定（draftReady不要、isEditMode && paintMode で許可）★★★
    if (!canDeleteExisting) {
      console.log('[ViewerCanvas] Delete blocked: canDeleteExisting=false');
      console.log('[ViewerCanvas] ========== HANDLE DELETE END (canDeleteExisting=false) ==========');
      return;
    }

    // ★★★ CRITICAL: selectedIdが必須 ★★★
    if (!selectedId) {
      console.log('[ViewerCanvas] Delete blocked: no selectedId');
      console.log('[ViewerCanvas] ========== HANDLE DELETE END (no selectedId) ==========');
      return;
    }
    
    const selectedShape = shapesMapRef.current.get(selectedId);
    if (!selectedShape) {
      console.log('[ViewerCanvas] Delete blocked: shape not found in Map');
      console.log('[ViewerCanvas] Available shape ids:', [...shapesMapRef.current.keys()].slice(0, 5));
      console.log('[ViewerCanvas] ========== HANDLE DELETE END (shape not found) ==========');
      return;
    }

    // ★★★ CRITICAL: comment_id一致チェック（effectiveActiveIdと比較）★★★
    const shapeCommentIdValue = shapeCommentId(selectedShape);
    console.log('[ViewerCanvas] comment_id check:', { 
      shapeCommentIdValue, 
      effectiveActiveId,
      match: sameId(shapeCommentIdValue, effectiveActiveId),
    });

    if (!sameId(shapeCommentIdValue, effectiveActiveId)) {
      console.log('[ViewerCanvas] Delete blocked: comment_id mismatch');
      console.log('[ViewerCanvas] ========== HANDLE DELETE END (comment_id mismatch) ==========');
      return;
    }
    
    const shape = selectedShape;
    console.log('[ViewerCanvas] Proceeding with delete for shape:', shape.id);
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
      setLastMutation('delete');
      setLastPayload(JSON.stringify({ id: shape.id }));
      try {
        console.log('[ViewerCanvas] Calling onDeleteShape...');
        await onDeleteShape(shape);
        setLastSaveStatus('success');
        setLastError(null);
        console.log('[ViewerCanvas] ========== HANDLE DELETE END (success) ==========');
        console.log('[ViewerCanvas] deletedLocalCount: 1, deletedDbCount: 1');
      } catch (err) {
        console.error('[ViewerCanvas] Delete shape error:', err);
        setLastSaveStatus('error');
        setLastError(err.message);
        // 失敗時はrevert（★★★ CRITICAL: 新しいMapを作成 ★★★）
        const revertMap = new Map(shapesMapRef.current);
        revertMap.set(shape.id, shape);
        shapesMapRef.current = revertMap;
        bump();
        onShapesChange?.(getAllShapes());
        console.log('[ViewerCanvas] ========== HANDLE DELETE END (error, reverted) ==========');
        console.log('[ViewerCanvas] deletedLocalCount: 0, deletedDbCount: 0');
      }
    } else {
      console.log('[ViewerCanvas] ========== HANDLE DELETE END (local only, no onDeleteShape) ==========');
      console.log('[ViewerCanvas] deletedLocalCount: 1, deletedDbCount: 0');
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
      const dx = p.x - panStartRef.current.px;
      const dy = p.y - panStartRef.current.py;
      const next = clampPan(panStartRef.current.x + dx, panStartRef.current.y + dy);
      setPan(next);
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
    handlePointerUp(e);
  };

  // PointerDown: 描画開始（描画モード時のみ）
  const handlePointerDown = (e) => {
    // ★★★ DEBUG: 描画開始直前の状態を詳細ログ（差分検出用）★★★
    const beforeIds = renderedShapes.map(s => s.id);
    const uniqueCidsInRendered = [...new Set(renderedShapes.map(s => shapeCommentId(s)))].slice(0, 10);
    const targetId = effectiveActiveId != null ? String(effectiveActiveId) : '';
    
    console.log('[DRAW_DEBUG] handlePointerDown BEFORE:', {
      targetId,
      effectiveActiveId,
      activeCommentId,
      draftCommentId: draftCommentIdRef.current,
      showAllPaint,
      hidePaintUntilSelect,
      renderedShapesLength: renderedShapes.length,
      uniqueCommentIdsInRendered: uniqueCidsInRendered,
      beforeIds: beforeIds.slice(0, 5).map(id => id?.substring?.(0, 8)),
      tool,
      paintMode,
      isDrawMode,
    });

    if (DEBUG_MODE) {
      console.log('[ViewerCanvas] handlePointerDown called', {
        tool,
        paintMode,
        draftReady,
        canEdit,
        isDrawMode,
        isDrawing,
        textEditorVisible: textEditor.visible,
        activeCommentId,
        hidePaintUntilSelect,
        currentShapeCommentId: currentShape?.comment_id,
      });
    }

    // ★★★ FIX-1: selectツール時は描画開始しない（選択は別処理）★★★
    if (isSelectTool) {
      return;
    }
    
    // ★★★ FIX-1: 新規描画はpaintModeだけでOK（T1/T2即描画）★★★
    if (!paintMode && tool !== 'text') {
      console.warn('[ViewerCanvas] PointerDown blocked: paintMode=false', { paintMode, tool });
      return;
    }

    // ★★★ Hunk Q (P0): draft準備中は描画開始をブロック ★★★
    if (paintMode && !draftReady && tool !== 'text') {
      console.log('[Hunk Q] PointerDown blocked: draftReady=false (waiting for draft hydration)', { 
        paintMode, 
        draftReady, 
        tool 
      });
      return;
    }

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
      console.warn('[ViewerCanvas] Drawing blocked: activeCommentId is null and onBeginPaint is missing');
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
      const imgCoords = stagePointToImagePoint();
      if (!imgCoords) return;
      
      setLastEvent('down');
      if (DEBUG_MODE) {
        setPointerPos({ x: imgCoords.stageX, y: imgCoords.stageY });
        setImgPos({ x: imgCoords.x, y: imgCoords.y });
      }
      
      setIsDrawing(true);
      
      // ★★★ CRITICAL: 描画開始時のview/scaleを保存（ジャンプ防止の核心）★★★
      drawViewRef.current = { viewX, viewY, contentScale };
      if (DEBUG_MODE) {
        console.log('[ViewerCanvas] drawViewRef saved:', drawViewRef.current);
      }

      // ★★★ CRITICAL: comment_idを取得（draftCommentId優先、fallback禁止）★★★
      const commentId = getCommentIdForDrawing();
      if (!commentId) {
        console.error('[ViewerCanvas] Cannot start drawing: no commentId available');
        setIsDrawing(false);
        return;
      }

      // ★★★ DEBUG: 描画開始時のcomment_id確認 ★★★
      console.log('[ViewerCanvas] Drawing with commentId:', {
        commentId: commentId?.substring(0, 12),
        draftCommentId: draftCommentId?.substring(0, 12) || 'null',
        effectiveActiveId: effectiveActiveId?.substring(0, 12) || 'null',
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
      setDebugHudLogs(prev => [...prev.slice(-9), drawStartLog]);

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
      
      if (tool === 'pen') {
        newShape.points = [imgCoords.x, imgCoords.y];
        setCurrentShape(newShape);
      } else {
        setCurrentShape(newShape);
      }

      // onBeginPaintは非同期で投げるだけ（awaitしない）
      if (onBeginPaint && !activeCommentId) {
        queueMicrotask(() => {
          onBeginPaint(imgCoords.x, imgCoords.y, bgSize.width, bgSize.height);
        });
      }

      // ★★★ DEBUG: 描画開始直後の状態を詳細ログ（差分検出用）★★★
      // NOTE: renderedShapesはuseMemoなので、同一レンダリング内では変化しない
      // 実際の変化は次のレンダリングで発生する
      const afterIds = renderedShapes.map(s => s.id);
      const uniqueCidsAfter = [...new Set(renderedShapes.map(s => shapeCommentId(s)))].slice(0, 10);
      console.log('[DRAW_DEBUG] handlePointerDown AFTER (same render):', {
        targetId: effectiveActiveId != null ? String(effectiveActiveId) : '',
        effectiveActiveId,
        activeCommentId,
        draftCommentId: draftCommentIdRef.current,
        showAllPaint,
        hidePaintUntilSelect,
        renderedShapesLength: renderedShapes.length,
        uniqueCommentIdsInRendered: uniqueCidsAfter,
        afterIds: afterIds.slice(0, 5).map(id => id?.substring?.(0, 8)),
        newShapeCommentId: commentId,
      });
      } catch (err) {
      console.error('PointerDown Error:', err);
      setError(`PointerDown Error: ${err.message}`);
      }
      };
  
  // PointerMove: 描画中（CRITICAL: refベースで判定、propsに依存しない）
  const handlePointerMove = (e) => {
    // テキスト編集中は処理しない
    if (textEditor.visible) return;
    
    try {
      const imgCoords = stagePointToImagePoint();
      if (!imgCoords) return;
      
      // CRITICAL: デバッグ用座標更新はドラッグ中・描画中は止める（残像防止）
      if (DEBUG_MODE && !isDraggingRef.current && !isDrawingRef2.current) {
        setPointerPos({ x: imgCoords.stageX, y: imgCoords.stageY });
        setImgPos({ x: imgCoords.x, y: imgCoords.y });
      }
      
      // CRITICAL: refベースで判定（親stateが揺れても描画継続）
      const shape = currentShapeRef2.current;
      if (!isDrawingRef2.current || !shape) return;
      
      setLastEvent('move');
      
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

      setCurrentShape(newShape);
    } catch (err) {
      console.error('PointerMove Error:', err);
    }
  };
  
  // テキスト確定（DOMから直接読む）
  const handleTextConfirm = async () => {
    const raw = textInputRef.current?.value ?? textEditor.value;
    const text = raw.trim();
    if (!text) {
      setTextEditor({ visible: false, x: 0, y: 0, value: '', shapeId: null, imgX: 0, imgY: 0, openedAt: 0 });
      if (onToolChange) onToolChange('select');
      return;
    }

    const { imgX, imgY, shapeId } = textEditor;
    const { nx, ny } = normalizeCoords(imgX, imgY);

    // フォントサイズをstrokeWidthベースで計算
    const fontSize = Math.max(12, strokeWidth * 6);

    if (shapeId) {
      // 既存テキストの編集（現在のツールバー設定を適用）
      const existingShape = shapes.find(s => s.id === shapeId);
      if (existingShape) {
        const updatedShape = {
          ...existingShape,
          text,
          nx,
          ny,
          stroke: strokeColor,
          strokeWidth: strokeWidth,
          fontSize,
        };

        // CRITICAL: Map方式でupsert + dirty/localTs付与（★★★ 不変更新 ★★★）
        const updatedWithDirty = { ...updatedShape, _dirty: true, _localTs: Date.now() };
        addToUndoStack({ type: 'update', shapeId, before: existingShape, after: updatedWithDirty });
        const newMap = new Map(shapesMapRef.current);
        newMap.set(shapeId, updatedWithDirty);
        shapesMapRef.current = newMap;
        bump();
        onShapesChange?.(getAllShapes());

        if (onSaveShape) {
          try {
            await onSaveShape(updatedShape, 'upsert');
            // CRITICAL: dirty解除（★★★ 不変更新 ★★★）
            const cur = shapesMapRef.current.get(shapeId);
            if (cur) {
              const dirtyMap = new Map(shapesMapRef.current);
              dirtyMap.set(shapeId, { ...cur, _dirty: false });
              shapesMapRef.current = dirtyMap;
              bump();
              onShapesChange?.(getAllShapes());
            }
          } catch (err) {
            console.error('Save text error:', err);
          }
        }
      }
    } else {
      // 新規テキスト作成（activeCommentIdがなければ仮IDを使用）
      const commentIdForText = activeCommentId || getCommentIdForDrawing();
      if (!commentIdForText) {
        console.error('[ViewerCanvas] Cannot create text: no commentId available');
        setTextEditor({ visible: false, x: 0, y: 0, value: '', shapeId: null, imgX: 0, imgY: 0, openedAt: 0 });
        return;
      }
      
      const normalizedShape = {
        id: generateUUID(),
        comment_id: commentIdForText,
        commentId: commentIdForText,  // ★両方のキーで入れる
        tool: 'text',
        stroke: strokeColor,
        strokeWidth: strokeWidth,
        bgWidth: bgSize.width,
        bgHeight: bgSize.height,
        nx,
        ny,
        text,
        fontSize,
        boxResized: false,  // 初期状態はautoサイズ
        // boxW, boxH は作成時には入れない（undefinedのまま）
      };
      
      // 仮IDでコメント作成をトリガー
      if (!activeCommentId && onBeginPaint) {
        queueMicrotask(() => {
          onBeginPaint(imgX, imgY, bgSize.width, bgSize.height);
        });
      }

      // CRITICAL: Map方式でupsert + dirty/localTs付与（★★★ 不変更新 ★★★）
      const shapeWithDirty = { ...normalizedShape, _dirty: true, _localTs: Date.now() };
      addToUndoStack({ type: 'add', shapeId: normalizedShape.id });
      const newMap = new Map(shapesMapRef.current);
      newMap.set(shapeWithDirty.id, shapeWithDirty);
      shapesMapRef.current = newMap;
      bump();
      onShapesChange?.(getAllShapes());
      setSelectedId(normalizedShape.id);

      if (onSaveShape) {
        try {
          const result = await onSaveShape(normalizedShape, 'create');
          // CRITICAL: dirty解除（★★★ 不変更新 ★★★）
          const cur = shapesMapRef.current.get(normalizedShape.id);
          if (cur) {
            const dirtyMap = new Map(shapesMapRef.current);
            dirtyMap.set(normalizedShape.id, { ...cur, dbId: result?.dbId, _dirty: false });
            shapesMapRef.current = dirtyMap;
            bump();
            onShapesChange?.(getAllShapes());
          }
        } catch (err) {
          console.error('Save text error:', err);
        }
      }
    }

    setTextEditor({ visible: false, x: 0, y: 0, value: '', shapeId: null, imgX: 0, imgY: 0, openedAt: 0 });
    setIsComposing(false);
    if (onToolChange) onToolChange('select');
  };

  // テキストキャンセル
  const handleTextCancel = () => {
    setTextEditor({ visible: false, x: 0, y: 0, value: '', shapeId: null, imgX: 0, imgY: 0, openedAt: 0 });
    setIsComposing(false);
    if (onToolChange) onToolChange('select');
  };

  // テキストBlur確定（開いた直後の誤作動を防ぐ）
  const handleTextBlur = () => {
    // 開いて250ms以内のblurは無視（誤作動防止）
    if (textEditor.openedAt && Date.now() - textEditor.openedAt < 250) return;
    
    const raw = textInputRef.current?.value ?? textEditor.value;
    if (raw.trim()) {
      handleTextConfirm();
    } else {
      handleTextCancel();
    }
  };

  // テキストダブルクリックで再編集
  const handleTextDblClick = (shape) => {
    if (!isEditMode) return;

    const { x: imgX, y: imgY } = denormalizeCoords(shape.nx, shape.ny);
    
    // CRITICAL: transform API で画像座標→ステージ座標に変換
    const group = contentGroupRef.current;
    if (!group) return;
    
    const tr = group.getAbsoluteTransform().copy();
    const stagePoint = tr.point({ x: imgX, y: imgY });

    console.log('[ViewerCanvas] Text double-click edit:', { shapeId: shape.id, text: shape.text });

    setTextEditor({
      visible: true,
      x: stagePoint.x,
      y: stagePoint.y,
      value: shape.text || '',
      shapeId: shape.id,
      imgX,
      imgY,
      openedAt: Date.now(),
    });
  };

  // PointerUp: 描画終了（CRITICAL: refベースで判定、propsに依存しない）
  const handlePointerUp = async () => {
    // ★★★ DEBUG: pointerUp開始時の状態を必ず出力 ★★★
    console.log('[DRAW_DEBUG] pointerUp start:', {
      isDrawing: isDrawingRef2.current,
      tool,
      canDrawNew,
      canCommitNew,
      paintMode,
      draftReady,
      renderTargetCommentId: renderTargetCommentId?.substring(0, 12) || 'null',
      draftCommentId: draftCommentId?.substring(0, 12) || 'null',
      currentShapeExists: !!currentShapeRef2.current,
      mapSize: shapesMapRef.current.size,
    });

    // CRITICAL: refベースで判定（親stateが揺れても描画完了）
    const shape = currentShapeRef2.current;
    if (!isDrawingRef2.current || !shape) {
      console.log('[DRAW_DEBUG] pointerUp aborted: isDrawing=false or no currentShape');
      return;
    }
    
    try {
      setLastEvent('up');
      setIsDrawing(false);
      
      // CRITICAL: 描画終了時に抑止解除
      suppressResetRef.current = false;
      
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

      // ★★★ CRITICAL FIX: fallback禁止、shape.comment_id が無い場合は早期return ★★★
      const resolvedCommentId = shape.comment_id;
      if (!resolvedCommentId) {
        console.error('[ViewerCanvas] shape.comment_id is missing, skipping save:', shape.id?.substring(0, 8));
        setCurrentShape(null);
        setIsDrawing(false);
        drawViewRef.current = null;
        return;
      }
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

      // ★★★ Hunk Q (P0): 新規shape確定は canCommitNew && draftReady で判定 ★★★
      console.log('[DRAW_DEBUG] commit check:', {
        canCommitNew,
        paintMode,
        draftReady,
        normalizedShapeCommentId: normalizedShape.comment_id?.substring(0, 12) || 'null',
      });

      if (!canCommitNew || !draftReady) {
        console.warn('[Hunk Q] COMMIT blocked: canCommitNew=false or draftReady=false', { 
          paintMode, 
          draftReady, 
          canCommitNew 
        });
        setCurrentShape(null);
        setIsDrawing(false);
        drawViewRef.current = null;
        return;
      }

      console.log('[DRAW_DEBUG] COMMIT new shape -> addToMap + onSaveShape:', {
        shapeId: normalizedShape.id.substring(0, 8),
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
      console.log('[DRAW_DEBUG] Map updated after commit:', {
        shapeId: shapeWithDirty.id.substring(0, 8),
        mapSizeAfter: shapesMapRef.current.size,
        allShapesCount: getAllShapes().length,
      });

      onShapesChange?.(getAllShapes()); // ★ 常に全量を渡す
      setCurrentShape(null);

      // ★★★ C: 描画確定直後に新規作成したshapeを自動選択（ハンドル/枠が出る）★★★
      setSelectedId(normalizedShape.id);

      // ★★★ C: 自動でselectツールに切り替えて選択状態を維持 ★★★
      if (onToolChange) {
        onToolChange('select');
      }

      // DB保存前の検証（一時フィールドが残っていないことを確認）
      if (DEBUG_MODE) {
        const hasTemp = ['points', 'startX', 'startY', 'x', 'y', 'width', 'height', 'radius']
          .some(key => normalizedShape[key] !== undefined);
        if (hasTemp) {
          console.warn('[ViewerCanvas] WARNING: Temp fields detected in normalizedShape:', normalizedShape);
        }
      }

      // 親コンポーネントに保存を依頼（createモード）
      if (onSaveShape) {
        setIsSaving(prev => ({ ...prev, [normalizedShape.id]: true }));
        setLastSaveStatus('saving');
        setLastMutation('create');
        setLastPayload(JSON.stringify(normalizedShape));

        console.log('[DRAW_DEBUG] calling onSaveShape:', {
          shapeId: normalizedShape.id.substring(0, 8),
          mode: 'create',
        });

        try {
          const result = await onSaveShape(normalizedShape, 'create');
          console.log('[DRAW_DEBUG] onSaveShape success:', {
            shapeId: normalizedShape.id.substring(0, 8),
            result,
          });
          setLastSaveStatus('success');
          setLastSuccessId(result?.dbId || normalizedShape.id);
          setLastError(null);

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
          setLastSaveStatus('error');
          setLastError(err.message || String(err));
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
        setLastSaveStatus('error');
        setLastError(err.message);
        drawViewRef.current = null; // エラー時も解除
        }
        };
  
  // CRITICAL: ドラッグ開始（残像防止）
  const handleDragStart = (shape, e) => {
    isInteractingRef.current = true;
    isDraggingRef.current = true;
    e.cancelBubble = true;
  };

  const handleTransformStart = (shape, e) => {
    isInteractingRef.current = true;
  };

  // CRITICAL: ドラッグ中の追従更新（Map方式）
  const handleDragMove = (shape, e) => {
    // ★★★ CRITICAL: 既存shape編集は canMutateExisting 必須 ★★★
    if (!canMutateExisting) return;
    const node = e.target;

    // RAF間引き
    pendingDragRef.current = { shape, x: node.x(), y: node.y() };
    if (dragRafRef.current) return;

    dragRafRef.current = requestAnimationFrame(() => {
      const p = pendingDragRef.current;
      dragRafRef.current = null;
      if (!p) return;

      const { shape, x, y } = p;

      // tool別にMapを追従させる（保存はしない）（★★★ 不変更新 ★★★）
      const cur = shapesMapRef.current.get(shape.id);
      if (!cur) return;
      
      const newMap = new Map(shapesMapRef.current);
      if (shape.tool === 'rect' || shape.tool === 'circle' || shape.tool === 'text') {
        const { nx, ny } = normalizeCoords(x, y);
        newMap.set(shape.id, { ...cur, nx, ny });
      } else if (shape.tool === 'pen' || shape.tool === 'arrow') {
        newMap.set(shape.id, { ...cur, dragX: x, dragY: y });
      }
      shapesMapRef.current = newMap;
      bump();
    });
  };

  // ドラッグ終了時の更新（CRITICAL: 増殖防止のため置換処理）
  const handleDragEnd = async (shape, e) => {
    // ★★★ CRITICAL: 既存shape編集は canMutateExisting 必須 ★★★
    if (!canMutateExisting) {
      console.log('[ViewerCanvas] DragEnd blocked: canMutateExisting=false');
      isDraggingRef.current = false;
      return;
    }

    // CRITICAL: 編集不可なら即return（isEditableShape関数で判定）
    if (!isEditableShape(shape)) {
      console.log('[ViewerCanvas] DragEnd blocked: not editable');
      isDraggingRef.current = false;
      return;
    }

    // 多重保存防止
    if (isSaving[shape.id]) {
      console.log('[ViewerCanvas] Already saving:', shape.id);
      isDraggingRef.current = false;
      return;
    }
    
    const node = e.target;
    // CRITICAL: dragX/dragY を優先（??で0を潰さない）
    const dx = shape.dragX ?? node.x();
    const dy = shape.dragY ?? node.y();
    
    const updatedShape = { ...shape };
    
    if (shape.tool === 'pen' && shape.normalizedPoints) {
      // Pen: deltaとしてpointsに焼き込み
      const newPoints = [];
      for (let i = 0; i < shape.normalizedPoints.length; i += 2) {
        const { x: px, y: py } = denormalizeCoords(shape.normalizedPoints[i], shape.normalizedPoints[i + 1]);
        const { nx, ny } = normalizeCoords(px + dx, py + dy);
        newPoints.push(nx, ny);
      }
      updatedShape.normalizedPoints = newPoints;
      updatedShape.dragX = 0;
      updatedShape.dragY = 0;
      node.position({ x: 0, y: 0 }); // dragEndでのみリセット
      } else if (shape.tool === 'rect') {
      // Rect: 絶対座標として直接保存
      const { nx, ny } = normalizeCoords(dx, dy);
      updatedShape.nx = nx;
      updatedShape.ny = ny;
      } else if (shape.tool === 'circle') {
      // Circle: 絶対座標として直接保存
      const { nx, ny } = normalizeCoords(dx, dy);
      updatedShape.nx = nx;
      updatedShape.ny = ny;
      } else if (shape.tool === 'arrow' && shape.normalizedPoints) {
      // Arrow: deltaとしてpointsに焼き込み
      const newPoints = [];
      for (let i = 0; i < shape.normalizedPoints.length; i += 2) {
        const { x: px, y: py } = denormalizeCoords(shape.normalizedPoints[i], shape.normalizedPoints[i + 1]);
        const { nx, ny } = normalizeCoords(px + dx, py + dy);
        newPoints.push(nx, ny);
      }
      updatedShape.normalizedPoints = newPoints;
      updatedShape.dragX = 0;
      updatedShape.dragY = 0;
      node.position({ x: 0, y: 0 }); // dragEndでのみリセット
      } else if (shape.tool === 'text') {
      // Text: 絶対座標として直接保存
      const { nx, ny } = normalizeCoords(dx, dy);
      updatedShape.nx = nx;
      updatedShape.ny = ny;
    }
    
    // CRITICAL: Map方式でupsert + dirty/localTs付与（★★★ 不変更新 ★★★）
    const updatedWithDirty = { ...updatedShape, _dirty: true, _localTs: Date.now() };
    addToUndoStack({ type: 'update', shapeId: shape.id, before: shape, after: updatedWithDirty });

    // CRITICAL: Map更新 + 親に全量同期（★★★ 不変更新 ★★★）
    const newMap = new Map(shapesMapRef.current);
    newMap.set(updatedWithDirty.id, updatedWithDirty);
    shapesMapRef.current = newMap;
    bump();
    onShapesChange?.(getAllShapes());

    // ドラッグ終了
    isDraggingRef.current = false;
    isInteractingRef.current = false; // ★ B) 操作終了

    // ★ B) 保留されていたshapesがあれば同期をトリガー
    if (pendingIncomingShapesRef.current) {
        console.log('[SYNC] handleDragEnd: applying pending shapes');
        bump();
    }
    isInteractingRef.current = false;

    // 保留中のshapesがあれば同期をトリガー
    if (pendingIncomingShapesRef.current) {
      bump();
    }
    
    // DB更新（upsertモード）
    if (onSaveShape) {
      setIsSaving(prev => ({ ...prev, [shape.id]: true }));
      setLastMutation('update-drag');
      setLastPayload(JSON.stringify(updatedShape));
      setLastSaveStatus('saving');
      
      try {
        const result = await onSaveShape(updatedShape, 'upsert');
        setLastSaveStatus('success');
        setLastSuccessId(result?.dbId || updatedShape.id);
        setLastError(null);
        
        // CRITICAL: dirty解除（★★★ 不変更新 ★★★）
        const cur = shapesMapRef.current.get(updatedShape.id);
        if (cur) {
          const newMap = new Map(shapesMapRef.current);
          newMap.set(updatedShape.id, { ...cur, dbId: result?.dbId, _dirty: false });
          shapesMapRef.current = newMap;
          bump();
          onShapesChange?.(getAllShapes());
        }
      } catch (err) {
        console.error('Update shape error:', err);
        setLastSaveStatus('error');
        setLastError(err.message);
        // 失敗時はrevert（★★★ 不変更新 ★★★）
        const revertMap = new Map(shapesMapRef.current);
        revertMap.set(shape.id, shape);
        shapesMapRef.current = revertMap;
        bump();
        onShapesChange?.(getAllShapes());
      } finally {
        setIsSaving(prev => ({ ...prev, [shape.id]: false }));
      }
    }
  };

  // Transform終了時の更新（CRITICAL: 増殖防止のため置換処理、Rect/Circle/Arrowに対応）
  const handleTransformEnd = async (shape, e) => {
    // ★★★ CRITICAL: 既存shape編集は canMutateExisting 必須 ★★★
    if (!canMutateExisting) {
      console.log('[ViewerCanvas] TransformEnd blocked: canMutateExisting=false');
      return;
    }

    // CRITICAL: 編集不可なら即return（isEditableShape関数で判定）
    if (!isEditableShape(shape)) {
      console.log('[ViewerCanvas] TransformEnd blocked: not editable');
      return;
    }

    // 多重保存防止
    if (isSaving[shape.id]) {
      console.log('[ViewerCanvas] Already saving:', shape.id);
      return;
    }

    const node = e.target;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();

    const updatedShape = { ...shape };

    if (shape.tool === 'rect') {
      const finalX = node.x();
      const finalY = node.y();
      const finalW = Math.max(5, node.width() * scaleX);
      const finalH = Math.max(5, node.height() * scaleY);

      // ノードを更新（リセットではなく確定）
      node.scaleX(1);
      node.scaleY(1);
      node.width(finalW);
      node.height(finalH);
      node.x(finalX);
      node.y(finalY);

      // 正規化座標に変換
      const { nx, ny } = normalizeCoords(finalX, finalY);
      const { nx: nx2, ny: ny2 } = normalizeCoords(finalX + finalW, finalY + finalH);

      updatedShape.nx = nx;
      updatedShape.ny = ny;
      updatedShape.nw = nx2 - nx;
      updatedShape.nh = ny2 - ny;
    } else if (shape.tool === 'circle') {
      const finalX = node.x();
      const finalY = node.y();
      const finalR = Math.max(3, node.radius() * Math.max(scaleX, scaleY));

      // ノードを更新（リセットではなく確定）
      node.scaleX(1);
      node.scaleY(1);
      node.radius(finalR);
      node.x(finalX);
      node.y(finalY);

      // 正規化座標に変換
      const { nx, ny } = normalizeCoords(finalX, finalY);
      updatedShape.nx = nx;
      updatedShape.ny = ny;
      updatedShape.nr = finalR / bgSize.width;
    } else if (shape.tool === 'arrow' && shape.normalizedPoints) {
      // Arrowの変形：2点のtransformを適用して新しいnormalizedPointsを作成
      const transform = node.getAbsoluteTransform();

      // 元の2点を復元（normalizedPoints → ステージ座標）
      const p1 = denormalizeCoords(shape.normalizedPoints[0], shape.normalizedPoints[1]);
      const p2 = denormalizeCoords(shape.normalizedPoints[2], shape.normalizedPoints[3]);

      // Transformを適用（回転・スケール・移動を反映）
      const newP1 = transform.point({ x: p1.x, y: p1.y });
      const newP2 = transform.point({ x: p2.x, y: p2.y });

      // 正規化座標に変換
      const { nx: nx1, ny: ny1 } = normalizeCoords(newP1.x, newP1.y);
      const { nx: nx2, ny: ny2 } = normalizeCoords(newP2.x, newP2.y);

      updatedShape.normalizedPoints = [nx1, ny1, nx2, ny2];

      // Transformをリセット
      node.scaleX(1);
      node.scaleY(1);
      node.rotation(0);
      node.x(0);
      node.y(0);
    } else if (shape.tool === 'text') {
      // Text: リサイズ時にboxResized=trueとboxW/boxHを保存
      const finalX = node.x();
      const finalY = node.y();
      
      // Group内のRectを取得してサイズを計算
      const rectChild = node.findOne('Rect');
      const finalW = rectChild ? Math.max(20, rectChild.width() * scaleX) : 100;
      const finalH = rectChild ? Math.max(16, rectChild.height() * scaleY) : 24;

      // ノードを更新
      node.scaleX(1);
      node.scaleY(1);
      node.x(finalX);
      node.y(finalY);

      // 正規化座標に変換
      const { nx, ny } = normalizeCoords(finalX, finalY);
      updatedShape.nx = nx;
      updatedShape.ny = ny;
      updatedShape.boxResized = true;
      updatedShape.boxW = finalW / bgSize.width;
      updatedShape.boxH = finalH / bgSize.height;
      }

      // CRITICAL: 一時フィールドを完全削除（更新前に）
      delete updatedShape.points;
      delete updatedShape.startX;
      delete updatedShape.startY;
      delete updatedShape.x;
      delete updatedShape.y;
      delete updatedShape.width;
      delete updatedShape.height;
      delete updatedShape.radius;

      // CRITICAL: Map方式でupsert + dirty/localTs付与（★★★ 不変更新 ★★★）
      const updatedWithDirty = { ...updatedShape, _dirty: true, _localTs: Date.now() };
      addToUndoStack({ type: 'update', shapeId: shape.id, before: shape, after: updatedWithDirty });

      // CRITICAL: Map更新 + 親に全量同期（★★★ 不変更新 ★★★）
      const newMap = new Map(shapesMapRef.current);
      newMap.set(updatedWithDirty.id, updatedWithDirty);
      shapesMapRef.current = newMap;
      bump();
      onShapesChange?.(getAllShapes());

      // DB更新（upsertモード）
      isInteractingRef.current = false; // ★ B) 操作終了
      if (onSaveShape) {
        // ★ B) 保留されていたshapesがあれば同期をトリガー
        if (pendingIncomingShapesRef.current) {
            console.log('[SYNC] handleTransformEnd: applying pending shapes');
            bump();
        }

        setIsSaving(prev => ({ ...prev, [shape.id]: true }));
        setLastMutation('update-transform');
        setLastPayload(JSON.stringify(updatedShape));
        setLastSaveStatus('saving');
        console.log('[ViewerCanvas] COMMIT existing shape -> onSaveShape:', { 
          shapeId: shape.id?.substring(0, 8), 
          canMutateExisting, 
          draftReady 
        });

        try {
          const result = await onSaveShape(updatedShape, 'upsert');
          setLastSaveStatus('success');
          setLastSuccessId(result?.dbId || updatedShape.id);
          setLastError(null);
          console.log('[ViewerCanvas] onSaveShape success:', { shapeId: shape.id?.substring(0, 8) });

          // CRITICAL: dirty解除（★★★ 不変更新 ★★★）
          const cur = shapesMapRef.current.get(updatedShape.id);
          if (cur) {
            const dirtyMap = new Map(shapesMapRef.current);
            dirtyMap.set(updatedShape.id, { ...cur, dbId: result?.dbId, _dirty: false });
            shapesMapRef.current = dirtyMap;
            bump();
            onShapesChange?.(getAllShapes());
          }
        } catch (err) {
          console.error('[ViewerCanvas] onSaveShape error:', err);
          setLastSaveStatus('error');
          setLastError(err.message);
          // 失敗時はrevert（★★★ 不変更新 ★★★）
          const revertMap = new Map(shapesMapRef.current);
          revertMap.set(shape.id, shape);
          shapesMapRef.current = revertMap;
          bump();
          onShapesChange?.(getAllShapes());
          console.log('[ViewerCanvas] onSaveShape failed, reverted to original size:', { shapeId: shape.id?.substring(0, 8) });
        } finally {
          setIsSaving(prev => ({ ...prev, [shape.id]: false }));
        }
      }
  };

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
    
    return {
      activeCommentId: String(activeCommentId ?? 'null'),
      effectiveActiveId: String(effectiveActiveId ?? 'null'),
      draftCommentId: String(draftCommentIdRef.current ?? 'null'),
      renderedShapesLength: renderedShapes.length,
      uniqueCommentIds: uniqueCids.map(id => String(id).substring(0, 12)),
      countsByCommentId,
    };
  }, [activeCommentId, effectiveActiveId, renderedShapes]);

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
  
  // Shape描画（正規化座標から復元）
  const renderShape = (shape, isExisting = false) => {
    // ★★★ CRITICAL: 描画中のshape（currentShape）かどうかを判定 ★★★
    const isDrawingThisShape = currentShape && currentShape.id === shape.id;
    
    const isSelected = selectedId === shape.id;
    const canTransform = shape.tool === 'rect' || shape.tool === 'circle' || shape.tool === 'text' || shape.tool === 'arrow';
    // ★ CRITICAL: 選択可能か（クリックで選択）と編集可能か（移動/変形/削除）を分離
    const isSelectable = isSelectableShape(shape);
    const isEditable = isEditableShape2(shape);

    const commonProps = {
    name: 'paintOverlay',
    stroke: shape.stroke,
    strokeWidth: shape.strokeWidth,
    // ★★★ CRITICAL: 描画中のshapeは完全非インタラクティブ ★★★
    listening: isSelectable && !isDrawingThisShape,
    onPointerDown: (isSelectable && !isDrawingThisShape) ? (e) => {
      e.cancelBubble = true;
      setSelectedId(shape.id);
      if (onStrokeColorChange && shape.stroke) onStrokeColorChange(shape.stroke);
      if (onStrokeWidthChange && typeof shape.strokeWidth === 'number') onStrokeWidthChange(shape.strokeWidth);
    } : undefined,
    ref: (node) => { if (node) shapeRefs.current[shape.id] = node; },
    // ★★★ CRITICAL: 描画中のshapeはドラッグ不可 ★★★
    draggable: isEditable && !isDrawingThisShape,
    onDragStart: (isEditable && !isDrawingThisShape) ? (e) => handleDragStart(shape, e) : undefined,
    onDragMove: (isEditable && !isDrawingThisShape) ? (e) => handleDragMove(shape, e) : undefined,
    onDragEnd: (isEditable && !isDrawingThisShape) ? (e) => handleDragEnd(shape, e) : undefined,
    onTransformStart: (isEditable && canTransform && !isDrawingThisShape) ? (e) => handleTransformStart(shape, e) : undefined,
    onTransformEnd: (isEditable && canTransform && !isDrawingThisShape) ? (e) => handleTransformEnd(shape, e) : undefined,
    };

    // バウンディングボックス用の計算
    let boundingBox = null;
    if (showBoundingBoxes && DEBUG_MODE) {
      if (shape.tool === 'pen' && shape.normalizedPoints) {
        const points = [];
        for (let i = 0; i < shape.normalizedPoints.length; i += 2) {
          const { x, y } = denormalizeCoords(shape.normalizedPoints[i], shape.normalizedPoints[i + 1]);
          points.push({ x, y });
        }
        const xs = points.map(p => p.x);
        const ys = points.map(p => p.y);
        boundingBox = {
          x: Math.min(...xs),
          y: Math.min(...ys),
          width: Math.max(...xs) - Math.min(...xs),
          height: Math.max(...ys) - Math.min(...ys),
        };
      } else if (shape.tool === 'rect' && shape.nx !== undefined) {
        const p1 = denormalizeCoords(shape.nx, shape.ny);
        const p2 = denormalizeCoords(shape.nx + shape.nw, shape.ny + shape.nh);
        boundingBox = {
          x: p1.x,
          y: p1.y,
          width: p2.x - p1.x,
          height: p2.y - p1.y,
        };
      } else if (shape.tool === 'circle' && shape.nx !== undefined) {
        const center = denormalizeCoords(shape.nx, shape.ny);
        const radius = shape.nr * bgSize.width;
        boundingBox = {
          x: center.x - radius,
          y: center.y - radius,
          width: radius * 2,
          height: radius * 2,
        };
      } else if (shape.tool === 'arrow' && shape.normalizedPoints) {
        const points = [];
        for (let i = 0; i < shape.normalizedPoints.length; i += 2) {
          const { x, y } = denormalizeCoords(shape.normalizedPoints[i], shape.normalizedPoints[i + 1]);
          points.push({ x, y });
        }
        const xs = points.map(p => p.x);
        const ys = points.map(p => p.y);
        boundingBox = {
          x: Math.min(...xs),
          y: Math.min(...ys),
          width: Math.max(...xs) - Math.min(...xs),
          height: Math.max(...ys) - Math.min(...ys),
        };
      }
    }
    
    if (shape.tool === 'pen') {
      // ★★★ CRITICAL FIX: 描画中と確定済みで座標系を完全に分離 ★★★
      // 描画中: shape.points（絶対座標）を使用、Group x/y = 0
      // 確定済み: normalizedPointsから復元、Group x/y = dragX/dragY（ドラッグ時のみ）

      const isDrawingShape = !shape.normalizedPoints && shape.points;
      let points = [];
      let groupX = 0;
      let groupY = 0;

      if (isDrawingShape) {
        // ★ 描画中: 絶対座標pointsをそのまま使用（x=y=0固定、正規化しない）
        points = shape.points;
        groupX = 0;
        groupY = 0;
      } else if (shape.normalizedPoints) {
        // ★ 確定済み: normalizedPointsから復元
        for (let i = 0; i < shape.normalizedPoints.length; i += 2) {
          const { x, y } = denormalizeCoords(shape.normalizedPoints[i], shape.normalizedPoints[i + 1]);
          points.push(x, y);
        }
        // ドラッグ中のオフセット（確定済みshapeのみ）
        groupX = shape.dragX ?? 0;
        groupY = shape.dragY ?? 0;
      }

      // pointsが空の場合は描画しない
      if (points.length < 4) return null;

      // bbox計算（透明当たり判定用）
      const xs = [], ys = [];
      for (let i = 0; i < points.length; i += 2) {
        xs.push(points[i]);
        ys.push(points[i + 1]);
      }
      const pad = Math.max(10, (shape.strokeWidth || 2) * 3);
      const bboxX = Math.min(...xs) - pad;
      const bboxY = Math.min(...ys) - pad;
      const bboxW = Math.max(20, (Math.max(...xs) - Math.min(...xs)) + pad * 2);
      const bboxH = Math.max(20, (Math.max(...ys) - Math.min(...ys)) + pad * 2);

      // ★★★ DEBUG: 件数付きログ（原因特定用） ★★★
      if (DEBUG_MODE && isSelected) {
        console.log('[pen rendered] id=' + shape.id.substring(0, 8) + ' cid=' + String(shape.comment_id || '').substring(0, 8) + ' points=' + (points.length / 2));
      }

      return (
        <Group
          key={shape.id}
          name="paintOverlay"
          ref={(node) => { if (node) shapeRefs.current[shape.id] = node; }}
          x={groupX}
          y={groupY}
          listening={isSelectable && !isDrawingShape}
          draggable={isEditable && !isDrawingShape}
          onPointerDown={(isSelectable && !isDrawingShape) ? (e) => {
            e.cancelBubble = true;
            setSelectedId(shape.id);
            if (onStrokeColorChange && shape.stroke) onStrokeColorChange(shape.stroke);
            if (onStrokeWidthChange && typeof shape.strokeWidth === 'number') onStrokeWidthChange(shape.strokeWidth);
          } : undefined}
          onDragStart={(isEditable && !isDrawingShape) ? (e) => handleDragStart(shape, e) : undefined}
          onDragMove={(isEditable && !isDrawingShape) ? (e) => handleDragMove(shape, e) : undefined}
          onDragEnd={(isEditable && !isDrawingShape) ? (e) => handleDragEnd(shape, e) : undefined}
        >
          <Line 
            stroke={shape.stroke}
            strokeWidth={shape.strokeWidth}
            points={points} 
            tension={0.5} 
            lineCap="round" 
            lineJoin="round" 
            fill={undefined}
            listening={false}
          />
          {!isDrawingShape && (
            <Rect 
              x={bboxX} 
              y={bboxY} 
              width={bboxW} 
              height={bboxH} 
              fill="rgba(0,0,0,0.01)"
              listening={isSelectable}
            />
          )}
          {isSelected && !isDrawingShape && (
            <>
              <Rect 
                x={bboxX} 
                y={bboxY} 
                width={bboxW} 
                height={bboxH} 
                stroke="#3b82f6"
                strokeWidth={1}
                dash={[4, 4]}
                listening={false}
              />
              <Rect
                x={bboxX + 2}
                y={bboxY + 2}
                width={28}
                height={14}
                fill="#3b82f6"
                cornerRadius={2}
                listening={false}
              />
              <Text
                x={bboxX + 6}
                y={bboxY + 4}
                text="ペン"
                fontSize={10}
                fill="white"
                listening={false}
              />
            </>
          )}
          {boundingBox && <Rect x={boundingBox.x} y={boundingBox.y} width={boundingBox.width} height={boundingBox.height} stroke="rgba(255,0,0,0.3)" strokeWidth={1} dash={[5,5]} fill={undefined} listening={false} />}
        </Group>
      );
    } else if (shape.tool === 'rect') {
      // 正規化座標を優先（必ずこれから復元）
      if (shape.nx !== undefined) {
        const p1 = denormalizeCoords(shape.nx, shape.ny);
        const p2 = denormalizeCoords(shape.nx + shape.nw, shape.ny + shape.nh);
        const elements = [
          <Rect {...commonProps} key={shape.id} x={p1.x} y={p1.y} width={p2.x - p1.x} height={p2.y - p1.y} fill={undefined} hitStrokeWidth={Math.max(10, (shape.strokeWidth || 2) * 3)} />
        ];
        if (boundingBox) {
          elements.push(<Rect key={`bbox-${shape.id}`} x={boundingBox.x} y={boundingBox.y} width={boundingBox.width} height={boundingBox.height} stroke="rgba(255,0,0,0.3)" strokeWidth={1} dash={[5,5]} fill={undefined} listening={false} />);
        }
        return elements;
        }

        // 描画中の一時データ（nxがない場合のみ - 保存後は存在しないはず）
        if (shape.x !== undefined && shape.width !== undefined) {
        return <Rect key={shape.id} {...commonProps} x={shape.x} y={shape.y} width={shape.width} height={shape.height} fill={undefined} hitStrokeWidth={Math.max(10, (shape.strokeWidth || 2) * 3)} />;
        }

        return null;
        } else if (shape.tool === 'circle') {
        // CRITICAL: 正規化座標を優先（必ずこれから復元）
        if (shape.nx !== undefined) {
        const center = denormalizeCoords(shape.nx, shape.ny);
        const elements = [
          <Circle {...commonProps} key={shape.id} x={center.x} y={center.y} radius={shape.nr * bgSize.width} fill={undefined} hitStrokeWidth={Math.max(10, (shape.strokeWidth || 2) * 3)} />
        ];
        if (boundingBox) {
          elements.push(<Rect key={`bbox-${shape.id}`} x={boundingBox.x} y={boundingBox.y} width={boundingBox.width} height={boundingBox.height} stroke="rgba(255,0,0,0.3)" strokeWidth={1} dash={[5,5]} fill={undefined} listening={false} />);
        }
        return elements;
        }

        // 描画中の一時データ（nxがない場合のみ - 保存後は存在しないはず）
        if (shape.x !== undefined && shape.radius !== undefined) {
        return <Circle key={shape.id} {...commonProps} x={shape.x} y={shape.y} radius={shape.radius} fill={undefined} hitStrokeWidth={Math.max(10, (shape.strokeWidth || 2) * 3)} />;
        }

        return null;
      } else if (shape.tool === 'arrow') {
        // ★★★ CRITICAL FIX: 描画中と確定済みで座標系を完全に分離 ★★★
        const isDrawingShape = !shape.normalizedPoints && shape.points;
        let points = [];
        let groupX = 0;
        let groupY = 0;

        if (isDrawingShape) {
          // ★ 描画中: 絶対座標pointsをそのまま使用
          points = shape.points;
          groupX = 0;
          groupY = 0;
        } else if (shape.normalizedPoints) {
          // ★ 確定済み: normalizedPointsから復元
          for (let i = 0; i < shape.normalizedPoints.length; i += 2) {
            const { x, y } = denormalizeCoords(shape.normalizedPoints[i], shape.normalizedPoints[i + 1]);
            points.push(x, y);
          }
          groupX = shape.dragX ?? 0;
          groupY = shape.dragY ?? 0;
        }

        // pointsが空の場合は描画しない
        if (points.length < 4) return null;

        // bbox計算（透明当たり判定用）
        const xs = [], ys = [];
        for (let i = 0; i < points.length; i += 2) {
          xs.push(points[i]);
          ys.push(points[i + 1]);
        }
        const pad = Math.max(15, (shape.strokeWidth || 2) * 4);
        const bboxX = Math.min(...xs) - pad;
        const bboxY = Math.min(...ys) - pad;
        const bboxW = Math.max(20, (Math.max(...xs) - Math.min(...xs)) + pad * 2);
        const bboxH = Math.max(20, (Math.max(...ys) - Math.min(...ys)) + pad * 2);

        // ★★★ DEBUG: 件数付きログ（原因特定用） ★★★
        if (DEBUG_MODE && isSelected) {
          console.log('[arrow rendered] id=' + shape.id.substring(0, 8) + ' cid=' + String(shape.comment_id || '').substring(0, 8) + ' points=' + (points.length / 2));
        }

        return (
          <Group
            key={shape.id}
            name="paintOverlay"
            ref={(node) => { if (node) shapeRefs.current[shape.id] = node; }}
            x={groupX}
            y={groupY}
            listening={isSelectable && !isDrawingShape}
            draggable={isEditable && !isDrawingShape}
            onPointerDown={(isSelectable && !isDrawingShape) ? (e) => {
              e.cancelBubble = true;
              setSelectedId(shape.id);
              if (onStrokeColorChange && shape.stroke) onStrokeColorChange(shape.stroke);
              if (onStrokeWidthChange && typeof shape.strokeWidth === 'number') onStrokeWidthChange(shape.strokeWidth);
            } : undefined}
            onDragStart={(isEditable && !isDrawingShape) ? (e) => handleDragStart(shape, e) : undefined}
            onDragMove={(isEditable && !isDrawingShape) ? (e) => handleDragMove(shape, e) : undefined}
            onDragEnd={(isEditable && !isDrawingShape) ? (e) => handleDragEnd(shape, e) : undefined}
          >
            <Arrow 
              stroke={shape.stroke}
              strokeWidth={shape.strokeWidth}
              points={points} 
              pointerLength={10} 
              pointerWidth={10} 
              listening={false}
            />
            {!isDrawingShape && (
              <Rect 
                x={bboxX} 
                y={bboxY} 
                width={bboxW} 
                height={bboxH} 
                fill="rgba(0,0,0,0.01)"
                listening={isSelectable}
              />
            )}
            {boundingBox && <Rect key={`bbox-${shape.id}`} x={boundingBox.x} y={boundingBox.y} width={boundingBox.width} height={boundingBox.height} stroke="rgba(255,0,0,0.3)" strokeWidth={1} dash={[5,5]} fill={undefined} listening={false} />}
          </Group>
        );
      } else if (shape.tool === 'text') {
        // Text描画
        let x = 0, y = 0;

        // 正規化座標を優先
        if (shape.nx !== undefined) {
          const pos = denormalizeCoords(shape.nx, shape.ny);
          x = pos.x;
          y = pos.y;
        } else if (shape.x !== undefined) {
          x = shape.x;
          y = shape.y;
        }

        const fontSize = shape.fontSize || Math.max(12, (shape.strokeWidth || 2) * 6);
        const textContent = shape.text || '';

        // ★ フォント設定を完全統一（測定と描画で同一）
        const fontProps = {
          fontFamily: 'Arial, sans-serif',
          fontStyle: 'normal',
          fontSize: fontSize,
          lineHeight: 1,
          letterSpacing: 0,
          padding: 0,
          wrap: 'none',  // ★ 折り返し禁止（bboxが太らないように）
        };

        // パディング設定
        const padL = 4;
        const padR = 4;
        const padY = 3;

        // ★ Canvas measureTextでグリフのAscent/Descentを実測
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        ctx.font = `${fontProps.fontStyle} ${fontSize}px ${fontProps.fontFamily}`;
        const metrics = ctx.measureText(textContent || 'M');
        
        // actualBoundingBox系でグリフの実際の高さを取得
        const ascent = metrics.actualBoundingBoxAscent || fontSize * 0.8;
        const descent = metrics.actualBoundingBoxDescent || fontSize * 0.2;
        const glyphH = ascent + descent;
        const tw = metrics.width;

        // ★ 判定を厳密に（boxResized === true かつ boxH != null）
        const hasManualBoxW = shape.boxResized === true && shape.boxW != null;
        const hasManualBoxH = shape.boxResized === true && shape.boxH != null;

        // ★ auto時：グリフ実測ベースで計算
        const autoBoxW = tw + padL + padR;
        const autoBoxH = glyphH + padY * 2;
        
        const boxW = hasManualBoxW ? shape.boxW * bgSize.width : autoBoxW;
        const boxH = hasManualBoxH ? shape.boxH * bgSize.height : autoBoxH;

        // ★ textY計算：グリフ上端がpadYに来るように配置
        const textX = padL;
        // Konva Textはbaselineがtopなので、ascent分だけ下にずらす必要はない
        // ただしKonvaはデフォルトでtop配置なので、padYをそのまま使う
        const textY = hasManualBoxH
          ? padY + (boxH - padY * 2 - glyphH) / 2  // リサイズ済み：中央配置
          : padY;  // auto：上端固定

        // デバッグログ
        if (DEBUG_MODE && !hasManualBoxH) {
          console.log('[Text auto canvas]', {
            id: shape.id?.substring(0, 8),
            ascent: ascent.toFixed(2),
            descent: descent.toFixed(2),
            glyphH: glyphH.toFixed(2),
            autoBoxH: autoBoxH.toFixed(2),
            boxH: boxH.toFixed(2),
            textY: textY.toFixed(2),
          });
        }

        return (
          <Group
            key={shape.id}
            name="paintOverlay"
            x={x}
            y={y}
            ref={(node) => { if (node) shapeRefs.current[shape.id] = node; }}
            draggable={isEditable}
            onPointerDown={canEdit ? (e) => {
              if (!isEditable) return;
              e.cancelBubble = true;
              setSelectedId(shape.id);
              if (onStrokeColorChange && shape.stroke) onStrokeColorChange(shape.stroke);
              if (onStrokeWidthChange && typeof shape.strokeWidth === 'number') onStrokeWidthChange(shape.strokeWidth);
            } : undefined}
            onDragStart={isEditable ? (e) => handleDragStart(shape, e) : undefined}
            onDragMove={isEditable ? (e) => handleDragMove(shape, e) : undefined}
            onDragEnd={isEditable ? (e) => handleDragEnd(shape, e) : undefined}
            onTransformEnd={isEditable ? (e) => handleTransformEnd(shape, e) : undefined}
            onDblClick={canEdit ? () => handleTextDblClick(shape) : undefined}
          >
            {/* 透明Rect：Transformerの対象・当たり判定 */}
            <Rect
              width={boxW}
              height={boxH}
              fill="transparent"
              listening={true}
            />
            {/* テキスト：Canvas実測ベースで配置 */}
            <Text
              x={textX}
              y={textY}
              text={textContent}
              {...fontProps}
              fill={shape.stroke}
              listening={false}
            />
          </Group>
        );
      }
      return null;
      };
  
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
    console.log('[ViewerCanvas] Render:', {
      renderedShapesCount: renderedShapes.length,
      paintMode,
      showAllPaint,
      canvasContextKey: canvasContextKey?.substring(0, 20) || 'null',
      renderTargetCommentId: renderTargetCommentId?.substring(0, 12) || 'null',
      isPending,
    });
  }

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative', overflow: 'auto', background: '#e0e0e0' }}>
      {/* ★★★ FIX-NO-BLANK: pending中は半透明オーバーレイ（背景は透けて見える）★★★ */}
      {isPending && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.7)', zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ color: '#666', fontSize: '14px' }}>コメント情報を読み込み中...</div>
        </div>
      )}
      
      {/* ★★★ DEBUG HUD: DEBUG_MODE時のみ表示 ★★★ */}
      {DEBUG_MODE && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          zIndex: 9999,
          background: 'rgba(0, 0, 0, 0.85)',
          color: '#0f0',
          padding: '8px',
          fontSize: '11px',
          fontFamily: 'monospace',
          lineHeight: '1.4',
          maxWidth: '400px',
          maxHeight: '40vh',
          overflow: 'auto',
          borderBottomRightRadius: '4px',
        }}>
          <div style={{ color: '#ff0', fontWeight: 'bold', marginBottom: '4px' }}>🎯 ViewerCanvas State</div>
          <div>activeCommentId: <span style={{ color: '#0ff' }}>{debugHudData.activeCommentId}</span></div>
          <div>effectiveActiveId: <span style={{ color: '#0ff' }}>{debugHudData.effectiveActiveId}</span></div>
          <div>draftCommentId: <span style={{ color: '#0ff' }}>{debugHudData.draftCommentId}</span></div>
          <div>renderedShapes.length: <span style={{ color: '#ff0' }}>{debugHudData.renderedShapesLength}</span></div>
          <div>uniqueCommentIds: <span style={{ color: '#f0f' }}>{debugHudData.uniqueCommentIds.join(', ') || '(none)'}</span></div>
          
          {Object.keys(debugHudData.countsByCommentId).length > 0 && (
            <div style={{ marginTop: '4px', borderTop: '1px solid #333', paddingTop: '4px' }}>
              <div style={{ color: '#ff0', fontSize: '10px' }}>Counts by CommentID:</div>
              {Object.entries(debugHudData.countsByCommentId).map(([cid, count]) => (
                <div key={cid} style={{ fontSize: '9px', marginTop: '2px' }}>
                  {cid}: <span style={{ color: '#ff0' }}>{count}</span>
                </div>
              ))}
            </div>
          )}
          
          {debugHudLogs.length > 0 && (
            <>
              <div style={{ borderTop: '1px solid #333', marginTop: '6px', paddingTop: '6px', color: '#ff0' }}>
                Recent Events:
              </div>
              {debugHudLogs.map((log, i) => (
                <div key={i} style={{ fontSize: '9px', marginTop: '2px' }}>
                  {log.event}: targetId={log.targetId.substring(0, 12)} tool={log.tool}
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* テキスト入力エディタ */}
      {textEditor.visible && (
        <div
          style={{
            position: 'absolute',
            left: `${textEditor.x}px`,
            top: `${textEditor.y}px`,
            zIndex: 1000,
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <textarea
            ref={textInputRef}
            value={textEditor.value}
            onChange={(e) => setTextEditor(prev => ({ ...prev, value: e.target.value }))}
            placeholder="テキストを入力..."
            style={{
              padding: '8px',
              fontSize: '16px',
              border: '2px solid #4f46e5',
              borderRadius: '4px 4px 0 0',
              background: 'white',
              minWidth: '250px',
              minHeight: '80px',
              resize: 'both',
              fontFamily: 'Arial',
              boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
              display: 'block',
              width: '100%',
            }}
            onCompositionStart={() => setIsComposing(true)}
            onCompositionEnd={() => setIsComposing(false)}
            onKeyDown={(e) => {
              e.stopPropagation();
              // IME変換中はEnterを無視（keyCode 229 または isComposing）
              const isComposingNow = e.nativeEvent?.isComposing || e.keyCode === 229 || isComposing;

              if (e.key === 'Enter' && !e.shiftKey && !isComposingNow) {
                e.preventDefault();
                handleTextConfirm();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                handleTextCancel();
              }
            }}
            onBlur={handleTextBlur}
            onClick={(e) => e.stopPropagation()}
          />
          
          {/* モバイル/タブレット用ボタン */}
          <div style={{ 
            display: 'flex', 
            gap: '4px', 
            background: 'white',
            borderRadius: '0 0 4px 4px',
            padding: '4px',
            borderTop: '1px solid #e5e7eb',
          }}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleTextConfirm();
              }}
              onMouseDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              style={{
                flex: 1,
                padding: '6px 12px',
                background: '#10b981',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                fontSize: '14px',
                fontWeight: '500',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
              }}
            >
              ✓ 確定
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleTextCancel();
              }}
              onMouseDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              style={{
                flex: 1,
                padding: '6px 12px',
                background: '#ef4444',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                fontSize: '14px',
                fontWeight: '500',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
              }}
            >
              × キャンセル
            </button>
          </div>
          
          <div style={{ marginTop: '4px', fontSize: '11px', color: '#666', background: 'white', padding: '2px 4px', borderRadius: '2px' }}>
            Enter: 確定 | Esc: キャンセル | Shift+Enter: 改行
          </div>
        </div>
      )}

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
        {/* P2 FIX: 背景ロード完了まで描画レイヤーを非表示 */}
        {/* P0: paint Layerに key を付与して hidePaintOverlay 切替時に確実に再マウント（残像根絶） */}
        {/* CONTRACT (P0): Paint layer may remount ONLY as a controlled mechanism to remove ghosting
// when hidePaintOverlay/canvasContextKey changes. Do NOT move this remounting to Stage. */}
        {bgReady && (
          <Layer 
            key={`paint:${hidePaintOverlay ? 'hide' : 'show'}:${forceClearToken}:${canvasContextKey || 'none'}`}
            ref={paintLayerRef}
            listening={!hidePaintOverlay}
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
                  {/* ★★★ CRITICAL: 確定済みshapeのみ描画（currentShapeとの重複は既に除外済み）★★★ */}
                  {renderedShapesFinal.map(s => renderShape(s, true))}

                  {/* ★★★ CRITICAL: 描画中のcurrentShapeは最後に独立して描画 ★★★ */}
                  {currentShape && renderShape(currentShape, false)}

                  <Transformer ref={transformerRef} name="paintOverlay" />
                </>
              )}
            </Group>
            </Layer>
            )}
        
        {/* ★ DEBUGオーバーレイ Layer削除（DOM HUDに統合） */}
      </Stage>
      
      {/* デバッグオーバーレイ（拡張版） */}
      {DEBUG_MODE && (
        <div style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.9)', color: '#0f0', padding: '10px', fontSize: '10px', fontFamily: 'monospace', borderRadius: '6px', pointerEvents: 'none', zIndex: 100, lineHeight: '1.5', maxWidth: '400px', maxHeight: '90vh', overflow: 'auto' }}>
          <div style={{ color: '#ff0', fontWeight: 'bold', marginBottom: '8px' }}>🔍 ViewerCanvas Debug</div>

          {/* Ready状態 */}
          {debugInfo && (
            <div style={{ marginBottom: '8px', borderBottom: '1px solid #333', paddingBottom: '6px' }}>
              <div><strong style={{ color: '#0ff' }}>Ready:</strong> {debugInfo.isReady ? '✓ TRUE' : '✗ FALSE'}</div>
              {debugInfo.readyDetails && (
                <div style={{ paddingLeft: '8px', fontSize: '9px' }}>
                  {Object.entries(debugInfo.readyDetails).map(([key, val]) => (
                    <div key={key} style={{ color: val ? '#0f0' : '#f00' }}>
                      {key}: {val ? '✓' : '✗'}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Query情報 */}
          {debugInfo && (
            <div style={{ marginBottom: '8px', borderBottom: '1px solid #333', paddingBottom: '6px' }}>
              <div><strong style={{ color: '#0ff' }}>Query:</strong></div>
              <div style={{ fontSize: '9px', wordBreak: 'break-all' }}>
                token: {debugInfo.token?.substring(0, 12)}...
              </div>
              <div style={{ fontSize: '9px' }}>fileId: {debugInfo.fileId?.substring(0, 15)}</div>
              <div style={{ fontSize: '9px' }}>pageNo: {debugInfo.pageNo}</div>
              <div style={{ fontSize: '9px' }}>guestId: {debugInfo.guestId?.substring(0, 20)}</div>
            </div>
          )}

          {/* Counts */}
          <div style={{ marginBottom: '8px', borderBottom: '1px solid #333', paddingBottom: '6px' }}>
            <div><strong style={{ color: '#0ff' }}>Counts:</strong></div>
            <div>fetchedCount: <span style={{ color: '#ff0', fontWeight: 'bold' }}>{debugInfo?.fetchedCount || 0}</span></div>
            <div>renderedCount: <span style={{ color: '#0f0', fontWeight: 'bold' }}>{shapes.length}</span></div>
            <div>existingShapes: {existingShapes?.length || 0}</div>
            <div>renderedShapes: {renderedShapes?.length || 0}</div>
          </div>

          {/* Background & View */}
          <div style={{ marginBottom: '8px', borderBottom: '1px solid #333', paddingBottom: '6px' }}>
            <div><strong style={{ color: '#0ff' }}>Background:</strong></div>
            <div>bgSize: {bgSize.width} x {bgSize.height}</div>
            <div><strong style={{ color: '#0ff' }}>View:</strong></div>
            <div>scale: {contentScale.toFixed(2)} (fit:{fitScale.toFixed(2)} * zoom:{userScale.toFixed(2)})</div>
            <div>offset: {Math.round(offsetX)}, {Math.round(offsetY)}</div>
            <div>stage: {containerSize.width} x {containerSize.height}</div>
          </div>

          {/* Sample Shape */}
          {shapes.length > 0 && (
            <div style={{ marginBottom: '8px', borderBottom: '1px solid #333', paddingBottom: '6px' }}>
              <div><strong style={{ color: '#0ff' }}>Sample (first):</strong></div>
              <div style={{ fontSize: '9px' }}>type: {shapes[0].tool}</div>
              <div style={{ fontSize: '9px', wordBreak: 'break-all' }}>id: {shapes[0].id}</div>
              <div style={{ fontSize: '9px' }}>has_nx: {shapes[0].nx !== undefined ? 'YES' : 'NO'}</div>
              <div style={{ fontSize: '9px' }}>has_normalizedPoints: {shapes[0].normalizedPoints ? 'YES' : 'NO'}</div>
            </div>
          )}

          {/* Drawing State */}
          <div style={{ marginBottom: '8px', borderBottom: '1px solid #333', paddingBottom: '6px' }}>
            <div><strong style={{ color: '#0ff' }}>Drawing:</strong></div>
            <div>paintMode: {paintMode ? 'ON' : 'OFF'}</div>
            <div>draftReady: {draftReady ? 'YES' : 'NO'}</div>
            <div>tool: {tool}</div>
            <div>canDrawNew: {canDrawNew ? 'YES' : 'NO'}</div>
            <div>canMutateExisting: {canMutateExisting ? 'YES' : 'NO'}</div>
            <div>canEdit: {canEdit ? 'YES' : 'NO'}</div>
            <div>isDrawing: {isDrawing ? 'YES' : 'NO'}</div>
            <div>lastEvent: {lastEvent}</div>
          </div>

          {/* Save Status */}
          <div>
            <div style={{ color: lastSaveStatus === 'success' ? '#0f0' : lastSaveStatus === 'error' ? '#f00' : '#ff0' }}>
              saveStatus: {lastSaveStatus}
            </div>
            {lastMutation && <div style={{ fontSize: '9px' }}>mutation: {lastMutation}</div>}
            {lastError && <div style={{ color: '#f00', fontSize: '9px' }}>error: {lastError}</div>}
            <div style={{ fontSize: '9px' }}>activeCommentId: {debugInfo?.activeCommentId || 'null'}</div>
            <div style={{ fontSize: '9px' }}>filteredCount: {debugInfo?.filteredCount || 0}</div>
            <div style={{ fontSize: '9px' }}>showAllPaint: {showAllPaint ? 'ON' : 'OFF'}</div>
            </div>
        </div>
      )}
    </div>
  );
});

ViewerCanvas.displayName = 'ViewerCanvas';

export default ViewerCanvas;