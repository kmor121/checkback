# VERIFY.md - Verification Checklist

**Last Updated:** 2026-01-18

## P0 Fix: Paint Visibility & Persistence

### Primary Tests
- [ ] **Z-01**: ペイントON→ドラッグ中に線が見える
  - Expected: ドラッグ中に線がリアルタイム表示される
  - Status: PENDING

- [ ] **Z-02**: pointerUp後も線が残る
  - Expected: 離した後も描画が残り、下書きとして表示され続ける
  - Status: PENDING

- [ ] **Z-03**: リロードしても「一瞬出て消える」が起きない
  - Expected: リロード直後から安定表示（フラッシュなし）
  - Status: PENDING

- [ ] **Z-04**: コメント未選択でも下書きが見える
  - Expected: activeCommentId=null でも下書きが表示される
  - Status: PENDING

### Regression Tests
- [ ] 全体/横幅/縦幅で描画が消えない
  - Expected: fitMode切替後も描画が残る
  - Status: PENDING

- [ ] Selection suppressed維持
  - Expected: 新規入力中に右コメント触ってもactiveCommentId=nullのまま
  - Status: PENDING

- [ ] ペイントON/OFF×5でズーム/位置が飛ばない
  - Expected: zoom/pan state が保持される
  - Status: PENDING

---

## Previous Verifications
- デバッグ表示が通常時に出ない: ✅ OK
- 全体/横幅/縦幅で%が変化する: ✅ OK