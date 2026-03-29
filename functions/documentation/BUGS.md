# BUGS.md - バグ台帳

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
    -   修正前に `Files inspected` セクションで、実際に読んだファイル・行番号を明記する。
    -   `Search terms` でコード検索結果を記録する。
    -   `Relevant code` に、問題の根拠となるコード抜粋を貼り付ける。

### 最小差分の原則

-   修正対象ファイルの周辺のみを変更。
-   整形、命名変更、リファクタリングなど、無関係な変更は禁止。
-   1修正＝1差分。複数の問題がある場合は別バグとして分離。

### Verifyゲート（必須）

-   **修正完了＝「Fixing」ステータス。**
-   **Verify実施＝「Verify」ステータスへ。**
-   **5点テスト（Verify リスト）をすべて通過してから、「Done」へ昇格。**
    -   例: 「既存コメント選択」「選択抑制の維持」「ペイントモード安定性」など、VERIFY.md の該当分を引用。
-   Verify未通過で「Done」にしない。

---

## バグ記載テンプレート（コピペ用）

```
### B-XXXX: [タイトル]

**優先度:** P0 / P1 / P2  
**影響範囲:** ShareView / ViewerCanvas / Draft / Sync / UI (複数選択可)  
**発生頻度:** [常に / 時々 / 特定条件]

**再現手順:**
1. ...
2. ...
3. ...

**現象:**
- 観測ログ: ...
- スクリーンショット: [リンク or 記述]
- ビデオ: [リンク or 記述]

**期待結果:**
- ...

**関連状態:**
- activeCommentId: ...
- paintMode: ...
- composerMode: ...
- その他: ...

**暫定仮説:**
[任意] 原因と思われる推測（コード検索前の仮説）

---

**Files inspected:**
- pages/ShareView.jsx (line XXX-YYY)
- components/viewer/ViewerCanvas.jsx (line AAA-BBB)

**Search terms:**
- `enterNewTextOnlyComposer`
- `onPointerDownCapture`

**Relevant code:**
(該当箇所のコード抜粋。3-10行が目安)

---

**Fix方針:**
[修正の戦略を短く]

**Patch:**
(差分を記載。例: find_replace tool の find/replace 内容)

---

**Verify結果:**
- ✓ [関連するVerify項目] (e.g., 「既存コメント選択」 PASS)
- ✓ [別のVerify項目] (e.g., 「選択抑制の維持」 PASS)
- ✓ [別のVerify項目] PASS
- ✗ [失敗した項目] FAIL - 理由: ...

**Risk / Next:**
- リスク: [修正が他機能に波及する可能性があるか]
- 次: [この修正後に確認すべき周辺機能]

**ステータス:** Open / Investigating / Fixing / Verify / Done
```

---

## (SAMPLE) B-0001: 新規テキスト入力中に他のコメントが再選択される

**優先度:** P1  
**影響範囲:** ShareView / UI  
**発生頻度:** 特定条件（Textareaクリック直後に右パネルをクリック）

**再現手順:**
1. ファイルをShareViewで開く。
2. 複数のコメントが右パネルに表示されている状態。
3. 「コメントを入力...」のTextareaをクリック。
4. 直後に右パネルの別のコメントカードをクリック。
5. 期待: 右パネルのハイライトが解除されたままで、新規入力モード中。
6. 実際: 別のコメントが選択される（再選択）。

**現象:**
- `activeCommentId` が新規入力中に null にならず、クリックで別のIDに上書きされる。
- 右パネルのコメントカードのハイライトが再び付与される。
- `ViewerCanvas` 上の描画が、新規作成中から選択されたコメント分に切り替わる。

**期待結果:**
- Textareaを操作した直後、他のUI要素（コメントカード等）の選択を一時的に抑制し、`activeCommentId` は null のままでなければならない。

**関連状態:**
- `isNewCommentInputActive`: true
- `activeCommentId`: null (期待) vs. [comment_id] (実際)
- `composerMode`: 'new'

**暫定仮説:**
- Textarea上でのクリック（`onPointerDownCapture`）で親要素への伝播をブロックしているはずだが、タイミングによってはイベント処理順序が入れ替わる可能性。
- または、`enterNewTextOnlyComposer` が呼び出されずにコメントカードのクリックハンドラが先に実行される場合がある。

---

**Files inspected:**
- pages/ShareView.jsx (line 193-206, 3341-3342)
- components/viewer/ViewerCanvas.jsx (line 383-428)

**Search terms:**
- `enterNewTextOnlyComposer`
- `onPointerDownCapture`
- `isNewCommentInputActive`

**Relevant code:**

    const enterNewTextOnlyComposer = (e) => {
      e?.stopPropagation?.();
      setComposerMode('new');
      setPaintMode(false);
      setShowAllPaint(false);
      if (activeCommentId) setActiveCommentId(null);
      if (composerTargetCommentId) setComposerTargetCommentId(null);
      setIsNewCommentInputActive(true);
    };

    <Textarea
      ...
      onPointerDownCapture={(e) => enterNewTextOnlyComposer('textarea')}
      onFocus={() => enterNewTextOnlyComposer('focus-fallback')}
      ...
    />

---

**Fix方針:**
- CONTRACT コメントを追加（P0で実施）して、意図を明確化。
- イベント伝播ブロック（`stopPropagation`）が意図した通り動作しているか、ブラウザのイベント順序を検証。

**Patch:**
（CONTRACT コメント追加済み - 詳細は SPEC.md 参照）

---

**Verify結果:**
- ✓ 「選択抑制の維持」(VERIFY.md V-02より) PASS
- ✓ Textarea入力中、右パネルクリックが無視される PASS
- ✓ 入力キャンセル後、正常にコメント選択可能 PASS
- ✓ 高速連続操作でも再選択されない PASS

**Risk / Next:**
- リスク: なし（CONTRACT明確化のため）。
- 次: 他の選択抑制ケース（ペイントモード中のコメント選択など）を確認。

**ステータス:** Done

---

## (SAMPLE) B-0002: ペイントモードのON/OFF時にViewerCanvasのズームが飛ぶ

**優先度:** P1  
**影響範囲:** ViewerCanvas / UI  
**発生頻度:** 時々（ズーム倍率が100%以上かつドラッグ中の場合）

**再現手順:**
1. ファイルをShareViewで開く。
2. ズームイン（200%など）。
3. パン（ドラッグで移動）。
4. ツールバーの「ペイント」ボタンをOFF。
5. 期待: ズーム倍率とパン位置が維持される。
6. 実際: ズーム倍率がリセット（100%に）または、パン位置がジャンプする。

**現象:**
- `Stage` の `scale` や `position` がリセットされ、表示領域が急に変わる。
- ユーザーがズームしていた領域から、突然全体表示に戻る。

**期待結果:**
- ペイントモードの状態変化（true ↔ false）に関わらず、`ViewerCanvas` のズーム/パン状態は完全に独立し、外部の状態変化で影響を受けない。

**関連状態:**
- `paintMode`: true → false
- `zoom`: [値を保持]
- `pan`: { x, y } [値を保持]

**暫定仮説:**
- `ViewerCanvas` の `useEffect` が `paintMode` を依存配列に含んでおり、値変化時に不要なリセットが発火している可能性。
- または、`Stage` のキー変更により強制的に再マウントされている可能性。

---

**Files inspected:**
- components/viewer/ViewerCanvas.jsx (line 506-517, 519-525, 3252-3271)
- pages/ShareView.jsx (line 1072-1179)

**Search terms:**
- `useEffect`
- `paintMode`
- `Stage`
- `FIX-2`
- `FIX-3`

**Relevant code:**

    // CRITICAL: fileIdentity/pageNumber変更時のみリセット（Mapをクリア）
    useEffect(() => {
      console.log('[ViewerCanvas] fileIdentity/pageNumber changed, resetting state (INTENDED)');
      shapesMapRef.current = new Map();
      bump();
      setSelectedId(null);
      setCurrentShape(null);
      setUndoStack([]);
      setRedoStack([]);
      setPan({ x: 0, y: 0 });
      setBgReady(false);
    }, [fileIdentity, pageNumber]);

---

**Fix方針:**
- `paintMode` が依存配列に含まれている `useEffect` を確認。
- `paintMode` 変化でリセットすべき状態（`isDrawing`, `currentShape` など）と、保護すべき状態（`zoom`, `pan`）を分離。
- 複数のFIX（FIX-1, FIX-2等）が既に適用されているため、現状の安定性を再検証。

**Patch:**
(検査中 - コード確認待ち)

---

**Verify結果:**
- ? 「ペイントモードの安定性」(VERIFY.md V-03より) - 検査中
- ? ズーム状態がpaintMode変化で保持されるか - 検査中
- ? パン位置が保持されるか - 検査中

**Risk / Next:**
- リスク: FIX-2, FIX-3との相互作用を確認が必要。
- 次: `prevPaintModeRef`, `prevCanvasContextKeyRef` 等の ref ロジックの検証。

**ステータス:** Investigating

---

## (SAMPLE) B-0003: temp→real ハンドオフ後にhandoff/freezeが破綻する

**優先度:** P0  
**影響範囲:** Draft / Sync / ShareView  
**発生頻度:** 特定条件（新規コメント描画ありで高速送信）

**再現手順:**
1. 新規ペイントコメント作成（複数描画）。
2. テキスト入力。
3. 送信ボタンをクリック。
4. 送信直後に、ブラウザのネットワークスロットリングON（低速シミュレート）。
5. 期待: 描画が消えずに表示される（handoff/freeze機構で保護）。
6. 実際: 描画が一瞬消える or 古い描画が混在する。

**現象:**
- `handoffRef.current` が期待と異なるタイミングで解除されている。
- `freezeRef.current` が有効でない、または早期に null になっている。
- DB再フェッチ中に、`react-query` のキャッシュ更新で描画が空になり、ちらつきが発生。

**期待結果:**
- コメント送信からDB反映（`react-query` invalidate完了）まで、描画データを `handoffRef.snapshot` と `freezeRef.shapesForCanvas` で確保。
- ユーザーに描画消失を見せない。

**関連状態:**
- `composerMode`: 'new' → 'view'
- `paintContextId`: temp_XXXX → real_YYYY
- `handoffRef.current`: { key, snapshot, pendingIds } → null
- `freezeRef.current`: { shapesForCanvas, ... } → null
- `lockPaintContextIdRef.current`: real_YYYY (送信中) → null

**暫定仮説:**
- `handoffRef` と `freezeRef` の解除タイミングが、`react-query` の invalidate/refetch スケジュールより先に発火している可能性。
- または、`handoffRef.pendingIds` と実際のDB反映に誤差があり、「全て反映」と誤判定される。

---

**Files inspected:**
- pages/ShareView.jsx (line 1516-1928, 2593-2643)
- components/viewer/ViewerCanvas.jsx (line 561-596)

**Search terms:**
- `handoffRef`
- `freezeRef`
- `lockPaintContextIdRef`
- `invalidateQueries`

**Relevant code:**

    // handoff snapshot作成
    handoffRef.current = {
      key: canvasContextKey,
      snapshot: shapesForCanvas,
      pendingIds: new Set(pendingShapeIds)
    };

    // DB送信完了後
    React.useEffect(() => {
      if (handoffRef.current && handoffRef.pendingIds.size === 0) {
        handoffRef.current = null;
      }
    }, [shapesForCanvas]);

---

**Fix方針:**
- `handoffRef` と `freezeRef` の解除を `react-query` の `isLoading` または `isFetching` stateに同期させ、タイミングずれを排除。
- `freezeRef` の snapshot更新タイミングを精密化し、pending期間中の描画ちらつきを防止。

**Patch:**
(詳細検査中)

---

**Verify結果:**
- ? 「コメント送信処理の安定性」(VERIFY.md V-05より) - 検査中
- ? 低速回線でもちらつきなし - 検査中
- ? handoff完了後、描画が正しく反映 - 検査中

**Risk / Next:**
- リスク: `react-query` の再フェッチ動作に大きく依存。network遅延シミュレーションが必須。
- 次: `FIX-PENDING` との連携確認。

**ステータス:** Investigating
