# STATE.md - Current System State

**Last Updated:** 2026-01-18 (P0 Final)

## P0 Fix: Paint Visibility & Persistence (Complete)
**Problem:**
- ペイントが「ドラッグ中は見えるが、離すと残らない」
- リロード時に「下書きが一瞬出てすぐ消える」フラッシュ
- コメント未選択で下書きが消える（消えた誤認）

**Root Cause:**
- `bgReady` フラグが不安定（onLoad重複呼び出し等）→ paintLayer の opacity/listening が揺れる
- pointerUp後に `currentShape` がクリアされると opacity=0 になり確定shapeも見えない
- 確定shape（renderedShapesFinal）が背景より先に描画されてフラッシュ
- 未選択時（renderTargetCommentId=null）は全フィルタで空配列 → 下書きが消える

**Fix Applied:**
1. `contentReady = bgSize.width > 0 && bgSize.height > 0` で安定判定（bgReadyフラグ依存を削除）
2. paintLayer: `opacity={(contentReady || paintMode || !!currentShape) ? 1 : 0}` で常時表示
3. 確定shape描画: `contentReady &&` で背景後のみ表示（フラッシュ防止）
4. currentShape（プレビュー）: contentReady不問で常時描画（ユーザー体験優先）
5. ShareView未選択時: `effectiveShowAllPaint = showAllPaint || !activeCommentId` で下書き表示維持
6. ViewerCanvas未選択時: `renderTargetCommentId=null` → 全表示（フィルタ無効、空配列回避）
7. BackgroundImage: `onLoadCalledRef` で重複呼び出し防止
8. window pointerup: `commitInFlightRef` で二重commit防止

**Status:** ✅ Fixed
**Verify Required:** Z-01〜Z-04 + 回帰テスト

---

## Previous State (P0/P1 fixes)
- デバッグ表示を通常時OFFに整理（?diag=1 で有効化）
- fitMode操作での描画消失を修正（fileIdentity変化検知を厳格化）
- 右上%表示を実表示倍率に変更