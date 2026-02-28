import React from 'react';
import { Group, Rect, Text } from 'react-konva';

// Text shape rendering extracted from ViewerCanvas for maintainability
export default function TextShapeRenderer({
  shape, x, y, isEditable, canEdit, isEditMode,
  onPointerDown, onDragStart, onDragMove, onDragEnd, onTransformEnd, onDblClick,
  shapeRefCb, bgSize, DEBUG_MODE,
}) {
  const fontSize = shape.fontSize || Math.max(12, (shape.strokeWidth || 2) * 6);
  const textContent = shape.text || '';
  const fontProps = { fontFamily: 'Arial, sans-serif', fontStyle: 'normal', fontSize, lineHeight: 1, letterSpacing: 0, padding: 0, wrap: 'none' };
  const padL = 4, padR = 4, padY = 3;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = `${fontProps.fontStyle} ${fontSize}px ${fontProps.fontFamily}`;
  const metrics = ctx.measureText(textContent || 'M');
  const ascent = metrics.actualBoundingBoxAscent || fontSize * 0.8;
  const descent = metrics.actualBoundingBoxDescent || fontSize * 0.2;
  const glyphH = ascent + descent;
  const tw = metrics.width;
  const hasManualBoxW = shape.boxResized === true && shape.boxW != null;
  const hasManualBoxH = shape.boxResized === true && shape.boxH != null;
  const autoBoxW = tw + padL + padR;
  const autoBoxH = glyphH + padY * 2;
  const boxW = hasManualBoxW ? shape.boxW * bgSize.width : autoBoxW;
  const boxH = hasManualBoxH ? shape.boxH * bgSize.height : autoBoxH;
  const textX = padL;
  const textY = hasManualBoxH ? padY + (boxH - padY * 2 - glyphH) / 2 : padY;

  return (
    <Group
      key={shape.id} name="paintOverlay" x={x} y={y}
      ref={shapeRefCb} draggable={isEditable}
      onPointerDown={onPointerDown} onDragStart={onDragStart} onDragMove={onDragMove}
      onDragEnd={onDragEnd} onTransformEnd={onTransformEnd} onDblClick={onDblClick}
    >
      <Rect width={boxW} height={boxH} fill="transparent" listening={true} />
      <Text x={textX} y={textY} text={textContent} {...fontProps} fill={shape.stroke} listening={false} />
    </Group>
  );
}