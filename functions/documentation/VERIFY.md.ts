# VERIFY.md - Verification Checklist

**Last Updated:** 2026-01-18 (P0 Final v2)

## P0 Fix: Paint Visibility & Persistence (ID正規化版)

### Primary Tests
- [ ] **Z-01**: リロードしても下書きが「一瞬出て消える」にならない
  - Expected: リロード直後は contentReady=false で確定shape非表示 → bgLoad後に表示（フラッシュなし）
  - Check: コンソールで `[P0-FIX] bgLoad SUCCESS` → `[P0-VISIBILITY] contentReady=true` 確認
  - Status: PENDING

- [ ] **Z-02**: リロード直後、右コメント未選択のまま → 下書き/描画が見える
  - Expected: activeCommentId=null（正規化済み）→ effectiveShowAllPaint=true → ViewerCanvas showAllPaint=true → 全表示
  - Check: コンソールで `[ShareView] context resolved ... activeCommentId: null` (文字列 'null' でなく真の null)
  - Check: コンソールで `[ViewerCanvas] renderedShapes UMEMO: showAllPaint=TRUE, returning all sourceShapes (priority)`
  - Status: PENDING

- [ ] **Z-03**: ペイントで描画 → ドラッグ中に見える／離した後も残る
  - Expected: paintMode=true で opacity=1（ドラッグ中表示）、pointerUp で Map追加（残る）
  - Check: コンソールで `[🎨 DRAW_DIAG] Map updated after commit` 確認
  - Status: PENDING

### Regression Tests
- [ ] ペイントON/OFF×5 → ズーム/位置が勝手に戻らない
  - Expected: zoom/pan state が保持される（Stage remount禁止）
  - Status: PENDING

- [ ] 入力中に右コメント触っても暴れない（Selection suppressed維持）
  - Expected: enterNewTextOnlyComposer で activeCommentId/composerTargetCommentId を即null化
  - Status: PENDING

- [ ] 送信前後でちらつき無し
  - Expected: freeze/handoff で temp→real 遷移時のちらつき防止
  - Status: PENDING

---

## Key Logs to Check
```
[ShareView] context resolved ... activeCommentId: null (NOT 'null' string)
[ViewerCanvas] renderedShapes UMEMO: showAllPaint=TRUE (priority)
[P0-VISIBILITY] contentReady=true, willBeVisible=true
[🎨 DRAW_DIAG] Map updated after commit
```

---

## Previous Verifications
- デバッグ表示が通常時に出ない: ✅ OK
- 全体/横幅/縦幅で%が変化する: ✅ OK