# VERIFY.md

## 回帰テスト手順

### V-01: 既存コメント選択と描画表示
- **手順**:
  1. ShareView を開く（既存ファイル・既存コメントあり）
  2. コメントパネルで既存コメントを選択
  3. 描画が表示されることを確認
- **観測ポイント**:
  - `activeCommentId` が選択したコメントのIDに設定されている
  - `renderedShapes` が空配列ではない（描画が表示されている）
  - コンソールに `[ViewerCanvas] renderedShapes UMEMO: Filtered by targetId` のログが出ている
- **NG時の切り分け**:
  - `activeCommentId` が null のままなら選択ロジックの不具合
  - `renderedShapes` が空なら ViewerCanvas のフィルタリング不具合

---

### V-02: 新規コメント入力時の選択抑制
- **手順**:
  1. ShareView を開く（既存コメントあり）
  2. 「新規コメント」ボタンをクリック
  3. 入力欄にフォーカスが移り、既存コメントの選択が解除されることを確認
  4. 既存コメントをクリックしても選択されない（選択抑制）ことを確認
- **観測ポイント**:
  - 新規コメント入力開始時に `activeCommentId` が null になっている
  - `hidePaintOverlay` が true になっている（描画が非表示）
  - 既存コメントをクリックしても `activeCommentId` が変わらない（選択抑制）
- **NG時の切り分け**:
  - `activeCommentId` が null にならないなら handleNewCommentStart の不具合
  - `hidePaintOverlay` が false のままなら計算ロジックの不具合
  - 既存コメントが選択できてしまうなら選択抑制の実装漏れ

---

### V-03: ペイントON/OFF時のズーム/パン維持・ちらつき無し
- **手順**:
  1. ShareView を開く（既存ファイル・既存コメントあり）
  2. ズームを 150% に設定し、パンで画像を右下に移動
  3. ペイントモードを ON にする
  4. ズーム倍率とパン位置が維持されていることを確認
  5. ペイントモードを OFF にする
  6. 再度ズーム倍率とパン位置が維持されていることを確認
- **観測ポイント**:
  - paintMode 切替前後で `zoom` と `pan` の値が変わらない
  - ViewerCanvas/Stage が key で強制再マウントされていない（コンソールに `[ViewerCanvas] Component MOUNTED` が paintMode 切替時に出ない）
  - 描画がちらつかない（一瞬消えて再表示されない）
- **NG時の切り分け**:
  - ズーム/パンがリセットされるなら ViewerCanvas の key 使用を確認
  - ちらつくなら Map クリアのタイミング不具合

---

### V-04: 描画下書きがモード往復で消えない
- **手順**:
  1. ShareView を開く（既存コメントあり）
  2. ペイントモードを ON にして、既存コメントを選択
  3. ペンツールで適当に描画（まだ確定しない）
  4. ペイントモードを OFF にする
  5. 再度ペイントモードを ON にして、同じコメントを選択
  6. 手順3の下書きが残っていることを確認
- **観測ポイント**:
  - paintMode OFF→ON 時に localStorage の draftShapes が読み込まれている
  - `shapesMapRef.current.size` が 0 にリセットされていない
  - コンソールに `[draftPaintStorage] Loaded draft:` のログが出ている
- **NG時の切り分け**:
  - localStorage に保存されていないなら saveDraftShapes の不具合
  - 読み込まれていないなら loadDraftShapes の呼び出し漏れ
  - Map がクリアされているなら canvasContextKey 変化の副作用

---

### V-05: 送信中〜temp→real後も描画が消えない/ちらつかない
- **手順**:
  1. ShareView を開く
  2. ネットワークを Slow 3G に設定（DevTools → Network → Throttling）
  3. 新規コメントを作成し、ペンツールで描画
  4. コメントを送信（Submit）
  5. 送信中〜送信完了後も描画が消えない/ちらつかないことを確認
- **観測ポイント**:
  - 送信中に `isFreezing` が true になっている（handoff 中）
  - `lockPaintContextIdRef.current` が temp→real の ID 遷移を記録している
  - refetch で `incoming=[]` になる瞬間があっても、`[P0-FLICKER] SYNC SKIP: transient empty` のログが出て Map が保持されている
  - 送信完了後、`lastNonEmptyShapesRef.current` が non-empty の描画を保持している
- **NG時の切り分け**:
  - `isFreezing` が false のままなら handoff ロジックの不具合
  - Map がクリアされているなら P0-FLICKER パッチの条件不足
  - temp→real 遷移で描画が消えるなら canvasContextKey の不適切な変化

---

## 実行記録

| 実行日 | 実行者 | 結果 | メモ |
|--------|--------|------|------|
| 2026-01-17 | - | 未実行 | 次スコープで V-01〜V-05 を1周実行予定 |