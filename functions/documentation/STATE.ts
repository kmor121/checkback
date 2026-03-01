# STATE.md - プロジェクト現在地

## TL;DR

-   **フェーズ:** ビューア/コメント/描画 の基本機能 + 複数FIX・設計確立済み。修正メイン（新規4：修正6）。
-   **直近の成果:** ViewerCanvas大規模リファクタリング完了（2468行→1245行、10ファイル分割）。
-   **コア課題:** temp→real ハンドオフ時のちらつき（P0）と、ペイントモード切替時のズーム飛び（P1）が **Investigating**（リファクタ範囲外、未修正）。
-   **重要:** Selection suppressed、Composer textarea操作時の`activeCommentId` null化、ViewerCanvas常時レンダリング（Layer key切替）は **絶対維持**。
-   **Next:** リファクタ後のV-01〜V-06回帰テスト通過 → P0バグ詳細検査。

---

## 今のゴール

### 短期（1-2週間）

-   ViewerCanvasリファクタ後の回帰テスト全項目OK確認。
-   P0バグ（B-0003: handoff/freeze）の原因特定と修正。
-   P1バグ（B-0002: paintMode ズーム飛び）の原因検査。
-   VERIFY.md の最低6点テストを全点 OK に。

### 中期（1ヶ月）

-   追加推奨テスト 5項（V-A01〜A05）の実装・検証。
-   大量データ・例外系の負荷テスト。
-   手操作テスト記録の蓄積（実行記録セクション埋め）。

---

## バグTOP3

| ID     | 症状                                      | 優先度 | 現状            | 次アクション                           |
| :----- | :---------------------------------------- | :----- | :-------------- | :------------------------------------- |
| B-0003 | temp→real後、描画がちらつく/消える        | **P0** | Investigating   | `handoffRef`/`freezeRef` タイミング検査  |
| B-0002 | ペイント ON/OFF時、ズーム/パンが飛ぶ        | **P1** | Investigating   | useEffect 依存配列、Stage key 検査      |
| B-0001 | テキスト入力中、他コメントが再選択される   | **P1** | Done (Verified) | リグレッション監視のみ                 |

---

## 直近の変更（7日分）

| 日付       | 要点                                   | 影響範囲                    | Verify要約                   |
| :--------- | :------------------------------------- | :-------------------------- | :--------------------------- |
| 2026-03-01 | ViewerCanvas Round1〜3 リファクタ完了  | ViewerCanvas + 10関連ファイル | V-01〜V-06 確認待ち          |
| 2026-01-16 | BUGS.md / VERIFY.md / STATE.md 作成    | 運用体系                    | -（ドキュメント）            |
| 2026-01-xx | handoff/freeze 機構実装               | ShareView / ViewerCanvas    | V-05 検査中                  |
| 2026-01-xx | selection suppressed コントラクト化   | ShareView / Textarea        | V-02 OK                      |
| 2026-01-xx | ViewerCanvas Layer key 制御           | ViewerCanvas (hidePaint)    | V-03 確認中                  |
| 2026-01-xx | draftPaint localStorage 統合          | ShareView / draft           | V-04 確認中                  |

---

## 重要な設計方針（必ず守る）

1. **Selection Suppressed（選択抑制）**
   - 新規コメント入力中（`isNewCommentInputActive=true` または Textarea フォーカス中）は、右パネルのコメント選択を `onPointerDownCapture` で完全ブロック。
   - `stopPropagation()` + `preventDefault()` で二重保険。
   - 解除タイミング: 入力キャンセル時 or 送信完了時。

2. **activeCommentId null化（新規入力時）**
   - `enterNewTextOnlyComposer()` が呼ばれた瞬間に `activeCommentId` を `null` に。
   - これにより Canvas は "新規描画モード（temp_XXX ID）" に切り替わる。
   - テキスト送信後、新規コメントが作成され `activeCommentId` が real_YYYY に更新される。

3. **ViewerCanvas 常時レンダリング（Layer key 制御）**
   - `ViewerCanvas` コンポーネント自体は **再マウント禁止**（ズーム/パン保持のため）。
   - 代わりに、内部の `<Layer>` に `key={hidePaintOverlay ? 'hide' : 'show'}` を付与。
   - 隠示/表示時に Layer のみ再マウント→前フレームの描画幽霊を確実に消去。

4. **temp → real handoff/freeze**
   - コメント送信時、`handoffRef.snapshot` と `freezeRef.shapesForCanvas` で描画を二重保護。
   - `react-query` 再フェッチ中も描画が消えない。
   - freeze 解除タイミング: `react-query` の `isFetching=false` 確認後。

5. **Map 方式での不変更新**
   - `shapesMapRef.current = new Map(...)` で新しい参照を作成。
   - 既存 Map をミューテートしない（参照の入れ替わりが検知されない）。

---

## 中核ファイル一覧

| ファイル                                    | 役割                                       |
| :------------------------------------------ | :----------------------------------------- |
| `pages/ShareView.jsx`                       | コメント管理・新規作成・入力制御の司令塔   |
| **ViewerCanvas 関連（10ファイル）**          |                                            |
| `components/viewer/ViewerCanvas.jsx`        | メインコンポーネント（状態管理・レンダー） 1245行 |
| `components/viewer/ShapeRenderer.jsx`       | shape描画ファクトリ                         |
| `components/viewer/TextShapeRenderer.jsx`   | テキストshape描画                           |
| `components/viewer/TextEditorOverlay.jsx`   | テキスト編集DOMオーバーレイ                 |
| `components/viewer/canvasUtils.js`          | ユーティリティ（UUID、正規化等）            |
| `components/viewer/canvasMapHelpers.js`     | Map操作ヘルパー（immutable更新）            |
| `components/viewer/canvasUndoRedo.js`       | Undo/Redoロジック                           |
| `components/viewer/canvasSyncEngine.js`     | existingShapes同期エンジン                  |
| `components/viewer/canvasConstants.js`      | 共有定数（TEXT_EDITOR_INITIAL, DEBUG_MODE） |
| `components/viewer/canvasTextHandlers.js`   | テキスト編集ハンドラ                        |
| `components/viewer/canvasDragTransformHandlers.js` | ドラッグ/Transform系ハンドラ          |
| **その他**                                  |                                            |
| `components/viewer/FloatingToolbar.jsx`     | ペイント ON/OFF・ツール選択               |
| `components/viewer/CanvasDebugHud.jsx`      | デバッグHUD                                |
| `components/DebugOverlay`                   | エラー捕捉・表示                          |
| `components/utils/draftPaintStorage`        | localStorage 管理（下書き描画）          |
| `functions/documentation/BUGS.md`           | バグ台帳（修正ガイド）                    |
| `functions/documentation/VERIFY.md`         | 回帰テスト手順（ゲート）                  |
| `functions/documentation/STATE.md`          | このファイル（進行状況）                  |

---

## 危険ポイント（やってはいけないこと）

-   ❌ **ViewerCanvas を key で強制再マウント:**
    -   `paintMode` 変化で `Stage` や `ViewerCanvas` 全体を再マウントしない。ズーム・パンが失われる。
    -   Layer のみ key で制御。

-   ❌ **useEffect 依存配列に無関係な state を入れない:**
    -   例：`paintMode` を含めると、ON/OFF で描画状態がリセットされる。
    -   `fileIdentity` / `pageNumber` / `zoom` のみが妥当な依存。

-   ❌ **activeCommentId を推測で更新:**
    -   必ずユーザー操作（コメント選択 or Textarea 入力）に由来する状態変化で更新。
    -   勝手に fallback ID に置き換えない。

-   ❌ **handoffRef/freezeRef を DB 反映前にクリア:**
    -   `react-query` の `isFetching` を確認してからクリア。
    -   タイミングずれで描画消失。

-   ❌ **描画中の shape を currentShape と Map に重複挿入:**
    -   `renderShape()` で currentShape は最後に独立レンダリング。
    -   Map から除外（`renderedShapes` 計算時にフィルタ）。

---

## 次にやること（優先順）

1. **【必須】リファクタ後の回帰テスト V-01〜V-06:**
   -   全項目OKを確認してからP0/P1バグ修正に進む。

2. **【P0】B-0003 詳細検査:**
   -   `handoffRef` / `freezeRef` 生成・解除のタイムスタンプを console.log で記録。
   -   `react-query` の `isFetching` / `isLoading` 状態遷移と照合。
   -   低速回線（Slow 3G）での実行記録を BUGS.md に追加。

3. **【P1】B-0002 検査:**
   -   `ViewerCanvas` の `useEffect` 全量をレビュー（依存配列確認）。
   -   ペイント ON/OFF の前後で `zoom` / `pan` が保持されるか測定。

4. **【運用】BUGS/VERIFY 継続メンテナンス:**
   -   毎修正後に BUGS.md / VERIFY.md を更新。
   -   STATE.md に「直近の変更」を追記。

---

## 更新履歴

### 2026-03-01 Round1〜3リファクタ確定

-   ViewerCanvas 2468行→1245行（約50%削減）。
-   10ファイル構成に分割（責務分離）。
-   ロジック変更なし（構造リファクタのみ）。
-   回帰テスト V-01〜V-06 確認待ち。

### 2026-01-16 初版

-   BUGS.md (3サンプル) / VERIFY.md (5必須+5推奨) / STATE.md を一括作成。
-   バグTOP3、設計方針、危険ポイントを可視化。

### ルール

-   **追記タイミング:** 修正完了・Verify実施・重大な方向転換時。
-   **記載形式:** `YYYY-MM-DD` / 要点（1行） / Verify結果（OK/NG と対象項目） / メモ（任意）。
-   **例:** `2026-01-20 B-0003 修正（handoffRef タイミング）/ V-05 OK / 低速回線テスト済み`。