import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Upload, Link as LinkIcon, Play, Copy, Clock, MessageSquare, MoreVertical } from 'lucide-react';
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
import { handleOpenFile, handleCopyShareLink, handleDownloadFile } from '../components/files/FileMenuActions';

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
      
      // コメント数を取得
      const filesWithComments = await Promise.all(
        files.map(async (file) => {
          const comments = await base44.entities.ReviewComment.filter({ file_id: file._id || file.id });
          return { ...file, comment_count: comments.length };
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
    <div className="max-w-6xl mx-auto">
      <h1 className="text-3xl font-bold mb-8">クイックチェック</h1>

      {/* ステップ表示 */}
      <div className="mb-8 flex items-center justify-center gap-4">
        <div className="flex items-center gap-2">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center ${uploadedFile ? 'bg-green-500' : 'bg-blue-600'} text-white font-semibold`}>
            {uploadedFile ? '✓' : '1'}
          </div>
          <span className="text-sm font-medium">アップロード</span>
        </div>
        <div className="w-12 h-0.5 bg-gray-300" />
        <div className="flex items-center gap-2">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center ${showCompleteModal ? 'bg-blue-600' : 'bg-gray-300'} text-white font-semibold`}>
            2
          </div>
          <span className="text-sm font-medium">リンクを発行</span>
        </div>
        <div className="w-12 h-0.5 bg-gray-300" />
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full flex items-center justify-center bg-gray-300 text-white font-semibold">
            3
          </div>
          <span className="text-sm font-medium">チェックバック開始</span>
        </div>
      </div>

      {/* アップロード枠 */}
      <Card className="mb-8">
        <CardContent className="p-12">
          <label
            htmlFor="file-upload"
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            className="border-2 border-dashed border-gray-300 rounded-lg p-12 flex flex-col items-center justify-center cursor-pointer hover:border-blue-500 hover:bg-blue-50 transition-colors"
          >
            <Upload className="w-16 h-16 text-gray-400 mb-4" />
            <p className="text-lg font-medium mb-2">ファイルをドラッグ＆ドロップ</p>
            <p className="text-sm text-gray-500 mb-4">または</p>
            <Button type="button" className="bg-blue-600 hover:bg-blue-700">
              ファイルを選択
            </Button>
            <input
              id="file-upload"
              type="file"
              className="hidden"
              onChange={handleFileSelect}
              disabled={uploadMutation.isPending}
            />
          </label>
          {uploadMutation.isPending && (
            <div className="mt-4 text-center text-sm text-gray-600">
              アップロード中...
            </div>
          )}
        </CardContent>
      </Card>

      {/* 最近使用したファイル */}
      <div>
        <h2 className="text-xl font-bold mb-4">最近使用したファイル</h2>
        {recentQuickFiles.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-gray-500">
              最近使用したファイルはありません
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {recentQuickFiles.map((file) => {
              const remainingDays = getRemainingDays(file.expires_at);
              return (
                <Card key={file.id} className="hover:shadow-lg transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium truncate">{file.title}</h3>
                        <div className="flex items-center gap-2 mt-1">
                          {file.comment_count > 0 && (
                            <Badge variant="secondary" className="text-xs">
                              <MessageSquare className="w-3 h-3 mr-1" />
                              {file.comment_count}
                            </Badge>
                          )}
                          {remainingDays !== null && (
                            <Badge variant={remainingDays < 3 ? 'destructive' : 'secondary'} className="text-xs">
                              <Clock className="w-3 h-3 mr-1" />
                              残り{remainingDays}日
                            </Badge>
                          )}
                        </div>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreVertical className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                         <DropdownMenuItem 
                           onClick={(e) => {
                             e.stopPropagation();
                             handleOpenFile(file, showToast, (err) => showToast(err, 'error'));
                           }}
                         >
                           開く
                         </DropdownMenuItem>
                         <DropdownMenuItem
                           onClick={(e) => {
                             e.stopPropagation();
                             handleCopyShareLink(file, showToast, (err) => showToast(err, 'error'));
                           }}
                         >
                           リンクをコピー
                         </DropdownMenuItem>
                         <DropdownMenuItem
                           onClick={(e) => {
                             e.stopPropagation();
                             handleDownloadFile(file, showToast, (err) => showToast(err, 'error'));
                           }}
                         >
                           ダウンロード
                         </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <div className="text-xs text-gray-500">
                      {format(new Date(file.uploaded_at), 'yyyy/MM/dd HH:mm', { locale: ja })}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
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