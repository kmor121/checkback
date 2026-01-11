# 開発・PR作成フロー

このドキュメントでは、PR作成からマージまでの標準フローを説明します。

---

## 📋 PR作成フロー（標準手順）

### 1. ブランチ作成・実装
```bash
git checkout -b feature/your-feature-name
# 実装...
git add .
git commit -m "feat: your feature description"
git push origin feature/your-feature-name
```

### 2. PR作成
1. GitHub上でPRを作成
2. **[components/PULL_REQUEST_TEMPLATE.md](./PULL_REQUEST_TEMPLATE.md) の内容をPR本文にコピー**
3. テンプレートに従って記入

### 3. スモークテスト実施（必須）
**⚠️ コードレビュー依頼前に必ず実施**

1. **[components/TEST_CHECKLIST.md](./TEST_CHECKLIST.md) を開く**
2. **該当するテスト項目を1周実施**
   - ShareView関連の変更 → セクション A〜F を全て実施
   - その他の変更 → 影響範囲に応じて該当項目を実施
3. **失敗した項目があれば PR本文に記載**
   - 再現手順、期待結果、実際の結果を明記
   - 可能であれば原因と対応方針も記載

### 4. レビュー依頼
- [ ] スモークテスト完了
- [ ] PR本文にテスト結果を記載済み
- [ ] Console に CRITICAL ERROR が出ていない

### 5. マージ
- レビュー承認後、マージ

---

## 🧪 テストファイル一覧

| ファイル | 用途 |
|---------|------|
| [components/TEST_CHECKLIST.md](./TEST_CHECKLIST.md) | スモークテスト手順（回帰防止用） |
| [components/PULL_REQUEST_TEMPLATE.md](./PULL_REQUEST_TEMPLATE.md) | PRテンプレート |

---

## 📝 回帰防止の重要項目

以下の項目は過去にバグが発生した箇所です。**変更時は特に注意してください**：

### ShareView（ペイント機能）
- **Canvas ちらつき**: コメント切替時、画像の再ロードや白フレームが出ないこと
- **リサイズ保持**: 新規描画した図形をリサイズ後、元のサイズに戻らないこと
- **下書き保持**: ×ボタンで閉じた後、再度開いた時に下書きが復元されること
- **既存shape削除**: 編集モードで既存（DB保存済み）のshapeを削除できること

### ViewerCanvas（描画エンジン）
- **Map方式の不変更新**: `shapesMapRef.current` は必ず新しいMapインスタンスで置き換えること
- **comment_id の厳格管理**: `renderTargetCommentId` を最優先し、fallback禁止
- **描画中の座標固定**: `drawViewRef.current` で描画開始時のview/scaleを保存し、描画中は固定すること

---

## 🔧 開発時のTips

### DEBUG モードの使い方
URL に `?debug=1` を追加すると、詳細ログが表示されます：
```
https://your-app.base44.com/share?token=xxx&debug=1
```

### Console ログの見方
- `[ViewerCanvas]`: Canvas内部の状態
- `[ShareView]`: ShareView全体の状態
- `[DRAW_DEBUG]`: 描画処理の詳細
- `CRITICAL ERROR`: 即座に修正が必要なエラー
- `WARNING`: 警告（許容される場合もある）

---

## ❌ 禁止事項

- **推測修正**: 必ずコードを確認してから修正すること
- **関係ない修正**: バグ修正に無関係なリファクタ・整形・命名変更は禁止
- **テストスキップ**: スモークテスト未実施でのPR作成は禁止

---

## 📚 関連ドキュメント

- [components/TEST_CHECKLIST.md](./TEST_CHECKLIST.md): スモークテスト詳細手順
- [components/PULL_REQUEST_TEMPLATE.md](./PULL_REQUEST_TEMPLATE.md): PRテンプレート