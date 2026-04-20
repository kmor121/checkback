import React from 'react';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Download,
  ChevronRight,
  MessageSquare,
  Send,
  Paintbrush,
  Edit,
  Trash,
  Link as LinkIcon,
  X,
  Check,
  Circle as CircleIcon,
  Reply,
  MoreVertical,
} from 'lucide-react';

/**
 * ShareView 右ペイン: コメント一覧
 * 純粋抽出（ダム・コンポーネント）。動作変更なし。
 */
export default function CommentList({
  shareLink,
  showAllPaint,
  setShowAllPaint,
  commentFilter,
  setCommentFilter,
  commentSort,
  setCommentSort,

  // top temp draft badge
  tempDraftCount,
  getTempDraftKeyForPreview,
  setActiveCommentId,
  setIsTempDraftPreview,
  setComposerMode,
  setComposerTargetCommentId,
  setPaintMode,
  setIsDockOpen,
  addDebugLog,
  deleteDraft,
  draftCacheRef,
  setDraftShapes,
  draftShapesRef,
  resolveCommentId,
  normId,
  tempCommentId,
  setTempCommentId,
  showToast,

  // list & per-comment
  sortedComments,
  paintShapes,
  activeCommentId,
  isNewTextOnlyComposerActive,
  composerMode,
  composerTargetCommentId,
  paintMode,
  paintSessionCommentId,
  repliesByParent,
  attachmentsByComment,
  replyingThreadId,
  setReplyingThreadId,
  draftCountByCommentId,

  selectComment,
  handleStartEditComment,
  handleToggleResolved,
  handleStartReply,
  handleDeleteComment,
  handleCopyCommentUrl,
  canEditDeleteComment,

  // reply input
  composerText,
  setComposerText,
  composerParentCommentId,
  pendingFiles,
  handleRemoveFile,
  handleFileSelect,
  handleSendComment,
  isSubmitting,
  setComposerParentCommentId,
  setPendingFiles,
}) {
  if (!shareLink?.can_view_comments) return null;

  return (
    <div className="w-96 border-l bg-white flex flex-col">
      <div className="p-4 border-b space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">コメント</h3>
          <Button
            variant={showAllPaint ? 'default' : 'outline'}
            size="sm"
            onClick={() => setShowAllPaint(!showAllPaint)}
            className="text-xs"
          >
            <Paintbrush className="w-3 h-3 mr-1" />
            全表示
          </Button>
        </div>

        <Tabs value={commentFilter} onValueChange={setCommentFilter} className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="all" className="text-xs">全て</TabsTrigger>
            <TabsTrigger value="unresolved" className="text-xs">未対応</TabsTrigger>
            <TabsTrigger value="resolved" className="text-xs">対応済</TabsTrigger>
          </TabsList>
        </Tabs>

        <Select value={commentSort} onValueChange={setCommentSort}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="page">ページ順</SelectItem>
            <SelectItem value="oldest">古い順</SelectItem>
            <SelectItem value="newest">新しい順</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* 新規下書きバッジ */}
        {tempDraftCount > 0 && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
            <div className="flex items-center gap-2 justify-between">
              <div
                className="flex items-center gap-2 text-sm flex-1 cursor-pointer hover:opacity-80 transition-opacity"
                onClick={() => {
                  console.log('[Z-03b] top badge clicked, setting preview ON');
                  setActiveCommentId(null);
                  setIsTempDraftPreview(true);
                  setComposerMode('view');
                  setComposerTargetCommentId(null);
                  setShowAllPaint(false);
                  setPaintMode(false);
                  setIsDockOpen(false);
                  addDebugLog(`[P0-V9-FIX] top temp draft badge clicked: preview ON`);
                }}
                title="クリックして新規下書きをプレビュー"
              >
                <Badge className="bg-blue-600 text-white">📝 新規下書き</Badge>
                <span className="text-blue-800">{tempDraftCount}個の描画</span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-auto p-1 text-red-600 hover:text-red-700"
                onClick={(e) => {
                  e.stopPropagation();
                  if (!window.confirm('新規下書きを削除しますか？この操作は元に戻せません。')) return;
                  const previewKey = getTempDraftKeyForPreview();
                  console.log('[DELETE] Deleting temp draft:', previewKey?.substring(0, 40));
                  if (previewKey) {
                    deleteDraft(previewKey);
                    draftCacheRef.current.delete(previewKey);
                    setDraftShapes(prev => prev.filter(s => {
                      const cid = normId(resolveCommentId(s));
                      const tempCid = normId(tempCommentId);
                      return !(cid && (cid.startsWith('temp_') || cid === tempCid));
                    }));
                    draftShapesRef.current = draftShapesRef.current.filter(s => {
                      const cid = normId(resolveCommentId(s));
                      const tempCid = normId(tempCommentId);
                      return !(cid && (cid.startsWith('temp_') || cid === tempCid));
                    });
                    setTempCommentId(null);
                    if (shareLink?.file_id) {
                      localStorage.removeItem(`tempCommentId:${shareLink.file_id}`);
                    }
                    setIsTempDraftPreview(false);
                    showToast('新規下書きを削除しました', 'success');
                  }
                }}
                title="新規下書きを削除"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}

        {sortedComments.length === 0 ? (
          <div className="text-center text-gray-500 py-8">コメントはありません</div>
        ) : (
          sortedComments.map((comment) => {
            const shapesCount = paintShapes.filter(s => s.comment_id === comment.id).length;
            const isSelected = activeCommentId === comment.id && !isNewTextOnlyComposerActive;
            const isEditing = composerMode === 'edit' && composerTargetCommentId === comment.id && !isNewTextOnlyComposerActive;
            const isPaintingThis = paintMode && paintSessionCommentId === comment.id;
            const replies = repliesByParent.get(comment.id) || [];
            const commentAttachments = attachmentsByComment.get(comment.id) || [];
            const isThreadOpen = replyingThreadId === comment.id;
            const draftCount = draftCountByCommentId[comment.id] || 0;
            const hasDraft = draftCount > 0;

            return (
              <div key={comment.id} className="space-y-2">
                <Card
                  className={`hover:shadow-md transition-shadow ${
                    isEditing ? 'border-2 border-green-600 bg-green-50' :
                    isSelected ? 'border-2 border-blue-600 bg-blue-50' :
                    comment.resolved ? 'opacity-75 bg-gray-50' : ''
                  }`}
                >
                  <CardContent className="p-3">
                    <div className="flex items-start gap-2">
                      <div
                        className="flex-1 cursor-pointer"
                        onClick={() => selectComment(comment)}
                        onDoubleClick={() => !comment.resolved && handleStartEditComment(comment)}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-medium">{comment.author_name}</span>
                          {comment.author_type === 'guest' && (
                            <Badge variant="outline" className="text-xs">ゲスト</Badge>
                          )}
                          {comment.resolved && (
                            <Badge className="text-xs bg-green-600 text-white">対応済</Badge>
                          )}
                          {shapesCount > 0 && (
                            <Badge variant="outline" className="text-xs flex items-center gap-1">
                              <Paintbrush className="w-3 h-3" />
                              {shapesCount}
                            </Badge>
                          )}
                          {(() => {
                            const editDraftCount = draftCountByCommentId[comment.id] || 0;
                            return editDraftCount > 0 && (
                              <Badge variant="outline" className="text-xs flex items-center gap-1 bg-blue-50 text-blue-700 border-blue-300">
                                📝 下書き {editDraftCount}
                              </Badge>
                            );
                          })()}
                          {isEditing && (
                            <Badge className="text-xs bg-green-600 text-white">編集中</Badge>
                          )}
                          {isPaintingThis && !isEditing && (
                            <Badge className="text-xs bg-orange-600 text-white">ペイント中</Badge>
                          )}
                        </div>

                        <p className="text-sm text-gray-700">{comment.body || '（本文なし）'}</p>

                        {commentAttachments.length > 0 && (
                          <div className="mt-2 space-y-1">
                            {commentAttachments.map((att) => (
                              <a
                                key={att.id}
                                href={att.file_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-2 text-xs text-blue-600 hover:underline"
                              >
                                <Download className="w-3 h-3" />
                                {att.original_filename}
                              </a>
                            ))}
                          </div>
                        )}

                        <div className="flex items-center gap-2 mt-2 text-xs text-gray-500">
                          <span>{comment.page_no}枚目</span>
                          <span>•</span>
                          <span>{format(new Date(comment.created_date), 'yyyy/MM/dd HH:mm', { locale: ja })}</span>
                          {replies.length > 0 && (
                            <>
                              <span>•</span>
                              <Button
                                variant="link"
                                size="sm"
                                className="h-auto p-0 text-xs text-blue-600"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setReplyingThreadId(isThreadOpen ? null : comment.id);
                                }}
                              >
                                {replies.length}件の返信
                              </Button>
                            </>
                          )}
                        </div>
                      </div>

                      <Button
                        variant="ghost"
                        size="sm"
                        className={`h-auto p-1 ${comment.resolved ? 'text-green-600' : 'text-gray-400'}`}
                        onClick={(e) => handleToggleResolved(comment, e)}
                        title={comment.resolved ? '未対応に戻す' : '対応済みにする'}
                      >
                        {comment.resolved ? (
                          <div className="w-5 h-5 rounded-full bg-green-600 flex items-center justify-center">
                            <Check className="w-3 h-3 text-white" />
                          </div>
                        ) : (
                          <CircleIcon className="w-5 h-5" />
                        )}
                      </Button>

                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-auto p-1 text-gray-600"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleStartReply(comment);
                        }}
                        title="返信"
                      >
                        <Reply className="w-4 h-4" />
                      </Button>

                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-auto p-1">
                            <MoreVertical className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {canEditDeleteComment(comment) && (
                            <>
                              <DropdownMenuItem onClick={() => handleStartEditComment(comment)}>
                                <Edit className="w-4 h-4 mr-2" />
                                編集
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => handleDeleteComment(comment)}
                                className="text-red-600"
                              >
                                <Trash className="w-4 h-4 mr-2" />
                                削除
                              </DropdownMenuItem>
                            </>
                          )}
                          <DropdownMenuItem onClick={() => handleStartReply(comment)}>
                            <MessageSquare className="w-4 h-4 mr-2" />
                            返信
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleCopyCommentUrl(comment)}>
                            <LinkIcon className="w-4 h-4 mr-2" />
                            URLをコピー
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </CardContent>
                </Card>

                {/* 返信リスト */}
                {isThreadOpen && replies.length > 0 && (
                  <div className="ml-6 space-y-2">
                    {replies.map((reply) => {
                      const replyAttachments = attachmentsByComment.get(reply.id) || [];
                      return (
                        <Card key={reply.id} className="bg-gray-50">
                          <CardContent className="p-3">
                            <div className="flex items-start gap-2">
                              <ChevronRight className="w-4 h-4 text-gray-400 mt-1 flex-shrink-0" />
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="text-xs font-medium">{reply.author_name}</span>
                                  {reply.author_type === 'guest' && (
                                    <Badge variant="outline" className="text-xs">ゲスト</Badge>
                                  )}
                                </div>
                                <p className="text-xs text-gray-700">{reply.body}</p>
                                {replyAttachments.length > 0 && (
                                  <div className="mt-2 space-y-1">
                                    {replyAttachments.map((att) => (
                                      <a
                                        key={att.id}
                                        href={att.file_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center gap-2 text-xs text-blue-600 hover:underline"
                                      >
                                        <Download className="w-3 h-3" />
                                        {att.original_filename}
                                      </a>
                                    ))}
                                  </div>
                                )}
                                <div className="text-xs text-gray-500 mt-1">
                                  {format(new Date(reply.created_date), 'yyyy/MM/dd HH:mm', { locale: ja })}
                                </div>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )}

                {/* 返信入力欄 */}
                {isThreadOpen && (
                  <div className="ml-6 bg-white rounded-lg border-2 border-blue-200 p-3 space-y-2">
                    <Textarea
                      placeholder="返信を入力..."
                      value={composerMode === 'reply' && composerParentCommentId === comment.id ? composerText : ''}
                      onChange={(e) => {
                        if (composerMode !== 'reply' || composerParentCommentId !== comment.id) {
                          handleStartReply(comment);
                        }
                        setComposerText(e.target.value);
                      }}
                      rows={2}
                      className="text-sm resize-none"
                    />

                    {pendingFiles.length > 0 && composerMode === 'reply' && composerParentCommentId === comment.id && (
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

                    <div className="flex items-center gap-2">
                      <input
                        type="file"
                        multiple
                        className="hidden"
                        id={`file-input-${comment.id}`}
                        onChange={(e) => {
                          if (composerMode !== 'reply' || composerParentCommentId !== comment.id) {
                            handleStartReply(comment);
                          }
                          handleFileSelect(e);
                        }}
                      />
                      <label htmlFor={`file-input-${comment.id}`}>
                        <Button variant="outline" size="sm" className="text-xs" asChild>
                          <span>
                            <Download className="w-3 h-3 mr-1" />
                            添付
                          </span>
                        </Button>
                      </label>
                      <Button
                        size="sm"
                        className="bg-blue-600 hover:bg-blue-700 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={handleSendComment}
                        disabled={!composerText.trim() || isSubmitting}
                        style={{ pointerEvents: isSubmitting ? 'none' : 'auto' }}
                      >
                        <Send className="w-3 h-3 mr-1" />
                        送信
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs"
                        onClick={() => {
                          setReplyingThreadId(null);
                          setComposerMode('new');
                          setComposerParentCommentId(null);
                          setComposerText('');
                          setPendingFiles([]);
                        }}
                      >
                        閉じる
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}