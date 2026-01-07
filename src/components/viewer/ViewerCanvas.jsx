import React, { useState, useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { Stage, Layer, Line, Rect, Circle, Arrow, Image as KonvaImage, Group, Transformer } from 'react-konva';
import useImage from 'use-image';

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
  onShapesChange,
  onSaveShape,
  onDeleteShape,
  paintMode = false,
  tool = 'select',
  strokeColor = '#ff0000',
  strokeWidth = 2,
  zoom = 100,
  onToolChange,
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
  
  const isImage = mimeType?.startsWith('image/');
  const isEditMode = tool === 'select';
  const isDrawMode = !isEditMode && paintMode;
  
  // fileUrl/pageNumber変更時にリセット（hydrateより先に実行）
  useEffect(() => {
    hydratedRef.current = false;
    setShapes([]);
    setSelectedId(null);
    setCurrentShape(null);
    setUndoStack([]);
    setRedoStack([]);
  }, [fileUrl, pageNumber]);

  // existingShapesからの初回hydrate（上書き防止）
  useEffect(() => {
    if (!hydratedRef.current && existingShapes) {
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

  // Transformer selection（編集モード時のみ、Rect/Circleのみ）
  useEffect(() => {
    if (!transformerRef.current) return;
    
    if (isEditMode && selectedId && shapeRefs.current[selectedId]) {
      const selectedShape = shapes.find(s => s.id === selectedId);
      const canResize = selectedShape && (selectedShape.tool === 'rect' || selectedShape.tool === 'circle');
      
      if (canResize) {
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
    if (!isDrawMode) return;
    
    try {
      const stage = e.target.getStage();
      if (!stage) return;
      
      const imgCoords = pointerToImageCoords(stage);
      if (!imgCoords) return;
      
      setLastEvent('down');
      setPointerPos(stage.getPointerPosition());
      setImgPos(imgCoords);
      setIsDrawing(true);
      
      const newShape = {
        id: `shape_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        tool,
        stroke: strokeColor,
        strokeWidth: strokeWidth,
        startX: imgCoords.x,
        startY: imgCoords.y,
      };
      
      if (tool === 'pen') {
        newShape.points = [imgCoords.x, imgCoords.y];
      }
      
      setCurrentShape(newShape);
    } catch (err) {
      console.error('PointerDown Error:', err);
      setError(`PointerDown Error: ${err.message}`);
    }
  };
  
  // PointerMove: 描画中（描画モード時のみ）
  const handlePointerMove = (e) => {
    try {
      const stage = e.target.getStage();
      if (!stage) return;
      
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
      } else if (tool === 'rect') {
        const { nx: nx1, ny: ny1 } = normalizeCoords(currentShape.x, currentShape.y);
        const { nx: nx2, ny: ny2 } = normalizeCoords(currentShape.x + currentShape.width, currentShape.y + currentShape.height);
        normalizedShape.nx = nx1;
        normalizedShape.ny = ny1;
        normalizedShape.nw = nx2 - nx1;
        normalizedShape.nh = ny2 - ny1;
      } else if (tool === 'circle') {
        const { nx, ny } = normalizeCoords(currentShape.x, currentShape.y);
        normalizedShape.nx = nx;
        normalizedShape.ny = ny;
        normalizedShape.nr = currentShape.radius / bgSize.width;
      } else if (tool === 'arrow' && currentShape.points) {
        const normalizedPoints = [];
        for (let i = 0; i < currentShape.points.length; i += 2) {
          const { nx, ny } = normalizeCoords(currentShape.points[i], currentShape.points[i + 1]);
          normalizedPoints.push(nx, ny);
        }
        normalizedShape.normalizedPoints = normalizedPoints;
      }
      
      // Undo履歴に追加
      addToUndoStack({ type: 'add', shapeId: normalizedShape.id });
      
      // Optimistic update
      setShapes(prev => [...prev, normalizedShape]);
      setCurrentShape(null);
      
      // 描画完了後、自動で選択ツールに切り替え＆新図形を選択
      setSelectedId(normalizedShape.id);
      if (onToolChange) {
        onToolChange('select');
      }
      
      // 親コンポーネントに保存を依頼
      if (onSaveShape) {
        setLastSaveStatus('saving');
        setLastMutation('create');
        setLastPayload(JSON.stringify(normalizedShape));
        try {
          const result = await onSaveShape(normalizedShape, 'create');
          setLastSaveStatus('success');
          setLastSuccessId(result?.dbId || normalizedShape.id);
          setLastError(null);
        } catch (err) {
          setLastSaveStatus('error');
          setLastError(err.message || String(err));
          console.error('Save Shape Error:', err);
        }
      }
    } catch (err) {
      console.error('PointerUp Error:', err);
      setError(`PointerUp Error: ${err.message}`);
      setLastSaveStatus('error');
      setLastError(err.message);
    }
  };
  
  // ドラッグ終了時の更新（Optimistic update）
  const handleDragEnd = async (shape, e) => {
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
    }
    
    addToUndoStack({ type: 'update', shapeId: shape.id, before: shape, after: updatedShape });
    
    // Optimistic update（即座にUI反映）
    setShapes(prev => prev.map(s => s.id === shape.id ? updatedShape : s));
    
    // DB更新（後で）
    if (onSaveShape) {
      setLastMutation('update-drag');
      setLastPayload(JSON.stringify(updatedShape));
      try {
        const result = await onSaveShape(updatedShape, 'update');
        setLastSaveStatus('success');
        setLastSuccessId(result?.dbId || updatedShape.id);
        setLastError(null);
      } catch (err) {
        console.error('Update shape error:', err);
        setLastSaveStatus('error');
        setLastError(err.message);
        // 失敗時はrevert
        setShapes(prev => prev.map(s => s.id === shape.id ? shape : s));
      }
    }
  };

  // Transform終了時の更新（Optimistic update、Rect/Circleのみ）
  const handleTransformEnd = async (shape, e) => {
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
    }
    
    addToUndoStack({ type: 'update', shapeId: shape.id, before: shape, after: updatedShape });
    
    // Optimistic update（即座にUI反映）
    setShapes(prev => prev.map(s => s.id === shape.id ? updatedShape : s));
    
    // DB更新（後で）
    if (onSaveShape) {
      setLastMutation('update-transform');
      setLastPayload(JSON.stringify(updatedShape));
      try {
        const result = await onSaveShape(updatedShape, 'update');
        setLastSaveStatus('success');
        setLastSuccessId(result?.dbId || updatedShape.id);
        setLastError(null);
      } catch (err) {
        console.error('Update shape error:', err);
        setLastSaveStatus('error');
        setLastError(err.message);
        // 失敗時はrevert
        setShapes(prev => prev.map(s => s.id === shape.id ? shape : s));
      }
    }
  };

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
    const canTransform = shape.tool === 'rect' || shape.tool === 'circle';
    
    const commonProps = {
      key: shape.id,
      stroke: shape.stroke,
      strokeWidth: shape.strokeWidth,
      onMouseDown: isEditMode ? (e) => {
        e.cancelBubble = true;
        setSelectedId(shape.id);
      } : undefined,
      onTouchStart: isEditMode ? (e) => {
        e.cancelBubble = true;
        setSelectedId(shape.id);
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
      onDragEnd: isEditMode ? (e) => handleDragEnd(shape, e) : undefined,
      // TransformEndはRect/Circleのみ
      onTransformEnd: (isEditMode && canTransform) ? (e) => handleTransformEnd(shape, e) : undefined,
    };
    
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

      return <Line {...commonProps} points={points} tension={0.5} lineCap="round" lineJoin="round" hitStrokeWidth={20} fill={undefined} />;
    } else if (shape.tool === 'rect') {
      // 正規化座標を優先（必ずこれから復元）
      if (shape.nx !== undefined) {
        const p1 = denormalizeCoords(shape.nx, shape.ny);
        const p2 = denormalizeCoords(shape.nx + shape.nw, shape.ny + shape.nh);
        return <Rect {...commonProps} x={p1.x} y={p1.y} width={p2.x - p1.x} height={p2.y - p1.y} fill={undefined} hitStrokeWidth={10} />;
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
        return <Circle {...commonProps} x={center.x} y={center.y} radius={shape.nr * bgSize.width} fill={undefined} hitStrokeWidth={10} />;
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

      return <Arrow {...commonProps} points={points} pointerLength={10} pointerWidth={10} hitStrokeWidth={20} />;
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
      <Stage
        ref={stageRef}
        width={containerSize.width}
        height={containerSize.height}
        onPointerDown={isDrawMode ? handlePointerDown : undefined}
        onPointerMove={isDrawMode ? handlePointerMove : undefined}
        onPointerUp={isDrawMode ? handlePointerUp : undefined}
        onMouseDown={isEditMode ? handleStageMouseDown : undefined}
        onTouchStart={isEditMode ? handleStageMouseDown : undefined}
        style={{ cursor: isDrawMode ? 'crosshair' : isEditMode ? 'default' : 'default' }}
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
      
      {/* デバッグオーバーレイ */}
      {DEBUG_MODE && (
        <div style={{ position: 'absolute', top: 8, left: 8, background: 'rgba(0,0,0,0.8)', color: '#0f0', padding: '8px', fontSize: '11px', fontFamily: 'monospace', borderRadius: '4px', pointerEvents: 'none', zIndex: 100, lineHeight: '1.4' }}>
          <div><strong>ViewerCanvas Debug</strong></div>
          <div>lastEvent: {lastEvent}</div>
          <div>pointer: {pointerPos ? `${Math.round(pointerPos.x)}, ${Math.round(pointerPos.y)}` : 'null'}</div>
          <div>imgPos: {imgPos ? `${Math.round(imgPos.x)}, ${Math.round(imgPos.y)}` : 'null'}</div>
          <div>bgSize: {bgSize.width} x {bgSize.height}</div>
          <div>fitScale: {fitScale.toFixed(2)}</div>
          <div>userScale: {userScale.toFixed(2)}</div>
          <div>contentScale: {contentScale.toFixed(2)}</div>
          <div>offset: {Math.round(offsetX)}, {Math.round(offsetY)}</div>
          <div>paintMode: {paintMode ? 'ON' : 'OFF'}</div>
          <div>tool: {tool}</div>
          <div>isDrawing: {isDrawing ? 'YES' : 'NO'}</div>
          <div>shapes: {shapes.length}</div>
          <div>hydrated: {hydratedRef.current ? 'YES' : 'NO'}</div>
          <div style={{ color: lastSaveStatus === 'success' ? '#0f0' : lastSaveStatus === 'error' ? '#f00' : '#ff0' }}>
            saveStatus: {lastSaveStatus}
          </div>
          {lastMutation && <div>lastMutation: {lastMutation}</div>}
          {lastSuccessId && <div style={{ color: '#0f0' }}>lastSuccessId: {lastSuccessId}</div>}
          {lastPayload && <div className="text-xs">payload: {lastPayload.substring(0, 100)}...</div>}
          {lastError && <div style={{ color: '#f00' }}>error: {lastError}</div>}
        </div>
      )}
    </div>
  );
});

ViewerCanvas.displayName = 'ViewerCanvas';

export default ViewerCanvas;