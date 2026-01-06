import React, { useState, useEffect, useRef, useImperativeHandle, forwardRef } from 'react';

const DEBUG_MODE = import.meta.env.VITE_DEBUG === 'true';

// ============================================================
// STEP A: 最小構成 - 単純なdivを返すだけ
// 動作確認後、順次機能を追加していく
// ============================================================

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
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [error, setError] = useState(null);
  
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
      return () => resizeObserver.disconnect();
    } catch (e) {
      setError(`ResizeObserver Error: ${e.message}`);
      console.error('ResizeObserver Error:', e);
    }
  }, []);
  
  // Undo/Redo用のメソッドを公開（暫定実装）
  useImperativeHandle(ref, () => ({
    undo: () => console.log('undo'),
    redo: () => console.log('redo'),
    clear: () => console.log('clear'),
    canUndo: false,
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
      {/* STEP A: 最小構成 - 情報表示のみ */}
      <div style={{ 
        background: 'white', 
        padding: '24px', 
        borderRadius: '8px', 
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        maxWidth: '600px'
      }}>
        <h3 style={{ marginBottom: '16px', fontSize: '18px', fontWeight: 'bold' }}>
          ✅ ViewerCanvas Loaded (Step A)
        </h3>
        <div style={{ fontSize: '14px', lineHeight: '1.6' }}>
          <div><strong>File URL:</strong> {fileUrl ? fileUrl.substring(0, 60) + '...' : '(none)'}</div>
          <div><strong>MIME Type:</strong> {mimeType || '(none)'}</div>
          <div><strong>Container Size:</strong> {containerSize.width} x {containerSize.height}</div>
          <div><strong>Paint Mode:</strong> {paintMode ? 'ON' : 'OFF'}</div>
          <div><strong>Tool:</strong> {tool}</div>
          <div><strong>Zoom:</strong> {zoom}%</div>
        </div>
        
        {DEBUG_MODE && (
          <div style={{ 
            marginTop: '16px', 
            padding: '12px', 
            background: '#f0f0f0', 
            borderRadius: '4px',
            fontSize: '12px',
            fontFamily: 'monospace'
          }}>
            <div><strong>DEBUG MODE</strong></div>
            <div>Props: {Object.keys({ fileUrl, mimeType, pageNumber, shapes, paintMode, tool, strokeColor, strokeWidth, zoom }).join(', ')}</div>
          </div>
        )}
      </div>
    </div>
  );
});

ViewerCanvas.displayName = 'ViewerCanvas';

export default ViewerCanvas;