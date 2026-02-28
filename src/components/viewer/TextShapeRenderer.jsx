import React, { useMemo } from 'react';
import { Group, Rect, Text } from 'react-konva';

// ★★★ FIX: measureText をuseMemoでキャッシュ（毎レンダーのcanvas生成を防止）★★★
export default function TextShapeRenderer({
  shape, x, y, isEditable, canEdit, isEditMode,
  onPointerDown, onDragStart, onDragMove, onDragEnd, onTransformEnd, onDblClick,
  shapeRefCb, bgSize, DEBUG_MODE,
}) {
  const fontSize = shape.fontSize || Math.max(12, (shape.strokeWidth || 2) * 6);
  const textContent = shape.text || '';
  const fontFamily = 'Arial, sans-serif';
  const padL = 4, padR = 4, padY = 3;

  const { tw, glyphH } = useMemo(() => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = `normal ${fontSize}px ${fontFamily}`;
    const metrics = ctx.measureText(textContent || 'M');
    const ascent = metrics.actualBoundingBoxAscent || fontSize * 0.8;
    const descent = metrics.actualBoundingBoxDescent || fontSize * 0.2;
    return { tw: metrics.width, glyphH: ascent + descent };
  }, [textContent, fontSize]);

  const hasManualBoxW = shape.boxResized === true && shape.boxW != null;
  const hasManualBoxH = shape.boxResized === true && shape.boxH != null;
  const boxW = hasManualBoxW ? shape.boxW * bgSize.width : tw + padL + padR;
  const boxH = hasManualBoxH ? shape.boxH * bgSize.height : glyphH + padY * 2;
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
      <Text x={textX} y={textY} text={textContent}
        fontFamily={fontFamily} fontStyle="normal" fontSize={fontSize}
        lineHeight={1} letterSpacing={0} padding={0} wrap="none"
        fill={shape.stroke} listening={false} />
    </Group>
  );
}