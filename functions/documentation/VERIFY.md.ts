# VERIFY.md - 回帰テスト手順書

## 運用ルール
- 修正後は関連テストを必ず実施し、末尾の「実行記録」に結果を追記する。
- 全関連テストが OK になるまで Done にしない（NGは差し戻し）。
- 推測でOK/NGを付けない（実際に手操作して確認）。

---

## 必須テスト項目（最低5点）

### V-01: 既存コメント選択と描画表示

**手順:**
1. ShareView でファイルを開く（既存コメント・描画あり）
2. 右パネルのコメントをクリックして選択
3. Canvas 上に対応するピンと描画が表示されるか確認

**期待結果:**
- 選択したコメントのピンがハイライト
- 紐付く描画（PaintShape）が Canvas 上に表示される
- ズーム/パンが保持されている

**観測ポイント:**
- `activeCommentId` の値
- Canvas 上の描画レイヤーの表示状態
- Console に描画関連エラーがないか

**NG時切り分け:**
- 描画が表示されない → PaintCanvas の mount/unmount タイミング確認
- ピンが表示されない → CommentPin の条件分岐確認

---

### V-02: 新規コメント入力中の選択抑制

**手順:**
1. ShareView でファイルを開く
2. Canvas 上の任意の位置で「テキストのみ」新規コメント入力開始
3. 入力中（Textarea フォーカス中）に右パネルの別コメントをクリック

**期待結果:**
- クリックしても選択が切り替わらない
- Textarea のフォーカスが保持される
- 入力内容が失われない

**観測ポイント:**
- `onPointerDownCapture` が発火しているか（Console ログ）
- `isNewCommentInputActive` の値
- `activeCommentId` が null 維持されているか

**NG時切り分け:**
- 選択が切り替わる → `onPointerDownCapture` の条件確認
- Textarea のフォーカスが外れる → `stopPropagation()` / `preventDefault()` の実装確認

---

### V-03: ペイントモード切替時のズーム/パン保持

**手順:**
1. ShareView でファイルを開く
2. ズームイン（拡大）し、パン（移動）する
3. ペイントモードをONにする
4. ペイントモードをOFFにする

**期待結果:**
- ペイントモード切替前後でズーム/パンが保持される
- Canvas の表示位置が変わらない

**観測ポイント:**
- Stage の `scaleX`/`scaleY`/`x`/`y` の値（切替前後で比較）
- ViewerCanvas の再マウント有無（Console の mount/unmount ログ）
- useEffect の依存配列に `paintMode` が含まれているか

**NG時切り分け:**
- ズーム/パンがリセットされる → Stage の key 確認、useEffect 依存配列確認
- Canvas が再マウントされる → ViewerCanvas の親コンポーネント確認

---

### V-04: 描画下書き（localStorage）のモード往復

**手順:**
1. ShareView でファイルを開く
2. 既存コメントを選択し、ペイントモードをONにする
3. 描画を追加（pen/rectなど）
4. ペイントモードをOFFにする（localStorage に保存される）
5. 再度ペイントモードをONにする

**期待結果:**
- 手順5で描画が復元される（localStorage から読み込まれる）
- 描画が消えていない

**観測ポイント:**
- localStorage の `draft_paint_*` キーの有無
- PaintCanvas の `loadDraft()` 呼び出しログ
- 復元された shapes の数

**NG時切り分け:**
- 描画が消える → localStorage 保存タイミング確認
- 復元されない → loadDraft() の条件分岐確認

---

### V-05: temp → real 遷移時の描画保持（handoff/freeze）

**手順:**
1. ShareView でファイルを開く
2. Canvas 上の任意の位置で新規コメント入力開始（描画あり）
3. 描画を追加（pen/rect/circleなど）
4. テキストを入力し、送信ボタンをクリック

**期待結果:**
- 送信中（react-query refetch中）も描画が表示され続ける
- temp → real 遷移時にちらつかない
- 新規コメント作成後、描画が正しく表示される

**観測ポイント:**
- `handoffRef.snapshot` の内容（送信直前）
- `freezeRef.shapesForCanvas` の内容（freeze中）
- `lockPaintContextIdRef.current` の値（temp/real ID）
- Console の "handoff" / "freeze" / "unlock" ログ

**NG時切り分け:**
- 描画が消える → handoffRef/freezeRef のタイミング確認
- ちらつく → freeze 解除タイミング確認（isFetching=false の確認）

---

## 実行記録

| 日付       | 実行者 | V-01 | V-02 | V-03 | V-04 | V-05 | メモ |
| :--------- | :----- | :--- | :--- | :--- | :--- | :--- | :--- |
| 2026-01-17 | User   | OK   | OK   | OK   | OK   | OK   | ユーザー実測。V-05: Slow 3G、送信中〜完了後も描画消えず/ちらつきなし |

---
## 追加テスト項目

### V-F01: ズームとフィット表示

**手順:**
1. ShareView で任意のファイルを開く
2. 初期表示で見切れていないことを確認（全体フィット）
3. 「＋」「－」ボタンで拡大・縮小できることを確認
4. 「全体」「横」「縦」ボタンでそれぞれのフィット表示になることを確認
5. ズームした状態でペイントモードをON/OFFし、ズームとパンが維持されることを確認

**期待結果:**
- 初期表示で見切れない
- ズーム操作が機能する
- 各フィット表示が正しく適用される
- ペイント切替で表示がリセットされない