import React, { useState, useRef, useEffect } from 'react';
import { Stage, Layer, Line, Rect, Circle, Arrow } from 'react-konva';

export default function PaintCanvas({ 
  width, 
  height, 
  onShapesChange, 
  existingShapes = [],
  isPainting = false,
  tool = 'pen',
  onToolChange
}) {
  const [shapes, setShapes] = useState(existingShapes);
  const [currentShape, setCurrentShape] = useState(null);
  const [history, setHistory] = useState([existingShapes]);
  const [historyStep, setHistoryStep] = useState(0);
  const isDrawing = useRef(false);
  const containerRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: width || 0, height: height || 0 });

  // containerから実サイズを取得
  useEffect(() => {
    if (!containerRef.current) return;
    
    const updateSize = () => {
      const rect = containerRef.current.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setDimensions({ width: rect.width, height: rect.height });
      }
    };
    
    updateSize();
    
    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(containerRef.current);
    
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    setShapes(existingShapes);
    setHistory([existingShapes]);
    setHistoryStep(0);
  }, [existingShapes]);

  useEffect(() => {
    if (onShapesChange) {
      onShapesChange(shapes);
    }
  }, [shapes, onShapesChange]);

  const handleMouseDown = (e) => {
    if (!isPainting) return;
    isDrawing.current = true;
    const pos = e.target.getStage().getPointerPosition();
    const actualWidth = dimensions.width || width;
    const actualHeight = dimensions.height || height;
    const normalizedX = pos.x / actualWidth;
    const normalizedY = pos.y / actualHeight;

    if (tool === 'pen') {
      setCurrentShape({
        type: 'pen',
        points: [normalizedX, normalizedY],
        stroke: '#ff0000',
        strokeWidth: 2 / (dimensions.width || width),
      });
    } else if (tool === 'rect') {
      setCurrentShape({
        type: 'rect',
        x: normalizedX,
        y: normalizedY,
        width: 0,
        height: 0,
        stroke: '#ff0000',
        strokeWidth: 2 / (dimensions.width || width),
      });
    } else if (tool === 'circle') {
      setCurrentShape({
        type: 'circle',
        x: normalizedX,
        y: normalizedY,
        radius: 0,
        stroke: '#ff0000',
        strokeWidth: 2 / (dimensions.width || width),
      });
    } else if (tool === 'arrow') {
      setCurrentShape({
        type: 'arrow',
        points: [normalizedX, normalizedY, normalizedX, normalizedY],
        stroke: '#ff0000',
        strokeWidth: 2 / (dimensions.width || width),
      });
    }
  };

  const handleMouseMove = (e) => {
    if (!isDrawing.current || !currentShape) return;
    const pos = e.target.getStage().getPointerPosition();
    const actualWidth = dimensions.width || width;
    const actualHeight = dimensions.height || height;
    const normalizedX = pos.x / actualWidth;
    const normalizedY = pos.y / actualHeight;

    if (tool === 'pen') {
      setCurrentShape({
        ...currentShape,
        points: [...currentShape.points, normalizedX, normalizedY],
      });
    } else if (tool === 'rect') {
      setCurrentShape({
        ...currentShape,
        width: normalizedX - currentShape.x,
        height: normalizedY - currentShape.y,
      });
    } else if (tool === 'circle') {
      const radius = Math.sqrt(
        Math.pow(normalizedX - currentShape.x, 2) + Math.pow(normalizedY - currentShape.y, 2)
      );
      setCurrentShape({
        ...currentShape,
        radius,
      });
    } else if (tool === 'arrow') {
      setCurrentShape({
        ...currentShape,
        points: [currentShape.points[0], currentShape.points[1], normalizedX, normalizedY],
      });
    }
  };

  const handleMouseUp = () => {
    if (!isDrawing.current || !currentShape) return;
    isDrawing.current = false;
    const newShapes = [...shapes, currentShape];
    setShapes(newShapes);
    setCurrentShape(null);
    
    const newHistory = history.slice(0, historyStep + 1);
    newHistory.push(newShapes);
    setHistory(newHistory);
    setHistoryStep(newHistory.length - 1);
  };

  // ツールバー用の関数をエクスポート
  React.useImperativeHandle(onToolChange, () => ({
    undo: () => {
      if (historyStep > 0) {
        setHistoryStep(historyStep - 1);
        setShapes(history[historyStep - 1]);
      }
    },
    redo: () => {
      if (historyStep < history.length - 1) {
        setHistoryStep(historyStep + 1);
        setShapes(history[historyStep + 1]);
      }
    },
    clear: () => {
      setShapes([]);
      setHistory([[...existingShapes]]);
      setHistoryStep(0);
    },
    canUndo: historyStep > 0,
    canRedo: historyStep < history.length - 1,
  }));

  const denormalizeValue = (normalizedValue, dimension) => normalizedValue * dimension;
  
  const actualWidth = dimensions.width || width;
  const actualHeight = dimensions.height || height;

  // サイズが確定していない場合はローディング
  if (actualWidth === 0 || actualHeight === 0) {
    return (
      <div 
        ref={containerRef}
        style={{ 
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'transparent',
          pointerEvents: isPainting ? 'auto' : 'none'
        }}
      >
        <div className="text-sm text-gray-500">読み込み中...</div>
      </div>
    );
  }

  return (
    <div 
      ref={containerRef}
      style={{ 
        position: 'absolute',
        inset: 0,
        zIndex: 20,
        pointerEvents: isPainting ? 'auto' : 'none'
      }}
    >
      <Stage
        width={actualWidth}
        height={actualHeight}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        style={{ cursor: isPainting ? 'crosshair' : 'default' }}
      >
        <Layer>
          {shapes.map((shape, i) => {
            if (shape.type === 'pen') {
              return (
                <Line
                  key={i}
                  points={shape.points.map((p, idx) => 
                    denormalizeValue(p, idx % 2 === 0 ? actualWidth : actualHeight)
                  )}
                  stroke={shape.stroke}
                  strokeWidth={denormalizeValue(shape.strokeWidth, actualWidth)}
                  tension={0.5}
                  lineCap="round"
                  opacity={shape.opacity || 1}
                />
              );
            } else if (shape.type === 'rect') {
              return (
                <Rect
                  key={i}
                  x={denormalizeValue(shape.x, actualWidth)}
                  y={denormalizeValue(shape.y, actualHeight)}
                  width={denormalizeValue(shape.width, actualWidth)}
                  height={denormalizeValue(shape.height, actualHeight)}
                  stroke={shape.stroke}
                  strokeWidth={denormalizeValue(shape.strokeWidth, actualWidth)}
                  opacity={shape.opacity || 1}
                />
              );
            } else if (shape.type === 'circle') {
              return (
                <Circle
                  key={i}
                  x={denormalizeValue(shape.x, actualWidth)}
                  y={denormalizeValue(shape.y, actualHeight)}
                  radius={denormalizeValue(shape.radius, Math.min(actualWidth, actualHeight))}
                  stroke={shape.stroke}
                  strokeWidth={denormalizeValue(shape.strokeWidth, actualWidth)}
                  opacity={shape.opacity || 1}
                />
              );
            } else if (shape.type === 'arrow') {
              return (
                <Arrow
                  key={i}
                  points={shape.points.map((p, idx) => 
                    denormalizeValue(p, idx % 2 === 0 ? actualWidth : actualHeight)
                  )}
                  stroke={shape.stroke}
                  strokeWidth={denormalizeValue(shape.strokeWidth, actualWidth)}
                  opacity={shape.opacity || 1}
                  pointerLength={10}
                  pointerWidth={10}
                />
              );
            }
            return null;
          })}
          {currentShape && (
            <>
              {currentShape.type === 'pen' && (
                <Line
                  points={currentShape.points.map((p, idx) => 
                    denormalizeValue(p, idx % 2 === 0 ? actualWidth : actualHeight)
                  )}
                  stroke={currentShape.stroke}
                  strokeWidth={denormalizeValue(currentShape.strokeWidth, actualWidth)}
                  tension={0.5}
                  lineCap="round"
                />
              )}
              {currentShape.type === 'rect' && (
                <Rect
                  x={denormalizeValue(currentShape.x, actualWidth)}
                  y={denormalizeValue(currentShape.y, actualHeight)}
                  width={denormalizeValue(currentShape.width, actualWidth)}
                  height={denormalizeValue(currentShape.height, actualHeight)}
                  stroke={currentShape.stroke}
                  strokeWidth={denormalizeValue(currentShape.strokeWidth, actualWidth)}
                />
              )}
              {currentShape.type === 'circle' && (
                <Circle
                  x={denormalizeValue(currentShape.x, actualWidth)}
                  y={denormalizeValue(currentShape.y, actualHeight)}
                  radius={denormalizeValue(currentShape.radius, Math.min(actualWidth, actualHeight))}
                  stroke={currentShape.stroke}
                  strokeWidth={denormalizeValue(currentShape.strokeWidth, actualWidth)}
                />
              )}
              {currentShape.type === 'arrow' && (
                <Arrow
                  points={currentShape.points.map((p, idx) => 
                    denormalizeValue(p, idx % 2 === 0 ? actualWidth : actualHeight)
                  )}
                  stroke={currentShape.stroke}
                  strokeWidth={denormalizeValue(currentShape.strokeWidth, actualWidth)}
                  pointerLength={10}
                  pointerWidth={10}
                />
              )}
            </>
          )}
        </Layer>
      </Stage>
    </div>
  );
}