# VERIFY.md - Verification Checklist

**Last Updated:** 2026-01-18 (P0 Final v3)

## P0 Fix v3: Paint Visibility & Persistence (renderTargetCommentId統一版)

### Primary Tests
- [ ] **Z-01**: ペイントON→ドラッグ中に線が見える
  - Expected: paintMode=true で opacity=1、ドラッグ中に currentShape が描画される
  - Check: コンソールで `[🎨 DRAW_DIAG] currentShape created` 確認
  - Status: PENDING

- [ ] **Z-02**: pointerUp後も線が残る
  - Expected: Map に追加され、contentReady で描画される
  - Check: コンソールで `[🎨 DRAW_DIAG] Map updated after commit` 確認
  - Status: PENDING

- [ ] **Z-03**: リロードしても「一瞬出て消える」が起きない
  - Expected: 案B2/案B 削除で Map 過剰クリアなし、contentReady で安定表示
  - Check: コンソールで「Intentional empty」ログが **出ない** 確認
  - Status: PENDING

- [ ] **Z-04**: リロード直後、右コメント未選択 → 下書きが見える
  - Expected: activeCommentId=null → renderTargetCommentId=null → draft のみ表示（temp_ または _dirty）
  - Check: コンソールで `[ViewerCanvas] renderedShapes UMEMO: No targetId, showAllPaint=false, returning drafts only` 確認
  - Status: PENDING

- [ ] **Z-05**: 描画が紐づくコメントを選択→未選択に戻す → そのコメント紐づき描画が"残り続けない"
  - Expected: 未選択時は draft のみ表示（DB確定shape は非表示）
  - Check: コンソールで `returning drafts only` 確認、DB shape が消える
  - Status: PENDING

### Regression Tests
- [ ] ペイントON/OFF×5 → ズーム/位置が勝手に戻らない
  - Expected: zoom/pan state が保持される（Stage remount禁止）
  - Status: PENDING

- [ ] 入力中に右コメント触っても暴れない（Selection suppressed維持）
  - Expected: enterNewTextOnlyComposer で即null化
  - Status: PENDING

- [ ] 送信前後でちらつき無し
  - Expected: freeze/handoff で temp→real 遷移時のちらつき防止
  - Status: PENDING

---

## Key Logs to Check
```
# ✅ 成功パターン（これが出ればOK）
[ShareView] context resolved ... activeCommentId: null (NOT 'null' string)
[ViewerCanvas] renderedShapes UMEMO: No targetId, showAllPaint=false, returning drafts only
[P0-VISIBILITY] contentReady=true, willBeVisible=true
[🎨 DRAW_DIAG] Map updated after commit

# ❌ 失敗パターン（これが出たらNG）
[案B2] Intentional empty BEFORE SYNC_GUARD: clearing Map
activeCommentId: 'null' (string, not null)
renderTargetCommentId: 'temp_...' (when unselected)
```

---

## Previous Verifications
- デバッグ表示が通常時に出ない: ✅ OK
- 全体/横幅/縦幅で%が変化する: ✅ OK