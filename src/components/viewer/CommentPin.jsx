import React from 'react';
import { Circle, Text, Group } from 'react-konva';

export default function CommentPin({
  comment,
  bgWidth,
  bgHeight,
  isActive,
  onClick,
  seqNo,
}) {
  // 正規化座標からピクセル座標へ
  const x = (comment.anchor_nx || 0) * bgWidth;
  const y = (comment.anchor_ny || 0) * bgHeight;
  
  // アンカーが設定されていない場合は表示しない
  if (comment.anchor_nx === undefined || comment.anchor_ny === undefined) {
    return null;
  }
  
  const pinRadius = 20;
  const fillColor = isActive ? '#2563eb' : '#ef4444';
  const strokeColor = '#ffffff';
  
  return (
    <Group
      x={x}
      y={y}
      onClick={onClick}
      onTap={onClick}
      listening={true}
    >
      {/* 外側の円 */}
      <Circle
        radius={pinRadius}
        fill={fillColor}
        stroke={strokeColor}
        strokeWidth={3}
        shadowColor="rgba(0,0,0,0.5)"
        shadowBlur={8}
        shadowOffsetY={2}
      />
      
      {/* 番号テキスト */}
      <Text
        text={String(seqNo || comment.seq_no || '?')}
        fontSize={14}
        fontStyle="bold"
        fill="#ffffff"
        width={pinRadius * 2}
        height={pinRadius * 2}
        offsetX={pinRadius}
        offsetY={pinRadius}
        align="center"
        verticalAlign="middle"
      />
    </Group>
  );
}