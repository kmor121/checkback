import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Send, MoreVertical, Edit, Trash, Check, X } from 'lucide-react';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';

export default function ReplyThread({ parentCommentId, fileId, replies, user }) {
  const [replyBody, setReplyBody] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editBody, setEditBody] = useState('');
  const queryClient = useQueryClient();

  const canEditDelete = (reply) => {
    if (!user) return false;
    if (user.role === 'admin') return true;
    if (reply.author_user_id === user.id) return true;
    return false;
  };

  const editMutation = useMutation({
    mutationFn: ({ id, body }) => base44.entities.ReviewComment.update(id, { body }),
    onSuccess: () => {
      setEditingId(null);
      setEditBody('');
      queryClient.invalidateQueries(['comments', fileId]);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.ReviewComment.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['comments', fileId]);
    },
  });

  const replyMutation = useMutation({
    mutationFn: async (body) => {
      return base44.entities.ReviewComment.create({
        file_id: fileId,
        parent_comment_id: parentCommentId,
        page_no: 1,
        seq_no: 0,
        anchor_nx: 0,
        anchor_ny: 0,
        author_type: 'user',
        author_user_id: user?.id,
        author_name: user?.full_name,
        body,
        resolved: false,
        has_paint: false,
      });
    },
    onSuccess: () => {
      setReplyBody('');
      queryClient.invalidateQueries(['comments', fileId]);
    },
  });

  const handleSubmit = (e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    if (!replyBody.trim() || replyMutation.isPending) return;
    replyMutation.mutate(replyBody.trim());
  };

  const sortedReplies = [...replies].sort(
    (a, b) => new Date(a.created_date) - new Date(b.created_date)
  );

  return (
    <div
      className="mt-2 pt-2 border-t border-gray-200 space-y-2"
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {/* 返信一覧 */}
      {sortedReplies.length > 0 && (
        <div className="space-y-2 pl-3 border-l-2 border-blue-200">
          {sortedReplies.map((reply) => (
            <div key={reply.id} className="text-xs">
              <div className="flex items-center gap-1">
                <span className="font-medium text-gray-800">{reply.author_name}</span>
                <span className="text-gray-400">
                  {format(new Date(reply.created_date), 'MM/dd HH:mm', { locale: ja })}
                </span>
              </div>
              <p className="text-gray-600 mt-0.5">{reply.body}</p>
            </div>
          ))}
        </div>
      )}

      {/* 返信入力 */}
      <div className="flex gap-2 items-end">
        <Textarea
          placeholder="返信を入力..."
          value={replyBody}
          onChange={(e) => setReplyBody(e.target.value)}
          onPointerDownCapture={(e) => e.stopPropagation()}
          rows={1}
          className="text-xs resize-none flex-1 min-h-[32px]"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSubmit(e);
            }
          }}
        />
        <Button
          size="sm"
          className="h-8 px-2 bg-blue-600 hover:bg-blue-700"
          disabled={!replyBody.trim() || replyMutation.isPending}
          onClick={handleSubmit}
        >
          <Send className="w-3 h-3" />
        </Button>
      </div>
    </div>
  );
}