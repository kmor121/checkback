# SPEC.md - ファイル共有/レビュープラットフォーム 仕様書

## Do-not-break（絶対維持）

以下の設計契約は **絶対に壊さない**（修正時も必ず維持）：

### 1. Selection suppressed（選択抑制）
- 新規コメント入力中（`isNewCommentInputActive=true` または Textarea フォーカス中）は、右パネルのコメント選択を `onPointerDownCapture` で完全ブロック。
- `stopPropagation()` + `preventDefault()` で二重保険。
- 解除タイミング: 入力キャンセル時 or 送信完了時。

### 2. activeCommentId null化（新規入力時）
- `enterNewTextOnlyComposer()` が呼び出された瞬間に `activeCommentId` を `null` に。
- これにより Canvas は "新規描画モード（temp_XXX ID）" に切り替わる。
- テキスト送信後、新規コメントが作成され `activeCommentId` が real_YYYY に更新される。

### 3. ViewerCanvas 常時レンダリング（Stage remount禁止）
- `ViewerCanvas` コンポーネント自体は **再マウント禁止**（ズーム/パン保持のため）。
- 代わりに、内部の `<Layer>` に `key={hidePaintOverlay ? 'hide' : 'show'}` を付与。
- 隠示/表示時に Layer のみ再マウント→前フレームの描画幽霊を確実に消去。
- **Stage に key を付けて強制再マウント（対症療法）は禁止**。

### 4. temp → real handoff/freeze
- コメント送信時、`handoffRef.snapshot` と `freezeRef.shapesForCanvas` で描画を二重保護。
- `react-query` 再フェッチ中も描画が消えない。
- freeze 解除タイミング: `react-query` の `isFetching=false` 確認後。
- `lockPaintContextIdRef` で temp→real の ID 切替を一時的にロック。

### 5. hidePaintOverlay の条件
- 「新規入力開始 **かつ** 描画がゼロ」の場合のみ Paint Layer を hide。
- 描画が1つでもある場合は、hide しない（描画を見せ続ける）。

### 6. Map 方式での不変更新
- `shapesMapRef.current = new Map(...)` で新しい参照を作成。
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
- `project_id` が null の場合は QuickCheck ファイル

### FileVersion
- バージョン管理（file_id + version_no）

### ReviewComment
- コメント本文 + ピン座標（anchor_nx/anchor_ny）
- `author_type`: user / guest
- `resolved`: 対応済みフラグ
- `parent_comment_id`: スレッド構造

### PaintShape
- 描画データ（shape_type + data_json）
- `comment_id` 必須（コメントに紐付く）
- `client_shape_id`: クライアント側 UUID（重複防止）
- `author_key`: ゲスト/ユーザー識別

### ShareLink
- 共有リンク（token + 有効期限 + 権限設定）
- `can_view_comments` / `can_post_comments`: ゲスト権限

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