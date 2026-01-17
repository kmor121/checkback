import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const DOCUMENTS = {
  'SPEC.md': `# SPEC.md - ファイル共有/レビュープラットフォーム 仕様書

## Do-not-break（絶対維持）

以下の設計契約は **絶対に壊さない**（修正時も必ず維持）：

### 1. Selection suppressed（選択抑制）
- 新規コメント入力中（\`isNewCommentInputActive=true\` または Textarea フォーカス中）は、右パネルのコメント選択を \`onPointerDownCapture\` で完全ブロック。
- \`stopPropagation()\` + \`preventDefault()\` で二重保険。
- 解除タイミング: 入力キャンセル時 or 送信完了時。

### 2. activeCommentId null化（新規入力時）
- \`enterNewTextOnlyComposer()\` が呼び出された瞬間に \`activeCommentId\` を \`null\` に。
- これにより Canvas は "新規描画モード（temp_XXX ID）" に切り替わる。
- テキスト送信後、新規コメントが作成され \`activeCommentId\` が real_YYYY に更新される。

### 3. ViewerCanvas 常時レンダリング（Stage remount禁止）
- \`ViewerCanvas\` コンポーネント自体は **再マウント禁止**（ズーム/パン保持のため）。
- 代わりに、内部の \`<Layer>\` に \`key={hidePaintOverlay ? 'hide' : 'show'}\` を付与。
- 隠示/表示時に Layer のみ再マウント→前フレームの描画幽霊を確実に消去。
- **Stage に key を付けて強制再マウント（対症療法）は禁止**。

### 4. temp → real handoff/freeze
- コメント送信時、\`handoffRef.snapshot\` と \`freezeRef.shapesForCanvas\` で描画を二重保護。
- \`react-query\` 再フェッチ中も描画が消えない。
- freeze 解除タイミング: \`react-query\` の \`isFetching=false\` 確認後。
- \`lockPaintContextIdRef\` で temp→real の ID 切替を一時的にロック。

### 5. hidePaintOverlay の条件
- 「新規入力開始 **かつ** 描画がゼロ」の場合のみ Paint Layer を hide。
- 描画が1つでもある場合は、hide しない（描画を見せ続ける）。

### 6. Map 方式での不変更新
- \`shapesMapRef.current = new Map(...)\` で新しい参照を作成。
- 既存 Map をミューテートしない（参照の入れ替わりが検知されない）。

---

## アーキテクチャ概要

### コアコンポーネント
- **ShareView.jsx**: 共有リンク経由のファイルビュー（ゲスト/ユーザー両対応）
- **ViewerCanvas.jsx**: Konva ベースの画像/PDF ビューア + 描画レイヤー
- **PaintCanvas.jsx**: 描画ツール（pen/rect/circle/arrow/text/highlight/mosaic）
- **CommentPin.jsx**: コメントピン（座標・ページ紐付き）

### データフロー
1. ファイル読み込み（FileAsset + FileVersion）
2. コメント一覧取得（ReviewComment）
3. 描画データ取得（PaintShape）
4. ユーザー操作→描画データ保存→react-query 再フェッチ
5. temp → real 遷移（handoff/freeze 経由）

---

## エンティティ設計

### FileAsset
- ファイル本体（URL/MIME/サイズ/ステータス）
- \`project_id\` が null の場合は QuickCheck ファイル

### FileVersion
- バージョン管理（file_id + version_no）

### ReviewComment
- コメント本文 + ピン座標（anchor_nx/anchor_ny）
- \`author_type\`: user / guest
- \`resolved\`: 対応済みフラグ
- \`parent_comment_id\`: スレッド構造

### PaintShape
- 描画データ（shape_type + data_json）
- \`comment_id\` 必須（コメントに紐付く）
- \`client_shape_id\`: クライアント側 UUID（重複防止）
- \`author_key\`: ゲスト/ユーザー識別

### ShareLink
- 共有リンク（token + 有効期限 + 権限設定）
- \`can_view_comments\` / \`can_post_comments\`: ゲスト権限

---

## 運用方針

### 修正時の絶対ルール
1. **推測修正禁止**: 根拠なしで変更しない（Verify 結果を元に判断）
2. **最小差分**: 無関係な変更を混入させない
3. **Verify 通過が完了条件**: Done(Verified) は Verify OK を根拠に記載
4. **1スコープ=1バグ/1機能**: 範囲を広げない
5. **Do-not-break 厳守**: 上記6契約は絶対に壊さない

### ドキュメント体系
- **SPEC.md**: 仕様・契約（このファイル）
- **BUGS.md**: バグ台帳（優先度・ステータス管理）
- **VERIFY.md**: 回帰テスト手順書（実行記録含む）
- **STATE.md**: 現在地（バグTOP3・直近の変更・次のステップ）
`,

  'BUGS.md': `# BUGS.md - バグ台帳

## 優先度定義

| レベル | 説明                                                                             | 修正SLA     |
| :----- | :------------------------------------------------------------------------------- | :---------- |
| **P0** | **Critical:** ユーザーが機能を使用できない / データ破損 / セキュリティリスク       | 即日対応    |
| **P1** | **High:** ユーザーエクスペリエンスに大きく悪影響 / 頻繁に発生 / 重要な機能に関係 | 1-2営業日   |
| **P2** | **Medium:** ユーザーが回避策で対応可能 / 低頻度 / 周辺機能に影響               | 1週間以内   |

---

## 運用ルール

### 推測修正禁止の原則

-   **絶対禁止事項:**
    -   不具合の原因を推測で特定し、該当コードを確認せずに修正する。
    -   「多分ここが原因だろう」という判断で差分を作成する。
-   **必須プロセス:**
    -   修正前に \`Files inspected\` セクションで、実際に読んだファイル・行番号を明記する。
    -   \`Search terms\` でコード検索結果を記録する。
    -   \`Relevant code\` に、問題の根拠となるコード抜粋を貼り付ける。

### 最小差分の原則

-   修正対象ファイルの周辺のみを変更。
-   整形、命名変更、リファクタリングなど、無関係な変更は禁止。
-   1修正＝1差分。複数の問題がある場合は別バグとして分離。

### Verifyゲート（必須）

-   **修正完了＝「Fixing」ステータス。**
-   **Verify実施＝「Verify」ステータスへ。**
-   **5点テスト（Verify リスト）をすべて通過してから、「Done」へ昇格。**
-   Verify未通過で「Done」にしない。

---

## バグ一覧

### B-0001: 入力中の再選択（selection suppressed）

- **優先度:** P1
- **影響範囲:** ShareView / UI
- **発生頻度:** 特定条件（新規コメント入力中に他コメントをクリック）

**再現手順:**
1. ShareView でファイルを開く
2. 「テキストのみ」で新規コメント入力開始
3. 入力中に右パネルの別コメントをクリック

**現象:**
- 入力中なのに選択が切り替わり、入力内容が失われる可能性

**期待結果:**
- 入力中は選択抑制され、クリックしても選択が変わらない

**Fix方針:**
- \`onPointerDownCapture\` で選択を完全ブロック
- \`isNewCommentInputActive=true\` または Textarea フォーカス中に発動

**ステータス:** Done (Verified)
**Verify結果:** V-02 PASS（2026-01-17）
**メモ:** 入力開始時の activeCommentId/composerTargetCommentId null化 + 選択抑制で解決。回帰監視のみ。

---

### B-0002: paint ON/OFF のズーム/パン飛び

- **優先度:** P1
- **影響範囲:** ViewerCanvas / PaintCanvas
- **発生頻度:** 常に（ペイントモード切替時）

**再現手順:**
1. ShareView でファイルを開く
2. ズーム/パンを調整
3. ペイントモードをON→OFFまたはOFF→ONに切り替え

**現象:**
- ズーム/パンがリセットされ、初期状態（中央・等倍）に戻る

**期待結果:**
- ペイントモードを切り替えても、ズーム/パンが保持される

**暫定仮説:**
- Stage/ViewerCanvas の再マウント
- useEffect 依存配列の誤り
- zoom/pan state のリセット経路

**ステータス:** Investigating
**Verify結果:** V-03 未実施（次スコープで実行予定）
**メモ:** 推測修正禁止。Files inspected/Relevant code を揃えてから修正。

---

### B-0003: handoff/freeze 由来のちらつき

- **優先度:** P0
- **影響範囲:** ShareView / ViewerCanvas / PaintCanvas
- **発生頻度:** 常に（temp→real 遷移時）

**再現手順:**
1. ShareView で新規コメント入力開始（描画あり）
2. 描画を追加
3. テキスト送信

**現象:**
- temp→real 遷移時に描画が一瞬消える/ちらつく
- handoffRef/freezeRef が機能していない可能性

**期待結果:**
- temp→real 遷移時も描画が消えず、シームレスに表示される

**暫定仮説:**
- handoffRef/freezeRef/lockPaintContextIdRef の解除タイミング
- react-query refetch との同期ずれ
- shapesMapRef の不変更新漏れ

**ステータス:** Investigating
**Verify結果:** V-05 未実施（次スコープで実行予定）
**メモ:** 推測修正禁止。handoff/freeze のタイムラインログを揃えてから修正。
`,

  'VERIFY.md': `# VERIFY.md - 回帰テスト手順書

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
- \`activeCommentId\` の値
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
- \`onPointerDownCapture\` が発火しているか（Console ログ）
- \`isNewCommentInputActive\` の値
- \`activeCommentId\` が null 維持されているか

**NG時切り分け:**
- 選択が切り替わる → \`onPointerDownCapture\` の条件確認
- Textarea のフォーカスが外れる → \`stopPropagation()\` / \`preventDefault()\` の実装確認

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
- Stage の \`scaleX\`/\`scaleY\`/\`x\`/\`y\` の値（切替前後で比較）
- ViewerCanvas の再マウント有無（Console の mount/unmount ログ）
- useEffect の依存配列に \`paintMode\` が含まれているか

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
- localStorage の \`draft_paint_*\` キーの有無
- PaintCanvas の \`loadDraft()\` 呼び出しログ
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
- \`handoffRef.snapshot\` の内容（送信直前）
- \`freezeRef.shapesForCanvas\` の内容（freeze中）
- \`lockPaintContextIdRef.current\` の値（temp/real ID）
- Console の "handoff" / "freeze" / "unlock" ログ

**NG時切り分け:**
- 描画が消える → handoffRef/freezeRef のタイミング確認
- ちらつく → freeze 解除タイミング確認（isFetching=false の確認）

---

## 実行記録

| 日付       | 実行者 | V-01 | V-02 | V-03 | V-04 | V-05 | メモ |
| :--------- | :----- | :--- | :--- | :--- | :--- | :--- | :--- |
| 2026-01-17 | -      | -    | -    | -    | -    | -    | 次スコープで実行予定 |
`,

  'STATE.md': `# STATE.md - プロジェクト現在地

## TL;DR

-   **フェーズ:** ビューア/コメント/描画 の基本機能 + 複数FIX・設計確立済み。修正メイン（新規4：修正6）。
-   **コア課題:** temp→real ハンドオフ時のちらつき（P0）と、ペイントモード切替時のズーム飛び（P1）が **Investigating**。
-   **重要:** Selection suppressed、Composer textarea操作時の\`activeCommentId\` null化、ViewerCanvas常時レンダリング（Layer key切替）は **絶対維持**。
-   **Next:** V-01〜V-05 を実行→VERIFY実行記録→BUGS/STATE整合更新。

---

## 今のゴール

### 短期（1-2週間）

-   P0バグ（B-0003: handoff/freeze）の原因特定と修正。
-   P1バグ（B-0002: paintMode ズーム飛び）の原因検査。
-   VERIFY.md の最低5点テストを全点 OK に。

### 中期（1ヶ月）

-   追加推奨テスト 5項（V-A01〜A05）の実装・検証。
-   大量データ・例外系の負荷テスト。
-   手操作テスト記録の蓄積（実行記録セクション埋め）。

---

## バグTOP3

| ID     | 症状                                      | 優先度 | 現状            | 次アクション                           |
| :----- | :---------------------------------------- | :----- | :-------------- | :------------------------------------- |
| B-0003 | temp→real後、描画がちらつく/消える        | **P0** | Investigating   | V-05実行→根拠確定→修正                  |
| B-0002 | ペイント ON/OFF時、ズーム/パンが飛ぶ        | **P1** | Investigating   | V-03実行→根拠確定→修正                  |
| B-0001 | テキスト入力中、他コメントが再選択される   | **P1** | Done (Verified) | V-02 PASS - リグレッション監視のみ      |

---

## 直近の変更（7日分）

| 日付       | 要点                                   | 影響範囲                    | Verify要約                   |
| :--------- | :------------------------------------- | :-------------------------- | :--------------------------- |
| 2026-01-17 | AdminDocuments ダウンロード機能修正（backend functionに内容埋込） | functions/downloadDocumentation.js | admin権限チェック付き |
| 2026-01-17 | 4ドキュメント新規作成（Reading成功）    | documentation               | 次: V-01〜V-05 実行          |
| 2026-01-17 | admin専用ドキュメントダウンロードページ | pages/AdminDocuments.jsx    | -（ドキュメント）            |

---

## 重要な設計方針（必ず守る）

1. **Selection Suppressed（選択抑制）**
   - 新規コメント入力中（\`isNewCommentInputActive=true\` または Textarea フォーカス中）は、右パネルのコメント選択を \`onPointerDownCapture\` で完全ブロック。
   - \`stopPropagation()\` + \`preventDefault()\` で二重保険。
   - 解除タイミング: 入力キャンセル時 or 送信完了時。

2. **activeCommentId null化（新規入力時）**
   - \`enterNewTextOnlyComposer()\` が呼び出された瞬間に \`activeCommentId\` を \`null\` に。
   - これにより Canvas は "新規描画モード（temp_XXX ID）" に切り替わる。
   - テキスト送信後、新規コメントが作成され \`activeCommentId\` が real_YYYY に更新される。

3. **ViewerCanvas 常時レンダリング（Layer key 制御）**
   - \`ViewerCanvas\` コンポーネント自体は **再マウント禁止**（ズーム/パン保持のため）。
   - 代わりに、内部の \`<Layer>\` に \`key={hidePaintOverlay ? 'hide' : 'show'}\` を付与。
   - 隠示/表示時に Layer のみ再マウント→前フレームの描画幽霊を確実に消去。

4. **temp → real handoff/freeze**
   - コメント送信時、\`handoffRef.snapshot\` と \`freezeRef.shapesForCanvas\` で描画を二重保護。
   - \`react-query\` 再フェッチ中も描画が消えない。
   - freeze 解除タイミング: \`react-query\` の \`isFetching=false\` 確認後。

5. **Map 方式での不変更新**
   - \`shapesMapRef.current = new Map(...)\` で新しい参照を作成。
   - 既存 Map をミューテートしない（参照の入れ替わりが検知されない）。

---

## 次の最小ステップ（1つ）

1. **V-01〜V-05 回帰テスト実行** (P0)
   - ShareView で V-01→V-05 を1周実行
   - 各テストの OK/NG と観測ログ要点を VERIFY.md「実行記録」に追記
   - V-03 結果で B-0002、V-05 結果で B-0003 のステータスを更新
   - STATE.md の「バグTOP3」を検証結果と一致させる
`
};

const ALLOWED_FILES = ['SPEC.md', 'BUGS.md', 'VERIFY.md', 'STATE.md'];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const { fileName } = await req.json();

    if (!fileName || !ALLOWED_FILES.includes(fileName)) {
      return Response.json({ error: 'Invalid file name' }, { status: 400 });
    }

    const content = DOCUMENTS[fileName];
    
    if (!content) {
      return Response.json({ error: 'Document not found' }, { status: 404 });
    }

    return Response.json({ content, fileName });
  } catch (error) {
    console.error('Download error:', error);
    return Response.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
});