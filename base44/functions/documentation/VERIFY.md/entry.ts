# VERIFY.md - Verification Checklist

**Last Updated:** 2026-01-18 (P0 Final v4)

## P0 Fix v4: Paint Visibility & Persistence (完全版)

### Primary Tests
- [ ] **Z-01**: 下書きがある状態でリロード → 「一瞬出て消える」が起きない
  - Expected: reset useEffect が externalPan 除外でファイル/ページ変更時のみ発火
  - Check: コンソールで `[P0-V4] fileIdentity/pageNumber CHANGED` が **リロード直後に1回のみ** 出る
  - Status: PENDING

- [ ] **Z-02**: リロード直後、右コメント未選択 → 下書きが見える
  - Expected: activeCommentId=null → effectiveShowAllPaint=false → renderedShapes で isDraft=true フィルタ
  - Check: コンソールで `[ViewerCanvas] renderedShapes UMEMO: No targetId, showAllPaint=false, returning drafts only` + `draftCount > 0`
  - Status: PENDING

- [ ] **Z-03**: コメントを選択 → そのコメント紐づき描画が見える
  - Expected: activeCommentId 設定 → renderTargetCommentId=activeCommentId → targetId フィルタで表示
  - Check: コンソールで `[ViewerCanvas] renderedShapes UMEMO: Filtered by targetId` + `filteredCount > 0`
  - Status: PENDING

- [ ] **Z-04**: 未選択に戻す → コメント紐づき描画は消える／下書きだけ見える
  - Expected: activeCommentId=null → effectiveShowAllPaint=false → drafts only
  - Check: コンソールで `returning drafts only` + DB確定shape が消える（temp_/isDraft のみ残る）
  - Status: PENDING

### Regression Tests
- [ ] ペイントで描く→離した後も残る
  - Expected: Map 追加 → contentReady で描画
  - Status: PENDING

- [ ] ペイントON/OFF×5 → ズーム/位置が勝手に戻らない
  - Expected: reset が発火しない（externalPan 除外済み）
  - Status: PENDING

- [ ] 入力中に右コメント触っても暴れない
  - Expected: enterNewTextOnlyComposer で即 null化
  - Status: PENDING

---

## Key Logs (Success Pattern)
```
[ShareView] No comment specified, keeping unselected
[ViewerCanvas] renderedShapes UMEMO: No targetId, showAllPaint=false, returning drafts only
isDraftFlagCount: X, tempCidCount: Y, draftCount: X+Y > 0
[P0-V4] fileIdentity/pageNumber CHANGED (リロード直後1回のみ)
```

## Key Logs (Failure Pattern - これが出たらNG)
```
effectiveShowAllPaint: true (when normalizedActiveCommentId is null)
returning all sourceShapes (unselected UX) # 未選択で全表示はNG
[P0-V4] fileIdentity/pageNumber CHANGED (リロード後2回以上) # 誤reset
```

---

## Previous Verifications
- デバッグ表示が通常時に出ない: ✅ OK
- 全体/横幅/縦幅で%が変化する: ✅ OK