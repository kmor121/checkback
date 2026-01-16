# SPEC.md - ファイル共有/レビュープラットフォーム 仕様書

## 0. このドキュメントの位置づけ

**正本（Single Source of Truth）:**
このドキュメントは、本アプリケーションの機能・仕様・設計原則に関する唯一の正として扱います。開発・QA・仕様変更の議論は、すべてこのドキュメントを基準とします。

**更新ルール:**
- **ロジック変更と同時に更新:** State管理・イベントフロー・コンポーネント責務など、挙動に関わる変更を行った場合は、必ずこのドキュメントの該当箇所を更新。PR に更新差分を含める。
- **コメント修正は不要:** コード内のコメント修正やリファクタリング（挙動に影響しない）では、このドキュメント更新不要。

**関連ドキュメント:**
- `functions/documentation/BUGS.md` - バグ台帳・修正ガイド
- `functions/documentation/VERIFY.md` - 回帰テスト手順
- `functions/documentation/STATE.md` - プロジェクト進行状況

---

## 1. 概要

### 目的
- ユーザーがファイル（主に PDF・画像）を共有・閲覧・レビュー可能。
- 複数の人員が同一ファイルに対してコメント・描画注釈を付与し、フィードバック循環を実現。
- 版管理：ファイルの更新があれば新バージョンを作成・管理。
- 共有リンク：期限・権限・DL可否を制御し、外部・内部に安全に共有。

### 非目的
- リアルタイム協調編集（複数人同時描画）。
- ドキュメント自体の編集機能（コメント・注釈のみ）。
- AI自動分析・OCR。
- モバイルネイティブアプリ（Web のみ）。

---

## 2. 用語集

| 用語 | 意味 |
| :--- | :--- |
| **File** | アップロード対象（PDF/画像等）。複数Versionを持つ。 |
| **Version** | File の版。1回のアップロード = 新Version。 |
| **Project** | ファイル集約の単位。複数File を含む。 |
| **ProjectMember** | Project に属するユーザー（owner / member 役割）。 |
| **Comment** | ユーザーが特定座標に付けたコメント。テキスト + 座標情報。 |
| **Annotation / Paint** | Comment に紐づく描画（ペン・図形・矢印・テキスト）。 |
| **Draft** | 送信前の下書き状態。localStorage に一時保存。 |
| **temp ID** | Draft 作成時の仮 Comment ID（temp_XXXXX 形式）。DB に未保存。 |
| **real ID** | Comment が DB に保存された後の真の ID。 |
| **Handoff** | Draft → real への遷移（送信時）。DB 反映と描画同期が必須。 |
| **Freeze** | 送信中、描画を一時固定・保護（react-query refetch 中の消失対策）。 |
| **ShareLink** | 外部ユーザーに共有するリンク。トークン・期限・権限を含む。 |
| **Guest** | ShareLink 経由でアクセスしたユーザー（ログイン不要）。 |

---

## 3. ユーザー種別と権限

| 権限 | できる操作 | できない操作 |
| :--- | :--- | :--- |
| **Admin** | Project・File 管理、全ユーザー管理、削除、権限変更 | （未決：制限あるか） |
| **Project Owner** | Project・File 管理、メンバー追加、コメント・注釈 | 他 Owner の操作、削除 |
| **Member** | コメント・注釈、File 閲覧・DL（権限による） | File 削除、メンバー管理 |
| **Guest（ShareLink 経由）** | File 閲覧、コメント（可否は リンク設定 で制御） | Project 管理、File DL（可否は リンク設定 で制御） |

---

## 4. 主要画面一覧

### 4.1 Pages

| パス | 機能 | ユーザー種別 |
| :--- | :--- | :--- |
| `/` | ホーム・プロジェクト一覧 | 全員（要ログイン） |
| `/projects` | Project 管理 | Login 必須 |
| `/projects/{projectId}/files` | 当 Project の File 一覧 | Project Member + Owner |
| `/files/{fileId}` または `/share/{shareToken}` | File 閲覧・レビュー（FileView） | Project Member / Guest（リンク経由） |
| `/account` | ユーザー設定 | 全員（要ログイン） |

### 4.2 モーダル・パネル（未決：詳細UI）

- **Share Link 作成/設定:** 期限・権限・DL 可否を指定。
- **Comment 返信:** 親 Comment への返信入力。
- **Notification パネル:** 通知一覧（コメント・レビュー進捗等）。

---

## 5. ファイル管理

### 5.1 アップロード

- **場所:** Project 内の File 追加。
- **操作:** File 選択 → 送信 → FileAsset 作成 + 初版 FileVersion 作成。
- **バージョン番号:** version_no = 1 から始まる。
- **ステータス:** 「未設定」→「進行中」→「完了」（管理側で手動制御）。

### 5.2 閲覧・ダウンロード

- **表示:** File 一覧から選択 → FileView 開く。
- **DL:** ShareLink の `allow_download` フラグで制御。
- **権限:** Project Member は常に DL 可。Guest は リンク設定 依存。

### 5.3 版管理

- **複数バージョン同時表示:** 未決（同一画面 / タブ切替 / 別ウィンドウ？）。
- **バージョン切り替え:** File 右上ドロップダウン（想定）で選択。
- **前版・新版の比較:** 未決（実装方針）。

### 5.4 差し替え・削除

- **差し替え:** 新 Version アップロード → version_no 自動採番。
- **削除:** 未決（ハードデリート / ソフトデリート / アーカイブ）。

---

## 6. レビューコメント

### 6.1 作成

- **入力方法:** 画像上の座標をクリック → Textarea ポップアップ → テキスト入力 → 送信。
- **座標情報:** 画像座標（正規化: 0-1）で DB に保存（ズーム・パン に依存しない）。
- **ページ指定:** 複数ページ File（PDF）の場合、page_no で区別。
- **Comment ID:**
  - Draft 作成時: temp_XXXXX（仮）。
  - DB 送信後: real_YYYYY（真）。handoff で遷移。

### 6.2 返信

- **構造:** parent_comment_id で親 Comment を指定。
- **ネスト深さ:** 未決（何階層まで？）。

### 6.3 解決・クローズ

- **resolved フラグ:** true / false（デフォルト false）。
- **解決者:** resolved_by（ユーザー名）。
- **解決日時:** resolved_at（タイムスタンプ）。

### 6.4 添付

- **ファイル添付:** ReviewCommentAttachment entity で管理。
- **対応フォーマット:** 画像 / 動画 / PDF（未決：詳細）。

### 6.5 削除

- **権限:** Comment 作成者 + Project Owner のみ。
- **方式:** 未決（ハードデリート / ソフトデリート）。

---

## 7. 描画注釈（Paint）

### 7.1 ツール

| ツール | 機能 |
| :--- | :--- |
| **Pen** | 自由線描画（Konva Line tensioned）。 |
| **Rect** | 矩形描画。 |
| **Circle** | 円描画。 |
| **Arrow** | 矢印描画（Konva Arrow）。 |
| **Text** | テキスト挿入。フォントサイズ・色 自動 or 手動。 |
| **Select** | 既存描画の選択・移動・リサイズ・削除。 |

### 7.2 座標・スケーリング

- **描画座標:** 画像内座標（正規化: 0-1）で保存。
- **ズーム・パン:** 表示スケール変更でも座標は変わらない。
- **スケール算出:** fitScale（画面に収める）×  userZoom（ユーザー指定）。

### 7.3 Comment 紐付け

- **1 Comment = 複数 Paint shape:** 同一座標 Comment に複数描画可。
- **paint_shape → comment_id:** PaintShape entity の comment_id で参照。

### 7.4 選択・編集

- **選択:** select ツール で shape をクリック → outline 表示。
- **編集:** 移動 / リサイズ / 色・太さ変更 / 削除。
- **保存:** 毎操作後に DB へ upsert（draft ではなく即座に）。

---

## 8. Draft の扱い

### 8.1 ローカル下書き

- **保存先:** localStorage の `draftPaint:` プレフィックス key。
- **キー形式:**
  - 新規作成: `draftPaint:file_{fileId}:new:{tempCommentId}`
  - 既存編集: `draftPaint:file_{fileId}:edit:{realCommentId}`
- **保存内容:** shapes 配列 + metadata（ファイル ID・ページ番号等）。

### 8.2 自動保存

- **タイミング:** ペイント終了時（pointerUp）。
- **方式:** 即座に DB upsert ではなく、localStorage に一時保存。
- **タイムアウト:** 未決（何秒で自動 flush か）。

### 8.3 送信フロー（temp → real）

1. ユーザーが「コメント送信」ボタン押下。
2. Draft shapes を一時取得（handoffRef snapshot）。
3. DB に Comment 作成（temp_XXXXX → real_YYYYY 割り当て）。
4. 同じ shapes を Comment に紐付けて再保存。
5. localStorage をクリア。
6. freezeRef で描画を一時固定（react-query refetch 中）。
7. refetch 完了後、freezeRef クリア → 新規コメント表示。

### 8.4 キャンセル・リセット

- **キャンセル時:** localStorage から該当キーを削除。
- **リロード時:** localStorage から復元（ページ戻り対策）。

---

## 9. 共有リンク

### 9.1 作成

- **操作:** File 右上「Share」ボタン → ShareLink 設定モーダル。
- **必須項目:** token（自動生成）、is_active（デフォルト true）。
- **オプション:**
  - expires_at（期限設定 / 無期限選択可）。
  - password_enabled + password_hash（パスワード保護）。
  - allow_download（DL 許可 / 禁止）。
  - can_view_comments（コメント閲覧許可 / 禁止）。
  - can_post_comments（コメント投稿許可 / 禁止）。

### 9.2 アクセス

- **URL:** `/share/{shareToken}`。
- **認証:** URL token のみ（ログイン不要）。
- **Guest 作成:** 初回アクセス時に Guest record 作成（未決：スキーマ）。

### 9.3 無効化・有効期限

- **無効化:** is_active = false（削除ではなく disabling）。
- **期限チェック:** 毎リクエスト時に expires_at 確認（期限切れ → 403）。

### 9.4 リンク再生成

- **実装未決:** 既存 token を無効化 + 新 token 発行するか、リンク URL は不変か。

---

## 10. 選択状態の原則

### 10.1 activeCommentId

- **定義:** 現在選択中の Comment ID（temp_XXXXX / real_YYYYY）。
- **用途:** Canvas 描画フィルタ（該当 Comment の shape のみ表示）。
- **初期値:** null（何も選択されていない）。

### 10.2 変更タイミング

- **ユーザー選択:** 右パネルのコメント一覧から click → activeCommentId 更新。
- **新規作成時:** Textarea フォーカス → activeCommentId = null（新規モード）→ Canvas は temp_XXXXX ID で描画準備。
- **送信完了時:** DB 反映後 → activeCommentId = real_YYYYY に更新。

### 10.3 Selection Suppressed（選択抑制）

- **ルール:** 新規コメント入力中（Textarea フォーカス）は、右パネルコメント選択を完全ブロック。
- **実装:** `onPointerDownCapture` で右パネル click を `stopPropagation()` + `preventDefault()`。
- **解除タイミング:** キャンセル or 送信完了時。
- **目的:** 入力中の activeCommentId 変更防止（描画ターゲット混乱を防ぐ）。

---

## 11. ViewerCanvas の原則

### 11.1 常時レンダリング

- **ルール:** ViewerCanvas コンポーネント自体は **再マウント禁止**（ズーム・パン保持のため）。
- **代替案:** 内部 Layer に `key={hidePaintOverlay ? 'hide' : 'show'}` 付与。
- **効果:** 隠示/表示時に Layer のみ再マウント → 前フレームの描画幽霊消去。

### 11.2 座標変換・スケーリング

- **fitScale:** containerSize に収まる最大スケール。
- **userZoom:** 100% = fitScale、 200% = 2 × fitScale。
- **描画座標の固定:** 正規化座標（0-1）で保存 → denormalize で復元（ズーム独立）。

### 11.3 禁止事項

- ❌ `paintMode` 変化で `Stage` / `ViewerCanvas` 全体を key で再マウント。
- ❌ useEffect 依存配列に無関係 state を入れない（paintMode 含めると ON/OFF で描画リセット）。
- ❌ activeCommentId を推測で更新（ユーザー操作に由来する変化のみ）。
- ❌ handoffRef / freezeRef を DB 反映前にクリア（react-query `isFetching` 確認後）。
- ❌ currentShape と Map に shape 重複挿入（描画中は currentShape 独立、Map から除外）。

### 11.4 Map 方式での不変更新

- **原則:** `shapesMapRef.current = new Map(...)` で新参照を作成。
- **理由:** 既存 Map ミューテートでは参照変化が検知されない（re-render 発火しない）。

---

## 12. 例外・エラーハンドリング

| シナリオ | 対応 |
| :--- | :--- |
| ネットワークエラー | toast 通知 + retry button（未決：詳細） |
| File 削除済み | 404 → トップへリダイレクト |
| 権限不足 | 403 → 警告 toast + 操作不可 |
| Comment 投稿中の離脱 | localStorage draft 保存 + ページ戻り復元 |
| 同時編集（複数タブ） | 未決（最後の書き込み勝利 / conflict detection / lock？） |

---

## 13. 非機能要件

### 13.1 性能

- **Canvas render:** 60fps 目標（ズーム・パン smooth）。
- **Comment list:** 未決（何件まで遅延ロード可か）。
- **Paint shapes:** 未決（上限何個か）。

### 13.2 ログ・監視

- **操作ログ:** Comment 作成・編集・削除・View を記録（未決：保存先）。
- **エラーログ:** JS error / API error を捕捉（ErrorBoundary + global handler）。

### 13.3 データ保全

- **Backup:** 未決（定期 export / DB snapshot？）。
- **削除ポリシー:** 未決（削除後の復旧期間）。

---

## 14. Verify（回帰テスト）

最低 5 点の必須テスト（詳細は `VERIFY.md` を参照）：

- **V-01:** Comment 選択維持（他 Comment 選択時に古い Comment が再選択されない）。
- **V-02:** テキスト入力中、選択ブロック。
- **V-03:** Canvas ズーム・パン保持（paintMode ON/OFF）。
- **V-04:** Draft 下書き保存・復元（localStorage）。
- **V-05:** temp → real handoff（送信後、描画ちらつき / 消失なし）。

推奨テスト 5 項（V-A01 ～ A05）も別途実施。

---

## 15. 未決事項リスト

| # | 項目 | 選択肢・補足 | 優先度 |
| :--- | :--- | :--- | :--- |
| 1 | 複数 Version 比較方法 | 同一画面分割 / タブ切替 / 別ウィンドウ | 中 |
| 2 | Comment 返信ネスト深さ | 2階層 / 3階層 / 無制限 | 中 |
| 3 | File 削除方式 | ハード / ソフト / アーカイブ | 高 |
| 4 | 同時編集対応 | 未対応 / conflict detection / optimistic lock | 低 |
| 5 | Pain shape 上限 | 1000 / 5000 / unlimited | 中 |
| 6 | Draft 自動 flush タイムアウト | 5秒 / 10秒 / 手動保存のみ | 中 |
| 7 | Guest ユーザースキーマ | email 必須 / 名前のみ / token のみ | 高 |
| 8 | パスワード保護実装 | Basic auth / JWT token / other | 中 |
| 9 | ページ差し替え時の Comment | 新 Version に引き継ぎ / 初期化 / ユーザー選択 | 高 |
| 10 | Admin ユーザーの権限上限 | 全操作可 / Project Owner のみ削除可 / other | 高 |

**決定順序の推奨:** 7 → 10 → 9 → 3 → 2 → 1 → 4 → 5 → 6 → 8

---

## 更新履歴

### 2026-01-16 v1.0 - 初版

- Core entity、画面、フロー、デザイン原則を整理。
- 既存コード（BUGS.md / VERIFY.md / STATE.md）を参照し、根拠を明示。
- 「未決」セクションで決定待機項目を可視化。