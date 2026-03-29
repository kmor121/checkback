import { base44 } from '@/api/base44Client';

/**
 * コメント削除時の楽観更新（react-queryキャッシュから即座に除去）
 * DB削除前に呼ぶことで、描画残留を防止する。
 */
export function optimisticRemoveComment(queryClient, { commentId, fileId, page, commentsQueryKey, shapesQueryKey }) {
  const cid = String(commentId);
  if (shapesQueryKey) {
    queryClient.setQueryData(shapesQueryKey, (old) => (old || []).filter(s => String(s.comment_id) !== cid));
  }
  if (commentsQueryKey) {
    queryClient.setQueryData(commentsQueryKey, (old) => (old || []).filter(c => String(c.id) !== cid && String(c.parent_comment_id) !== cid));
  }
}

/**
 * コメントと紐づくPaintShape/返信/添付ファイルを一括削除する。
 */
export async function deleteCommentWithShapes({ commentId, fileId, paintShapes, comments, attachmentsByComment }) {
  const cid = String(commentId);

  const relatedShapes = (paintShapes || []).filter(s => String(s.comment_id) === cid);
  for (const shape of relatedShapes) {
    await base44.entities.PaintShape.delete(shape.id);
  }

  const childReplies = (comments || []).filter(c => String(c.parent_comment_id) === cid);
  for (const reply of childReplies) {
    await base44.entities.ReviewComment.delete(reply.id);
  }

  let atts = [];
  if (attachmentsByComment instanceof Map) {
    atts = attachmentsByComment.get(commentId) || [];
  } else if (attachmentsByComment && typeof attachmentsByComment === 'object') {
    atts = attachmentsByComment[commentId] || [];
  }
  for (const att of atts) {
    await base44.entities.ReviewCommentAttachment.delete(att.id);
  }

  await base44.entities.ReviewComment.delete(commentId);
}