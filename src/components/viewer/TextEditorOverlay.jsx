import React from 'react';

export default function TextEditorOverlay({ textEditor, setTextEditor, textInputRef, isComposing, setIsComposing, handleTextConfirm, handleTextCancel, handleTextBlur }) {
  if (!textEditor.visible) return null;
  return (
    <div style={{ position: 'absolute', left: `${textEditor.x}px`, top: `${textEditor.y}px`, zIndex: 1000 }}
      onMouseDown={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <textarea ref={textInputRef} value={textEditor.value}
        onChange={(e) => setTextEditor(prev => ({ ...prev, value: e.target.value }))}
        placeholder="テキストを入力..."
        style={{ padding: '8px', fontSize: '16px', border: '2px solid #4f46e5', borderRadius: '4px 4px 0 0', background: 'white', minWidth: '250px', minHeight: '80px', resize: 'both', fontFamily: 'Arial', boxShadow: '0 4px 6px rgba(0,0,0,0.1)', display: 'block', width: '100%' }}
        onCompositionStart={() => setIsComposing(true)} onCompositionEnd={() => setIsComposing(false)}
        onKeyDown={(e) => {
          e.stopPropagation();
          const isComposingNow = e.nativeEvent?.isComposing || e.keyCode === 229 || isComposing;
          if (e.key === 'Enter' && !e.shiftKey && !isComposingNow) { e.preventDefault(); handleTextConfirm(); }
          else if (e.key === 'Escape') { e.preventDefault(); handleTextCancel(); }
        }}
        onBlur={handleTextBlur} onClick={(e) => e.stopPropagation()} />
      <div style={{ display: 'flex', gap: '4px', background: 'white', borderRadius: '0 0 4px 4px', padding: '4px', borderTop: '1px solid #e5e7eb' }}>
        <button onClick={(e) => { e.stopPropagation(); handleTextConfirm(); }} onMouseDown={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()}
          style={{ flex: 1, padding: '6px 12px', background: '#10b981', color: 'white', border: 'none', borderRadius: '4px', fontSize: '14px', fontWeight: '500', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>✓ 確定</button>
        <button onClick={(e) => { e.stopPropagation(); handleTextCancel(); }} onMouseDown={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()}
          style={{ flex: 1, padding: '6px 12px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '4px', fontSize: '14px', fontWeight: '500', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>× キャンセル</button>
      </div>
      <div style={{ marginTop: '4px', fontSize: '11px', color: '#666', background: 'white', padding: '2px 4px', borderRadius: '2px' }}>Enter: 確定 | Esc: キャンセル | Shift+Enter: 改行</div>
    </div>
  );
}