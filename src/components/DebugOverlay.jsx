import React, { useState, useEffect } from 'react';

const DEBUG_MODE = import.meta.env.VITE_DEBUG === 'true';

export default function DebugOverlay() {
  const [errors, setErrors] = useState([]);
  
  useEffect(() => {
    if (!DEBUG_MODE) return;
    
    const handleError = (event) => {
      const errorMsg = event.error?.message || event.message || String(event.error || event.reason || 'unknown');
      const errorStack = event.error?.stack || '';
      setErrors(prev => [...prev, { 
        type: 'error', 
        message: errorMsg, 
        stack: errorStack,
        timestamp: new Date().toISOString() 
      }]);
    };
    
    const handleRejection = (event) => {
      const errorMsg = event.reason?.message || String(event.reason || 'unhandled rejection');
      const errorStack = event.reason?.stack || '';
      setErrors(prev => [...prev, { 
        type: 'rejection', 
        message: errorMsg, 
        stack: errorStack,
        timestamp: new Date().toISOString() 
      }]);
    };
    
    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleRejection);
    
    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, []);
  
  if (!DEBUG_MODE || errors.length === 0) return null;
  
  return (
    <div style={{
      position: 'fixed',
      top: 0,
      right: 0,
      maxWidth: '400px',
      maxHeight: '50vh',
      overflow: 'auto',
      background: 'rgba(220, 38, 38, 0.95)',
      color: 'white',
      padding: '12px',
      fontSize: '11px',
      fontFamily: 'monospace',
      zIndex: 99999,
      borderBottomLeftRadius: '8px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
        <strong>🚨 Global Errors ({errors.length})</strong>
        <button 
          onClick={() => setErrors([])}
          style={{ background: 'white', color: 'red', border: 'none', borderRadius: '4px', padding: '2px 8px', cursor: 'pointer' }}
        >
          Clear
        </button>
      </div>
      {errors.map((err, idx) => (
        <div key={idx} style={{ marginBottom: '12px', borderBottom: '1px solid rgba(255,255,255,0.3)', paddingBottom: '8px' }}>
          <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
            [{err.type}] {new Date(err.timestamp).toLocaleTimeString()}
          </div>
          <div style={{ marginBottom: '4px' }}>
            {err.message}
          </div>
          {err.stack && (
            <details style={{ fontSize: '10px', opacity: 0.8 }}>
              <summary style={{ cursor: 'pointer' }}>Stack trace</summary>
              <pre style={{ whiteSpace: 'pre-wrap', marginTop: '4px' }}>{err.stack}</pre>
            </details>
          )}
        </div>
      ))}
    </div>
  );
}