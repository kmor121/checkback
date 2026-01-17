# STATE.md

## 現在の状態（2026-01-17）

### バグ TOP3

| ID | 概要 | 優先度 | 現状 |
|----|------|--------|------|
| B-0001 | temp→real 遷移時の描画消失 | P1 | Done(Verified) - V-05 OK（2026-01-17） |
| B-0002 | ペイントON/OFF切替時にズーム/パンがリセット | P1 | Investigating - V-03 未実行 |
| B-0003 | 描画下書きがモード往復で消える | P2 | Investigating - V-04 未実行 |

### 直近の変更（7日分）

| 日付 | 変更内容 | Verify | メモ |
|------|----------|--------|------|
| 2026-01-17 | ドキュメント4ファイル新規作成（SPEC/BUGS/VERIFY/STATE.md） | - | functions/documentation/*.md を見出し1行で作成、Reading成功を確認 |

### 次の最小ステップ（1つ）

1. **V-01〜V-05 回帰テスト実行** (P0)
   - ShareView で V-01→V-05 を1周実行
   - 各テストの OK/NG と観測ログ要点を VERIFY.md「実行記録」に追記
   - V-03 結果で B-0002、V-05 結果で B-0003 のステータスを更新
   - STATE.md の「バグTOP3」を検証結果と一致させる

### アーキテクチャ（変更禁止）

- **Selection Suppression**: 新規コメント入力中は activeCommentId=null、選択抑制
- **Handoff/Freeze**: temp→real 遷移時に handoffRef/freezeRef でコンテキスト凍結
- **ViewerCanvas 常時レンダリング**: Stage/ViewerCanvas は key で強制再マウントしない
- **Paint Layer 制御的 key 使用**: hidePaintOverlay/forceClearToken/canvasContextKey の変化時のみ Paint Layer を再マウント可

### 運用ルール

- **推測修正禁止**: 根拠なしで変更しない（Verify 結果を元に判断）
- **最小差分**: 無関係な変更を混入させない
- **Verify 通過が完了条件**: Done(Verified) は Verify OK を根拠に記載
- **1スコープ=1バグ/1機能**: 範囲を広げない