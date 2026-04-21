import React from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Paintbrush, Download, Send, X, Trash2 } from 'lucide-react';

/**
 * ShareView 中央下段: コメント入力 Composer
 * 純粋抽出（ダム・コンポーネント）。動作変更なし。
 */
export default function CommentComposer({
  shareLink,
  comments,
  activeCommentId,
  paintMode,
  handlePaintModeChange,
  composerMode,
  composerText,
  setComposerText,
  enterNewTextOnlyComposer,
  setIsNewCommentInputActive,
  pendingFiles,
  handleRemoveFile,
  handleFileSelect,
  handleSendComment,
  handleCancelEdit,
  handleDiscard,
  isSubmitting,
  draftShapes,
  draftCacheRef,
  targetKey,
  paintSessionCommentId,
  tempDraftCount,
  setActiveCommentId,
  setIsTempDraftPreview,
  setComposerMode,
  setComposerTargetCommentId,
  setShowAllPaint,
  setPaintMode,
  setIsDockOpen,
  addDebugLog,
}) {
  if (!shareLink?.can_post_comments) return null;

  // 対応済みチェック
  const activeComment = comments.find(c => c.id === activeCommentId);
  const isLocked = activeComment?.resolved || false;

  return (
    <div className="bg-gray-100 p-4 flex justify-center">
      <div className="w-full max-w-2xl bg-white rounded-xl shadow-2xl border-2 border-gray-200 p-4">
        <div className="flex gap-3 items-start">
          {/* ペイントボタン */}
          <Button
            variant={paintMode ? 'default' : 'outline'}
            size="sm"
            onClick={() => handlePaintModeChange(!paintMode)}
            className="mt-1"
            disabled={isLocked}
          >
            <Paintbrush className="w-4 h-4 mr-1" />
            {paintMode ? 'ペイント中' : 'ペイント'}
          </Button>

          {/* 本文入力 */}
          <div className="flex-1 space-y-2">
            <Textarea
              placeholder={composerMode === 'edit' ? '編集中...' : composerMode === 'reply' ? '返信を入力...' : 'コメントを入力...'}
              value={composerText}
              onChange={(e) => setComposerText(e.target.value)}
              onPointerDownCapture={(e) => enterNewTextOnlyComposer('textarea')}
              onFocus={() => enterNewTextOnlyComposer('focus-fallback')}
              onBlur={() => {
                if (!composerText.trim()) {
                  setIsNewCommentInputActive(false);
                }
              }}
              rows={2}
              className="text-sm resize-none"
              disabled={isLocked}
            />

            {/* 添付ファイル一覧 */}
            {pendingFiles.length > 0 && (
              <div className="space-y-1">
                {pendingFiles.map((file, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-xs text-gray-600">
                    <Download className="w-3 h-3" />
                    <span className="flex-1 truncate">{file.name}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-auto p-0 text-red-600"
                      onClick={() => handleRemoveFile(idx)}
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 添付ボタン */}
          <input
            type="file"
            multiple
            className="hidden"
            id="dock-file-input"
            onChange={handleFileSelect}
            disabled={isLocked}
          />
          <label htmlFor="dock-file-input">
            <Button variant="outline" size="sm" className="mt-1" asChild disabled={isLocked}>
              <span>
                <Download className="w-4 h-4" />
              </span>
            </Button>
          </label>

          {/* 送信ボタン */}
          <Button
            onClick={handleSendComment}
            disabled={!composerText.trim() || isLocked || isSubmitting}
            className="bg-blue-600 hover:bg-blue-700 mt-1 disabled:opacity-50 disabled:cursor-not-allowed"
            size="sm"
            title={composerMode === 'edit' ? '保存' : '送信'}
            style={{ pointerEvents: isSubmitting ? 'none' : 'auto' }}
          >
            <Send className="w-4 h-4" />
          </Button>

          {/* 閉じるボタン（編集モード時のみ） */}
          {composerMode === 'edit' && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCancelEdit}
              className="mt-1"
              title="閉じる（下書き保持）"
            >
              <X className="w-4 h-4" />
            </Button>
          )}

          {/* 破棄ボタン（編集/新規時、下書きがある場合のみ） */}
          {(composerMode === 'edit' || composerMode === 'new') && (draftShapes.length > 0 || composerText.trim().length > 0) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDiscard}
              className="mt-1 text-red-600 hover:text-red-700"
              title="下書きを破棄"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          )}
        </div>

        {/* 固定高さのステータス領域 */}
        <div className="h-6 mt-2 flex items-center">
          {isLocked ? (
            <div className="text-xs text-orange-600 flex items-center gap-2">
              <Badge className="bg-orange-100 text-orange-700 border border-orange-300">
                対応済みのため編集できません
              </Badge>
            </div>
          ) : (composerMode === 'edit' || paintSessionCommentId || (composerMode === 'new' && !activeCommentId && draftShapes.length > 0)) ? (
            <div className="text-xs text-gray-500 flex items-center gap-2">
              <Badge className="bg-green-600 text-white">
                {composerMode === 'edit' ? 'コメント編集中' : paintSessionCommentId ? 'コメントに追記中' : '新規作成中'}
              </Badge>
              <span>
                {composerMode === 'edit' ? '保存して更新' : 'コメントを入力してください。'}
              </span>
              {(() => {
                const cacheCount = targetKey ? (draftCacheRef.current.get(targetKey)?.length || 0) : 0;
                const displayCount = Math.max(draftShapes.length, cacheCount);
                return displayCount > 0 ? (
                  <Badge variant="secondary" className="bg-blue-100 text-blue-800">
                    📝 下書き {displayCount}個
                  </Badge>
                ) : null;
              })()}
            </div>
          ) : tempDraftCount > 0 ? (
            <div className="text-xs text-gray-500 flex items-center gap-2">
              <Badge
                className="bg-blue-600 text-white cursor-pointer hover:bg-blue-700"
                onClick={() => {
                  console.log('[Z-03c] bottom badge clicked, setting preview ON');
                  setActiveCommentId(null);
                  setIsTempDraftPreview(true);
                  setComposerMode('view');
                  setComposerTargetCommentId(null);
                  setShowAllPaint(false);
                  setPaintMode(false);
                  setIsDockOpen(false);
                  addDebugLog(`[P0-V9-FIX] bottom temp draft badge clicked: preview ON`);
                }}
                title="クリックして新規下書きをプレビュー"
              >
                📝 新規下書き {tempDraftCount}個
              </Badge>
              <span>クリックしてプレビュー</span>
            </div>
          ) : (
            <div className="opacity-0 pointer-events-none">placeholder</div>
          )}
        </div>
      </div>
    </div>
  );
}