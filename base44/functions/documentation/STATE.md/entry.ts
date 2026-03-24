# STATE.md - Current System State

**Last Updated:** 2026-01-18 (P0 Final v4)

## P0 Fix v4: Paint Visibility & Persistence (完全版)
**Problem:**
- リロード時に下書きが「一瞬出て消える」（reset useEffect が externalPan 変化で誤発火）
- 未選択でコメント紐づき描画が残る（effectiveShowAllPaint 自動 true）
- 未選択で draft 判定できず全表示/空配列の両極端（isDraft フラグ未付与）

**Root Cause:**
1. **effectiveShowAllPaint 自動 ON**: `normalizedActiveCommentId ? showAllPaint : true` → 未選択で全表示 → コメント紐づき描画残留
2. **isDraft フラグ未付与**: draft shapes に識別子なし → ViewerCanvas で draft のみ表示不可
3. **reset 誤発火**: 依存配列に `externalPan` → pan 変更で reset → Map クリア → フラッシュ

**Fix Applied (4 hunks):**
1. **Hunk1 (ShareView L151):** `effectiveShowAllPaint = showAllPaint` のみ（自動全表示を削除）
2. **Hunk2 (ShareView L835-838):** draft shapes に `isDraft: true` を付与（hydrate 時）
3. **Hunk3 (ViewerCanvas L377-409):** 未選択デフォルトを「isDraft=true OR temp_ cid のみ」に変更
4. **Hunk4 (ViewerCanvas L587-619):** reset useEffect 依存配列から `externalPan` 除外

**Display Contract (固定):**
- 選択あり + showAllPaint=false → 選択コメント紐づきのみ
- 選択あり + showAllPaint=true → 全描画
- 未選択 + showAllPaint=false → draft のみ（isDraft OR temp_）
- 未選択 + showAllPaint=true → 全描画

**Status:** ✅ Fixed (All 4 hunks applied)
**Verify Required:** Z-01〜Z-04 + 回帰テスト