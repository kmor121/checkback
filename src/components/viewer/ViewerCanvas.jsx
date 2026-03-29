import React, { useState, useEffect, useLayoutEffect, useRef, useImperativeHandle, forwardRef, useMemo, useCallback } from 'react';
import { Stage, Layer, Line, Rect, Circle, Arrow, Image as KonvaImage, Group, Transformer, Text } from 'react-konva';
import useImage from 'use-image';
import TextEditorOverlay from './TextEditorOverlay';
import CanvasDebugHud from './CanvasDebugHud';
import { renderShapeFactory } from './ShapeRenderer';
import { generateUUID, normalizeFileUrl, resolveCommentId, normalizeShape, shapeCommentId, sameId } from './canvasUtils';
import { mapSet, mapDelete, mapUpdateIfExists, markDirty, commitShapeToMap, onSaveSuccess, onSaveRevert } from './canvasMapHelpers';
import { performUndoAction, performRedoAction } from './canvasUndoRedo';
import { syncExistingShapes } from './canvasSyncEngine';
import { TEXT_EDITOR_INITIAL, DEBUG_MODE } from './canvasConstants';
import { createTextHandlers } from './canvasTextHandlers';
import { createDragTransformHandlers } from './canvasDragTransformHandlers';

function BackgroundImage({ src, onLoad }) {
  const [image, status] = useImage(src, 'anonymous');
  const lastImageRef = useRef(null);
  const onLoadCalledRef = useRef(false);
  useEffect(() => {
    if (status === 'failed') { onLoadCalledRef.current = false; }
    if (image && !onLoadCalledRef.current) {
      lastImageRef.current = image;
      onLoadCalledRef.current = true;
      if (onLoad) onLoad({ width: image.width, height: image.height });
    }
  }, [image, status, onLoad, src]);
  const imgToRender = image || lastImageRef.current;
  return imgToRender ? <KonvaImage image={imgToRender} width={imgToRender.width} height={imgToRender.height} listening={false} /> : null;
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
  
  const contentReady = bgReady && bgSize.width > 0 && bgSize.height > 0;

  const [isDrawing, setIsDrawing] = useState(false);
  const [currentShape, setCurrentShape] = useState(null);
  const shapesMapRef = useRef(new Map());
  const [shapesVersion, setShapesVersion] = useState(0);
  const [selectedId, setSelectedId] = useState(null);
  const transformerRef = useRef(null);
  const shapeRefs = useRef({});
  
  const bump = useCallback(() => setShapesVersion(v => v + 1), []);
  const getAllShapes = () => Array.from(shapesMapRef.current.values());
  const shapesRef = { get current() { return getAllShapes(); } };

  const drawViewRef = useRef(null);
  const isInteractingRef = useRef(false);
  const pendingIncomingShapesRef = useRef(null);
  const isDraggingRef = useRef(false);
  const dragRafRef = useRef(null);
  const pendingDragRef = useRef(null);
  
  const isDrawingRef2 = useRef(false);
  const currentShapeRef2 = useRef(null);
  
  const prevActiveCommentIdRef = useRef(activeCommentId);
  const draftCommentIdRef = useRef(null);
  const prevCanvasContextKeyRef = useRef(null);
  const pendingCtxRef = useRef(null);
  const prevEmptyCountRef = useRef(0);
  const lastEmptyAppliedCtxRef = useRef(null);
  
  const debugHudLogsRef = useRef([]);
  
  const coordDiagRef = useRef({
    paintEnterSeq: 0, strokeSeqInSession: 0, firstStroke: false, lastPointerEvent: null,
    lastPointerRaw: null, lastPointerStage: null, lastPointerImage: null,
    viewAtEvent: null, ptrDiagStr: null, commitDiagStr: null, downK: null,
    firstPtr: null, firstCmt: null, lastPtr: null, lastCmt: null,
  });
  const [diagTick, setDiagTick] = useState(0); // HUD更新用tick
  
  const shapes = useMemo(() => getAllShapes(), [shapesVersion]);
  
  const setShapes = (updater) => {
    const next = typeof updater === 'function' ? updater(getAllShapes()) : (updater ?? []);
    shapesMapRef.current = new Map(next.map(s => [s.id, s]));
    bump();
  };
  
  useEffect(() => { isDrawingRef2.current = isDrawing; }, [isDrawing]);
  useEffect(() => { currentShapeRef2.current = currentShape; }, [currentShape]);
  
  const [localPan, setLocalPan] = useState({ x: 0, y: 0 });
  const pan = externalPan || localPan;
  const setPan = onPanChange || setLocalPan;
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0, px: 0, py: 0 });

  const clampPan = useCallback((nx, ny, currentScaledW, currentScaledH, prevPan = null) => {
    const overflowX = currentScaledW > containerSize.width + 1;
    const overflowY = currentScaledH > containerSize.height + 1;
    if (!overflowX) { nx = 0; } else { nx = Math.min(0, Math.max(containerSize.width - currentScaledW, nx)); }
    if (!overflowY) { ny = 0; } else { ny = Math.min(0, Math.max(containerSize.height - currentScaledH, ny)); }
    if (prevPan && nx === prevPan.x && ny === prevPan.y) return prevPan;
    return { x: nx, y: ny };
  }, [containerSize.width, containerSize.height]);
  
  const [textEditor, setTextEditor] = useState(TEXT_EDITOR_INITIAL);
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
  
  const fileIdentity = useMemo(() => normalizeFileUrl(fileUrl), [fileUrl]);
  const effectiveActiveId = activeCommentId ?? draftCommentId ?? draftCommentIdRef.current ?? null;

  // Permission flags
  const isSelectTool = tool === 'select';
  const canDrawNew = !!paintMode;
  const canCommitNew = !!paintMode;
  const canSelectExisting = !!paintMode && isSelectTool;
  const canMutateExisting = !!paintMode && !!draftReady && isSelectTool;
  const canEdit = canMutateExisting;
  const canDeleteExisting = !!paintMode && isEditMode;
  const targetIdForDelete = effectiveActiveId != null ? String(effectiveActiveId) : '';
  const canEditPaint = targetIdForDelete !== '';

  const isSelectableShape = (shape) => {
    if (!paintMode || !isSelectTool) return false;
    if (effectiveActiveId == null) return false;
    return sameId(shapeCommentId(shape), effectiveActiveId);
  };
  const isEditableShape2 = (shape) => isSelectableShape(shape);

  const getCommentIdForDrawing = () => {
    if (draftCommentId != null && draftCommentId !== '') return String(draftCommentId);
    if (renderTargetCommentId != null && renderTargetCommentId !== '') return String(renderTargetCommentId);
    if (activeCommentId != null && activeCommentId !== '') return String(activeCommentId);
    console.error('[ViewerCanvas] getCommentIdForDrawing: no paintContextId available');
    return null;
  };
  
  const renderedShapes = useMemo(() => {
    let src = getAllShapes();
    if (currentShape?.id) src = src.filter(s => s.id !== currentShape.id);

    console.log('[ViewerCanvas] renderedShapes calc:', {
      mapSize: shapesMapRef.current.size,
      srcLen: src.length,
      showDraftOnly,
      showAllPaint,
      renderTargetCommentId: renderTargetCommentId?.substring?.(0, 16),
      draftCommentId: draftCommentId?.substring?.(0, 16),
      canvasContextKey: canvasContextKey?.substring?.(0, 30),
    });

    if (showDraftOnly) {
      return src.filter(s => s.isDraft === true || String(resolveCommentId(s) || '').startsWith('temp_'));
    }
    if (showAllPaint) return src;

    const normalizeNullableId = (v) => (v == null || v === 'null' || v === 'undefined' || v === '' ? null : v);
    const targetId0 = normalizeNullableId(renderTargetCommentId);
    const draftId = normalizeNullableId(draftCommentId);
    const targetId = targetId0 ?? draftId;
    const result = targetId ? src.filter(s => resolveCommentId(s) === targetId) : [];
    console.log('[ViewerCanvas] renderedShapes result:', { targetId: targetId?.substring?.(0, 16), resultLen: result.length });
    return result;
  }, [shapesVersion, showAllPaint, renderTargetCommentId, currentShape, showDraftOnly, draftCommentId, canvasContextKey]);

  const renderedShapesFinal = hidePaintOverlay ? [] : renderedShapes;
  

  
  const isEditableShape = (shape) => {
    if (!canEdit || effectiveActiveId == null) return false;
    return sameId(shapeCommentId(shape), effectiveActiveId);
  };
  
  // fileUrl安定化（最後の有効URLを保持）
  useEffect(() => {
    if (fileUrl) {
      stableFileUrlRef.current = fileUrl;
    }
  }, [fileUrl]);

  useEffect(() => {
    if (hidePaintOverlay && selectedId) setSelectedId(null);
  }, [hidePaintOverlay, selectedId]);



  useEffect(() => {
    const prev = prevActiveCommentIdRef.current;
    prevActiveCommentIdRef.current = activeCommentId;
    if (String(prev ?? '') === String(activeCommentId ?? '')) return;

    setCurrentShape(null); currentShapeRef2.current = null;
    setIsDrawing(false); isDrawingRef2.current = false;
    hidePaintUntilSelectRef.current = false;
    setSelectedId(null);
    setTextEditor(TEXT_EDITOR_INITIAL);
    draftCommentIdRef.current = null;
    drawViewRef.current = null;
    bump();
    requestAnimationFrame(() => {
      if (transformerRef.current) { transformerRef.current.nodes([]); transformerRef.current.getLayer()?.batchDraw(); }
    });
  }, [activeCommentId]);
  
  // 送信完了後のキャンバスクリア
  const prevNonceRef = useRef(clearAfterSubmitNonce);
  useEffect(() => {
    if (clearAfterSubmitNonce !== prevNonceRef.current) {
      prevNonceRef.current = clearAfterSubmitNonce;

      draftCommentIdRef.current = null;
      setSelectedId(null);
      setCurrentShape(null);
      setIsDrawing(false);
      setTextEditor(TEXT_EDITOR_INITIAL);
      if (transformerRef.current) {
        transformerRef.current.nodes([]);
        transformerRef.current.getLayer()?.batchDraw();
      }
    }
  }, [clearAfterSubmitNonce]);

  // 仮commentIdで描いたshapeを、activeCommentId確定後に付け替える
  useEffect(() => {
    if (!activeCommentId) return;
    if (!draftCommentIdRef.current) return;

    const draftId = draftCommentIdRef.current;


    setShapes(prev => prev.map(s => s.comment_id === draftId ? { ...s, comment_id: activeCommentId } : s));
    draftCommentIdRef.current = null;
  }, [activeCommentId]);

  // ★★★ B) コンテキスト変更時は即座にMapをクリア（描画混在防止）★★★
  useLayoutEffect(() => {
    if (!canvasContextKey) return;

    const prev = prevCanvasContextKeyRef.current;
    if (prev !== canvasContextKey) {
        shapesMapRef.current = new Map();
      pendingCtxRef.current = null;
      lastNonEmptyShapesRef.current = { key: null, shapes: null };
      emptyStreakCountRef.current = 0;
      prevEmptyCountRef.current = 0;
      lastEmptyAppliedCtxRef.current = null;
      bump();
      setSelectedId(null);
      setCurrentShape(null);
      setIsDrawing(false);
      prevCanvasContextKeyRef.current = canvasContextKey;
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
    shapesMapRef.current = new Map();
    bump();
    setSelectedId(null);
    setCurrentShape(null);
    setUndoStack([]);
    setRedoStack([]);
    if (!externalPan) setLocalPan({ x: 0, y: 0 });
    setBgReady(false);
  }, [fileIdentity, pageNumber]);

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
    
    if (clamped.x !== currentPan.x || clamped.y !== currentPan.y) {
      setPanRef.current(clamped);
    }
  }, [zoom, containerSize.width, containerSize.height, bgSize.width, bgSize.height, clampPan]);

  // ★★★ P0: forceClearToken は UI状態のみリセット（Map破壊禁止、Layer key切替で対応）★★★
  const prevForceClearTokenRef = useRef(forceClearToken);
  useEffect(() => {
    if (forceClearToken === prevForceClearTokenRef.current) return;
    prevForceClearTokenRef.current = forceClearToken;

    setSelectedId(null);
    setCurrentShape(null);
    setIsDrawing(false);
    setTextEditor(TEXT_EDITOR_INITIAL);
    if (transformerRef.current) {
      transformerRef.current.nodes([]);
      transformerRef.current.getLayer()?.batchDraw();
    }
    }, [forceClearToken]);

  // Sync engine refs
  const lastNonEmptyShapesRef = useRef({ key: null, shapes: null });
  const emptyStreakCountRef = useRef(0);

  useLayoutEffect(() => {
    syncExistingShapes({
      existingShapes,
      shapesMapRef,
      bump,
      showAllPaint,
      renderTargetCommentId,
      canvasContextKey,
      hidePaintOverlay,
      paintMode,
      isCanvasTransitioning,
      isInteractingRef,
      pendingIncomingShapesRef,
      pendingCtxRef,
      lastNonEmptyShapesRef,
      emptyStreakCountRef,
      prevEmptyCountRef,
      lastEmptyAppliedCtxRef,
      stageRef,
    });
  }, [existingShapes, canvasContextKey, isCanvasTransitioning]);

  // ✅ 選択維持（Mapに存在するか確認）
  useEffect(() => {
    if (!selectedId) return;
    if (!shapesMapRef.current.has(selectedId)) {
      setSelectedId(null);
    }
  }, [shapesVersion, selectedId]);

  // mount/unmount debug removed for size

  useEffect(() => {
    if (paintMode) {
      const cdr = coordDiagRef.current;
      cdr.paintEnterSeq += 1; cdr.strokeSeqInSession = 0; cdr.firstStroke = false; cdr.lastPointerEvent = null;
      cdr.firstPtr = null; cdr.firstCmt = null; cdr.lastPtr = null; cdr.lastCmt = null;
    }
  }, [paintMode]);
  
  const prevToolRef = useRef(tool);
  useEffect(() => {
    const prevTool = prevToolRef.current;
    prevToolRef.current = tool;
    if (prevTool === 'select' && tool !== 'select') setSelectedId(null);
  }, [tool]);

  // Transformer selection
  useEffect(() => {
    if (!transformerRef.current) return;
    const tr = transformerRef.current;
    if (isEditMode && selectedId && shapeRefs.current[selectedId]) {
      const selectedShape = shapes.find(s => s.id === selectedId);
      const canTransform = selectedShape && ['rect', 'circle', 'text', 'arrow'].includes(selectedShape.tool);
      if (canTransform) {
        tr.nodes([shapeRefs.current[selectedId]]);
        tr.padding(0);
        tr.boundBoxFunc(null);
      } else {
        tr.nodes([]);
      }
    } else {
      tr.nodes([]);
    }
    tr.getLayer()?.batchDraw();
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
  
  const baseFitScale = useMemo(() => {
    if (!containerSize.width || !containerSize.height || !bgSize.width || !bgSize.height) return 1;
    if (fitMode === 'width') return containerSize.width / bgSize.width;
    if (fitMode === 'height') return containerSize.height / bgSize.height;
    return Math.min(containerSize.width / bgSize.width, containerSize.height / bgSize.height);
  }, [fitMode, containerSize.width, containerSize.height, bgSize.width, bgSize.height]);
  const fitScale = baseFitScale;
  
  const userScale = zoom / 100;
  const contentScale = baseFitScale * userScale;
  
  const prevEffectivePercentRef = useRef(null);
  useEffect(() => {
    if (!onScaleInfoChange) return;
    const ep = Math.round(contentScale * 100);
    if (prevEffectivePercentRef.current === ep) return;
    prevEffectivePercentRef.current = ep;
    onScaleInfoChange({ effectiveScale: contentScale, effectivePercent: ep, fitScale: baseFitScale, zoom });
  }, [contentScale, baseFitScale, zoom, onScaleInfoChange]);
  
  const scaledWidth = bgSize.width * contentScale;
  const scaledHeight = bgSize.height * contentScale;
  
  const offsetX = (containerSize.width - scaledWidth) / 2;
  const offsetY = (containerSize.height - scaledHeight) / 2;
  const viewX = offsetX + pan.x;
  const viewY = offsetY + pan.y;

  const bgLoadCalledRef = useRef(false);
  const handleBgLoad = useCallback((size) => {
    if (bgLoadCalledRef.current) return;
    bgLoadCalledRef.current = true;
    setBgSize(size);
    setBgReady(true);
    if (onBgLoad) onBgLoad(size, containerSize);
  }, [containerSize, onBgLoad]);
  
  const canPan = (!paintMode || tool === 'select') && !textEditor.visible && !isDrawing;

  const stagePointToImagePoint = (viewOverride) => {
    const stage = stageRef.current;
    if (!stage) return null;
    const p = stage.getPointerPosition();
    if (!p) return null;
    const _branch = viewOverride ? 'override' : (isDrawingRef2.current && drawViewRef.current) ? 'frozen' : 'current';
    const v = viewOverride || (isDrawingRef2.current && drawViewRef.current) || { viewX, viewY, contentScale };
    return { x: (p.x - v.viewX) / v.contentScale, y: (p.y - v.viewY) / v.contentScale, stageX: p.x, stageY: p.y, _branch, _view: v };
  };
  
  const normalizeCoords = (imgX, imgY) => ({
    nx: imgX / bgSize.width,
    ny: imgY / bgSize.height,
  });
  
  const denormalizeCoords = (nx, ny) => ({
    x: nx * bgSize.width,
    y: ny * bgSize.height,
  });
  
  const addToUndoStack = (action) => {
    setUndoStack(prev => [...prev, action]);
    setRedoStack([]);
  };

  const performUndo = () => performUndoAction(undoStack, setUndoStack, setRedoStack, shapesMapRef, bump, onShapesChange);
  const performRedo = () => performRedoAction(redoStack, setRedoStack, setUndoStack, shapesMapRef, bump, onShapesChange);

  // Delete selected shape
  const handleDelete = async () => {
    if (!canDeleteExisting || !selectedId) return;
    const selectedShape = shapesMapRef.current.get(selectedId);
    if (!selectedShape) return;
    const shapeCommentIdValue = shapeCommentId(selectedShape);
    if (!sameId(shapeCommentIdValue, effectiveActiveId)) return;
    const shape = selectedShape;
    addToUndoStack({ type: 'delete', shape, index: 0 });
    
    if (transformerRef.current) {
      transformerRef.current.nodes([]);
      transformerRef.current.getLayer()?.batchDraw();
    }
    
    mapDelete(shapesMapRef, selectedId);
    bump();
    onShapesChange?.(getAllShapes());
    setSelectedId(null);
    
    if (onDeleteShape) {
      debugRef.current.mutation = 'delete';
      try {
        await onDeleteShape(shape);
        debugRef.current.saveStatus = 'success';
        debugRef.current.error = null;
      } catch (err) {
        console.error('[ViewerCanvas] Delete shape error:', err);
        debugRef.current.saveStatus = 'error';
        debugRef.current.error = err.message;
        onSaveRevert(shapesMapRef, shape, bump, onShapesChange);
      }
    }
  };

  const handleStagePointerDown = (e) => {
    const stage = e.target.getStage();
    if (!stage) return;
    if (isDrawMode) {
      handlePointerDown(e);
      return;
    }

    const clickedOnEmpty = e.target === stage;
    if (canPan && clickedOnEmpty && !textEditor.visible) {
      const p = stage.getPointerPosition();
      if (!p) return;
      setIsPanning(true);
      panStartRef.current = { x: pan.x, y: pan.y, px: p.x, py: p.y };
      return;
    }

    if (isEditMode && clickedOnEmpty) {
      setSelectedId(null);
    }
  };

  const handleStagePointerMove = (e) => {
    const stage = e.target.getStage();
    if (!stage) return;

    if (isPanning) {
      const p = stage.getPointerPosition();
      if (!p) return;
      
      const currentScaledWidth = bgSize.width * contentScale;
      const currentScaledHeight = bgSize.height * contentScale;
      const overflowX = currentScaledWidth > containerSize.width + 1;
      const overflowY = currentScaledHeight > containerSize.height + 1;
      const dx = overflowX ? (p.x - panStartRef.current.px) : 0;
      const dy = overflowY ? (p.y - panStartRef.current.py) : 0;
      if (dx === 0 && dy === 0) return;
      const next = clampPan(panStartRef.current.x + dx, panStartRef.current.y + dy, currentScaledWidth, currentScaledHeight, pan);
      if (next !== pan) setPan(next);
      return;
    }

    handlePointerMove(e);
  };

  const handleStagePointerUp = (e) => {
    if (isPanning) {
      setIsPanning(false);
      return;
    }
    if (commitInFlightRef.current) return;
    commitInFlightRef.current = true;
    handlePointerUp(e);
    requestAnimationFrame(() => {
      commitInFlightRef.current = false;
    });
  };
  
  const commitInFlightRef = useRef(false);
  const handlePointerUpRef = useRef(null);
  const handlePointerDown = (e) => {
    if (isSelectTool) return;
    if (!paintMode && tool !== 'text') return;
    if (currentShape && activeCommentId != null) {
      const currentCid = currentShape.comment_id;
      if (currentCid != null && String(currentCid) !== String(activeCommentId)) {
        if (DEBUG_MODE) console.log('[ViewerCanvas] Clearing stale currentShape from different comment', { currentCid, activeCommentId });
        setCurrentShape(null);
        setIsDrawing(false);
      }
    }

    if (activeCommentId == null && tool !== 'select' && !onBeginPaint) return;

    if (tool === 'text' && !textEditor.visible) {
      try {
        const imgCoords = stagePointToImagePoint();
        if (!imgCoords) {
          return;
        }
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
    
    if (textEditor.visible) return;
    
    try {
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
      
          if (DEBUG_MODE) {
        const rp = { clientX: e.evt?.clientX ?? 0, clientY: e.evt?.clientY ?? 0 };
        const k = stageRef.current?.getPointerPosition() || { x: 0, y: 0 };
        const cd = coordDiagRef.current;
        cd.strokeSeqInSession += 1; cd.firstStroke = (cd.strokeSeqInSession === 1);
        cd.lastPointerEvent = 'down'; cd.lastPointerRaw = rp; cd.lastPointerStage = k;
        cd.lastPointerImage = { x: imgCoords.x, y: imgCoords.y, stageX: imgCoords.stageX, stageY: imgCoords.stageY };
        cd.viewAtEvent = { viewX, viewY, contentScale, offsetX, offsetY, baseFitScale, userScale: zoom / 100, stageW: containerSize.width, stageH: containerSize.height };
        const sr = stageRef.current?.container?.()?.getBoundingClientRect() || { left: 0, top: 0 };
        const m = { x: rp.clientX - sr.left, y: rp.clientY - sr.top };
        const br = imgCoords._branch || '?';
        const vU = imgCoords._view || frozenView;
        cd.downK = { x: k.x, y: k.y };
        cd.ptrDiagStr = `fs=${cd.firstStroke?'Y':'N'} k=(${Math.round(k.x)},${Math.round(k.y)}) m=(${Math.round(m.x)},${Math.round(m.y)}) br=${br} vX=${Math.round(vU.viewX)} sc=${vU.contentScale.toFixed(3)} tool=${tool}`;
        cd.lastPtr = cd.ptrDiagStr; if (cd.strokeSeqInSession === 1 && !cd.firstPtr) cd.firstPtr = cd.ptrDiagStr;
        cd.commitDiagStr = null; setDiagTick(t => t + 1);
      }

      const commentId = getCommentIdForDrawing();
      if (!commentId) { setIsDrawing(false); return; }

        if (DEBUG_MODE) {
        debugHudLogsRef.current = [...debugHudLogsRef.current.slice(-9), {
          timestamp: new Date().toISOString(), event: 'DRAW_START', commentId, tool,
        }];
      }

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
      if (isDrawingRef2.current && stageRef.current && e.evt) stageRef.current.setPointersPositions(e.evt);
      const imgCoords = stagePointToImagePoint();
      if (!imgCoords) return;
      
      if (DEBUG_MODE && !isDraggingRef.current && !isDrawingRef2.current) {
        debugRef.current.pointerPos = { x: imgCoords.stageX, y: imgCoords.stageY };
        debugRef.current.imgPos = { x: imgCoords.x, y: imgCoords.y };
      }
      
      if (DEBUG_MODE && isDrawingRef2.current && (Math.floor((currentShapeRef2.current?.points?.length ?? 0) / 2)) <= 3) {
        coordDiagRef.current.lastPointerEvent = 'move';
        coordDiagRef.current.lastPointerImage = { x: imgCoords.x, y: imgCoords.y, stageX: imgCoords.stageX, stageY: imgCoords.stageY };
      }
      
      const shape = currentShapeRef2.current;
      if (!isDrawingRef2.current || !shape) return;
      
      debugRef.current.lastEvent = 'move';
      
      const newShape = { ...shape };
      const shapeTool = shape.tool;
      
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

      currentShapeRef2.current = newShape;
      setCurrentShape(newShape);
    } catch (err) { console.error('PointerMove Error:', err); }
  };
  
  const { handleTextConfirm, handleTextCancel, handleTextBlur, handleTextDblClick } = createTextHandlers({
    textInputRef, textEditor, setTextEditor, setIsComposing,
    normalizeCoords, denormalizeCoords, bgSize,
    shapes, shapesMapRef, bump, onShapesChange,
    addToUndoStack, setSelectedId,
    strokeColor, strokeWidth,
    activeCommentId, getCommentIdForDrawing, onBeginPaint,
    onSaveShape, onToolChange,
    isEditMode, contentGroupRef,
  });

  const handlePointerUp = async () => {
    const shape = currentShapeRef2.current;
    if (!shape) return;
    
    try {
      debugRef.current.lastEvent = 'up';
      setIsDrawing(false);
      
      const shapeTool = shape.tool;

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
      if (!resolvedCommentId) { setCurrentShape(null); setIsDrawing(false); drawViewRef.current = null; return; }
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

      delete normalizedShape.points;
      delete normalizedShape.startX;
      delete normalizedShape.startY;
      delete normalizedShape.x;
      delete normalizedShape.y;
      delete normalizedShape.width;
      delete normalizedShape.height;
      delete normalizedShape.radius;

      if (!canCommitNew) {
        setCurrentShape(null);
        setIsDrawing(false);
        drawViewRef.current = null;
        return;
      }

      addToUndoStack({ type: 'add', shapeId: normalizedShape.id });

      commitShapeToMap(shapesMapRef, normalizedShape, bump, onShapesChange);
      
      setCurrentShape(null);

      setSelectedId(normalizedShape.id);
      if (onToolChange) {
        onToolChange('select');
      }

      if (DEBUG_MODE && coordDiagRef.current.downK) {
        const dK = coordDiagRef.current.downK, cd2 = coordDiagRef.current;
        let ix = 0, iy = 0;
        if (normalizedShape.nx !== undefined) { const p = denormalizeCoords(normalizedShape.nx, normalizedShape.ny); ix = p.x; iy = p.y; }
        else if (normalizedShape.normalizedPoints?.length >= 2) { const p = denormalizeCoords(normalizedShape.normalizedPoints[0], normalizedShape.normalizedPoints[1]); ix = p.x; iy = p.y; }
        const sx = ix * contentScale + viewX, sy = iy * contentScale + viewY;
        cd2.commitDiagStr = `img=(${Math.round(ix)},${Math.round(iy)}) stg=(${Math.round(sx)},${Math.round(sy)}) k0=(${Math.round(dK.x)},${Math.round(dK.y)}) Δ=(${Math.round(sx-dK.x)},${Math.round(sy-dK.y)})`;
        cd2.lastCmt = cd2.commitDiagStr; if (cd2.strokeSeqInSession === 1 && !cd2.firstCmt) cd2.firstCmt = cd2.commitDiagStr;
        setDiagTick(t => t + 1);
      }

      if (onSaveShape) {
        setIsSaving(prev => ({ ...prev, [normalizedShape.id]: true }));
        debugRef.current.saveStatus = 'saving';
        debugRef.current.mutation = 'create';

        try {
          const result = await onSaveShape(normalizedShape, 'create');
          debugRef.current.saveStatus = 'success';
          debugRef.current.successId = result?.dbId || normalizedShape.id;
          debugRef.current.error = null;

          onSaveSuccess(shapesMapRef, normalizedShape.id, result?.dbId, bump, onShapesChange);
        } catch (err) {
          debugRef.current.saveStatus = 'error';
          debugRef.current.error = err.message || String(err);
          console.error('Save Shape Error:', err);
        } finally {
          setIsSaving(prev => ({ ...prev, [normalizedShape.id]: false }));
        }
        }

          drawViewRef.current = null;
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
  const { handleDragStart, handleTransformStart, handleDragMove, handleDragEnd, handleTransformEnd } = createDragTransformHandlers({
    shapesMapRef, bump, onShapesChange, onSaveShape,
    normalizeCoords, denormalizeCoords, bgSize,
    addToUndoStack, isEditableShape,
    canMutateExisting, isSaving, setIsSaving,
    isInteractingRef, isDraggingRef, pendingIncomingShapesRef,
    dragRafRef, pendingDragRef,
    debugRef,
  });

  const applyStyleToSelected = async (patch) => {
    if (!selectedId) return;
    const cur = shapesRef.current || [];
    const prev = cur.find(s => s.id === selectedId);
    if (!prev) return;
    const nextStroke = patch.stroke ?? prev.stroke;
    const rawSw = patch.strokeWidth ?? prev.strokeWidth;
    const nextSw = typeof rawSw === 'string' ? Number(rawSw) : rawSw;
    const safeSw = Number.isFinite(nextSw) ? nextSw : prev.strokeWidth;
    const next = { ...prev, stroke: nextStroke, strokeWidth: (prev.tool === 'text') ? prev.strokeWidth : safeSw };
    if (next.stroke === prev.stroke && next.strokeWidth === prev.strokeWidth) return;

    addToUndoStack({ type: 'update', shapeId: prev.id, before: prev, after: next });
    mapSet(shapesMapRef, prev.id, next);
    bump();
    onShapesChange?.(getAllShapes());

    if (onSaveShape) {
      try {
        const res = await onSaveShape(next, 'upsert');
        if (res?.dbId) onSaveSuccess(shapesMapRef, prev.id, res.dbId, bump, onShapesChange);
      } catch (err) {
        console.error('Apply style error:', err);
      }
    }
  };

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

  const debugHudData = useMemo(() => {
    if (!DEBUG_MODE) return null;
    const uniqueCids = [...new Set(renderedShapes.map(s => shapeCommentId(s)).filter(Boolean))].slice(0, 10);
    const countsByCommentId = {};
    renderedShapes.forEach(s => { const cid = shapeCommentId(s); if (cid) { const k = String(cid).substring(0, 12); countsByCommentId[k] = (countsByCommentId[k] || 0) + 1; } });
    return {
      activeCommentId: String(activeCommentId ?? 'null'),
      effectiveActiveId: String(effectiveActiveId ?? 'null'),
      draftCommentId: String(draftCommentIdRef.current ?? 'null'),
      renderedShapesLength: renderedShapes.length,
      uniqueCommentIds: uniqueCids.map(id => String(id).substring(0, 12)),
      countsByCommentId,
      coordDiag: { ...coordDiagRef.current },
    };
  }, [activeCommentId, effectiveActiveId, renderedShapes, diagTick]);

  useImperativeHandle(ref, () => ({
    getBgSize: () => bgSize,
    getContainerSize: () => containerSize,
    undo: performUndo,
    redo: performRedo,
    clear: () => {
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
    afterSubmitClear: () => {
      const draftId = draftCommentIdRef.current;
      const newMap = new Map(shapesMapRef.current);
      for (const [id, shape] of shapesMapRef.current.entries()) {
        if ((draftId && shape.comment_id === draftId) || shape._dirty) {
          newMap.delete(id);
        }
      }
      shapesMapRef.current = newMap;
      bump();
      
      draftCommentIdRef.current = null;
      setSelectedId(null);
      setCurrentShape(null);
      setIsDrawing(false);
      setUndoStack([]);
      setRedoStack([]);
      setTextEditor(TEXT_EDITOR_INITIAL);
      if (transformerRef.current) {
        transformerRef.current.nodes([]);
        transformerRef.current.getLayer()?.batchDraw();
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