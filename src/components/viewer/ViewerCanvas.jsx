import React, { useState, useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { Stage, Layer, Line, Rect, Circle, Arrow, Image as KonvaImage, Group } from 'react-konva';
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
  const contentGroupRef = useRef(null);
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
  const [imgPos, setImgPos] = useState(null);
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
  
  // PointerDown: 描画開始
  const handlePointerDown = (e) => {
    if (!paintMode) return;
    
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
        id: `shape_${Date.now()}`,
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
  
  // PointerMove: 描画中
  const handlePointerMove = (e) => {
    try {
      const stage = e.target.getStage();
      if (!stage) return;
      
      const imgCoords = pointerToImageCoords(stage);
      if (!imgCoords) return;
      
      setPointerPos(stage.getPointerPosition());
      setImgPos(imgCoords);
      
      if (!paintMode || !isDrawing || !currentShape) return;
      
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
  
  // PointerUp: 描画終了
  const handlePointerUp = async () => {
    if (!paintMode || !isDrawing || !currentShape) return;
    
    try {
      setLastEvent('up');
      setIsDrawing(false);
      
      // 正規化データを作成
      const normalizedShape = { ...currentShape };
      
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
        normalizedShape.nr = currentShape.radius / bgSize.width; // 半径も正規化
      } else if (tool === 'arrow' && currentShape.points) {
        const normalizedPoints = [];
        for (let i = 0; i < currentShape.points.length; i += 2) {
          const { nx, ny } = normalizeCoords(currentShape.points[i], currentShape.points[i + 1]);
          normalizedPoints.push(nx, ny);
        }
        normalizedShape.normalizedPoints = normalizedPoints;
      }
      
      normalizedShape.bgWidth = bgSize.width;
      normalizedShape.bgHeight = bgSize.height;
      
      // ローカルに追加
      setLocalShapes([...localShapes, normalizedShape]);
      setCurrentShape(null);
      
      // 親コンポーネントに保存を依頼
      if (onSaveShape) {
        setLastSaveStatus('saving');
        try {
          await onSaveShape(normalizedShape);
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
    const commonProps = {
      key: shape.id,
      stroke: shape.stroke,
      strokeWidth: shape.strokeWidth,
    };
    
    if (shape.tool === 'pen') {
      let points = shape.points || [];
      
      // 正規化座標がある場合は復元
      if (shape.normalizedPoints) {
        points = [];
        for (let i = 0; i < shape.normalizedPoints.length; i += 2) {
          const { x, y } = denormalizeCoords(shape.normalizedPoints[i], shape.normalizedPoints[i + 1]);
          points.push(x, y);
        }
      }
      
      return <Line {...commonProps} points={points} tension={0.5} lineCap="round" lineJoin="round" />;
    } else if (shape.tool === 'rect') {
      let x = shape.x || 0;
      let y = shape.y || 0;
      let width = shape.width || 0;
      let height = shape.height || 0;
      
      if (shape.nx !== undefined) {
        const p1 = denormalizeCoords(shape.nx, shape.ny);
        const p2 = denormalizeCoords(shape.nx + shape.nw, shape.ny + shape.nh);
        x = p1.x;
        y = p1.y;
        width = p2.x - p1.x;
        height = p2.y - p1.y;
      }
      
      return <Rect {...commonProps} x={x} y={y} width={width} height={height} />;
    } else if (shape.tool === 'circle') {
      let x = shape.x || 0;
      let y = shape.y || 0;
      let radius = shape.radius || 0;
      
      if (shape.nx !== undefined) {
        const center = denormalizeCoords(shape.nx, shape.ny);
        x = center.x;
        y = center.y;
        radius = shape.nr * bgSize.width;
      }
      
      return <Circle {...commonProps} x={x} y={y} radius={radius} />;
    } else if (shape.tool === 'arrow') {
      let points = shape.points || [];
      
      if (shape.normalizedPoints) {
        points = [];
        for (let i = 0; i < shape.normalizedPoints.length; i += 2) {
          const { x, y } = denormalizeCoords(shape.normalizedPoints[i], shape.normalizedPoints[i + 1]);
          points.push(x, y);
        }
      }
      
      return <Arrow {...commonProps} points={points} pointerLength={10} pointerWidth={10} />;
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
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        style={{ cursor: paintMode ? 'crosshair' : 'default' }}
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
            {existingShapes.map(renderShape)}
            {localShapes.map(renderShape)}
            {currentShape && renderShape(currentShape)}
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
          <div>existingShapes: {existingShapes.length}</div>
          <div>localShapes: {localShapes.length}</div>
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