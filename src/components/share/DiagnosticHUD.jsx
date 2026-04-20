import React from 'react';
import { Button } from '@/components/ui/button';

/**
 * ShareView用 診断HUD群
 * - ?diag=1 : 状態見える化HUD（Z-04）
 * - ?debug=1 or localStorage.forceDebug=1 or VITE_DEBUG=true : Debugコピーボタン
 * - VITE_DEBUG=true : Draft Debug HUD
 */
export default function DiagnosticHUD({
  diagEnabled,
  paintMode,
  canPost,
  shareLink,
  isReady,
  normalizedActiveCommentId,
  isUnselected,
  isTempDraftPreview,
  tempDraftCount,
  composerMode,
  paintContextId,
  targetKey,
  debugButtonEnabled,
  tool,
  isEditMode,
  isNewMode,
  draftScope,
  draftReady,
  shapesLoaded,
  shapesFetching,
  paintShapesLength,
  draftShapesLength,
  shapesForCanvasLength,
  isCanvasTransitioning,
  canvasInternalResetKey,
  debugLogBufferRef,
  showToast,
  debugMode,
  draftDebugInfo,
  tempCommentId,
  activeCommentId,
}) {
  return (
    <>
      {diagEnabled && (
        <div className="fixed top-16 left-4 z-[9998] bg-black/90 text-white text-xs font-mono p-3 rounded shadow-lg max-w-xs max-h-[80vh] overflow-auto">
          <div className="font-bold text-yellow-400 mb-1">🔍 Z-04</div>
          <div>tbGate: pm=<span className={paintMode?'text-green-400':'text-red-400'}>{paintMode?'T':'F'}</span> cp=<span className={canPost?'text-green-400':'text-red-400'}>{canPost?'T':'F'}</span>(<span className="text-gray-400">{String(shareLink?.can_post_comments)}</span>) rdy=<span className={isReady?'text-green-400':'text-red-400'}>{isReady?'T':'F'}</span> vis=<span className={(paintMode&&canPost&&isReady)?'text-green-400 font-bold':'text-red-400 font-bold'}>{(paintMode&&canPost&&isReady)?'T':'F'}</span></div>
          <div>active: <span className={normalizedActiveCommentId?'text-cyan-400':'text-red-400'}>{normalizedActiveCommentId?.substring(0,12)||'null'}</span> unsel: <span className={isUnselected?'text-green-400':'text-red-400'}>{isUnselected?'T':'F'}</span></div>
          <div>tempPreview: {isTempDraftPreview?'T':'F'} tempDraft: {tempDraftCount} mode: <span className="text-cyan-400">{composerMode}</span></div>
          <div>pCtx: <span className="text-cyan-400">{paintContextId?.substring(0,12)||'null'}</span> tKey: <span className="text-cyan-400">{targetKey?.substring(0,30)||'null'}</span></div>
        </div>
      )}

      {debugButtonEnabled && (
        <div style={{ position: 'fixed', top: '12px', right: '12px', zIndex: 99999, pointerEvents: 'auto' }}>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              try {
                const debugData = {
                  timestamp: new Date().toISOString(),
                  paintMode,
                  tool,
                  composerMode,
                  isEditMode,
                  isNewMode,
                  paintContextId: paintContextId?.substring(0, 12) || 'null',
                  targetKey: targetKey?.substring(0, 50) || 'null',
                  draftScope,
                  draftReady,
                  shapesLoaded,
                  shapesFetching,
                  dbCount: paintShapesLength,
                  draftCount: draftShapesLength,
                  mergedCount: shapesForCanvasLength,
                  isCanvasTransitioning,
                  ctx: canvasInternalResetKey?.substring(0, 50) || 'null',
                  recentLogs: debugLogBufferRef.current.slice(-100),
                };
                const text = JSON.stringify(debugData, null, 2);

                if (typeof navigator !== 'undefined' && navigator.clipboard) {
                  navigator.clipboard.writeText(text).then(() => {
                    showToast('📋 Debug情報をコピーしました', 'success');
                  }).catch(() => {
                    const textarea = document.createElement('textarea');
                    textarea.value = text;
                    textarea.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:80%;height:60%;z-index:99999;padding:20px;font-family:monospace;font-size:12px;border:2px solid #000;background:white;';
                    document.body.appendChild(textarea);
                    textarea.focus();
                    textarea.select();
                    setTimeout(() => textarea.remove(), 60000);
                  });
                } else {
                  const textarea = document.createElement('textarea');
                  textarea.value = text;
                  textarea.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:80%;height:60%;z-index:99999;padding:20px;font-family:monospace;font-size:12px;border:2px solid #000;background:white;';
                  document.body.appendChild(textarea);
                  textarea.focus();
                  textarea.select();
                  setTimeout(() => textarea.remove(), 60000);
                }
              } catch (e) {
                showToast('コピー失敗: ' + e.message, 'error');
              }
            }}
            className="text-xs bg-yellow-100 hover:bg-yellow-200 border-yellow-400 shadow-lg font-bold"
          >
            📋 Debug
          </Button>
        </div>
      )}

      {debugMode && (
        <div className="fixed top-0 left-0 z-[9999] bg-black/90 text-green-400 text-xs font-mono p-2 max-w-sm">
          <div className="text-yellow-400 font-bold mb-1">📝 Draft Debug</div>
          <div>targetKey: <span className="text-cyan-400 break-all">{draftDebugInfo.targetKey || 'null'}</span></div>
          <div>loadDraftFound: <span className={draftDebugInfo.loadDraftFound ? 'text-green-400' : 'text-red-400'}>{draftDebugInfo.loadDraftFound ? 'true' : 'false'}</span></div>
          <div>draftLoadedCount: <span className="text-yellow-400">{draftDebugInfo.loadedCount}</span></div>
          <div>draftRenderedCount: <span className="text-yellow-400">{draftDebugInfo.renderedCount}</span></div>
          <div>draftSavedAt: <span className="text-cyan-400">{draftDebugInfo.savedAt || 'never'}</span></div>
          <div className="border-t border-gray-600 mt-1 pt-1">
            <div>composerMode: <span className="text-cyan-400">{composerMode}</span></div>
            <div>tool: <span className="text-cyan-400">{tool}</span></div>
            <div>paintMode: <span className={paintMode ? 'text-green-400' : 'text-red-400'}>{paintMode ? 'ON' : 'OFF'}</span></div>
            <div>tempCommentId: <span className="text-cyan-400">{tempCommentId?.substring(0, 12) || 'null'}</span></div>
            <div>activeCommentId: <span className="text-cyan-400">{activeCommentId?.substring(0, 12) || 'null'}</span></div>
            <div>draftShapes.length: <span className="text-yellow-400">{draftShapesLength}</span></div>
            <div>shapesForCanvas: <span className="text-yellow-400">{shapesForCanvasLength}</span></div>
          </div>
        </div>
      )}
    </>
  );
}