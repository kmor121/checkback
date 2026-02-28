import React from 'react';
import { Line, Rect, Circle, Arrow, Group, Text } from 'react-konva';
import TextShapeRenderer from './TextShapeRenderer';

// Extracted from ViewerCanvas for file size reduction
export function renderShapeFactory({
  currentShape, selectedId, bgSize, denormalizeCoords,
  isSelectableShape, isEditableShape2, canEdit, isEditMode,
  setSelectedId, onStrokeColorChange, onStrokeWidthChange,
  shapeRefs, handleDragStart, handleDragMove, handleDragEnd,
  handleTransformStart, handleTransformEnd, handleTextDblClick,
  DEBUG_MODE,
}) {
  return function renderShape(shape, isExisting = false) {
    const isDrawingThisShape = currentShape && currentShape.id === shape.id;
    const isSelected = selectedId === shape.id;
    const canTransform = shape.tool === 'rect' || shape.tool === 'circle' || shape.tool === 'text' || shape.tool === 'arrow';
    const isSelectable = isSelectableShape(shape);
    const isEditable = isEditableShape2(shape);

    const commonProps = {
      name: 'paintOverlay',
      stroke: shape.stroke,
      strokeWidth: shape.strokeWidth,
      listening: isSelectable && !isDrawingThisShape,
      onPointerDown: (isSelectable && !isDrawingThisShape) ? (e) => {
        e.cancelBubble = true;
        setSelectedId(shape.id);
        if (onStrokeColorChange && shape.stroke) onStrokeColorChange(shape.stroke);
        if (onStrokeWidthChange && typeof shape.strokeWidth === 'number') onStrokeWidthChange(shape.strokeWidth);
      } : undefined,
      ref: (node) => { if (node) shapeRefs.current[shape.id] = node; },
      draggable: isEditable && !isDrawingThisShape,
      onDragStart: (isEditable && !isDrawingThisShape) ? (e) => handleDragStart(shape, e) : undefined,
      onDragMove: (isEditable && !isDrawingThisShape) ? (e) => handleDragMove(shape, e) : undefined,
      onDragEnd: (isEditable && !isDrawingThisShape) ? (e) => handleDragEnd(shape, e) : undefined,
      onTransformStart: (isEditable && canTransform && !isDrawingThisShape) ? (e) => handleTransformStart(shape, e) : undefined,
      onTransformEnd: (isEditable && canTransform && !isDrawingThisShape) ? (e) => handleTransformEnd(shape, e) : undefined,
    };

    if (shape.tool === 'pen') {
      const isDrawingShape = !shape.normalizedPoints && shape.points;
      let points = [];
      let groupX = 0, groupY = 0;
      if (isDrawingShape) {
        points = shape.points;
      } else if (shape.normalizedPoints) {
        for (let i = 0; i < shape.normalizedPoints.length; i += 2) {
          const { x, y } = denormalizeCoords(shape.normalizedPoints[i], shape.normalizedPoints[i + 1]);
          points.push(x, y);
        }
        groupX = shape.dragX ?? 0;
        groupY = shape.dragY ?? 0;
      }
      if (points.length < 4) return null;
      const xs = [], ys = [];
      for (let i = 0; i < points.length; i += 2) { xs.push(points[i]); ys.push(points[i + 1]); }
      const pad = Math.max(10, (shape.strokeWidth || 2) * 3);
      const bboxX = Math.min(...xs) - pad, bboxY = Math.min(...ys) - pad;
      const bboxW = Math.max(20, (Math.max(...xs) - Math.min(...xs)) + pad * 2);
      const bboxH = Math.max(20, (Math.max(...ys) - Math.min(...ys)) + pad * 2);

      return (
        <Group key={shape.id} name="paintOverlay" ref={(node) => { if (node) shapeRefs.current[shape.id] = node; }}
          x={groupX} y={groupY} listening={isSelectable && !isDrawingShape} draggable={isEditable && !isDrawingShape}
          onPointerDown={(isSelectable && !isDrawingShape) ? (e) => { e.cancelBubble = true; setSelectedId(shape.id); if (onStrokeColorChange && shape.stroke) onStrokeColorChange(shape.stroke); if (onStrokeWidthChange && typeof shape.strokeWidth === 'number') onStrokeWidthChange(shape.strokeWidth); } : undefined}
          onDragStart={(isEditable && !isDrawingShape) ? (e) => handleDragStart(shape, e) : undefined}
          onDragMove={(isEditable && !isDrawingShape) ? (e) => handleDragMove(shape, e) : undefined}
          onDragEnd={(isEditable && !isDrawingShape) ? (e) => handleDragEnd(shape, e) : undefined}>
          <Line stroke={shape.stroke} strokeWidth={shape.strokeWidth} points={points} tension={0.5} lineCap="round" lineJoin="round" fill={undefined} listening={false} />
          {!isDrawingShape && <Rect x={bboxX} y={bboxY} width={bboxW} height={bboxH} fill="rgba(0,0,0,0.01)" listening={isSelectable} />}
          {isSelected && !isDrawingShape && (<>
            <Rect x={bboxX} y={bboxY} width={bboxW} height={bboxH} stroke="#3b82f6" strokeWidth={1} dash={[4, 4]} listening={false} />
            <Rect x={bboxX + 2} y={bboxY + 2} width={28} height={14} fill="#3b82f6" cornerRadius={2} listening={false} />
            <Text x={bboxX + 6} y={bboxY + 4} text="ペン" fontSize={10} fill="white" listening={false} />
          </>)}
        </Group>
      );
    } else if (shape.tool === 'rect') {
      if (shape.nx !== undefined) {
        const p1 = denormalizeCoords(shape.nx, shape.ny);
        const p2 = denormalizeCoords(shape.nx + shape.nw, shape.ny + shape.nh);
        return [<Rect {...commonProps} key={shape.id} x={p1.x} y={p1.y} width={p2.x - p1.x} height={p2.y - p1.y} fill={undefined} hitStrokeWidth={Math.max(10, (shape.strokeWidth || 2) * 3)} />];
      }
      if (shape.x !== undefined && shape.width !== undefined) {
        return <Rect key={shape.id} {...commonProps} x={shape.x} y={shape.y} width={shape.width} height={shape.height} fill={undefined} hitStrokeWidth={Math.max(10, (shape.strokeWidth || 2) * 3)} />;
      }
      return null;
    } else if (shape.tool === 'circle') {
      if (shape.nx !== undefined) {
        const center = denormalizeCoords(shape.nx, shape.ny);
        return [<Circle {...commonProps} key={shape.id} x={center.x} y={center.y} radius={shape.nr * bgSize.width} fill={undefined} hitStrokeWidth={Math.max(10, (shape.strokeWidth || 2) * 3)} />];
      }
      if (shape.x !== undefined && shape.radius !== undefined) {
        return <Circle key={shape.id} {...commonProps} x={shape.x} y={shape.y} radius={shape.radius} fill={undefined} hitStrokeWidth={Math.max(10, (shape.strokeWidth || 2) * 3)} />;
      }
      return null;
    } else if (shape.tool === 'arrow') {
      const isDrawingShape = !shape.normalizedPoints && shape.points;
      let points = [];
      let groupX = 0, groupY = 0;
      if (isDrawingShape) { points = shape.points; }
      else if (shape.normalizedPoints) {
        for (let i = 0; i < shape.normalizedPoints.length; i += 2) {
          const { x, y } = denormalizeCoords(shape.normalizedPoints[i], shape.normalizedPoints[i + 1]);
          points.push(x, y);
        }
        groupX = shape.dragX ?? 0; groupY = shape.dragY ?? 0;
      }
      if (points.length < 4) return null;
      const xs = [], ys = [];
      for (let i = 0; i < points.length; i += 2) { xs.push(points[i]); ys.push(points[i + 1]); }
      const pad = Math.max(15, (shape.strokeWidth || 2) * 4);
      const bboxX = Math.min(...xs) - pad, bboxY = Math.min(...ys) - pad;
      const bboxW = Math.max(20, (Math.max(...xs) - Math.min(...xs)) + pad * 2);
      const bboxH = Math.max(20, (Math.max(...ys) - Math.min(...ys)) + pad * 2);
      return (
        <Group key={shape.id} name="paintOverlay" ref={(node) => { if (node) shapeRefs.current[shape.id] = node; }}
          x={groupX} y={groupY} listening={isSelectable && !isDrawingShape} draggable={isEditable && !isDrawingShape}
          onPointerDown={(isSelectable && !isDrawingShape) ? (e) => { e.cancelBubble = true; setSelectedId(shape.id); if (onStrokeColorChange && shape.stroke) onStrokeColorChange(shape.stroke); if (onStrokeWidthChange && typeof shape.strokeWidth === 'number') onStrokeWidthChange(shape.strokeWidth); } : undefined}
          onDragStart={(isEditable && !isDrawingShape) ? (e) => handleDragStart(shape, e) : undefined}
          onDragMove={(isEditable && !isDrawingShape) ? (e) => handleDragMove(shape, e) : undefined}
          onDragEnd={(isEditable && !isDrawingShape) ? (e) => handleDragEnd(shape, e) : undefined}>
          <Arrow stroke={shape.stroke} strokeWidth={shape.strokeWidth} points={points} pointerLength={10} pointerWidth={10} listening={false} />
          {!isDrawingShape && <Rect x={bboxX} y={bboxY} width={bboxW} height={bboxH} fill="rgba(0,0,0,0.01)" listening={isSelectable} />}
        </Group>
      );
    } else if (shape.tool === 'text') {
      let tx = 0, ty = 0;
      if (shape.nx !== undefined) { const pos = denormalizeCoords(shape.nx, shape.ny); tx = pos.x; ty = pos.y; } else if (shape.x !== undefined) { tx = shape.x; ty = shape.y; }
      return <TextShapeRenderer key={shape.id} shape={shape} x={tx} y={ty} isEditable={isEditable} canEdit={canEdit} isEditMode={isEditMode} bgSize={bgSize} DEBUG_MODE={DEBUG_MODE}
        shapeRefCb={(node) => { if (node) shapeRefs.current[shape.id] = node; }}
        onPointerDown={canEdit ? (e) => { if (!isEditable) return; e.cancelBubble = true; setSelectedId(shape.id); if (onStrokeColorChange && shape.stroke) onStrokeColorChange(shape.stroke); if (onStrokeWidthChange && typeof shape.strokeWidth === 'number') onStrokeWidthChange(shape.strokeWidth); } : undefined}
        onDragStart={isEditable ? (e) => handleDragStart(shape, e) : undefined} onDragMove={isEditable ? (e) => handleDragMove(shape, e) : undefined}
        onDragEnd={isEditable ? (e) => handleDragEnd(shape, e) : undefined} onTransformEnd={isEditable ? (e) => handleTransformEnd(shape, e) : undefined}
        onDblClick={canEdit ? () => handleTextDblClick(shape) : undefined} />;
    }
    return null;
  };
}