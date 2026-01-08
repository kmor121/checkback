import React, { useState, useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { Stage, Layer, Line, Rect, Circle, Arrow, Image as KonvaImage, Group, Transformer, Text } from 'react-konva';
import useImage from 'use-image';
// CommentPin は使用しない（バッジ非表示）

// UUID生成（clientShapeId用、再生成されない保証）
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

const DEBUG_MODE = import.meta.env.VITE_DEBUG === 'true';

// 背景画像コンポーネント
function BackgroundImage({ src, onLoad }) {
  const [image] = useImage(src);
  
  useEffect(() => {
    if (image && onLoad) {
      onLoad({ width: image.width, height: image.height });
    }
  }, [image, onLoad]);
  
  return image ? (
    <KonvaImage 
      image={image} 
      width={image.width} 
      height={image.height} 
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
  onShapesChange,
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
  const hydratedRef = useRef(false);
  
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
  const [dragTick, setDragTick] = useState(0);
  
  const isImage = mimeType?.startsWith('image/');
  const isEditMode = tool === 'select';
  const isDrawMode = !isEditMode && (paintMode || tool === 'text');
  
  // fileUrl/pageNumber変更時にリセット（hydrateより先に実行）
  useEffect(() => {
    hydratedRef.current = false;
    setShapes([]);
    setSelectedId(null);
    setCurrentShape(null);
    setUndoStack([]);
    setRedoStack([]);
  }, [fileUrl, pageNumber]);

  // existingShapesからの初回hydrate（後から非空配列が届いても反映）
  useEffect(() => {
    if (!existingShapes) return;
    // 空配列では hydrate しない（後から非空が届く可能性がある）
    if (existingShapes.length === 0) return;
    // 未hydrate または 現在のshapesが空の時だけ反映（ローカル編集を上書きしない）
    if (!hydratedRef.current || shapes.length === 0) {
      console.log('[ViewerCanvas] Hydrating shapes:', existingShapes.length);
      setShapes(existingShapes);
      hydratedRef.current = true;
    }
  }, [existingShapes]);

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
        if (isEditMode && selectedId) {
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
  }, [selectedId, shapes, undoStack, redoStack, isEditMode]);

  // ResizeObserver
  useEffect(() => {
    if (!containerRef.current) return;
    
    try {
      const resizeObserver = new ResizeObserver(entries => {
        const entry = entries[0];
        if (entry) {
          const width = entry.contentRect.width;
          const height = entry.contentRect.height;
          if (width > 0 && height > 0) {
            setContainerSize({ width, height });
          }
        }
      });
      
      resizeObserver.observe(containerRef.current);
      
      const rect = containerRef.current.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
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
  
  // 中央寄せオフセット
  const offsetX = Math.max(0, (containerSize.width - scaledWidth) / 2);
  const offsetY = Math.max(0, (containerSize.height - scaledHeight) / 2);
  
  // pointer座標 → 画像座標への変換
  const pointerToImageCoords = (stage) => {
    const pos = stage.getPointerPosition();
    if (!pos) return null;
    
    const imgX = (pos.x - offsetX) / contentScale;
    const imgY = (pos.y - offsetY) / contentScale;
    
    return { x: imgX, y: imgY };
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

  // 削除（DB削除も実行）
  const handleDelete = async () => {
    if (!isEditMode || !selectedId || tool !== 'select') return;
    
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

  // 空白クリックで選択解除（編集モード時）
  const handleStageMouseDown = (e) => {
    if (isEditMode) {
      const clickedOnEmpty = e.target === e.target.getStage();
      if (clickedOnEmpty) {
        setSelectedId(null);
      }
    }
  };

  // PointerDown: 描画開始（描画モード時のみ）
  const handlePointerDown = (e) => {
    // CRITICAL: tool='text' のときは最優先で処理（paintMode不問）
    if (tool === 'text' && !textEditor.visible) {
      try {
        const stage = e.target.getStage();
        if (!stage) {
          console.error('[ViewerCanvas] Text tool: stage is null');
          return;
        }
        
        // 座標を強制更新
        if (e?.evt) stage.setPointersPositions(e.evt);
        
        const imgCoords = pointerToImageCoords(stage);
        const pos = stage.getPointerPosition();
        
        if (!imgCoords || !pos) {
          console.error('[ViewerCanvas] Text tool: coords unavailable', { imgCoords, pos });
          return;
        }
        
        const container = containerRef.current;
        const scrollX = container ? container.scrollLeft : 0;
        const scrollY = container ? container.scrollTop : 0;
        
        console.log('[ViewerCanvas] ✓ Text tool activated:', { 
          tool, 
          paintMode, 
          isDrawMode,
          pos: { x: pos.x, y: pos.y },
          img: { x: imgCoords.x, y: imgCoords.y }
        });
        
        setTextEditor({
          visible: true,
          x: pos.x + scrollX,
          y: pos.y + scrollY,
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
      const stage = e.target.getStage();
      if (!stage) return;
      
      // 座標を強制更新（pointer取得を確実にする）
      if (e?.evt) stage.setPointersPositions(e.evt);
      
      const imgCoords = pointerToImageCoords(stage);
      if (!imgCoords) return;
      
      setLastEvent('down');
      setPointerPos(stage.getPointerPosition());
      setImgPos(imgCoords);
      
      // 描画開始時にコメント自動作成を通知（初回のみ）
      if (onBeginPaint && !isDrawing) {
        onBeginPaint(imgCoords.x, imgCoords.y, bgSize.width, bgSize.height);
      }
      
      setIsDrawing(true);

      // CRITICAL: clientShapeId は1回だけ発行して固定（移動・編集で絶対に再生成しない）
      const newShape = {
        id: generateUUID(),
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
    } catch (err) {
      console.error('PointerDown Error:', err);
      setError(`PointerDown Error: ${err.message}`);
    }
  };
  
  // PointerMove: 描画中（描画モード時のみ）
  const handlePointerMove = (e) => {
    // テキスト編集中は処理しない
    if (textEditor.visible) return;
    
    try {
      const stage = e.target.getStage();
      if (!stage) return;
      
      // 座標を強制更新
      if (e?.evt) stage.setPointersPositions(e.evt);
      
      const imgCoords = pointerToImageCoords(stage);
      if (!imgCoords) return;
      
      setPointerPos(stage.getPointerPosition());
      setImgPos(imgCoords);
      
      if (!isDrawMode || !isDrawing || !currentShape) return;
      
      setLastEvent('move');
      
      const newShape = { ...currentShape };
      
      if (tool === 'pen') {
        newShape.points = [...currentShape.points, imgCoords.x, imgCoords.y];
      } else if (tool === 'rect') {
        newShape.x = Math.min(currentShape.startX, imgCoords.x);
        newShape.y = Math.min(currentShape.startY, imgCoords.y);
        newShape.width = Math.abs(imgCoords.x - currentShape.startX);
        newShape.height = Math.abs(imgCoords.y - currentShape.startY);
      } else if (tool === 'circle') {
        const dx = imgCoords.x - currentShape.startX;
        const dy = imgCoords.y - currentShape.startY;
        newShape.radius = Math.sqrt(dx * dx + dy * dy);
        newShape.x = currentShape.startX;
        newShape.y = currentShape.startY;
      } else if (tool === 'arrow') {
        newShape.points = [currentShape.startX, currentShape.startY, imgCoords.x, imgCoords.y];
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
      // 新規テキスト作成
      const normalizedShape = {
        id: generateUUID(),
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
    const screenX = offsetX + imgX * contentScale;
    const screenY = offsetY + imgY * contentScale;

    const container = containerRef.current;
    const scrollX = container ? container.scrollLeft : 0;
    const scrollY = container ? container.scrollTop : 0;

    console.log('[ViewerCanvas] Text double-click edit:', { shapeId: shape.id, text: shape.text });

    // 編集時も現在のツールバー設定を使用
    setTextEditor({
      visible: true,
      x: screenX + scrollX,
      y: screenY + scrollY,
      value: shape.text || '',
      shapeId: shape.id,
      imgX,
      imgY,
      openedAt: Date.now(),
    });
  };

  // PointerUp: 描画終了（描画モード時のみ）
  const handlePointerUp = async () => {
    if (!isDrawMode || !isDrawing || !currentShape) return;
    
    try {
      setLastEvent('up');
      setIsDrawing(false);
      
      // しきい値チェック（誤クリック対策）
      if (tool === 'rect') {
        if (currentShape.width < 5 || currentShape.height < 5) {
          setCurrentShape(null);
          setIsDrawing(false);
          return;
        }
      } else if (tool === 'circle') {
        if (currentShape.radius < 3) {
          setCurrentShape(null);
          setIsDrawing(false);
          return;
        }
      } else if (tool === 'arrow' && currentShape.points) {
        const dx = currentShape.points[2] - currentShape.points[0];
        const dy = currentShape.points[3] - currentShape.points[1];
        const length = Math.sqrt(dx * dx + dy * dy);
        if (length < 5) {
          setCurrentShape(null);
          setIsDrawing(false);
          return;
        }
      }
      
      // 正規化データを作成
      const normalizedShape = {
        id: currentShape.id,
        tool: currentShape.tool,
        stroke: currentShape.stroke,
        strokeWidth: currentShape.strokeWidth,
        bgWidth: bgSize.width,
        bgHeight: bgSize.height,
      };
      
      if (tool === 'pen' && currentShape.points) {
        const normalizedPoints = [];
        for (let i = 0; i < currentShape.points.length; i += 2) {
          const { nx, ny } = normalizeCoords(currentShape.points[i], currentShape.points[i + 1]);
          normalizedPoints.push(nx, ny);
        }
        normalizedShape.normalizedPoints = normalizedPoints;
        // 一時フィールドを削除（正規化データのみ保存）
        // points, startX, startY は含めない
      } else if (tool === 'rect') {
        const { nx: nx1, ny: ny1 } = normalizeCoords(currentShape.x, currentShape.y);
        const { nx: nx2, ny: ny2 } = normalizeCoords(currentShape.x + currentShape.width, currentShape.y + currentShape.height);
        normalizedShape.nx = nx1;
        normalizedShape.ny = ny1;
        normalizedShape.nw = nx2 - nx1;
        normalizedShape.nh = ny2 - ny1;
        // 一時フィールドを削除（正規化データのみ保存）
        // x, y, width, height, startX, startY は含めない
      } else if (tool === 'circle') {
        const { nx, ny } = normalizeCoords(currentShape.x, currentShape.y);
        normalizedShape.nx = nx;
        normalizedShape.ny = ny;
        normalizedShape.nr = currentShape.radius / bgSize.width;
        // 一時フィールドを削除（正規化データのみ保存）
        // x, y, radius, startX, startY は含めない
      } else if (tool === 'arrow' && currentShape.points) {
        const normalizedPoints = [];
        for (let i = 0; i < currentShape.points.length; i += 2) {
          const { nx, ny } = normalizeCoords(currentShape.points[i], currentShape.points[i + 1]);
          normalizedPoints.push(nx, ny);
        }
        normalizedShape.normalizedPoints = normalizedPoints;
        // 一時フィールドを削除（正規化データのみ保存）
        // points, startX, startY は含めない
      }

      // Undo履歴に追加
      addToUndoStack({ type: 'add', shapeId: normalizedShape.id });

      // CRITICAL: Optimistic update は追加（新規描画のみ）
      setShapes(prev => [...prev, normalizedShape]);
      setCurrentShape(null);

      // 描画完了後、自動で選択ツールに切り替え＆新図形を選択
      setSelectedId(normalizedShape.id);
      if (onToolChange) {
        onToolChange('select');
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
    } catch (err) {
      console.error('PointerUp Error:', err);
      setError(`PointerUp Error: ${err.message}`);
      setLastSaveStatus('error');
      setLastError(err.message);
    }
  };
  
  // ドラッグ終了時の更新（CRITICAL: 増殖防止のため置換処理）
  const handleDragEnd = async (shape, e) => {
    // 多重保存防止
    if (isSaving[shape.id]) {
      console.log('[ViewerCanvas] Already saving:', shape.id);
      return;
    }
    
    const node = e.target;
    const x = node.x();
    const y = node.y();
    
    const updatedShape = { ...shape };
    
    if (shape.tool === 'pen' && shape.normalizedPoints) {
      // Pen: deltaとしてpointsに焼き込み
      const newPoints = [];
      for (let i = 0; i < shape.normalizedPoints.length; i += 2) {
        const { x: px, y: py } = denormalizeCoords(shape.normalizedPoints[i], shape.normalizedPoints[i + 1]);
        const { nx, ny } = normalizeCoords(px + x, py + y);
        newPoints.push(nx, ny);
      }
      updatedShape.normalizedPoints = newPoints;
      // Pen/Arrowのみリセット
      node.x(0);
      node.y(0);
    } else if (shape.tool === 'rect') {
      // Rect: 絶対座標として直接保存
      const { nx, ny } = normalizeCoords(x, y);
      updatedShape.nx = nx;
      updatedShape.ny = ny;
      // Rect/Circleはリセットしない
    } else if (shape.tool === 'circle') {
      // Circle: 絶対座標として直接保存
      const { nx, ny } = normalizeCoords(x, y);
      updatedShape.nx = nx;
      updatedShape.ny = ny;
      // Rect/Circleはリセットしない
    } else if (shape.tool === 'arrow' && shape.normalizedPoints) {
      // Arrow: deltaとしてpointsに焼き込み
      const newPoints = [];
      for (let i = 0; i < shape.normalizedPoints.length; i += 2) {
        const { x: px, y: py } = denormalizeCoords(shape.normalizedPoints[i], shape.normalizedPoints[i + 1]);
        const { nx, ny } = normalizeCoords(px + x, py + y);
        newPoints.push(nx, ny);
      }
      updatedShape.normalizedPoints = newPoints;
      // Pen/Arrowのみリセット
      node.x(0);
      node.y(0);
    } else if (shape.tool === 'text') {
      // Text: 絶対座標として直接保存
      const { nx, ny } = normalizeCoords(x, y);
      updatedShape.nx = nx;
      updatedShape.ny = ny;
    }
    
    addToUndoStack({ type: 'update', shapeId: shape.id, before: shape, after: updatedShape });
    
    // CRITICAL: Optimistic update は「同じidを置換」（追加ではない）
    setShapes(prev => prev.map(s => s.id === updatedShape.id ? updatedShape : s));
    
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
    
    addToUndoStack({ type: 'update', shapeId: shape.id, before: shape, after: updatedShape });
    
    // CRITICAL: Optimistic update は「同じidを置換」（追加ではない）
    setShapes(prev => prev.map(s => s.id === updatedShape.id ? updatedShape : s));
    
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

  // 選択図形にスタイルを適用
  const applyStyleToSelected = async (patch) => {
    if (!selectedId) return;
    const prev = shapes.find(s => s.id === selectedId);
    if (!prev) return;

    // テキストに太さは適用しない
    const next = {
      ...prev,
      stroke: patch.stroke ?? prev.stroke,
      strokeWidth: (prev.tool === 'text') ? prev.strokeWidth : (patch.strokeWidth ?? prev.strokeWidth),
    };

    // 差分が無ければ保存しない
    if (next.stroke === prev.stroke && next.strokeWidth === prev.strokeWidth) return;

    addToUndoStack({ type: 'update', shapeId: prev.id, before: prev, after: next });
    setShapes(cur => cur.map(s => s.id === prev.id ? next : s));

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
    if (!isEditMode || !selectedId) return;
    applyStyleToSelected({ stroke: strokeColor });
  }, [strokeColor]);

  useEffect(() => {
    if (!isEditMode || !selectedId) return;
    applyStyleToSelected({ strokeWidth });
  }, [strokeWidth]);

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
    },
    delete: handleDelete,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
  }));
  
  // Shape描画（正規化座標から復元）
  const renderShape = (shape, isExisting = false) => {
    const isSelected = selectedId === shape.id;
    const canTransform = shape.tool === 'rect' || shape.tool === 'circle' || shape.tool === 'text' || shape.tool === 'arrow';
    
    const commonProps = {
      key: shape.id,
      stroke: shape.stroke,
      strokeWidth: shape.strokeWidth,
      onMouseDown: isEditMode ? (e) => {
        e.cancelBubble = true;
        setSelectedId(shape.id);
        // 選択図形の色/太さをツールバーに反映
        if (onStrokeColorChange && shape.stroke) onStrokeColorChange(shape.stroke);
        if (onStrokeWidthChange && typeof shape.strokeWidth === 'number') onStrokeWidthChange(shape.strokeWidth);
      } : undefined,
      onTouchStart: isEditMode ? (e) => {
        e.cancelBubble = true;
        setSelectedId(shape.id);
        // 選択図形の色/太さをツールバーに反映
        if (onStrokeColorChange && shape.stroke) onStrokeColorChange(shape.stroke);
        if (onStrokeWidthChange && typeof shape.strokeWidth === 'number') onStrokeWidthChange(shape.strokeWidth);
      } : undefined,
      ref: (node) => {
        if (node) {
          shapeRefs.current[shape.id] = node;
        }
      },
      draggable: isEditMode && !isExisting,
      onDragStart: isEditMode ? (e) => {
        e.cancelBubble = true;
      } : undefined,
      onDragMove: isEditMode ? (e) => {
        // ドラッグ中も選択枠を追従させるために再レンダリング強制
        setDragTick(prev => prev + 1);
      } : undefined,
      onDragEnd: isEditMode ? (e) => handleDragEnd(shape, e) : undefined,
      // TransformEndはRect/Circleのみ
      onTransformEnd: (isEditMode && canTransform) ? (e) => handleTransformEnd(shape, e) : undefined,
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
            draggable={isEditMode && !isExisting}
            onMouseDown={isEditMode ? (e) => {
              e.cancelBubble = true;
              setSelectedId(shape.id);
              if (onStrokeColorChange && shape.stroke) onStrokeColorChange(shape.stroke);
              if (onStrokeWidthChange && typeof shape.strokeWidth === 'number') onStrokeWidthChange(shape.strokeWidth);
            } : undefined}
            onTouchStart={isEditMode ? (e) => {
              e.cancelBubble = true;
              setSelectedId(shape.id);
              if (onStrokeColorChange && shape.stroke) onStrokeColorChange(shape.stroke);
              if (onStrokeWidthChange && typeof shape.strokeWidth === 'number') onStrokeWidthChange(shape.strokeWidth);
            } : undefined}
            onDragStart={isEditMode ? (e) => {
              e.cancelBubble = true;
            } : undefined}
            onDragMove={isEditMode ? (e) => {
              setDragTick(prev => prev + 1);
            } : undefined}
            onDragEnd={isEditMode ? (e) => handleDragEnd(shape, e) : undefined}
          >
            <Line 
              stroke={shape.stroke}
              strokeWidth={isSelected ? shape.strokeWidth + 1 : shape.strokeWidth}
              points={points} 
              tension={0.5} 
              lineCap="round" 
              lineJoin="round" 
              fill={undefined}
              shadowBlur={isSelected ? 4 : 0}
              shadowColor={isSelected ? shape.stroke : undefined}
              listening={false}
            />
            <Rect 
              x={bboxX} 
              y={bboxY} 
              width={bboxW} 
              height={bboxH} 
              fill="transparent"
              listening={isEditMode}
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
            <Rect {...commonProps} x={p1.x} y={p1.y} width={p2.x - p1.x} height={p2.y - p1.y} fill={undefined} hitStrokeWidth={10} />
            {boundingBox && <Rect x={boundingBox.x} y={boundingBox.y} width={boundingBox.width} height={boundingBox.height} stroke="rgba(255,0,0,0.3)" strokeWidth={1} dash={[5,5]} fill={undefined} listening={false} />}
          </React.Fragment>
        );
      }

      // 描画中の一時データ（nxがない場合のみ）
      if (shape.x !== undefined && shape.width !== undefined) {
        return <Rect {...commonProps} x={shape.x} y={shape.y} width={shape.width} height={shape.height} fill={undefined} hitStrokeWidth={10} />;
      }

      return null;
      } else if (shape.tool === 'circle') {
      // 正規化座標を優先（必ずこれから復元）
      if (shape.nx !== undefined) {
        const center = denormalizeCoords(shape.nx, shape.ny);
        return (
          <React.Fragment key={shape.id}>
            <Circle {...commonProps} x={center.x} y={center.y} radius={shape.nr * bgSize.width} fill={undefined} hitStrokeWidth={10} />
            {boundingBox && <Rect x={boundingBox.x} y={boundingBox.y} width={boundingBox.width} height={boundingBox.height} stroke="rgba(255,0,0,0.3)" strokeWidth={1} dash={[5,5]} fill={undefined} listening={false} />}
          </React.Fragment>
        );
      }

      // 描画中の一時データ（nxがない場合のみ）
      if (shape.x !== undefined && shape.radius !== undefined) {
        return <Circle {...commonProps} x={shape.x} y={shape.y} radius={shape.radius} fill={undefined} hitStrokeWidth={10} />;
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
              draggable={isEditMode && !isExisting}
              onMouseDown={isEditMode ? (e) => {
                e.cancelBubble = true;
                setSelectedId(shape.id);
                if (onStrokeColorChange && shape.stroke) onStrokeColorChange(shape.stroke);
                if (onStrokeWidthChange && typeof shape.strokeWidth === 'number') onStrokeWidthChange(shape.strokeWidth);
              } : undefined}
              onTouchStart={isEditMode ? (e) => {
                e.cancelBubble = true;
                setSelectedId(shape.id);
                if (onStrokeColorChange && shape.stroke) onStrokeColorChange(shape.stroke);
                if (onStrokeWidthChange && typeof shape.strokeWidth === 'number') onStrokeWidthChange(shape.strokeWidth);
              } : undefined}
              onDragStart={isEditMode ? (e) => {
                e.cancelBubble = true;
              } : undefined}
              onDragMove={isEditMode ? (e) => {
                setDragTick(prev => prev + 1);
              } : undefined}
              onDragEnd={isEditMode ? (e) => handleDragEnd(shape, e) : undefined}
            >
              <Arrow 
                stroke={shape.stroke}
                strokeWidth={isSelected ? shape.strokeWidth + 1 : shape.strokeWidth}
                points={points} 
                pointerLength={10} 
                pointerWidth={10} 
                shadowBlur={isSelected ? 4 : 0}
                shadowColor={isSelected ? shape.stroke : undefined}
                listening={false}
              />
              <Rect 
                x={bboxX} 
                y={bboxY} 
                width={bboxW} 
                height={bboxH} 
                fill="transparent"
                listening={isEditMode}
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
            onMouseDown={isEditMode ? (e) => {
              e.cancelBubble = true;
              setSelectedId(shape.id);
              // 選択図形の色/太さをツールバーに反映
              if (onStrokeColorChange && shape.stroke) onStrokeColorChange(shape.stroke);
              if (onStrokeWidthChange && typeof shape.strokeWidth === 'number') onStrokeWidthChange(shape.strokeWidth);
            } : undefined}
            onTouchStart={isEditMode ? (e) => {
              e.cancelBubble = true;
              setSelectedId(shape.id);
              // 選択図形の色/太さをツールバーに反映
              if (onStrokeColorChange && shape.stroke) onStrokeColorChange(shape.stroke);
              if (onStrokeWidthChange && typeof shape.strokeWidth === 'number') onStrokeWidthChange(shape.strokeWidth);
            } : undefined}
            ref={(node) => {
              if (node) {
                shapeRefs.current[shape.id] = node;
              }
            }}
            draggable={isEditMode && !isExisting}
            onDragStart={isEditMode ? (e) => {
              e.cancelBubble = true;
            } : undefined}
            onDragMove={isEditMode ? (e) => {
              // ドラッグ中も選択枠を追従させるために再レンダリング強制
              setDragTick(prev => prev + 1);
            } : undefined}
            onDragEnd={isEditMode ? (e) => handleDragEnd(shape, e) : undefined}
            onDblClick={isEditMode ? () => handleTextDblClick(shape) : undefined}
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
        onMouseDown={(e) => {
          if (isDrawMode) handlePointerDown(e);
          else if (isEditMode) handleStageMouseDown(e);
        }}
        onTouchStart={(e) => {
          if (isDrawMode) handlePointerDown(e);
          else if (isEditMode) handleStageMouseDown(e);
        }}
        onMouseMove={isDrawMode ? handlePointerMove : undefined}
        onTouchMove={isDrawMode ? handlePointerMove : undefined}
        onMouseUp={isDrawMode ? handlePointerUp : undefined}
        onTouchEnd={isDrawMode ? handlePointerUp : undefined}
        style={{ cursor: isDrawMode ? 'crosshair' : 'default' }}
      >
        {/* 背景Layer（非インタラクティブ） */}
        <Layer listening={false}>
          <Group
            x={offsetX}
            y={offsetY}
            scaleX={contentScale}
            scaleY={contentScale}
          >
            {isImage && fileUrl && (
              <BackgroundImage src={fileUrl} onLoad={setBgSize} />
            )}
          </Group>
        </Layer>


        {/* 注釈Layer（contentGroup内に配置） */}
        <Layer>
          <Group
            ref={contentGroupRef}
            x={offsetX}
            y={offsetY}
            scaleX={contentScale}
            scaleY={contentScale}
          >
            {shapes.map(s => renderShape(s, false))}
            {currentShape && renderShape(currentShape, false)}
            <Transformer ref={transformerRef} />
          </Group>
        </Layer>
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
            <div>hydrated: {hydratedRef.current ? 'YES' : 'NO'}</div>
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