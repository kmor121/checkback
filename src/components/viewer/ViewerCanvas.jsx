import React, { useState, useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { Stage, Layer, Line, Rect, Circle, Arrow, Image as KonvaImage } from 'react-konva';
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
  paintMode = false,
  tool = 'pen',
  strokeColor = '#ff0000',
  strokeWidth = 2,
  zoom = 100,
}, ref) => {
  const containerRef = useRef(null);
  const stageRef = useRef(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [bgSize, setBgSize] = useState({ width: 800, height: 600 });
  const [error, setError] = useState(null);
  
  // 描画状態
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentShape, setCurrentShape] = useState(null);
  const [localShapes, setLocalShapes] = useState([]);
  
  // デバッグ用
  const [lastEvent, setLastEvent] = useState('none');
  const [pointerPos, setPointerPos] = useState(null);
  const [lastSaveStatus, setLastSaveStatus] = useState('idle');
  const [lastError, setLastError] = useState(null);
  
  const isImage = mimeType?.startsWith('image/');
  
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
  
  // スケール計算
  const baseScale = Math.min(
    containerSize.width / bgSize.width,
    containerSize.height / bgSize.height
  ) || 1;
  
  const userScale = zoom / 100;
  const finalScale = baseScale * userScale;
  
  const scaledWidth = bgSize.width * finalScale;
  const scaledHeight = bgSize.height * finalScale;
  
  // 座標を正規化（0-1の範囲に変換）
  const normalizePoint = (x, y) => ({
    nx: x / (bgSize.width * finalScale),
    ny: y / (bgSize.height * finalScale),
  });
  
  // 正規化座標を実座標に戻す
  const denormalizePoint = (nx, ny) => ({
    x: nx * bgSize.width * finalScale,
    y: ny * bgSize.height * finalScale,
  });
  
  // PointerDown: 描画開始
  const handlePointerDown = (e) => {
    if (!paintMode) return;
    
    try {
      const stage = e.target.getStage();
      if (!stage) return;
      
      const pos = stage.getPointerPosition();
      if (!pos) return;
      
      setLastEvent('down');
      setPointerPos(pos);
      setIsDrawing(true);
      
      const newShape = {
        id: `shape_${Date.now()}`,
        tool,
        points: [pos.x, pos.y],
        stroke: strokeColor,
        strokeWidth: strokeWidth,
      };
      
      setCurrentShape(newShape);
    } catch (err) {
      console.error('PointerDown Error:', err);
      setError(`PointerDown Error: ${err.message}`);
    }
  };
  
  // PointerMove: 描画中
  const handlePointerMove = (e) => {
    try {
      const stage = e.target.getStage();
      if (!stage) return;
      
      const pos = stage.getPointerPosition();
      if (!pos) return;
      
      setPointerPos(pos);
      
      if (!paintMode || !isDrawing || !currentShape) return;
      
      setLastEvent('move');
      
      const newShape = {
        ...currentShape,
        points: [...currentShape.points, pos.x, pos.y],
      };
      
      setCurrentShape(newShape);
    } catch (err) {
      console.error('PointerMove Error:', err);
    }
  };
  
  // PointerUp: 描画終了
  const handlePointerUp = async () => {
    if (!paintMode || !isDrawing || !currentShape) return;
    
    try {
      setLastEvent('up');
      setIsDrawing(false);
      
      // 座標を正規化
      const normalizedPoints = [];
      for (let i = 0; i < currentShape.points.length; i += 2) {
        const { nx, ny } = normalizePoint(currentShape.points[i], currentShape.points[i + 1]);
        normalizedPoints.push(nx, ny);
      }
      
      const shapeToSave = {
        ...currentShape,
        normalizedPoints,
        bgWidth: bgSize.width,
        bgHeight: bgSize.height,
      };
      
      // ローカルに追加
      setLocalShapes([...localShapes, shapeToSave]);
      setCurrentShape(null);
      
      // 親コンポーネントに保存を依頼
      if (onSaveShape) {
        setLastSaveStatus('saving');
        try {
          await onSaveShape(shapeToSave);
          setLastSaveStatus('success');
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
  
  // Undo/Redo
  useImperativeHandle(ref, () => ({
    undo: () => {
      if (localShapes.length > 0) {
        const newShapes = localShapes.slice(0, -1);
        setLocalShapes(newShapes);
      }
    },
    redo: () => console.log('redo (not implemented)'),
    clear: () => {
      setLocalShapes([]);
      setCurrentShape(null);
    },
    canUndo: localShapes.length > 0,
    canRedo: false,
  }));
  
  // Shape描画（正規化座標から復元）
  const renderShape = (shape) => {
    let points = shape.points;
    
    // 正規化座標がある場合は復元
    if (shape.normalizedPoints) {
      points = [];
      for (let i = 0; i < shape.normalizedPoints.length; i += 2) {
        const { x, y } = denormalizePoint(shape.normalizedPoints[i], shape.normalizedPoints[i + 1]);
        points.push(x, y);
      }
    }
    
    const commonProps = {
      key: shape.id,
      stroke: shape.stroke,
      strokeWidth: shape.strokeWidth,
    };
    
    if (shape.tool === 'pen') {
      return <Line {...commonProps} points={points} tension={0.5} lineCap="round" lineJoin="round" />;
    } else if (shape.tool === 'rect') {
      return <Rect {...commonProps} x={points[0]} y={points[1]} width={points[2] - points[0]} height={points[3] - points[1]} />;
    } else if (shape.tool === 'circle') {
      const radius = Math.sqrt(Math.pow(points[2] - points[0], 2) + Math.pow(points[3] - points[1], 2)) / 2;
      return <Circle {...commonProps} x={(points[0] + points[2]) / 2} y={(points[1] + points[3]) / 2} radius={radius} />;
    } else if (shape.tool === 'arrow') {
      return <Arrow {...commonProps} points={[points[0], points[1], points[2], points[3]]} pointerLength={10} pointerWidth={10} />;
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
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden', background: '#e0e0e0' }}>
      {/* Konva Stage */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 50, pointerEvents: paintMode ? 'auto' : 'none' }}>
        <Stage
          ref={stageRef}
          width={scaledWidth}
          height={scaledHeight}
          scaleX={finalScale}
          scaleY={finalScale}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          style={{ cursor: paintMode ? 'crosshair' : 'default' }}
        >
          {/* 背景Layer */}
          <Layer listening={false}>
            {isImage && fileUrl && (
              <BackgroundImage src={fileUrl} onLoad={setBgSize} />
            )}
          </Layer>
          
          {/* 注釈Layer */}
          <Layer>
            {existingShapes.map(renderShape)}
            {localShapes.map(renderShape)}
            {currentShape && renderShape(currentShape)}
          </Layer>
        </Stage>
      </div>
      
      {/* プレースホルダー */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999', fontSize: '14px' }}>
        {fileUrl ? `File: ${mimeType || 'unknown'}` : 'No file loaded'}
      </div>
      
      {/* デバッグ */}
      {DEBUG_MODE && (
        <div style={{ position: 'absolute', top: 8, left: 8, background: 'rgba(0,0,0,0.8)', color: '#0f0', padding: '8px', fontSize: '11px', fontFamily: 'monospace', borderRadius: '4px', pointerEvents: 'none', zIndex: 100, lineHeight: '1.4' }}>
          <div><strong>ViewerCanvas Debug</strong></div>
          <div>lastEvent: {lastEvent}</div>
          <div>pointer: {pointerPos ? `${Math.round(pointerPos.x)}, ${Math.round(pointerPos.y)}` : 'null'}</div>
          <div>stageSize: {Math.round(scaledWidth)} x {Math.round(scaledHeight)}</div>
          <div>bgSize: {bgSize.width} x {bgSize.height}</div>
          <div>scale: {finalScale.toFixed(2)}</div>
          <div>paintMode: {paintMode ? 'ON' : 'OFF'}</div>
          <div>tool: {tool}</div>
          <div>isDrawing: {isDrawing ? 'YES' : 'NO'}</div>
          <div>existingShapes: {existingShapes.length}</div>
          <div>localShapes: {localShapes.length}</div>
          <div>currentShape: {currentShape ? `${currentShape.points.length / 2} pts` : 'null'}</div>
          <div style={{ color: lastSaveStatus === 'success' ? '#0f0' : lastSaveStatus === 'error' ? '#f00' : '#ff0' }}>
            saveStatus: {lastSaveStatus}
          </div>
          {lastError && <div style={{ color: '#f00' }}>error: {lastError}</div>}
        </div>
      )}
    </div>
  );
});

ViewerCanvas.displayName = 'ViewerCanvas';

export default ViewerCanvas;