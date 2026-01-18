# STATE.md - Current System State

**Last Updated:** 2026-01-18 (P0 Hotfix)

## P0 Hotfix: normalizedActiveCommentId TDZ Error
**Problem:** `normalizedActiveCommentId is not defined` → 参照が定義より前

**Fix:** normalizedActiveCommentId を activeCommentId state 直後に定義（L147→L148）

**Status:** ✅ Fixed

---

## P0 Fix v3: Paint Visibility & Persistence (renderTargetCommentId統一版)
**Problem:**
- リロード時に下書きが「一瞬出て消える」（Map過剰クリア）
- コメント未選択で下書き/描画が消える（フィルタ誤発火）
- コメント選択→未選択に戻したとき、そのコメント紐づき描画が"残り続ける"（表示ルール不安定）

**Root Cause:**
- **renderTargetCommentId = paintContextId (temp_)** → 未選択でも temp_ でフィルタ、全表示されない
- **案B2/案B ブロック:** temp_ ctx で「Intentional empty」が繰り返し発火 → Map過剰クリア → 描画消失
- **activeCommentId='null' 文字列化 → truthy 誤判定** → effectiveShowAllPaint=false

**Fix Applied (3 core hunks):**
1. **Hunk1 (ShareView):** `renderTargetCommentId = normalizedActiveCommentId` に変更（paintContextId から分離）
   - 表示フィルタは「UIの選択(activeCommentId)」に追従、paintContextId は「保存先ID」として別用途
2. **Hunk2 (ViewerCanvas):** 案B2/案B ブロック削除（renderTargetCommentId が activeCommentId なので temp_ 過剰クリア不要）
3. **Hunk3 (ViewerCanvas):** 未選択時デフォルトを「draftのみ」に変更（temp_ または _dirty=true）
   - showAllPaint=true → 全表示
   - targetId あり → targetId 一致のみ
   - targetId なし + showAllPaint=false → draft のみ（temp_ または _dirty）

**Previous fixes (maintained):**
- ID正規化（'null'/'undefined'/''→null）
- localStorage 'null' 排除
- contentReady 判定（bgSize ベース）
- paintLayer opacity 制御
- 確定shape は contentReady 後のみ描画

**Status:** ✅ Fixed (All 3 core hunks + hotfix applied)
**Verify Required:** Z-01〜Z-05 + 回帰テスト