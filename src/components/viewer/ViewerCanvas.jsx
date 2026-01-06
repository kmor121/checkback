import React, { useState, useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { Stage, Layer, Line, Rect, Circle, Arrow, Image as KonvaImage } from 'react-konva';
import useImage from 'use-image';
import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

const DEBUG_MODE = import.meta.env.VITE_DEBUG === 'true';

// 背景画像コンポーネント
function BackgroundImage({ src, width, height }) {
  const [image] = useImage(src);
  return image ? <KonvaImage image={image} width={width} height={height} listening={false} /> : null;
}

// PDF背景コンポーネント
function BackgroundPDF({ pdfUrl, pageNumber, width, height, onLoad }) {
  const [pdfImage, setPdfImage] = useState(null);
  
  useEffect(() => {
    if (!pdfUrl) return;
    
    let cancelled = false;
    
    const loadPDF = async () => {
      try {
        const pdf = await pdfjsLib.getDocument(pdfUrl).promise;
        if (cancelled) return;
        
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;
        
        const viewport = page.getViewport({ scale: 2 });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        
        await page.render({ canvasContext: context, viewport }).promise;
        if (cancelled) return;
        
        const dataUrl = canvas.toDataURL();
        const img = new window.Image();
        img.onload = () => {
          if (!cancelled) {
            setPdfImage(img);
            if (onLoad) onLoad({ width: viewport.width, height: viewport.height });
          }
        };
        img.src = dataUrl;
      } catch (error) {
        console.error('PDF load error:', error);
      }
    };
    
    loadPDF();
    
    return () => {
      cancelled = true;
    };
  }, [pdfUrl, pageNumber, onLoad]);
  
  return pdfImage ? <KonvaImage image={pdfImage} width={width} height={height} listening={false} /> : null;
}

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
  const [containerSize, setContainerSize] = useState({ width: 800, height: 600 });
  const [contentSize, setContentSize] = useState({ width: 800, height: 600 });
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentShape, setCurrentShape] = useState(null);
  const [pointerPos, setPointerPos] = useState({ x: 0, y: 0 });
  const [history, setHistory] = useState([]);
  const [historyStep, setHistoryStep] = useState(-1);
  
  const isPDF = mimeType === 'application/pdf';
  const isImage = mimeType?.startsWith('image/');
  
  // ResizeObserver
  useEffect(() => {
    if (!containerRef.current) return;
    
    const resizeObserver = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry) {
        setContainerSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    
    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, []);
  
  // スケール計算
  const baseScale = Math.min(
    containerSize.width / contentSize.width,
    containerSize.height / contentSize.height
  ) || 1;
  
  const userScale = zoom / 100;
  const finalScale = baseScale * userScale;
  
  const scaledWidth = contentSize.width * finalScale;
  const scaledHeight = contentSize.height * finalScale;
  
  // 描画開始
  const handlePointerDown = (e) => {
    if (!paintMode) return;
    
    const stage = e.target.getStage();
    const pos = stage.getPointerPosition();
    const relativePos = {
      x: pos.x / finalScale,
      y: pos.y / finalScale,
    };
    
    setIsDrawing(true);
    setPointerPos(relativePos);
    
    const newShape = {
      id: `shape_${Date.now()}`,
      tool,
      points: tool === 'pen' ? [relativePos.x, relativePos.y] : undefined,
      x: relativePos.x,
      y: relativePos.y,
      width: 0,
      height: 0,
      stroke: strokeColor,
      strokeWidth: strokeWidth / finalScale,
    };
    
    setCurrentShape(newShape);
  };
  
  // 描画中
  const handlePointerMove = (e) => {
    if (!paintMode) {
      const stage = e.target.getStage();
      const pos = stage.getPointerPosition();
      if (pos) {
        setPointerPos({
          x: Math.round(pos.x),
          y: Math.round(pos.y),
        });
      }
      return;
    }
    
    if (!isDrawing || !currentShape) return;
    
    const stage = e.target.getStage();
    const pos = stage.getPointerPosition();
    const relativePos = {
      x: pos.x / finalScale,
      y: pos.y / finalScale,
    };
    
    setPointerPos(relativePos);
    
    if (tool === 'pen') {
      setCurrentShape({
        ...currentShape,
        points: [...currentShape.points, relativePos.x, relativePos.y],
      });
    } else {
      const width = relativePos.x - currentShape.x;
      const height = relativePos.y - currentShape.y;
      setCurrentShape({
        ...currentShape,
        width,
        height,
      });
    }
  };
  
  // 描画終了
  const handlePointerUp = () => {
    if (!isDrawing || !currentShape) return;
    
    setIsDrawing(false);
    
    const newShapes = [...shapes, currentShape];
    if (onShapesChange) onShapesChange(newShapes);
    
    // 履歴に追加
    const newHistory = history.slice(0, historyStep + 1);
    newHistory.push(newShapes);
    setHistory(newHistory);
    setHistoryStep(newHistory.length - 1);
    
    setCurrentShape(null);
  };
  
  // Undo/Redo
  useImperativeHandle(ref, () => ({
    undo: () => {
      if (historyStep > 0) {
        const newStep = historyStep - 1;
        setHistoryStep(newStep);
        if (onShapesChange) onShapesChange(history[newStep] || []);
      }
    },
    redo: () => {
      if (historyStep < history.length - 1) {
        const newStep = historyStep + 1;
        setHistoryStep(newStep);
        if (onShapesChange) onShapesChange(history[newStep]);
      }
    },
    clear: () => {
      if (onShapesChange) onShapesChange([]);
      const newHistory = [...history, []];
      setHistory(newHistory);
      setHistoryStep(newHistory.length - 1);
    },
    canUndo: historyStep > 0,
    canRedo: historyStep < history.length - 1,
  }));
  
  // Shape描画
  const renderShape = (shape) => {
    const commonProps = {
      key: shape.id,
      stroke: shape.stroke,
      strokeWidth: shape.strokeWidth,
    };
    
    if (shape.tool === 'pen') {
      return <Line {...commonProps} points={shape.points} tension={0.5} lineCap="round" lineJoin="round" />;
    } else if (shape.tool === 'rect') {
      return <Rect {...commonProps} x={shape.x} y={shape.y} width={shape.width} height={shape.height} />;
    } else if (shape.tool === 'circle') {
      const radius = Math.sqrt(Math.pow(shape.width, 2) + Math.pow(shape.height, 2)) / 2;
      return <Circle {...commonProps} x={shape.x + shape.width / 2} y={shape.y + shape.height / 2} radius={radius} />;
    } else if (shape.tool === 'arrow') {
      return <Arrow {...commonProps} points={[shape.x, shape.y, shape.x + shape.width, shape.y + shape.height]} pointerLength={10} pointerWidth={10} />;
    }
    return null;
  };
  
  return (
    <div 
      ref={containerRef}
      style={{ 
        width: '100%', 
        height: '100%', 
        position: 'relative',
        overflow: 'hidden',
        cursor: paintMode ? 'crosshair' : 'default',
      }}
    >
      <Stage
        ref={stageRef}
        width={scaledWidth}
        height={scaledHeight}
        scaleX={finalScale}
        scaleY={finalScale}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        style={{ pointerEvents: paintMode ? 'auto' : 'auto' }}
      >
        {/* 背景Layer */}
        <Layer listening={false}>
          {isImage && fileUrl && (
            <BackgroundImage 
              src={fileUrl} 
              width={contentSize.width} 
              height={contentSize.height}
            />
          )}
          {isPDF && fileUrl && (
            <BackgroundPDF 
              pdfUrl={fileUrl} 
              pageNumber={pageNumber}
              width={contentSize.width}
              height={contentSize.height}
              onLoad={(size) => setContentSize(size)}
            />
          )}
        </Layer>
        
        {/* 注釈Layer */}
        <Layer>
          {shapes.map(renderShape)}
          {currentShape && renderShape(currentShape)}
        </Layer>
      </Stage>
      
      {/* デバッグ情報 */}
      {DEBUG_MODE && (
        <div style={{
          position: 'absolute',
          top: 8,
          right: 8,
          background: 'rgba(0,0,0,0.8)',
          color: '#0f0',
          padding: '8px',
          fontSize: '10px',
          fontFamily: 'monospace',
          borderRadius: '4px',
          pointerEvents: 'none',
        }}>
          <div>paintMode: {paintMode.toString()}</div>
          <div>tool: {tool}</div>
          <div>stage: {Math.round(scaledWidth)}x{Math.round(scaledHeight)}</div>
          <div>scale: {finalScale.toFixed(2)}</div>
          <div>pointer: ({Math.round(pointerPos.x)}, {Math.round(pointerPos.y)})</div>
        </div>
      )}
    </div>
  );
});

ViewerCanvas.displayName = 'ViewerCanvas';

export default ViewerCanvas;