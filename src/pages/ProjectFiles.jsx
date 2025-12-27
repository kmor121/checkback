import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Upload,
  Grid3x3,
  List,
  MessageSquare,
  MoreVertical,
  FileText,
  Download,
  Share2,
  ExternalLink,
  Copy,
  Edit2
} from 'lucide-react';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { Link } from 'react-router-dom';
import { createPageUrl } from '../utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { handleOpenFile, handleCopyShareLink, handleDownloadFile } from '../components/files/FileMenuActions';

export default function ProjectFiles() {
  const [user, setUser] = useState(null);
  const [viewMode, setViewMode] = useState('grid');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortBy, setSortBy] = useState('updated');
  const [selectedFile, setSelectedFile] = useState(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });
  const queryClient = useQueryClient();
  const params = new URLSearchParams(window.location.search);
  const projectId = params.get('projectId');

  const showToast = (message, type = 'success') => {
    setToast({ show: true, message, type });
    setTimeout(() => setToast({ show: false, message: '', type: 'success' }), 3000);
  };

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: async () => {
      const projects = await base44.entities.Project.filter({ id: projectId });
      return projects[0];
    },
    enabled: !!projectId,
  });

  const { data: files = [] } = useQuery({
    queryKey: ['files', projectId],
    queryFn: () => base44.entities.FileAsset.filter({ project_id: projectId }),
    enabled: !!projectId,
  });

  const uploadMutation = useMutation({
    mutationFn: async (file) => {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      return await base44.entities.FileAsset.create({
        project_id: projectId,
        title: file.name,
        original_filename: file.name,
        file_url,
        mime_type: file.type,
        size_bytes: file.size,
        uploaded_by_user_id: user?.id,
        uploaded_by_name: user?.full_name,
        uploaded_at: new Date().toISOString(),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['files']);
    },
  });

  const handleFileSelect = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    uploadMutation.mutate(file);
  };

  const filteredFiles = files.filter(f => {
    if (statusFilter !== 'all' && f.status !== statusFilter) return false;
    return true;
  });

  const sortedFiles = [...filteredFiles].sort((a, b) => {
    if (sortBy === 'name') return a.title.localeCompare(b.title);
    if (sortBy === 'updated') return new Date(b.updated_date) - new Date(a.updated_date);
    if (sortBy === 'uploaded') return new Date(b.uploaded_at) - new Date(a.uploaded_at);
    return 0;
  });

  const formatFileSize = (bytes) => {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">{project?.name || 'プロジェクト'}</h1>
        <Tabs defaultValue="files" className="mt-4">
          <TabsList>
            <TabsTrigger value="talk" onClick={() => window.location.href = '#/app/projects/' + projectId + '/talk'}>
              トーク
            </TabsTrigger>
            <TabsTrigger value="files">ファイル</TabsTrigger>
            <TabsTrigger value="schedule" onClick={() => window.location.href = '#/app/projects/' + projectId + '/schedule'}>
              スケジュール
            </TabsTrigger>
            <TabsTrigger value="notes" onClick={() => window.location.href = '#/app/projects/' + projectId + '/notes'}>
              ノート
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* ツールバー */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">すべて</SelectItem>
              <SelectItem value="未設定">未設定</SelectItem>
              <SelectItem value="進行中">進行中</SelectItem>
              <SelectItem value="完了">完了</SelectItem>
            </SelectContent>
          </Select>
          
          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="updated">更新日</SelectItem>
              <SelectItem value="uploaded">アップロード日</SelectItem>
              <SelectItem value="name">名前</SelectItem>
            </SelectContent>
          </Select>

          <Button
            variant="outline"
            size="icon"
            onClick={() => setViewMode('grid')}
            className={viewMode === 'grid' ? 'bg-gray-100' : ''}
          >
            <Grid3x3 className="w-4 h-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setViewMode('list')}
            className={viewMode === 'list' ? 'bg-gray-100' : ''}
          >
            <List className="w-4 h-4" />
          </Button>
        </div>

        <label htmlFor="file-upload">
          <Button className="bg-blue-600 hover:bg-blue-700">
            <Upload className="w-4 h-4 mr-2" />
            新規アップロード
          </Button>
          <input
            id="file-upload"
            type="file"
            className="hidden"
            onChange={handleFileSelect}
            disabled={uploadMutation.isPending}
          />
        </label>
      </div>

      {/* ファイル一覧 */}
      {sortedFiles.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center text-gray-500">
            ファイルがありません
          </CardContent>
        </Card>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {sortedFiles.map((file) => (
            <Card
              key={file.id}
              className="hover:shadow-lg transition-shadow cursor-pointer"
              onClick={() => {
                setSelectedFile(file);
                setDetailsOpen(true);
              }}
            >
              <CardContent className="p-4">
                <div className="aspect-video bg-gray-100 rounded mb-3 flex items-center justify-center">
                  <FileText className="w-12 h-12 text-gray-400" />
                </div>
                <div className="flex items-start justify-between mb-2">
                  <h3 className="font-medium text-sm truncate flex-1">{file.title}</h3>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="icon" className="h-6 w-6">
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
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-xs">{file.status}</Badge>
                  {file.comment_count > 0 && (
                    <Badge variant="secondary" className="text-xs">
                      <MessageSquare className="w-3 h-3 mr-1" />
                      {file.comment_count}
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y">
              {sortedFiles.map((file) => (
                <div
                  key={file.id}
                  className="p-4 hover:bg-gray-50 transition-colors cursor-pointer flex items-center justify-between"
                  onClick={() => {
                    setSelectedFile(file);
                    setDetailsOpen(true);
                  }}
                >
                  <div className="flex items-center gap-3 flex-1">
                    <FileText className="w-5 h-5 text-gray-400" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{file.title}</div>
                      <div className="text-sm text-gray-500">
                        {format(new Date(file.uploaded_at), 'yyyy/MM/dd HH:mm', { locale: ja })}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{file.status}</Badge>
                    {file.comment_count > 0 && (
                      <Badge variant="secondary">
                        <MessageSquare className="w-3 h-3 mr-1" />
                        {file.comment_count}
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ファイル詳細パネル */}
      <Sheet open={detailsOpen} onOpenChange={setDetailsOpen}>
        <SheetContent className="w-96">
          <SheetHeader>
            <SheetTitle>ファイル詳細</SheetTitle>
          </SheetHeader>
          {selectedFile && (
            <div className="mt-6 space-y-6">
              <div className="aspect-video bg-gray-100 rounded flex items-center justify-center">
                <FileText className="w-16 h-16 text-gray-400" />
              </div>

              <div>
                <h3 className="font-semibold mb-4">メタ情報</h3>
                <div className="space-y-3 text-sm">
                  <div>
                    <span className="text-gray-500">アップロード日:</span>
                    <div className="font-medium">
                      {format(new Date(selectedFile.uploaded_at), 'yyyy/MM/dd HH:mm', { locale: ja })}
                    </div>
                  </div>
                  <div>
                    <span className="text-gray-500">アップロード者:</span>
                    <div className="font-medium">{selectedFile.uploaded_by_name}</div>
                  </div>
                  <div>
                    <span className="text-gray-500">サイズ:</span>
                    <div className="font-medium">{formatFileSize(selectedFile.size_bytes)}</div>
                  </div>
                  <div>
                    <span className="text-gray-500">ステータス:</span>
                    <div>
                      <Select defaultValue={selectedFile.status}>
                        <SelectTrigger className="w-full mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="未設定">未設定</SelectItem>
                          <SelectItem value="進行中">進行中</SelectItem>
                          <SelectItem value="完了">完了</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="font-semibold mb-4">操作</h3>
                <div className="space-y-2">
                  <Button variant="outline" className="w-full justify-start">
                    <Edit2 className="w-4 h-4 mr-2" />
                    名前を変更
                  </Button>
                  <Button 
                    variant="outline" 
                    className="w-full justify-start"
                    onClick={() => handleCopyShareLink(selectedFile, showToast, (err) => showToast(err, 'error'))}
                  >
                    <Share2 className="w-4 h-4 mr-2" />
                    共有リンクをコピー
                  </Button>
                  <Button 
                    variant="outline" 
                    className="w-full justify-start"
                    onClick={() => handleOpenFile(selectedFile, showToast, (err) => showToast(err, 'error'))}
                  >
                    <ExternalLink className="w-4 h-4 mr-2" />
                    別タブで開く
                  </Button>
                  <Button 
                    variant="outline" 
                    className="w-full justify-start"
                    onClick={() => handleCopyShareLink(selectedFile, showToast, (err) => showToast(err, 'error'))}
                  >
                    <Copy className="w-4 h-4 mr-2" />
                    リンクをコピー
                  </Button>
                  <Button 
                    variant="outline" 
                    className="w-full justify-start"
                    onClick={() => handleDownloadFile(selectedFile, showToast, (err) => showToast(err, 'error'))}
                  >
                    <Download className="w-4 h-4 mr-2" />
                    ダウンロード
                  </Button>
                  <Button 
                    className="w-full bg-blue-600 hover:bg-blue-700"
                    onClick={() => handleOpenFile(selectedFile, showToast, (err) => showToast(err, 'error'))}
                  >
                    <Button className="w-full bg-blue-600 hover:bg-blue-700">
                      プレビュー
                    </Button>
                  </Link>
                </div>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

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