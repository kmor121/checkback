// existingShapes → shapesMap 同期エンジン（ViewerCanvasから抽出）
import { resolveCommentId, normalizeShape } from './canvasUtils';

const DEBUG_MODE = (typeof window !== 'undefined') && (
  new URLSearchParams(window.location.search).get('diag') === '1' ||
  localStorage.getItem('debugPaintLayer') === '1' ||
  import.meta.env.VITE_DEBUG === 'true'
);

function dbg(...args) { if (DEBUG_MODE) console.log(...args); }

/**
 * syncExistingShapes: existingShapes props → shapesMapRef の完全同期
 *
 * @param {object} ctx - 同期に必要なすべてのコンテキスト
 * @returns {void}
 */
export function syncExistingShapes({
  existingShapes,
  shapesMapRef,
  bump,
  showAllPaint,
  renderTargetCommentId,
  canvasContextKey,
  hidePaintOverlay,
  paintMode,
  isCanvasTransitioning,
  isInteractingRef,
  pendingIncomingShapesRef,
  pendingCtxRef,
  lastNonEmptyShapesRef,
  emptyStreakCountRef,
  prevEmptyCountRef,
  lastEmptyAppliedCtxRef,
  stageRef,
}) {
  if (hidePaintOverlay) {
    dbg('[SYNC] hidePaintOverlay=true -> SKIP');
    return;
  }

  // 操作中は保留
  if (isInteractingRef.current) {
    dbg('[SYNC] Interaction in progress, deferring');
    pendingIncomingShapesRef.current = existingShapes;
    return;
  }

  const incomingRaw = pendingIncomingShapesRef.current || existingShapes;
  pendingIncomingShapesRef.current = null;
  if (!incomingRaw) return;

  const incoming = Array.isArray(incomingRaw) ? incomingRaw : [];
  const ctx = canvasContextKey || 'no-ctx';

  // ★★★ SIMPLIFIED SYNC: incoming をそのままMapに反映 ★★★
  dbg('[SYNC] SIMPLE SYNC', { incomingCount: incoming.length, ctx: ctx?.substring(0, 30), currentMapSize: shapesMapRef.current.size });

  if (incoming.length === 0) {
    // 空→Map全クリア（_dirty含む。操作中は上でdefer済み）
    if (shapesMapRef.current.size > 0) {
      shapesMapRef.current = new Map();
      bump();
    }
    return;
  }

  const newMap = new Map();
  for (const s of shapesToSync) {
    const normalized = normalizeShape(s, null);
    const cid = resolveCommentId(normalized);
    if (!normalized || !cid) continue;

    if (dirtyShapes.has(normalized.id)) {
      newMap.set(normalized.id, dirtyShapes.get(normalized.id));
    } else {
      newMap.set(normalized.id, normalized);
    }
  }

  for (const [id, shape] of dirtyShapes.entries()) {
    if (!newMap.has(id)) newMap.set(id, shape);
  }

  return newMap;
}