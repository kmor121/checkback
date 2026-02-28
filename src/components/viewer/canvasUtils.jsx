// ViewerCanvas から抽出したユーティリティ関数群

export function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

export const DEBUG_MODE = (typeof window !== 'undefined') && (
  new URLSearchParams(window.location.search).get('diag') === '1' ||
  localStorage.getItem('debugPaintLayer') === '1' ||
  import.meta.env.VITE_DEBUG === 'true'
);

// fileUrlを正規化（クエリ違いを同一ファイルとして扱う）
export function normalizeFileUrl(url) {
  if (!url) return "";
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return String(url).split("?")[0];
  }
}

// commentId解決ユーティリティ（キー揺れ完全吸収、入れ子対応）
export const resolveCommentId = (s) => {
  const v = s?.comment_id ?? s?.commentId ?? s?.commentID ?? 
            s?.comment?.id ?? 
            s?.data?.comment_id ?? s?.data?.commentId ?? s?.data?.commentID ??
            s?.shape?.comment_id ?? s?.shape?.commentId ?? s?.shape?.commentID;
  return v == null ? null : String(v);
};

// shape正規化（入れ子を平坦化、comment_id を canonical 化）
export const normalizeShape = (s, defaultCommentId = null) => {
  if (!s) return null;
  const base = s.data ? { ...s, ...s.data } : (s.shape ? { ...s, ...s.shape } : s);
  let commentId = resolveCommentId(base);
  if (commentId == null || commentId === '') {
    commentId = defaultCommentId != null ? String(defaultCommentId) : null;
  }
  return {
    ...base,
    comment_id: commentId,
    id: base.id ?? base.client_shape_id ?? base._local_id ?? (base._local_id = generateUUID()),
  };
};

// 後方互換エイリアス
export const shapeCommentId = resolveCommentId;
export const sameId = (a, b) => String(a ?? '') === String(b ?? '');

// 座標変換
export const normalizeCoords = (imgX, imgY, bgWidth, bgHeight) => ({
  nx: imgX / bgWidth,
  ny: imgY / bgHeight,
});

export const denormalizeCoords = (nx, ny, bgWidth, bgHeight) => ({
  x: nx * bgWidth,
  y: ny * bgHeight,
});

// テキストエディタ初期状態
export const TEXT_EDITOR_INITIAL = {
  visible: false, x: 0, y: 0, value: '', shapeId: null, imgX: 0, imgY: 0, openedAt: 0,
};