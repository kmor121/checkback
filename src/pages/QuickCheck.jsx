import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Upload, Link as LinkIcon, Play, Copy, Clock, MessageSquare, MoreVertical, FileText } from 'lucide-react';
import { format, differenceInDays } from 'date-fns';
import { ja } from 'date-fns/locale';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { handleCopyShareLink, handleDownloadFile } from '../components/files/FileMenuActions';
import { createPageUrl } from '@/utils';

export default function QuickCheck() {
  const [user, setUser] = useState(null);
  const [uploadedFile, setUploadedFile] = useState(null);
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [shareUrl, setShareUrl] = useState('');
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });
  const queryClient = useQueryClient();

  const showToast = (message, type = 'success') => {
    setToast({ show: true, message, type });
    setTimeout(() => setToast({ show: false, message: '', type: 'success' }), 3000);
  };

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { data: recentQuickFiles = [] } = useQuery({
    queryKey: ['quickCheckFiles', user?.id],
    queryFn: async () => {
      const files = await base44.entities.FileAsset.filter({ 
        project_id: null,
        uploaded_by_user_id: user?.id
      });
      
      // コメント数を取得し、IDを正規化
      const filesWithComments = await Promise.all(
        files.map(async (file) => {
          const fileId = file._id || file.id;
          const comments = await base44.entities.ReviewComment.filter({ file_id: fileId });
          return { 
            ...file, 
            id: fileId,
            _id: fileId,
            comment_count: comments.length 
          };
        })
      );
      
      return filesWithComments.sort((a, b) => new Date(b.uploaded_at) - new Date(a.uploaded_at));
    },
    enabled: !!user,
  });

  const uploadMutation = useMutation({
    mutationFn: async (file) => {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);
      
      return await base44.entities.FileAsset.create({
        project_id: null,
        title: file.name,
        original_filename: file.name,
        file_url,
        mime_type: file.type,
        size_bytes: file.size,
        uploaded_by_user_id: user?.id,
        uploaded_by_name: user?.full_name,
        uploaded_at: new Date().toISOString(),
        expires_at: expiresAt.toISOString(),
        comment_count: 0,
      });
    },
    onSuccess: async (fileAsset) => {
      const token = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);
      
      await base44.entities.ShareLink.create({
        file_id: fileAsset.id,
        token,
        is_active: true,
        expires_at: expiresAt.toISOString(),
        password_enabled: false,
        allow_download: true,
        share_latest_only: false,
        can_view_comments: true,
        can_post_comments: true,
      });

      setUploadedFile(fileAsset);
      setShareUrl(`${window.location.origin}${window.location.pathname}#/share/${token}`);
      setShowCompleteModal(true);
      queryClient.invalidateQueries(['quickCheckFiles']);
    },
  });

  const handleFileSelect = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    uploadMutation.mutate(file);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;
    uploadMutation.mutate(file);
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(shareUrl);
  };

  const getRemainingDays = (expiresAt) => {
    if (!expiresAt) return null;
    const days = differenceInDays(new Date(expiresAt), new Date());
    return days;
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 py-4">
        {/* タイトル */}
        <h1 className="text-center text-2xl font-bold mb-1">クイックチェックを始めましょう</h1>
        <p className="text-center text-sm text-gray-600 mb-4">ファイルをアップロードして共有リンクを発行</p>

        {/* アップロード枠 */}
        <Card className="mb-6 shadow-lg border-0">
          <CardContent className="p-4">
            <label
              htmlFor="file-upload"
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              className="border-2 border-dashed border-gray-300 rounded-xl p-6 flex flex-col items-center justify-center cursor-pointer hover:border-gray-400 hover:bg-gray-50 transition-all"
            >
              <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center mb-2">
                <FileText className="w-6 h-6 text-blue-600" />
              </div>
              <h3 className="text-base font-semibold mb-1">ここにアップロードしてみましょう</h3>
              <p className="text-xs text-gray-500 mb-1">クリックまたはドラッグ＆ドロップでアップロード</p>
              <p className="text-xs text-gray-400">
                .mp4 / .mov / .pdf / .jpeg / .png / .ai / .psd / .pptx / .docx / .xlsx
              </p>
              <input
                id="file-upload"
                type="file"
                className="hidden"
                onChange={handleFileSelect}
                disabled={uploadMutation.isPending}
              />
            </label>
            {uploadMutation.isPending && (
              <div className="mt-3 text-center">
                <div className="inline-block w-5 h-5 border-3 border-gray-300 border-t-blue-600 rounded-full animate-spin mb-1"></div>
                <p className="text-xs text-gray-600">アップロード中...</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 最近使用したファイル */}
        {recentQuickFiles.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-bold">最近使用したファイル</h2>
              <Button variant="link" className="text-xs text-blue-600 h-auto p-0">
                全て見る →
              </Button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              {recentQuickFiles.slice(0, 8).map((file) => {
                const remainingDays = getRemainingDays(file.expires_at);
                const fileId = file.id;
                return (
                  <Link 
                    key={file.id}
                    to={`${createPageUrl('FileView')}?fileId=${encodeURIComponent(fileId)}`}
                    className="group"
                  >
                    <Card className="h-full hover:shadow-lg transition-all border border-gray-200 overflow-hidden">
                      <div className="aspect-video bg-gray-100 flex items-center justify-center border-b overflow-hidden">
                        {file.mime_type?.startsWith('image/') ? (
                          <img 
                            src={file.file_url} 
                            alt={file.title}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <FileText className="w-10 h-10 text-gray-300 group-hover:text-gray-400 transition-colors" />
                        )}
                      </div>
                      <CardContent className="p-2.5">
                        <div className="flex items-start justify-between gap-2 mb-1.5">
                          <h3 className="font-medium text-xs truncate group-hover:text-blue-600 transition-colors">
                            {file.title}
                          </h3>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild onClick={(e) => e.preventDefault()}>
                              <Button variant="ghost" size="icon" className="h-5 w-5 -mt-0.5">
                                <MoreVertical className="w-3.5 h-3.5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={(e) => {
                                  e.preventDefault();
                                  handleCopyShareLink(file, showToast, (err) => showToast(err, 'error'));
                                }}
                              >
                                リンクをコピー
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={(e) => {
                                  e.preventDefault();
                                  handleDownloadFile(file, showToast, (err) => showToast(err, 'error'));
                                }}
                              >
                                ダウンロード
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {file.comment_count > 0 && (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                              <MessageSquare className="w-2.5 h-2.5 mr-0.5" />
                              {file.comment_count}
                            </Badge>
                          )}
                          {remainingDays !== null && (
                            <Badge variant={remainingDays < 3 ? 'destructive' : 'secondary'} className="text-[10px] px-1.5 py-0">
                              <Clock className="w-2.5 h-2.5 mr-0.5" />
                              残り{remainingDays}日
                            </Badge>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* アップロード完了モーダル */}
      <Dialog open={showCompleteModal} onOpenChange={setShowCompleteModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>準備が完了しました</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-2 block">共有URL</label>
              <div className="flex gap-2">
                <Input value={shareUrl} readOnly className="flex-1" />
                <Button onClick={copyToClipboard} size="icon">
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
            </div>
            <Button variant="outline" className="w-full">
              パスワードを設定
            </Button>
            <Button 
              className="w-full bg-blue-600 hover:bg-blue-700"
              onClick={() => {
                window.open(shareUrl, '_blank');
                setShowCompleteModal(false);
              }}
            >
              <Play className="w-4 h-4 mr-2" />
              チェックバックする
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* トースト通知 */}
      {toast.show && (
        <div className="fixed bottom-4 right-4 z-50">
          <div className={`px-6 py-3 rounded-lg shadow-lg ${
            toast.type === 'error' ? 'bg-red-600 text-white' : 'bg-green-600 text-white'
          }`}>
            {toast.message}
          </div>
        </div>
      )}
    </div>
  );
}