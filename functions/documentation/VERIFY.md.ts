# VERIFY.md - Verification Checklist

**Last Updated:** 2026-01-18 (P0 Final)

## P0 Fix: Paint Visibility & Persistence

### Primary Tests
- [ ] **Z-01**: ペイントON→ドラッグ中に線が見える
  - Expected: ドラッグ中に線がリアルタイム表示される（paintMode/currentShape 時は常時 opacity=1）
  - Status: PENDING → コンソールで [P0-VISIBILITY] willBeVisible=true 確認

- [ ] **Z-02**: pointerUp後も線が残る
  - Expected: 離した後も描画が残る（Map追加→contentReady でレンダリング）
  - Status: PENDING → コンソールで [🎨 DRAW_DIAG] Map updated after commit 確認

- [ ] **Z-03**: リロードしても「一瞬出て消える」が起きない
  - Expected: リロード直後は確定shape非表示（contentReady=false）→背景ロード後に表示
  - Status: PENDING → コンソールで [P0-FIX] bgLoad SUCCESS → contentReady=true 確認

- [ ] **Z-04**: コメント未選択でも下書きが見える
  - Expected: renderTargetCommentId=null でも全表示（空配列回避）
  - Status: PENDING → コンソールで [ViewerCanvas] renderedShapes UMEMO: No targetId, returning all sourceShapes 確認

### Regression Tests
- [ ] 全体/横幅/縦幅で描画が消えない
  - Expected: fitMode切替後も描画が残る（fileIdentity不変なのでMap保持）
  - Status: PENDING

- [ ] Selection suppressed維持
  - Expected: 新規入力中に右コメント触ってもactiveCommentId=nullのまま
  - Status: PENDING

- [ ] ペイントON/OFF×5でズーム/位置が飛ばない
  - Expected: zoom/pan state が保持される（Stage remount禁止）
  - Status: PENDING

---

## Previous Verifications
- デバッグ表示が通常時に出ない: ✅ OK
- 全体/横幅/縦幅で%が変化する: ✅ OK