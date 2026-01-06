/**
 * _public.js
 * 
 * Base44アプリ内で認証不要のページを定義するための設定ファイル
 * 
 * Base44の仕様:
 * - アプリ全体が「Private（認証必須）」または「Public（全ページログイン不要）」
 * - 個別ページ単位での権限設定は基本的にサポートされていない
 * 
 * この設定により、Layoutで判定される公開ページのリストを管理します。
 */

export const PUBLIC_PAGES = [
  'ShareView',  // 共有リンク閲覧ページ（ゲスト向け）
];

/**
 * 指定されたページ名が公開ページかどうかを判定
 * @param {string} pageName - ページ名
 * @returns {boolean}
 */
export function isPublicPage(pageName) {
  return PUBLIC_PAGES.includes(pageName);
}

/**
 * 現在のパスが公開ルートかどうかを判定
 * @param {string} pathname - window.location.pathname
 * @returns {boolean}
 */
export function isPublicRoute(pathname) {
  const pathLower = pathname.toLowerCase();
  
  // ShareView ページ
  if (pathLower === '/shareview' || pathLower.startsWith('/shareview?')) {
    return true;
  }
  
  // レガシー /share/ パス（もし使われていれば）
  if (pathLower.startsWith('/share/')) {
    return true;
  }
  
  return false;
}

// Default export for pages.config.js compatibility
export default {
  PUBLIC_PAGES,
  isPublicPage,
  isPublicRoute,
};