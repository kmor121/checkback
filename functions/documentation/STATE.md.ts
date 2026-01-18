# STATE.md - Current System State

**Last Updated:** 2026-01-18 (P0 Final v2)

## P0 Fix: Paint Visibility & Persistence (Complete)
**Problem:**
- ペイントが「ドラッグ中は見えるが、離すと残らない」
- リロード時に「下書きが一瞬出てすぐ消える」フラッシュ
- コメント未選択で下書きが消える（消えた誤認）
- **Root: activeCommentId='null' 文字列化 → truthy誤判定 → effectiveShowAllPaint=false → targetIdフィルタ誤発火 → 空配列**

**Root Cause:**
- localStorage に `'null'` 文字列を書き込み → 読み込み時に `normalizeNullableId` せず String() → `'null'` が truthy扱い
- `effectiveShowAllPaint = showAllPaint && !activeCommentId` で `'null'` が `!= null` なので false → 全表示が無効化
- ViewerCanvas: `if (targetId) ... else if (showAllPaint) ...` の順序で targetId 優先 → 未選択でもフィルタが発火
- `bgReady` フラグが不安定（onLoad重複呼び出し等）→ paintLayer の opacity/listening が揺れる
- 確定shape（renderedShapesFinal）が背景より先に描画されてフラッシュ

**Fix Applied:**
1. **ID正規化（P0）:** `normalizeNullableId(v)` で `'null'/'undefined'/''` を真の `null` に戻す
2. **localStorage 'null' 排除:** activeCommentId/tempCommentId が null のとき `removeItem`（'null' を setItem しない）
3. **effectiveShowAllPaint:** 正規化後の activeCommentId を使用（`showAllPaint || !normalizedActiveCommentId`）
4. **ViewerCanvas フィルタ優先順位:** `if (showAllPaint)` を最優先（targetId より先、未選択時全表示UX）
5. **ViewerCanvas targetId正規化:** `normalizeNullableId(renderTargetCommentId)` で 'null' 文字列を除外
6. `contentReady = bgSize.width > 0 && bgSize.height > 0` で安定判定（bgReadyフラグ依存を削除）
7. paintLayer: `opacity={(contentReady || paintMode || !!currentShape) ? 1 : 0}` で常時表示
8. 確定shape描画: `contentReady &&` で背景後のみ表示（フラッシュ防止）
9. currentShape（プレビュー）: contentReady不問で常時描画（ユーザー体験優先）
10. BackgroundImage: `onLoadCalledRef` で重複呼び出し防止
11. window pointerup: `commitInFlightRef` で二重commit防止

**Status:** ✅ Fixed (All hunks applied)
**Verify Required:** Z-01〜Z-03 + 回帰テスト

---

## Previous State (P0/P1 fixes)
- デバッグ表示を通常時OFFに整理（?diag=1 で有効化）
- fitMode操作での描画消失を修正（fileIdentity変化検知を厳格化）
- 右上%表示を実表示倍率に変更