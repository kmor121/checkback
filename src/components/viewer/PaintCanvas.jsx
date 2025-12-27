import React, { useState, useRef, useEffect } from 'react';
import { Stage, Layer, Line, Rect, Circle, Arrow } from 'react-konva';
import { Button } from '@/components/ui/button';
import { Pencil, Square, CircleIcon, ArrowRight, Undo, Redo, Trash2 } from 'lucide-react';

export default function PaintCanvas({ 
  width, 
  height, 
  onShapesChange, 
  existingShapes = [],
  isPainting = false 
}) {
  const [tool, setTool] = useState('pen');
  const [shapes, setShapes] = useState(existingShapes);
  const [currentShape, setCurrentShape] = useState(null);
  const [history, setHistory] = useState([existingShapes]);
  const [historyStep, setHistoryStep] = useState(0);
  const isDrawing = useRef(false);

  useEffect(() => {
    setShapes(existingShapes);
    setHistory([existingShapes]);
    setHistoryStep(0);
  }, [existingShapes]);

  useEffect(() => {
    if (onShapesChange) {
      onShapesChange(shapes);
    }
  }, [shapes]);

  const handleMouseDown = (e) => {
    if (!isPainting) return;
    isDrawing.current = true;
    const pos = e.target.getStage().getPointerPosition();
    const normalizedX = pos.x / width;
    const normalizedY = pos.y / height;

    if (tool === 'pen') {
      setCurrentShape({
        type: 'pen',
        points: [normalizedX, normalizedY],
        stroke: '#ff0000',
        strokeWidth: 2 / width,
      });
    } else if (tool === 'rect') {
      setCurrentShape({
        type: 'rect',
        x: normalizedX,
        y: normalizedY,
        width: 0,
        height: 0,
        stroke: '#ff0000',
        strokeWidth: 2 / width,
      });
    } else if (tool === 'circle') {
      setCurrentShape({
        type: 'circle',
        x: normalizedX,
        y: normalizedY,
        radius: 0,
        stroke: '#ff0000',
        strokeWidth: 2 / width,
      });
    } else if (tool === 'arrow') {
      setCurrentShape({
        type: 'arrow',
        points: [normalizedX, normalizedY, normalizedX, normalizedY],
        stroke: '#ff0000',
        strokeWidth: 2 / width,
      });
    }
  };

  const handleMouseMove = (e) => {
    if (!isDrawing.current || !currentShape) return;
    const pos = e.target.getStage().getPointerPosition();
    const normalizedX = pos.x / width;
    const normalizedY = pos.y / height;

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

  const handleUndo = () => {
    if (historyStep > 0) {
      setHistoryStep(historyStep - 1);
      setShapes(history[historyStep - 1]);
    }
  };

  const handleRedo = () => {
    if (historyStep < history.length - 1) {
      setHistoryStep(historyStep + 1);
      setShapes(history[historyStep + 1]);
    }
  };

  const handleClear = () => {
    setShapes([]);
    setHistory([[...existingShapes]]);
    setHistoryStep(0);
  };

  const denormalizeValue = (normalizedValue, dimension) => normalizedValue * dimension;

  return (
    <div className="relative">
      {isPainting && (
        <div className="absolute top-2 left-2 z-10 bg-white rounded-lg shadow-lg p-2 flex gap-2">
          <Button
            variant={tool === 'pen' ? 'default' : 'outline'}
            size="icon"
            onClick={() => setTool('pen')}
          >
            <Pencil className="w-4 h-4" />
          </Button>
          <Button
            variant={tool === 'rect' ? 'default' : 'outline'}
            size="icon"
            onClick={() => setTool('rect')}
          >
            <Square className="w-4 h-4" />
          </Button>
          <Button
            variant={tool === 'circle' ? 'default' : 'outline'}
            size="icon"
            onClick={() => setTool('circle')}
          >
            <CircleIcon className="w-4 h-4" />
          </Button>
          <Button
            variant={tool === 'arrow' ? 'default' : 'outline'}
            size="icon"
            onClick={() => setTool('arrow')}
          >
            <ArrowRight className="w-4 h-4" />
          </Button>
          <div className="w-px bg-gray-300" />
          <Button
            variant="outline"
            size="icon"
            onClick={handleUndo}
            disabled={historyStep <= 0}
          >
            <Undo className="w-4 h-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={handleRedo}
            disabled={historyStep >= history.length - 1}
          >
            <Redo className="w-4 h-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={handleClear}
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      )}
      <Stage
        width={width}
        height={height}
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
                    denormalizeValue(p, idx % 2 === 0 ? width : height)
                  )}
                  stroke={shape.stroke}
                  strokeWidth={denormalizeValue(shape.strokeWidth, width)}
                  tension={0.5}
                  lineCap="round"
                  opacity={shape.opacity || 1}
                />
              );
            } else if (shape.type === 'rect') {
              return (
                <Rect
                  key={i}
                  x={denormalizeValue(shape.x, width)}
                  y={denormalizeValue(shape.y, height)}
                  width={denormalizeValue(shape.width, width)}
                  height={denormalizeValue(shape.height, height)}
                  stroke={shape.stroke}
                  strokeWidth={denormalizeValue(shape.strokeWidth, width)}
                  opacity={shape.opacity || 1}
                />
              );
            } else if (shape.type === 'circle') {
              return (
                <Circle
                  key={i}
                  x={denormalizeValue(shape.x, width)}
                  y={denormalizeValue(shape.y, height)}
                  radius={denormalizeValue(shape.radius, Math.min(width, height))}
                  stroke={shape.stroke}
                  strokeWidth={denormalizeValue(shape.strokeWidth, width)}
                  opacity={shape.opacity || 1}
                />
              );
            } else if (shape.type === 'arrow') {
              return (
                <Arrow
                  key={i}
                  points={shape.points.map((p, idx) => 
                    denormalizeValue(p, idx % 2 === 0 ? width : height)
                  )}
                  stroke={shape.stroke}
                  strokeWidth={denormalizeValue(shape.strokeWidth, width)}
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
                    denormalizeValue(p, idx % 2 === 0 ? width : height)
                  )}
                  stroke={currentShape.stroke}
                  strokeWidth={denormalizeValue(currentShape.strokeWidth, width)}
                  tension={0.5}
                  lineCap="round"
                />
              )}
              {currentShape.type === 'rect' && (
                <Rect
                  x={denormalizeValue(currentShape.x, width)}
                  y={denormalizeValue(currentShape.y, height)}
                  width={denormalizeValue(currentShape.width, width)}
                  height={denormalizeValue(currentShape.height, height)}
                  stroke={currentShape.stroke}
                  strokeWidth={denormalizeValue(currentShape.strokeWidth, width)}
                />
              )}
              {currentShape.type === 'circle' && (
                <Circle
                  x={denormalizeValue(currentShape.x, width)}
                  y={denormalizeValue(currentShape.y, height)}
                  radius={denormalizeValue(currentShape.radius, Math.min(width, height))}
                  stroke={currentShape.stroke}
                  strokeWidth={denormalizeValue(currentShape.strokeWidth, width)}
                />
              )}
              {currentShape.type === 'arrow' && (
                <Arrow
                  points={currentShape.points.map((p, idx) => 
                    denormalizeValue(p, idx % 2 === 0 ? width : height)
                  )}
                  stroke={currentShape.stroke}
                  strokeWidth={denormalizeValue(currentShape.strokeWidth, width)}
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