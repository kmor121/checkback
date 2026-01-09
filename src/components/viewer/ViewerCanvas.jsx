import React, { useState, useEffect, useRef, useImperativeHandle, forwardRef, useMemo } from 'react';
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

// ★ CRITICAL: comment_id判定ユーティリティ（フィールド名/型ブレ吸収）
const shapeCommentId = (s) => s?.comment_id ?? s?.commentId ?? s?.commentID ?? null;
const sameId = (a, b) => String(a ?? '') === String(b ?? '');

// 背景画像コンポーネント（チラつき防止：前の画像を保持）
function BackgroundImage({ src, onLoad }) {
  const [image] = useImage(src);
  const lastImageRef = useRef(null);
  
  useEffect(() => {
    if (image) {
      lastImageRef.current = image;
      if (onLoad) {
        onLoad({ width: image.width, height: image.height });
      }
    }
  }, [image, onLoad]);
  
  const imgToRender = image || lastImageRef.current;
  
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
}, ref) => {
  const containerRef = useRef(null);
  const stageRef = useRef(null);
  const contentGroupRef = useRef(null);
  const stableFileUrlRef = useRef(fileUrl);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [bgSize, setBgSize] = useState({ width: 800, height: 600 });
  const [error, setError] = useState(null);
  
  // 描画状態
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentShape, setCurrentShape] = useState(null);
  const [shapes, setShapes] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const transformerRef = useRef(null);
  const shapeRefs = useRef({});
  const shapesRef = useRef([]); // CRITICAL: 常に最新shapesを参照（stale回避）
  const drawViewRef = useRef(null); // CRITICAL: 描画中のview固定（ジャンプ防止）
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
  
  // shapesRefを常に最新に保つ
  useEffect(() => {
    shapesRef.current = shapes;
  }, [shapes]);
  
  // CRITICAL: 描画状態をrefに同期（activeCommentIdリセットガード用）
  useEffect(() => {
    isDrawingRef2.current = isDrawing;
  }, [isDrawing]);
  
  useEffect(() => {
    currentShapeRef2.current = currentShape;
  }, [currentShape]);
  
  // パン状態
  const [pan, setPan] = useState({ x: 0, y: 0 });
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
  
  // ★ CRITICAL: 選択に使うIDは activeCommentId または draftCommentIdRef（仮ID対応）
  const effectiveActiveId = activeCommentId ?? draftCommentIdRef.current ?? null;
  
  // ★ CRITICAL: 選択と編集を分離
  const canSelect = isEditMode;                 // 選択だけは常にOK
  const canMutate = paintMode && isEditMode;    // 移動/変形/削除はpaintMode時だけ
  const canEdit = canMutate;                    // 後方互換用エイリアス
  
  // ★ このshapeを選択できるか（effectiveActiveId使用で仮ID対応）
  const isSelectableShape = (shape) =>
    canSelect && effectiveActiveId != null && sameId(shapeCommentId(shape), effectiveActiveId);
  
  // ★ このshapeを編集できるか（paintMode時のみ）
  const isEditableShape2 = (shape) =>
    canMutate && isSelectableShape(shape);
  
  // CRITICAL: 描画に使うcomment_idを取得（仮IDまたはactiveCommentId）
  const getCommentIdForDrawing = () => {
    if (activeCommentId != null) return activeCommentId;
    // 仮ID生成（onBeginPaintは非同期で投げるだけ）
    if (!draftCommentIdRef.current) {
      draftCommentIdRef.current = generateUUID();
    }
    return draftCommentIdRef.current;
  };
  
  // CRITICAL: existingShapes + shapes を1本にマージ（ローカル優先）
  const mergedShapes = useMemo(() => {
    const map = new Map();
    (existingShapes ?? []).forEach(s => map.set(s.id, s));
    (shapes ?? []).forEach(s => map.set(s.id, s)); // ローカルの方を優先
    return Array.from(map.values());
  }, [existingShapes, shapes]);
  
  // CRITICAL: 実際に描画するshape配列（互換性対策: comment_id ?? commentId、String比較）
  const renderedShapes = useMemo(() => {
    if (showAllPaint) return mergedShapes;
    
    // activeCommentIdがある時はそれだけ（互換性対策＋String化で一致判定）
    if (activeCommentId != null) {
      const targetId = String(activeCommentId);
      return mergedShapes.filter(s => {
        const cid = s.comment_id ?? s.commentId;
        return cid != null && String(cid) === targetId;
      });
    }
    
    // 描画中の仮ID shapeも表示（activeCommentIdがなくても描画継続）
    if (draftCommentIdRef.current) {
      const targetId = String(draftCommentIdRef.current);
      return mergedShapes.filter(s => {
        const shapeCommentId = s.comment_id ?? s.commentId;
        return shapeCommentId && String(shapeCommentId) === targetId;
      });
    }
    
    return [];
  }, [mergedShapes, showAllPaint, activeCommentId]);
  
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
    if (!canEdit) return false;                  // paintMode && tool==='select' の時だけ編集OK
    if (activeCommentId == null) return false;   // 0を弾かないために == null を使う
    return sameId(shapeCommentId(shape), activeCommentId);
  };
  
  // fileUrl安定化（最後の有効URLを保持）
  useEffect(() => {
    if (fileUrl) {
      stableFileUrlRef.current = fileUrl;
    }
  }, [fileUrl]);

  // CRITICAL: activeCommentId変化時のリセット（描画中は絶対にリセットしない）
  useEffect(() => {
    const prev = prevActiveCommentIdRef.current;
    prevActiveCommentIdRef.current = activeCommentId;
    
    // ★超重要: 描画中 or currentShapeがある場合は絶対にリセットしない
    if (isDrawing || currentShape) {
      if (DEBUG_MODE) console.log('[ViewerCanvas] skip reset (drawing in progress)');
      return;
    }
    
    if (DEBUG_MODE) {
      console.log('[ViewerCanvas] activeCommentId changed, resetting', { prev, next: activeCommentId });
    }
    
    // 通常のコメント切替/解除は安全にリセット
    setSelectedId(null);
    setCurrentShape(null);
    setIsDrawing(false);
    setTextEditor({ visible: false, x: 0, y: 0, value: '', shapeId: null, imgX: 0, imgY: 0, openedAt: 0 });
    
    requestAnimationFrame(() => {
      if (transformerRef.current) {
        transformerRef.current.nodes([]);
        transformerRef.current.getLayer()?.batchDraw();
      }
    });
  }, [activeCommentId, isDrawing, currentShape]);
  
  // CRITICAL: 仮commentIdで描いたshapeを、activeCommentId確定後に付け替える
  useEffect(() => {
    if (!activeCommentId) return;
    if (!draftCommentIdRef.current) return;
    
    const draftId = draftCommentIdRef.current;
    if (DEBUG_MODE) console.log('[ViewerCanvas] attaching draft shapes to real comment', { draftId, activeCommentId });
    
    setShapes(prev => prev.map(s => s.comment_id === draftId ? { ...s, comment_id: activeCommentId } : s));
    draftCommentIdRef.current = null;
  }, [activeCommentId]);

  // CRITICAL: fileUrl/pageNumber/zoom変更時にリセット
  useEffect(() => {
    if (DEBUG_MODE) {
      console.log('[ViewerCanvas] fileUrl/pageNumber/zoom changed, resetting state');
    }
    setShapes([]);
    setSelectedId(null);
    setCurrentShape(null);
    setUndoStack([]);
    setRedoStack([]);
    setPan({ x: 0, y: 0 });
  }, [fileUrl, pageNumber, zoom]);

  // CRITICAL: existingShapes を常に反映（source-of-truth を props に寄せる）
  useEffect(() => {
    // CRITICAL: 描画中は編集状態をリセットしない（描画継続を許可）
    if (isDrawing || currentShape) {
      // 描画中でもexistingShapesは反映
      const existingIds = new Set((existingShapes ?? []).map(s => s.id));
      const localOnlyShapes = shapes.filter(s => !existingIds.has(s.id));
      const merged = [...(existingShapes ?? []), ...localOnlyShapes];
      setShapes(merged);
      return;
    }

    // CRITICAL: existingShapesが空配列の場合は完全リセット（送信後のクリア対応）
    if (!existingShapes || existingShapes.length === 0) {
      setShapes([]);
      setSelectedId(null);
      setTextEditor({ visible: false, x: 0, y: 0, value: '', shapeId: null, imgX: 0, imgY: 0, openedAt: 0 });
      draftCommentIdRef.current = null;
      
      requestAnimationFrame(() => {
        if (transformerRef.current) {
          transformerRef.current.nodes([]);
          transformerRef.current.getLayer()?.batchDraw();
        }
      });
      return;
    }

    // ★ CRITICAL: ローカル優先マージ（ドラッグ後の位置を守る）
    const mergedShapesLocal = (() => {
      const map = new Map();
      (existingShapes ?? []).forEach(s => map.set(s.id, s));
      (shapes ?? []).forEach(s => map.set(s.id, s));
      return Array.from(map.values());
    })();
    setShapes(mergedShapesLocal);

    // ✅ 選択は「存在していて同じコメントなら維持」、そうでなければ解除
    setSelectedId(prevSel => {
      if (!prevSel) return null;
      const sel = mergedShapesLocal.find(s => s.id === prevSel);
      if (!sel) return null;
      const effId = activeCommentId ?? draftCommentIdRef.current ?? null;
      if (effId == null) return null;
      return sameId(shapeCommentId(sel), effId) ? prevSel : null;
    });
    
    setTextEditor({ visible: false, x: 0, y: 0, value: '', shapeId: null, imgX: 0, imgY: 0, openedAt: 0 });

    requestAnimationFrame(() => {
      if (transformerRef.current) {
        transformerRef.current.nodes([]);
        transformerRef.current.getLayer()?.batchDraw();
      }
    });
  }, [existingShapes]);

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

  // 描画モード開始時は選択解除
  useEffect(() => {
    if (!isEditMode) {
      setSelectedId(null);
    }
  }, [isEditMode]);

  // Transformer selection（編集モード時のみ、Rect/Circle/Textに対応）
  useEffect(() => {
    if (!transformerRef.current) return;
    
    if (isEditMode && selectedId && shapeRefs.current[selectedId]) {
      const selectedShape = shapes.find(s => s.id === selectedId);
      const canTransform = selectedShape && (selectedShape.tool === 'rect' || selectedShape.tool === 'circle' || selectedShape.tool === 'text' || selectedShape.tool === 'arrow');

      if (canTransform) {
        transformerRef.current.nodes([shapeRefs.current[selectedId]]);
        transformerRef.current.getLayer().batchDraw();
      } else {
        transformerRef.current.nodes([]);
        transformerRef.current.getLayer().batchDraw();
      }
    } else {
      transformerRef.current.nodes([]);
      transformerRef.current.getLayer().batchDraw();
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
        // CRITICAL: 編集可能なIDのみ削除を許可（isEditableShape関数で判定）
        const selectedShape = shapes.find(s => s.id === selectedId);
        if (canEdit && selectedId && selectedShape && isEditableShape(selectedShape)) {
          e.preventDefault();
          handleDelete();
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
    }, [selectedId, shapes, undoStack, redoStack, canEdit]);

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
  
  // CRITICAL: パンは select ツール時のみ（描画ツールとの競合回避）
  const canPan = paintMode && tool === 'select' && zoom > 100;
  
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
  


  // CRITICAL: Konva transform API を使った座標変換（手計算を廃止）
  const stagePointToImagePoint = () => {
    const stage = stageRef.current;
    const group = contentGroupRef.current;
    if (!stage || !group) return null;

    const p = stage.getPointerPosition();
    if (!p) return null;

    // group(=画像レイヤー)の絶対変換を逆変換して、ローカル座標に戻す
    const tr = group.getAbsoluteTransform().copy();
    tr.invert();
    const local = tr.point(p);

    return { x: local.x, y: local.y, stageX: p.x, stageY: p.y };
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

  // Undo実行
  const performUndo = () => {
    if (undoStack.length === 0) return;
    
    const action = undoStack[undoStack.length - 1];
    setUndoStack(prev => prev.slice(0, -1));
    setRedoStack(prev => [...prev, action]);
    
    if (action.type === 'add') {
      setShapes(prev => prev.filter(s => s.id !== action.shapeId));
    } else if (action.type === 'update') {
      setShapes(prev => prev.map(s => s.id === action.shapeId ? action.before : s));
    } else if (action.type === 'delete') {
      setShapes(prev => {
        const newShapes = [...prev];
        newShapes.splice(action.index, 0, action.shape);
        return newShapes;
      });
    }
  };

  // Redo実行
  const performRedo = () => {
    if (redoStack.length === 0) return;
    
    const action = redoStack[redoStack.length - 1];
    setRedoStack(prev => prev.slice(0, -1));
    setUndoStack(prev => [...prev, action]);
    
    if (action.type === 'add') {
      // 再追加は困難なので省略
    } else if (action.type === 'update') {
      setShapes(prev => prev.map(s => s.id === action.shapeId ? action.after : s));
    } else if (action.type === 'delete') {
      setShapes(prev => prev.filter(s => s.id !== action.shape.id));
    }
  };

  // CRITICAL: 削除（DB削除も実行、永続化）
  const handleDelete = async () => {
    if (!canEdit || !selectedId) return;
    
    // CRITICAL: 編集可能なIDのみ削除を許可（isEditableShape関数で判定）
    const selectedShape = shapes.find(s => s.id === selectedId);
    if (!selectedShape || !isEditableShape(selectedShape)) {
      console.log('[ViewerCanvas] Delete blocked: not editable');
      return;
    }
    
    const index = shapes.findIndex(s => s.id === selectedId);
    if (index === -1) return;
    
    const shape = shapes[index];
    addToUndoStack({ type: 'delete', shape, index });
    
    // Transformer解除（先に）
    if (transformerRef.current) {
      transformerRef.current.nodes([]);
      transformerRef.current.getLayer()?.batchDraw();
    }
    
    // Optimistic update
    setShapes(prev => prev.filter(s => s.id !== selectedId));
    setSelectedId(null);
    
    // DB削除を実行
    if (onDeleteShape) {
      setLastMutation('delete');
      setLastPayload(JSON.stringify({ id: shape.id }));
      try {
        await onDeleteShape(shape);
        setLastSaveStatus('success');
        setLastError(null);
      } catch (err) {
        console.error('Delete shape error:', err);
        setLastSaveStatus('error');
        setLastError(err.message);
        // 失敗時はrevert
        setShapes(prev => {
          const newShapes = [...prev];
          newShapes.splice(index, 0, shape);
          return newShapes;
        });
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
    if (DEBUG_MODE) {
      console.log('[ViewerCanvas] handlePointerDown called', {
        tool,
        paintMode,
        isDrawMode,
        isDrawing,
        textEditorVisible: textEditor.visible,
        activeCommentId,
      });
    }

    // ★ CRITICAL: activeCommentIdがnくonBeginPaintも無い場合のみブロック（方針②）
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

      // CRITICAL: comment_idを取得（仮IDまたはactiveCommentId）
      const commentId = getCommentIdForDrawing();

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

        addToUndoStack({ type: 'update', shapeId, before: existingShape, after: updatedShape });
        setShapes(prev => prev.map(s => s.id === shapeId ? updatedShape : s));

        if (onSaveShape) {
          try {
            await onSaveShape(updatedShape, 'upsert');
          } catch (err) {
            console.error('Save text error:', err);
          }
        }
      }
    } else {
      // 新規テキスト作成（activeCommentIdがなければ仮IDを使用）
      const commentIdForText = activeCommentId || getCommentIdForDrawing();
      
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
      };
      
      // 仮IDでコメント作成をトリガー
      if (!activeCommentId && onBeginPaint) {
        queueMicrotask(() => {
          onBeginPaint(imgX, imgY, bgSize.width, bgSize.height);
        });
      }

      addToUndoStack({ type: 'add', shapeId: normalizedShape.id });
      setShapes(prev => [...prev, normalizedShape]);
      setSelectedId(normalizedShape.id);

      if (onSaveShape) {
        try {
          const result = await onSaveShape(normalizedShape, 'create');
          if (result?.dbId) {
            setShapes(prev => prev.map(s => s.id === normalizedShape.id ? { ...s, dbId: result.dbId } : s));
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
    // CRITICAL: refベースで判定（親stateが揺れても描画完了）
    const shape = currentShapeRef2.current;
    if (!isDrawingRef2.current || !shape) return;
    
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

      // 正規化データを作成（描画開始時のcomment_idを優先）
      const resolvedCommentId = shape.comment_id ?? activeCommentId ?? draftCommentIdRef.current;
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

      // Undo履歴に追加
      addToUndoStack({ type: 'add', shapeId: normalizedShape.id });

      // CRITICAL: Optimistic update は追加（新規描画のみ）
      setShapes(prev => [...prev, normalizedShape]);
      setCurrentShape(null);

      // ✅ 描画直後に選択状態にする
      setSelectedId(normalizedShape.id);
      // ✅ ハンドル表示＆すぐ移動したいなら select に戻す
      if (onToolChange) onToolChange('select');

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

        try {
          const result = await onSaveShape(normalizedShape, 'create');
          setLastSaveStatus('success');
          setLastSuccessId(result?.dbId || normalizedShape.id);
          setLastError(null);

          // CRITICAL: DBから返ってきた_idを既存shapeに上書き（新規追加しない）
          if (result?.dbId) {
            setShapes(prev => prev.map(s => s.id === normalizedShape.id ? { ...s, dbId: result.dbId } : s));
          }
        } catch (err) {
          setLastSaveStatus('error');
          setLastError(err.message || String(err));
          console.error('Save Shape Error:', err);
        } finally {
          setIsSaving(prev => ({ ...prev, [normalizedShape.id]: false }));
        }
        }

        // ★描画完了：view固定解除
        drawViewRef.current = null;
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
    isDraggingRef.current = true;
    e.cancelBubble = true;
  };

  // CRITICAL: ドラッグ中の追従更新（残像防止）
  const handleDragMove = (shape, e) => {
    if (!canEdit) return;
    const node = e.target;

    // RAF間引き
    pendingDragRef.current = { shape, x: node.x(), y: node.y() };
    if (dragRafRef.current) return;

    dragRafRef.current = requestAnimationFrame(() => {
      const p = pendingDragRef.current;
      dragRafRef.current = null;
      if (!p) return;

      const { shape, x, y } = p;

      // tool別に「stateを追従」させる（保存はしない）
      if (shape.tool === 'rect' || shape.tool === 'circle' || shape.tool === 'text') {
        const { nx, ny } = normalizeCoords(x, y);
        setShapes(prev => prev.map(s => s.id === shape.id ? { ...s, nx, ny } : s));
      } else if (shape.tool === 'pen' || shape.tool === 'arrow') {
        // pen/arrowはdragX/dragYでReact制御
        setShapes(prev => prev.map(s => s.id === shape.id ? { ...s, dragX: x, dragY: y } : s));
        node.x(0);
        node.y(0);
      }
    });
  };

  // ドラッグ終了時の更新（CRITICAL: 増殖防止のため置換処理）
  const handleDragEnd = async (shape, e) => {
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
    // CRITICAL: dragX/dragY を優先（RAF更新済みなら node.x/y は0）
    const dx = shape.dragX || node.x();
    const dy = shape.dragY || node.y();
    
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
      node.x(0);
      node.y(0);
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
      node.x(0);
      node.y(0);
    } else if (shape.tool === 'text') {
      // Text: 絶対座標として直接保存
      const { nx, ny } = normalizeCoords(dx, dy);
      updatedShape.nx = nx;
      updatedShape.ny = ny;
    }
    
    addToUndoStack({ type: 'update', shapeId: shape.id, before: shape, after: updatedShape });

    // CRITICAL: Optimistic update は「同じidを置換」（追加ではない）+ 親に即同期
    setShapes(prev => {
      const next = prev.map(s => s.id === updatedShape.id ? updatedShape : s);
      onShapesChange?.(next); // ★親にも即同期（巻き戻り防止）
      return next;
    });

    // ドラッグ終了
    isDraggingRef.current = false;
    
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
        
        // CRITICAL: DBから返ってきた_idを既存shapeに上書き（新規追加しない）
        if (result?.dbId) {
          setShapes(prev => prev.map(s => s.id === updatedShape.id ? { ...s, dbId: result.dbId } : s));
        }
      } catch (err) {
        console.error('Update shape error:', err);
        setLastSaveStatus('error');
        setLastError(err.message);
        // 失敗時はrevert
        setShapes(prev => prev.map(s => s.id === updatedShape.id ? shape : s));
      } finally {
        setIsSaving(prev => ({ ...prev, [shape.id]: false }));
      }
    }
  };

  // Transform終了時の更新（CRITICAL: 増殖防止のため置換処理、Rect/Circle/Arrowに対応）
  const handleTransformEnd = async (shape, e) => {
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

      addToUndoStack({ type: 'update', shapeId: shape.id, before: shape, after: updatedShape });

      // CRITICAL: Optimistic update は「同じidを置換」（追加ではない）+ 親に即同期
      setShapes(prev => {
        const next = prev.map(s => s.id === updatedShape.id ? updatedShape : s);
        onShapesChange?.(next); // ★親にも即同期（巻き戻り防止）
        return next;
      });

      // DB更新（upsertモード）
      if (onSaveShape) {
      setIsSaving(prev => ({ ...prev, [shape.id]: true }));
      setLastMutation('update-transform');
      setLastPayload(JSON.stringify(updatedShape));
      setLastSaveStatus('saving');
      
      try {
        const result = await onSaveShape(updatedShape, 'upsert');
        setLastSaveStatus('success');
        setLastSuccessId(result?.dbId || updatedShape.id);
        setLastError(null);
        
        // CRITICAL: DBから返ってきた_idを既存shapeに上書き（新規追加しない）
        if (result?.dbId) {
          setShapes(prev => prev.map(s => s.id === updatedShape.id ? { ...s, dbId: result.dbId } : s));
        }
      } catch (err) {
        console.error('Update shape error:', err);
        setLastSaveStatus('error');
        setLastError(err.message);
        // 失敗時はrevert
        setShapes(prev => prev.map(s => s.id === updatedShape.id ? shape : s));
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

  // ツールバー変更を選択図形に適用
  useEffect(() => {
    if (!canEdit || !selectedId) return;
    applyStyleToSelected({ stroke: strokeColor });
  }, [strokeColor, canEdit, selectedId]);

  useEffect(() => {
    if (!canEdit || !selectedId) return;
    applyStyleToSelected({ strokeWidth });
  }, [strokeWidth, canEdit, selectedId]);

  // Undo/Redo
  useImperativeHandle(ref, () => ({
    undo: performUndo,
    redo: performRedo,
    clear: () => {
      setShapes([]);
      setCurrentShape(null);
      setUndoStack([]);
      setRedoStack([]);
      setSelectedId(null);
      setIsDrawing(false);
      draftCommentIdRef.current = null; // CRITICAL: 仮IDもリセット
    },
    delete: handleDelete,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
  }));
  
  // Shape描画（正規化座標から復元）
  const renderShape = (shape, isExisting = false) => {
    const isSelected = selectedId === shape.id;
    const canTransform = shape.tool === 'rect' || shape.tool === 'circle' || shape.tool === 'text' || shape.tool === 'arrow';
    // ★ CRITICAL: 選択可能か（クリックで選択）と編集可能か（移動/変形/削除）を分離
    const isSelectable = isSelectableShape(shape);
    const isEditable = isEditableShape2(shape);

    const commonProps = {
      key: shape.id,
      stroke: shape.stroke,
      strokeWidth: shape.strokeWidth,
      listening: isSelectable, // ★選択可能な時は当たり判定ON（クリックで選択）
      onPointerDown: isSelectable ? (e) => {
        e.cancelBubble = true;
        setSelectedId(shape.id);
        if (onStrokeColorChange && shape.stroke) onStrokeColorChange(shape.stroke);
        if (onStrokeWidthChange && typeof shape.strokeWidth === 'number') onStrokeWidthChange(shape.strokeWidth);
      } : undefined,
      ref: (node) => { if (node) shapeRefs.current[shape.id] = node; },
      draggable: isEditable, // ★移動はpaintMode時のみ
      onDragStart: isEditable ? (e) => handleDragStart(shape, e) : undefined,
      onDragMove: isEditable ? (e) => handleDragMove(shape, e) : undefined,
      onDragEnd: isEditable ? (e) => handleDragEnd(shape, e) : undefined,
      onTransformEnd: (isEditable && canTransform) ? (e) => handleTransformEnd(shape, e) : undefined,
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
      let points = [];

      // 正規化座標を優先（必ずこれから復元）
      if (shape.normalizedPoints) {
        for (let i = 0; i < shape.normalizedPoints.length; i += 2) {
          const { x, y } = denormalizeCoords(shape.normalizedPoints[i], shape.normalizedPoints[i + 1]);
          points.push(x, y);
        }
      } else if (shape.points) {
        // 描画中の一時データ（normalizedPointsがない場合のみ）
        points = shape.points;
      }

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

      return (
        <React.Fragment key={shape.id}>
          <Group
            ref={(node) => { if (node) shapeRefs.current[shape.id] = node; }}
            x={shape.dragX || 0}
            y={shape.dragY || 0}
            listening={isSelectable}
            draggable={isEditable}
            onPointerDown={isSelectable ? (e) => {
              e.cancelBubble = true;
              setSelectedId(shape.id);
              if (onStrokeColorChange && shape.stroke) onStrokeColorChange(shape.stroke);
              if (onStrokeWidthChange && typeof shape.strokeWidth === 'number') onStrokeWidthChange(shape.strokeWidth);
            } : undefined}
            onDragStart={isEditable ? (e) => handleDragStart(shape, e) : undefined}
            onDragMove={isEditable ? (e) => handleDragMove(shape, e) : undefined}
            onDragEnd={isEditable ? (e) => handleDragEnd(shape, e) : undefined}
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
            <Rect 
              x={bboxX} 
              y={bboxY} 
              width={bboxW} 
              height={bboxH} 
              fill="rgba(0,0,0,0.01)"
              listening={isSelectable}
            />
            {isSelected && (
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
            )}
          </Group>
          {boundingBox && <Rect x={boundingBox.x} y={boundingBox.y} width={boundingBox.width} height={boundingBox.height} stroke="rgba(255,0,0,0.3)" strokeWidth={1} dash={[5,5]} fill={undefined} listening={false} />}
        </React.Fragment>
      );
    } else if (shape.tool === 'rect') {
      // 正規化座標を優先（必ずこれから復元）
      if (shape.nx !== undefined) {
        const p1 = denormalizeCoords(shape.nx, shape.ny);
        const p2 = denormalizeCoords(shape.nx + shape.nw, shape.ny + shape.nh);
        return (
          <React.Fragment key={shape.id}>
            <Rect {...commonProps} x={p1.x} y={p1.y} width={p2.x - p1.x} height={p2.y - p1.y} fill={undefined} hitStrokeWidth={Math.max(10, (shape.strokeWidth || 2) * 3)} />
            {boundingBox && <Rect x={boundingBox.x} y={boundingBox.y} width={boundingBox.width} height={boundingBox.height} stroke="rgba(255,0,0,0.3)" strokeWidth={1} dash={[5,5]} fill={undefined} listening={false} />}
          </React.Fragment>
        );
        }

        // 描画中の一時データ（nxがない場合のみ - 保存後は存在しないはず）
        if (shape.x !== undefined && shape.width !== undefined) {
        return <Rect {...commonProps} x={shape.x} y={shape.y} width={shape.width} height={shape.height} fill={undefined} hitStrokeWidth={Math.max(10, (shape.strokeWidth || 2) * 3)} />;
        }

        return null;
        } else if (shape.tool === 'circle') {
        // CRITICAL: 正規化座標を優先（必ずこれから復元）
        if (shape.nx !== undefined) {
        const center = denormalizeCoords(shape.nx, shape.ny);
        return (
          <React.Fragment key={shape.id}>
            <Circle {...commonProps} x={center.x} y={center.y} radius={shape.nr * bgSize.width} fill={undefined} hitStrokeWidth={Math.max(10, (shape.strokeWidth || 2) * 3)} />
            {boundingBox && <Rect x={boundingBox.x} y={boundingBox.y} width={boundingBox.width} height={boundingBox.height} stroke="rgba(255,0,0,0.3)" strokeWidth={1} dash={[5,5]} fill={undefined} listening={false} />}
          </React.Fragment>
        );
        }

        // 描画中の一時データ（nxがない場合のみ - 保存後は存在しないはず）
        if (shape.x !== undefined && shape.radius !== undefined) {
        return <Circle {...commonProps} x={shape.x} y={shape.y} radius={shape.radius} fill={undefined} hitStrokeWidth={Math.max(10, (shape.strokeWidth || 2) * 3)} />;
        }

        return null;
      } else if (shape.tool === 'arrow') {
        let points = [];

        // 正規化座標を優先（必ずこれから復元）
        if (shape.normalizedPoints) {
          for (let i = 0; i < shape.normalizedPoints.length; i += 2) {
            const { x, y } = denormalizeCoords(shape.normalizedPoints[i], shape.normalizedPoints[i + 1]);
            points.push(x, y);
          }
        } else if (shape.points) {
          // 描画中の一時データ（normalizedPointsがない場合のみ）
          points = shape.points;
        }

        // bbox計算（透明当たり判定用）
        const xs = [], ys = [];
        for (let i = 0; i < points.length; i += 2) {
          xs.push(points[i]);
          ys.push(points[i + 1]);
        }
        const pad = Math.max(15, (shape.strokeWidth || 2) * 4); // 矢印は先端も考慮
        const bboxX = Math.min(...xs) - pad;
        const bboxY = Math.min(...ys) - pad;
        const bboxW = Math.max(20, (Math.max(...xs) - Math.min(...xs)) + pad * 2);
        const bboxH = Math.max(20, (Math.max(...ys) - Math.min(...ys)) + pad * 2);

        return (
          <React.Fragment key={shape.id}>
            <Group
              ref={(node) => { if (node) shapeRefs.current[shape.id] = node; }}
              x={shape.dragX || 0}
              y={shape.dragY || 0}
              listening={isSelectable}
              draggable={isEditable}
              onPointerDown={isSelectable ? (e) => {
                e.cancelBubble = true;
                setSelectedId(shape.id);
                if (onStrokeColorChange && shape.stroke) onStrokeColorChange(shape.stroke);
                if (onStrokeWidthChange && typeof shape.strokeWidth === 'number') onStrokeWidthChange(shape.strokeWidth);
              } : undefined}
              onDragStart={isEditable ? (e) => handleDragStart(shape, e) : undefined}
              onDragMove={isEditable ? (e) => handleDragMove(shape, e) : undefined}
              onDragEnd={isEditable ? (e) => handleDragEnd(shape, e) : undefined}
            >
              <Arrow 
                stroke={shape.stroke}
                strokeWidth={shape.strokeWidth}
                points={points} 
                pointerLength={10} 
                pointerWidth={10} 
                listening={false}
              />
              <Rect 
                x={bboxX} 
                y={bboxY} 
                width={bboxW} 
                height={bboxH} 
                fill="rgba(0,0,0,0.01)"
                listening={isSelectable}
              />
            </Group>
            {boundingBox && <Rect x={boundingBox.x} y={boundingBox.y} width={boundingBox.width} height={boundingBox.height} stroke="rgba(255,0,0,0.3)" strokeWidth={1} dash={[5,5]} fill={undefined} listening={false} />}
          </React.Fragment>
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
        
        // テキストの場合は stroke を使わず fill のみ使用
        return (
          <Text
            key={shape.id}
            x={x}
            y={y}
            text={shape.text || ''}
            fontSize={fontSize}
            fill={shape.stroke}
            fontFamily="Arial, sans-serif"
            onPointerDown={canEdit ? (e) => {
              if (!isEditable) return;
              e.cancelBubble = true;
              setSelectedId(shape.id);
              if (onStrokeColorChange && shape.stroke) onStrokeColorChange(shape.stroke);
              if (onStrokeWidthChange && typeof shape.strokeWidth === 'number') onStrokeWidthChange(shape.strokeWidth);
            } : undefined}
            ref={(node) => { if (node) shapeRefs.current[shape.id] = node; }}
            draggable={isEditable}
            onDragStart={isEditable ? (e) => handleDragStart(shape, e) : undefined}
            onDragMove={isEditable ? (e) => handleDragMove(shape, e) : undefined}
            onDragEnd={isEditable ? (e) => handleDragEnd(shape, e) : undefined}
            onDblClick={canEdit ? () => handleTextDblClick(shape) : undefined}
          />
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
  
  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative', overflow: 'auto', background: '#e0e0e0' }}>
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
        {/* 背景Layer（非インタラクティブ） */}
        <Layer listening={false}>
          <Group
            x={viewX}
            y={viewY}
            scaleX={contentScale}
            scaleY={contentScale}
          >
            {isImage && stableFileUrlRef.current && (
              <BackgroundImage src={stableFileUrlRef.current} onLoad={setBgSize} />
            )}
          </Group>
        </Layer>


        {/* 注釈Layer（contentGroup内に配置） */}
        <Layer>
          <Group
            ref={contentGroupRef}
            x={viewX}
            y={viewY}
            scaleX={contentScale}
            scaleY={contentScale}
          >
            {/* CRITICAL: mergedShapesから renderedShapes のみ描画 */}
            {renderedShapes.map(s => renderShape(s, true))}
            {currentShape && renderShape(currentShape, false)}
            <Transformer ref={transformerRef} />
          </Group>
        </Layer>
        
        {/* ★ DEBUGオーバーレイ Layer（最前面） */}
        {DEBUG_MODE && (
          <Layer listening={false}>
            <Rect x={5} y={5} width={220} height={100} fill="rgba(0,0,0,0.8)" cornerRadius={4} />
            <Text 
              x={10} 
              y={10} 
              text={[
                `paintMode: ${paintMode}`,
                `tool: ${tool}`,
                `canSelect: ${canSelect}`,
                `canMutate: ${canMutate}`,
                `activeCommentId: ${String(activeCommentId ?? 'null')}`,
                `effectiveActiveId: ${String(effectiveActiveId ?? 'null')}`,
                `activeShapes: ${activeShapes?.length ?? 0}`,
                `renderedShapes: ${renderedShapes?.length ?? 0}`,
              ].join('\n')}
              fontSize={12} 
              fill="white" 
              lineHeight={1.4}
            />
          </Layer>
        )}
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
            <div>tool: {tool}</div>
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