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
  // フィルタ条件
  showAllPaint,
  renderTargetCommentId,
  canvasContextKey,
  // 状態フラグ
  hidePaintOverlay,
  paintMode,
  isCanvasTransitioning,
  // refs（ミュータブル、呼び出し元が管理）
  isInteractingRef,
  pendingIncomingShapesRef,
  pendingCtxRef,
  lastNonEmptyShapesRef,
  emptyStreakCountRef,
  prevEmptyCountRef,
  lastEmptyAppliedCtxRef,
  stageRef,
}) {
  // hidePaintOverlay時はMap破壊禁止
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

  // 保留データを優先
  const incomingRaw = pendingIncomingShapesRef.current || existingShapes;
  pendingIncomingShapesRef.current = null;
  if (!incomingRaw) return;

  // renderTargetCommentId でフィルタ
  const incoming = (!showAllPaint && renderTargetCommentId)
    ? (Array.isArray(incomingRaw) ? incomingRaw : []).filter(
        s => String(resolveCommentId(s) || '') === String(renderTargetCommentId)
      )
    : (Array.isArray(incomingRaw) ? incomingRaw : []);

  const shapesToSync = incoming;
  const prevMapSize = shapesMapRef.current.size;
  const ctx = canvasContextKey || 'no-ctx';
  const isPending = !!pendingCtxRef.current;
  const incomingEmpty = incoming.length === 0;

  // temp_ コンテキスト判定
  const isTempCtx = String(renderTargetCommentId || '').startsWith('temp_');
  const allowIntentionalEmpty = isTempCtx && !paintMode && !showAllPaint;
  const isNewTempCtx = isTempCtx;

  // --- 非空記録 ---
  if (!incomingEmpty) {
    lastNonEmptyShapesRef.current = { key: ctx, shapes: shapesToSync };
    emptyStreakCountRef.current = 0;
  }

  // --- transient empty ガード（同一ctx、非temp、非pending） ---
  if (incomingEmpty && prevMapSize > 0 && !isPending && !allowIntentionalEmpty && !hidePaintOverlay && !isNewTempCtx) {
    const lastNE = lastNonEmptyShapesRef.current;
    const isSameCtx = lastNE?.key === ctx;
    const lastNECount = (isSameCtx && lastNE?.shapes?.length) || 0;

    if (isSameCtx && lastNECount > 0 && emptyStreakCountRef.current < 5) {
      emptyStreakCountRef.current += 1;
      dbg('[SYNC-GUARD] transient empty, preserving Map', { ctx: ctx?.substring(0, 20), emptyStreak: emptyStreakCountRef.current });
      return;
    }
  }

  // --- pending中のempty ---
  if (isPending && incomingEmpty) {
    if (prevMapSize === 0) {
      dbg('[SYNC] pending解除 (empty×empty)');
      pendingCtxRef.current = null;
      return;
    }
    if (!isCanvasTransitioning) {
      dbg('[SYNC] pending解除 (0件確定)');
      shapesMapRef.current = new Map();
      pendingCtxRef.current = null;
      bump();
      return;
    }
    dbg('[SYNC] pending SKIP');
    return;
  }

  // --- pending中の非empty → 置換 ---
  if (isPending && !incomingEmpty) {
    const result = buildSyncMap(shapesMapRef, shapesToSync);
    dbg('[SYNC] pending replaced', { newSize: result.size });
    shapesMapRef.current = result;
    pendingCtxRef.current = null;
    bump();
    return;
  }

  // --- 同一ctx: empty処理 ---
  if (incomingEmpty) {
    emptyStreakCountRef.current += 1;

    const lastNE = lastNonEmptyShapesRef.current;
    const isSameCtx = lastNE?.key === ctx;
    const lastNECount = (isSameCtx && lastNE?.shapes?.length) || 0;

    // flicker guard
    if (!allowIntentionalEmpty && !hidePaintOverlay && isSameCtx && lastNECount > 0 && emptyStreakCountRef.current < 5) {
      dbg('[SYNC-FLICKER] preserving lastNonEmpty');
      if (prevMapSize === 0 && lastNE?.shapes) {
        const restoreMap = new Map();
        lastNE.shapes.forEach(s => restoreMap.set(s.id, s));
        shapesMapRef.current = restoreMap;
        bump();
      }
      return;
    }

    // transitioning
    if (isCanvasTransitioning) {
      if (hidePaintOverlay || allowIntentionalEmpty) {
        if (lastEmptyAppliedCtxRef.current === ctx && shapesMapRef.current.size === 0) return;
        lastEmptyAppliedCtxRef.current = ctx;
        shapesMapRef.current = new Map();
        lastNonEmptyShapesRef.current = { key: null, shapes: null };
        emptyStreakCountRef.current = 0;
        prevEmptyCountRef.current = 0;
        bump();
        requestAnimationFrame(() => {
          if (!stageRef.current) return;
          const stage = stageRef.current.getStage?.() || stageRef.current;
          stage?.batchDraw?.();
        });
        return;
      }
      if (prevMapSize === 0) {
        // fall through
      } else {
        prevEmptyCountRef.current += 1;
        return;
      }
    }

    // Hunk E: 2回連続empty で確定クリア
    prevEmptyCountRef.current += 1;
    if (prevEmptyCountRef.current < 2 && prevMapSize > 0) {
      dbg('[SYNC-E] first empty, preserving');
      return;
    }
    if (prevMapSize > 0) {
      dbg('[SYNC-E] 2nd empty, clearing Map');
      shapesMapRef.current = new Map();
      bump();
    }
    prevEmptyCountRef.current = 0;
    emptyStreakCountRef.current = 0;
    return;
  }

  // --- 非empty: FULL SYNC ---
  emptyStreakCountRef.current = 0;
  lastEmptyAppliedCtxRef.current = null;
  prevEmptyCountRef.current = 0;

  dbg('[SYNC] FULL SYNC IN', {
    renderTarget: renderTargetCommentId?.substring(0, 12),
    incomingCount: incoming.length,
    ctx: ctx?.substring(0, 20),
    prevMapSize,
  });

  const newMap = buildSyncMap(shapesMapRef, shapesToSync);
  dbg('[SYNC] Map replaced', { newSize: newMap.size });
  shapesMapRef.current = newMap;
  bump();
}

/**
 * dirtyShapes を保持しつつ incoming shapes で Map を構築
 */
function buildSyncMap(shapesMapRef, shapesToSync) {
  const dirtyShapes = new Map();
  for (const [id, shape] of shapesMapRef.current.entries()) {
    if (shape._dirty) dirtyShapes.set(id, shape);
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

  // dirty だが incoming にないものも保持
  for (const [id, shape] of dirtyShapes.entries()) {
    if (!newMap.has(id)) newMap.set(id, shape);
  }

  return newMap;
}