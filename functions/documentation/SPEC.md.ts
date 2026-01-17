# SPEC.md

## Do-not-break 契約（絶対に壊さない仕様）

### 1. Selection Suppression（選択抑制）
- **契約**: 新規コメント入力中は activeCommentId を即座に null 化し、他コメントの自動再選択を完全に抑止する
- **実装**: ShareView の handleNewCommentStart で `setActiveCommentId(null)` を実行
- **検証**: V-02（新規コメント入力時の選択抑制）

### 2. Handoff/Freeze（temp→real 引き継ぎ）
- **契約**: コメント送信中（temp→real）は描画コンテキストを凍結し、描画が消えない/ちらつかないことを保証する
- **実装**: ShareView の handoffRef / freezeRef / lockPaintContextIdRef で temp→real 遷移を制御
- **検証**: V-05（送信中〜temp→real後も描画が消えない/ちらつかない）

### 3. ViewerCanvas 常時レンダリング（強制再マウント禁止）
- **契約**: ViewerCanvas/Stage を key 変更で強制再マウントしない（Zoom/Pan が失われるため）
- **実装**: ViewerCanvas/Stage には key を付与しない（Paint Layer のみ制御的に key 使用可）
- **検証**: V-03（ペイントON/OFF時のズーム/パン維持・ちらつき無し）

### 4. hidePaintOverlay の条件（新規コメント入力中は描画非表示）
- **契約**: 新規コメント入力中（activeCommentId=null かつ newCommentInput あり）は hidePaintOverlay=true で描画を非表示にする
- **実装**: ShareView で `hidePaintOverlay` を計算し ViewerCanvas に渡す
- **検証**: V-02（新規コメント入力時の選択抑制）