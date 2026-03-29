import { base44 } from '@/api/base44Client';

/**
 * コメントと紐づくPaintShape/返信/添付ファイルを一括削除する。
 * @param {object} params
 * @param {string} params.commentId - 削除対象コメントID
 * @param {string} params.fileId - ファイルID
 * @param {Array} params.paintShapes - 現在のpaintShapes配列（DBフェッチ済み）
 * @param {Array} params.comments - 現在のcomments配列（返信検索用）
 * @param {Map|object} params.attachmentsByComment - commentId→添付配列のMapまたはオブジェクト
 */
export async function deleteCommentWithShapes({ commentId, fileId, paintShapes, comments, attachmentsByComment }) {
  const cid = String(commentId);

  // 1. 関連PaintShapeを全削除（型統一で比較）
  const relatedShapes = (paintShapes || []).filter(s => String(s.comment_id) === cid);
  for (const shape of relatedShapes) {
    await base44.entities.PaintShape.delete(shape.id);
  }

  // 2. 返信コメント削除
  const childReplies = (comments || []).filter(c => String(c.parent_comment_id) === cid);
  for (const reply of childReplies) {
    await base44.entities.ReviewComment.delete(reply.id);
  }

  // 3. 添付ファイル削除
  let atts = [];
  if (attachmentsByComment instanceof Map) {
    atts = attachmentsByComment.get(commentId) || [];
  } else if (attachmentsByComment && typeof attachmentsByComment === 'object') {
    atts = attachmentsByComment[commentId] || [];
  }
  for (const att of atts) {
    await base44.entities.ReviewCommentAttachment.delete(att.id);
  }

  // 4. コメント本体削除
  await base44.entities.ReviewComment.delete(commentId);

  return { deletedShapes: relatedShapes.length, deletedReplies: childReplies.length, deletedAttachments: atts.length };
}