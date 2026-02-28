import React from 'react';

export default function CanvasDebugHud({ debugHudData, debugRef, renderedShapes, bgSize, contentScale, offsetX, offsetY, containerSize, paintMode, draftReady, tool, canDrawNew, canMutateExisting, canEdit, isDrawing }) {
  return (
    <div style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.9)', color: '#0f0', padding: '10px', fontSize: '10px', fontFamily: 'monospace', borderRadius: '6px', pointerEvents: 'none', zIndex: 100, lineHeight: '1.5', maxWidth: '400px', maxHeight: '90vh', overflow: 'auto' }}>
      <div style={{ color: '#ff0', fontWeight: 'bold', marginBottom: '4px' }}>🔍 VC Debug</div>
      <div style={{ marginBottom: '4px', padding: '3px', background: 'rgba(255,255,0,0.15)', borderRadius: '3px', border: '1px solid #ff0' }}>
        <div style={{ color: '#ff0', fontWeight: 'bold', fontSize: '9px' }}>DIAG seq:{debugHudData.coordDiag?.strokeSeqInSession||0}</div>
        <div style={{ fontSize: '8px', color: '#0f0', wordBreak: 'break-all', lineHeight: '1.2' }}>1P:{debugHudData.coordDiag?.firstPtr||'-'}</div>
        <div style={{ fontSize: '8px', color: '#0f0', wordBreak: 'break-all', lineHeight: '1.2' }}>1C:{debugHudData.coordDiag?.firstCmt||'-'}</div>
        <div style={{ fontSize: '8px', color: '#0ff', wordBreak: 'break-all', lineHeight: '1.2' }}>LP:{debugHudData.coordDiag?.lastPtr||'-'}</div>
        <div style={{ fontSize: '8px', color: '#f0f', wordBreak: 'break-all', lineHeight: '1.2' }}>LC:{debugHudData.coordDiag?.lastCmt||'-'}</div>
      </div>
      <div style={{ marginBottom: '4px', fontSize: '9px' }}>
        shapes:{renderedShapes?.length || 0} bg:{bgSize.width}x{bgSize.height} sc:{contentScale.toFixed(2)} off:{Math.round(offsetX)},{Math.round(offsetY)} stg:{containerSize.width}x{containerSize.height}
      </div>
      <div style={{ marginBottom: '4px', fontSize: '9px' }}>
        pm:{paintMode?'Y':'N'} dr:{draftReady?'Y':'N'} tool:{tool} cDN:{canDrawNew?'Y':'N'} cME:{canMutateExisting?'Y':'N'} cE:{canEdit?'Y':'N'} drw:{isDrawing?'Y':'N'} evt:{debugRef.current.lastEvent}
      </div>
      <div style={{ marginBottom: '4px', fontSize: '9px' }}>
        <span>save:{debugRef.current.saveStatus}</span>
        {debugRef.current.error && <span style={{ color: '#f00' }}> err:{debugRef.current.error.substring(0, 30)}</span>}
      </div>
    </div>
  );
}