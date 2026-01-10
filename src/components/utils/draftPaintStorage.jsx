/**
 * 下書き描画のlocalStorage管理ユーティリティ
 * 
 * キー設計:
 * - 既存コメント編集: draftPaint:{fileId}:{commentId}
 * - 新規コメント: draftPaint:{fileId}:temp:{tempCommentId}
 */

const DRAFT_PREFIX = 'draftPaint:';
const DRAFT_VERSION = 1;
const DRAFT_EXPIRY_DAYS = 7;

/**
 * 下書きキーを生成
 * @param {string} fileId - ファイルID
 * @param {string|null} commentId - コメントID（既存）またはnull
 * @param {string|null} tempId - 仮コメントID（新規）
 */
export function getDraftKey(fileId, commentId, tempId = null) {
  if (!fileId) return null;
  if (commentId) {
    return `${DRAFT_PREFIX}${fileId}:${commentId}`;
  }
  if (tempId) {
    return `${DRAFT_PREFIX}${fileId}:temp:${tempId}`;
  }
  return null;
}

/**
 * 新規コメント用の仮IDを生成
 */
export function generateTempCommentId() {
  return `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 下書きを保存
 * @param {string} key - getDraftKeyで生成したキー
 * @param {Array} shapes - 描画データの配列
 * @param {object} metadata - 追加メタデータ（pageNo等）
 */
export function saveDraft(key, shapes, metadata = {}) {
  if (!key || !shapes) return false;
  
  try {
    const draft = {
      version: DRAFT_VERSION,
      updatedAt: new Date().toISOString(),
      shapes: shapes,
      ...metadata,
    };
    localStorage.setItem(key, JSON.stringify(draft));
    console.log('[draftPaintStorage] Saved draft:', key, 'shapes:', shapes.length);
    return true;
  } catch (e) {
    console.error('[draftPaintStorage] Failed to save draft:', e);
    return false;
  }
}

/**
 * 下書きを読み込む
 * @param {string} key - getDraftKeyで生成したキー
 * @returns {object|null} - { version, updatedAt, shapes, ... } または null
 */
export function loadDraft(key) {
  if (!key) return null;
  
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    
    const draft = JSON.parse(raw);
    
    // 期限切れチェック（7日）
    if (draft.updatedAt) {
      const updatedAt = new Date(draft.updatedAt);
      const now = new Date();
      const diffDays = (now - updatedAt) / (1000 * 60 * 60 * 24);
      if (diffDays > DRAFT_EXPIRY_DAYS) {
        console.log('[draftPaintStorage] Draft expired, removing:', key);
        localStorage.removeItem(key);
        return null;
      }
    }
    
    console.log('[draftPaintStorage] Loaded draft:', key, 'shapes:', draft.shapes?.length || 0);
    return draft;
  } catch (e) {
    console.error('[draftPaintStorage] Failed to load draft:', e);
    return null;
  }
}

/**
 * 下書きを削除
 * @param {string} key - getDraftKeyで生成したキー
 */
export function deleteDraft(key) {
  if (!key) return;
  
  try {
    localStorage.removeItem(key);
    console.log('[draftPaintStorage] Deleted draft:', key);
  } catch (e) {
    console.error('[draftPaintStorage] Failed to delete draft:', e);
  }
}

/**
 * 特定ファイルの全下書きキーを取得
 * @param {string} fileId - ファイルID
 * @returns {string[]} - キーの配列
 */
export function getDraftKeysForFile(fileId) {
  if (!fileId) return [];
  
  const prefix = `${DRAFT_PREFIX}${fileId}:`;
  const keys = [];
  
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(prefix)) {
      keys.push(key);
    }
  }
  
  return keys;
}

/**
 * 期限切れの下書きを全て削除（ガベージコレクション）
 */
export function cleanupExpiredDrafts() {
  try {
    const now = new Date();
    const keysToRemove = [];
    
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(DRAFT_PREFIX)) {
        try {
          const raw = localStorage.getItem(key);
          if (raw) {
            const draft = JSON.parse(raw);
            if (draft.updatedAt) {
              const updatedAt = new Date(draft.updatedAt);
              const diffDays = (now - updatedAt) / (1000 * 60 * 60 * 24);
              if (diffDays > DRAFT_EXPIRY_DAYS) {
                keysToRemove.push(key);
              }
            }
          }
        } catch (e) {
          // パースエラーは削除対象
          keysToRemove.push(key);
        }
      }
    }
    
    keysToRemove.forEach(key => localStorage.removeItem(key));
    
    if (keysToRemove.length > 0) {
      console.log('[draftPaintStorage] Cleaned up expired drafts:', keysToRemove.length);
    }
  } catch (e) {
    console.error('[draftPaintStorage] Failed to cleanup:', e);
  }
}