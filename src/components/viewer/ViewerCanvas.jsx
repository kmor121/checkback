import React, { useState, useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { Stage, Layer, Line } from 'react-konva';

const DEBUG_MODE = import.meta.env.VITE_DEBUG === 'true';

const ViewerCanvas = forwardRef(({
  fileUrl,
  mimeType,
  pageNumber = 1,
  shapes = [],
  onShapesChange,
  paintMode = false,
  tool = 'pen',
  strokeColor = '#ff0000',
  strokeWidth = 2,
  zoom = 100,
}, ref) => {
  const containerRef = useRef(null);
  const stageRef = useRef(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [error, setError] = useState(null);
  
  // 描画状態
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentLine, setCurrentLine] = useState(null);
  const [lines, setLines] = useState([]);
  
  // デバッグ用
  const [lastEvent, setLastEvent] = useState('none');
  const [pointerPos, setPointerPos] = useState(null);
  
  // エラーキャッチ
  useEffect(() => {
    const handleError = (e) => {
      setError(`Component Error: ${e.message}`);
      console.error('ViewerCanvas Error:', e);
    };
    
    window.addEventListener('error', handleError);
    return () => window.removeEventListener('error', handleError);
  }, []);
  
  // ResizeObserver でコンテナサイズを監視
  useEffect(() => {
    if (!containerRef.current) return;
    
    try {
      const resizeObserver = new ResizeObserver(entries => {
        const entry = entries[0];
        if (entry) {
          const width = entry.contentRect.width;
          const height = entry.contentRect.height;
          
          // サイズが有効な場合のみ更新
          if (width > 0 && height > 0) {
            setContainerSize({ width, height });
          }
        }
      });
      
      resizeObserver.observe(containerRef.current);
      
      // 初期サイズを即座に取得
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
      
      const newLine = {
        id: `line_${Date.now()}`,
        points: [pos.x, pos.y],
        stroke: strokeColor,
        strokeWidth: strokeWidth,
      };
      
      setCurrentLine(newLine);
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
      
      if (!paintMode || !isDrawing || !currentLine) return;
      
      setLastEvent('move');
      
      const newLine = {
        ...currentLine,
        points: [...currentLine.points, pos.x, pos.y],
      };
      
      setCurrentLine(newLine);
    } catch (err) {
      console.error('PointerMove Error:', err);
    }
  };
  
  // PointerUp: 描画終了
  const handlePointerUp = () => {
    if (!paintMode || !isDrawing || !currentLine) return;
    
    try {
      setLastEvent('up');
      setIsDrawing(false);
      
      // 現在の線を保存
      setLines([...lines, currentLine]);
      setCurrentLine(null);
      
      // 親コンポーネントに通知
      if (onShapesChange) {
        onShapesChange([...lines, currentLine]);
      }
    } catch (err) {
      console.error('PointerUp Error:', err);
      setError(`PointerUp Error: ${err.message}`);
    }
  };
  
  // Undo/Redo用のメソッドを公開
  useImperativeHandle(ref, () => ({
    undo: () => {
      if (lines.length > 0) {
        const newLines = lines.slice(0, -1);
        setLines(newLines);
        if (onShapesChange) onShapesChange(newLines);
      }
    },
    redo: () => console.log('redo (not implemented)'),
    clear: () => {
      setLines([]);
      setCurrentLine(null);
      if (onShapesChange) onShapesChange([]);
    },
    canUndo: lines.length > 0,
    canRedo: false,
  }));
  
  // エラー表示
  if (error) {
    return (
      <div style={{ 
        width: '100%', 
        height: '100%', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        background: '#fee',
        color: '#c00',
        padding: '20px',
        fontFamily: 'monospace',
        fontSize: '14px'
      }}>
        <div>
          <strong>ViewerCanvas Error:</strong><br/>
          {error}
        </div>
      </div>
    );
  }
  
  // コンテナサイズが確定していない場合
  if (containerSize.width === 0 || containerSize.height === 0) {
    return (
      <div 
        ref={containerRef}
        style={{ 
          width: '100%', 
          height: '100%', 
          position: 'relative',
          overflow: 'hidden',
          background: '#f0f0f0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div style={{ color: '#666' }}>Loading canvas...</div>
      </div>
    );
  }
  
  return (
    <div 
      ref={containerRef}
      style={{ 
        width: '100%', 
        height: '100%', 
        position: 'relative',
        overflow: 'hidden',
        background: '#e0e0e0',
      }}
    >
      {/* Konva Stage - 固定サイズ、scale=1 */}
      <div style={{
        position: 'absolute',
        inset: 0,
        zIndex: 50,
        pointerEvents: paintMode ? 'auto' : 'none',
      }}>
        <Stage
          ref={stageRef}
          width={containerSize.width}
          height={containerSize.height}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          style={{ cursor: paintMode ? 'crosshair' : 'default' }}
        >
          <Layer>
            {/* 既存の線 */}
            {lines.map((line) => (
              <Line
                key={line.id}
                points={line.points}
                stroke={line.stroke}
                strokeWidth={line.strokeWidth}
                tension={0.5}
                lineCap="round"
                lineJoin="round"
              />
            ))}
            
            {/* 現在描画中の線 */}
            {currentLine && (
              <Line
                points={currentLine.points}
                stroke={currentLine.stroke}
                strokeWidth={currentLine.strokeWidth}
                tension={0.5}
                lineCap="round"
                lineJoin="round"
              />
            )}
          </Layer>
        </Stage>
      </div>
      
      {/* プレースホルダー背景 */}
      <div style={{
        position: 'absolute',
        inset: 0,
        zIndex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#999',
        fontSize: '14px',
      }}>
        {fileUrl ? `File: ${mimeType || 'unknown'}` : 'No file loaded'}
      </div>
      
      {/* デバッグオーバーレイ */}
      {DEBUG_MODE && (
        <div style={{
          position: 'absolute',
          top: 8,
          left: 8,
          background: 'rgba(0,0,0,0.8)',
          color: '#0f0',
          padding: '8px',
          fontSize: '11px',
          fontFamily: 'monospace',
          borderRadius: '4px',
          pointerEvents: 'none',
          zIndex: 100,
          lineHeight: '1.4',
        }}>
          <div><strong>ViewerCanvas Debug</strong></div>
          <div>lastEvent: {lastEvent}</div>
          <div>pointer: {pointerPos ? `${Math.round(pointerPos.x)}, ${Math.round(pointerPos.y)}` : 'null'}</div>
          <div>stageSize: {containerSize.width} x {containerSize.height}</div>
          <div>paintMode: {paintMode ? 'ON' : 'OFF'}</div>
          <div>tool: {tool}</div>
          <div>isDrawing: {isDrawing ? 'YES' : 'NO'}</div>
          <div>linesCount: {lines.length}</div>
          <div>currentLine: {currentLine ? `${currentLine.points.length / 2} pts` : 'null'}</div>
        </div>
      )}
    </div>
  );
});

ViewerCanvas.displayName = 'ViewerCanvas';

export default ViewerCanvas;