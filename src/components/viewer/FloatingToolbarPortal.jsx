import React from 'react';
import { createPortal } from 'react-dom';
import FloatingToolbar from './FloatingToolbar';

/**
 * FloatingToolbar を document.body へ Portal 描画するラッパー。
 * transform 付き親要素の影響で position:fixed が画面外に飛ぶ問題を回避する。
 */
export default function FloatingToolbarPortal({ show, ...toolbarProps }) {
  if (!show || typeof document === 'undefined') return null;
  
  return createPortal(
    <FloatingToolbar {...toolbarProps} />,
    document.body
  );
}