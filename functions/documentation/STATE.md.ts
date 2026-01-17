# STATE.md - プロジェクト現在地

## TL;DR

-   **フェーズ:** ビューア/コメント/描画 の基本機能 + 複数FIX・設計確立済み。修正メイン（新規4：修正6）。
-   **コア課題:** ズーム/フィット不具合（全体/横/縦がはみ出す/小さすぎる）とパン回帰（ドラッグ移動不可）を修正完了。temp→realハンドオフ時のちらつき（P0）とペイントモード切替時のズーム飛び（P1）が **Investigating**。
-   **重要:** Selection suppressed、Composer textarea操作時の`activeCommentId` null化、ViewerCanvas常時レンダリング（Layer key切替）は **絶対維持**。
-   **Next:** V-01〜V-05 を実行→VERIFY実行記録→BUGS/STATE整合更新。

---

## 今のゴール

### 短期（1-2週間）

-   ズーム/フィット/パンの挙動を安定させる（今回修正完了）。
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
| 2026-01-17 | ズーム/フィット不具合修正＋パン復活       | ViewerCanvas, ShareView      | zoom契約一本化（二重適用解消）、canPan条件緩和 |
| 2026-01-17 | AdminDocuments ダウンロード機能修正（backend functionに内容埋込） | functions/downloadDocumentation.js | admin権限チェック付き |
| 2026-01-17 | 4ドキュメント新規作成（Reading成功）    | documentation               | 次: V-01〜V-05 実行          |

---

## 重要な設計方針（必ず守る）

1. **Selection Suppressed（選択抑制）**
   - 新規コメント入力中（`isNewCommentInputActive=true` または Textarea フォーカス中）は、右パネルのコメント選択を `onPointerDownCapture` で完全ブロック。
   - `stopPropagation()` + `preventDefault()` で二重保険。
   - 解除タイミング: 入力キャンセル時 or 送信完了時。

2. **activeCommentId null化（新規入力時）**
   - `enterNewTextOnlyComposer()` が呼び出された瞬間に `activeCommentId` を `null` に。
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

6. **ズーム値の契約（2026-01-17追加）**
   - ViewerCanvas: `contentScale = fitScale * (zoom / 100)`
   - ShareView: `zoom = 100` が全体フィット基準、横幅/縦幅は `(scaleW or scaleH / fitScale) * 100`
   - 二重適用禁止（fitScaleを両側で掛けない）

---

## 次の最小ステップ（1つ）

1. **V-01〜V-05 回帰テスト実行** (P0)
   - ShareView で V-01→V-05 を1周実行
   - 各テストの OK/NG と観測ログ要点を VERIFY.md「実行記録」に追記
   - V-03 結果で B-0002、V-05 結果で B-0003 のステータスを更新
   - STATE.md の「バグTOP3」を検証結果と一致させる