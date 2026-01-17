# BUGS.md

## バグトラッキング

### フォーマット
- **ID**: B-XXXX（4桁ゼロ埋め）
- **ステータス**: Investigating / Verify / Done(Verified) / Won't Fix
- **優先度**: P0（即座に修正）/ P1（次スプリント）/ P2（バックログ）

---

## 現在のバグ一覧

### B-0001 [P1] temp→real 遷移時の描画消失（コメント確定後にちらつく）
- **ステータス**: Done(Verified)
- **発生条件**: ShareView で新規コメント作成時、送信直後に描画が一瞬消える
- **根本原因**: temp_xxx から real commentId への遷移時、refetch で incoming=[] になる瞬間があり、transient empty を温存せず即座に Map をクリアしていた
- **修正内容**: P0-FLICKER パッチ（lastNonEmpty/emptyStreak で5回連続 empty まで保持）を適用
- **Verify結果**: V-05 OK（2026-01-17）- 送信中〜temp→real後も描画が消えない/ちらつかない

### B-0002 [P1] ペイントON/OFF切替時にズーム/パンがリセットされる
- **ステータス**: Investigating
- **発生条件**: ShareView で paintMode を ON→OFF または OFF→ON すると、ズーム倍率とパン位置が初期状態に戻る
- **推定原因**: paintMode 切替時に ViewerCanvas/Stage が key で強制再マウントされている可能性
- **Verify結果**: 未実行（次スコープで V-03 実行予定）

### B-0003 [P2] 描画下書きがモード往復で消える
- **ステータス**: Investigating
- **発生条件**: ShareView で下書き描画中に paintMode を OFF→ON すると、下書きが消失する
- **推定原因**: draftShapes の管理が paintMode 切替で破棄されている可能性
- **Verify結果**: 未実行（次スコープで V-04 実行予定）

---

## 履歴（Done）

（過去の修正済みバグはここに移動）