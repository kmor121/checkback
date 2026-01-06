import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Copy, Check, ExternalLink } from 'lucide-react';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { createPageUrl } from '@/utils';

export default function ShareLinkModal({ open, onOpenChange, fileId }) {
  const [passwordEnabled, setPasswordEnabled] = useState(false);
  const [password, setPassword] = useState('');
  const [expiresInDays, setExpiresInDays] = useState(30);
  const [allowDownload, setAllowDownload] = useState(true);
  const [shareLatestOnly, setShareLatestOnly] = useState(false);
  const [canViewComments, setCanViewComments] = useState(true);
  const [canPostComments, setCanPostComments] = useState(true);
  const [generatedUrl, setGeneratedUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const queryClient = useQueryClient();

  const { data: shareLinks = [] } = useQuery({
    queryKey: ['shareLinks', fileId],
    queryFn: () => base44.entities.ShareLink.filter({ file_id: fileId }),
    enabled: !!fileId && open,
  });

  const createLinkMutation = useMutation({
    mutationFn: async () => {
      const token = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + parseInt(expiresInDays));

      let passwordHash = null;
      if (passwordEnabled && password) {
        const encoder = new TextEncoder();
        const data = encoder.encode(password + 'salt');
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        passwordHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      }

      await base44.entities.ShareLink.create({
        file_id: fileId,
        token,
        is_active: true,
        expires_at: expiresAt.toISOString(),
        password_enabled: passwordEnabled,
        password_hash: passwordHash,
        allow_download: allowDownload,
        share_latest_only: shareLatestOnly,
        can_view_comments: canViewComments,
        can_post_comments: canPostComments,
      });

      return token;
    },
    onSuccess: (token) => {
      // Canonical URL: ShareView page with token parameter
      const url = `${window.location.origin}${createPageUrl('ShareView')}?token=${token}`;
      setGeneratedUrl(url);
      queryClient.invalidateQueries(['shareLinks']);
    },
  });

  const handleCopy = () => {
    navigator.clipboard.writeText(generatedUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>共有リンク</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="create">
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="create">共有リンクを発行</TabsTrigger>
            <TabsTrigger value="history">発行履歴</TabsTrigger>
          </TabsList>

          <TabsContent value="create" className="space-y-4">
            {generatedUrl ? (
              <div className="space-y-4">
                <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                  <p className="text-sm font-medium text-green-800 mb-2">共有リンクを発行しました</p>
                  <div className="flex gap-2 mb-3">
                    <Input value={generatedUrl} readOnly className="flex-1" />
                    <Button onClick={handleCopy} size="icon" title="コピー">
                      {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    </Button>
                    <Button 
                      onClick={() => window.open(generatedUrl, '_blank')} 
                      size="icon" 
                      variant="outline"
                      title="新規タブで開く"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </Button>
                  </div>
                  <div className="text-xs text-gray-600 bg-gray-50 p-2 rounded border">
                    <strong>Copied URL:</strong> {generatedUrl}
                  </div>
                </div>
                <Button variant="outline" onClick={() => setGeneratedUrl('')} className="w-full">
                  新しいリンクを作成
                </Button>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>パスワード付きリンク</Label>
                    <Switch checked={passwordEnabled} onCheckedChange={setPasswordEnabled} />
                  </div>
                  {passwordEnabled && (
                    <Input
                      type="password"
                      placeholder="パスワードを入力"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  )}
                </div>

                <div className="space-y-2">
                  <Label>有効期限（日数）</Label>
                  <Input
                    type="number"
                    min="1"
                    max="100"
                    value={expiresInDays}
                    onChange={(e) => setExpiresInDays(e.target.value)}
                  />
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>ダウンロード許可</Label>
                    <Switch checked={allowDownload} onCheckedChange={setAllowDownload} />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label>過去のバージョンを共有しない</Label>
                    <Switch checked={shareLatestOnly} onCheckedChange={setShareLatestOnly} />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label>コメント閲覧可</Label>
                    <Switch checked={canViewComments} onCheckedChange={setCanViewComments} />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label>コメント投稿可</Label>
                    <Switch checked={canPostComments} onCheckedChange={setCanPostComments} />
                  </div>
                </div>

                <Button
                  onClick={() => createLinkMutation.mutate()}
                  disabled={createLinkMutation.isPending || (passwordEnabled && !password)}
                  className="w-full bg-blue-600 hover:bg-blue-700"
                >
                  リンクを発行
                </Button>
              </>
            )}
          </TabsContent>

          <TabsContent value="history" className="space-y-2">
            {shareLinks.length === 0 ? (
              <div className="text-center text-gray-500 py-8">
                発行履歴がありません
              </div>
            ) : (
              shareLinks.map((link) => {
                const linkUrl = `${window.location.origin}${createPageUrl('ShareView')}?token=${link.token}`;
                return (
                <div key={link.id} className="border rounded-lg p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <div className="text-sm font-medium mb-1">
                        {format(new Date(link.created_date), 'yyyy/MM/dd HH:mm', { locale: ja })}
                      </div>
                      <div className="text-xs text-gray-500 mb-1">
                        期限: {format(new Date(link.expires_at), 'yyyy/MM/dd', { locale: ja })}
                      </div>
                      <div className="text-xs text-blue-600 break-all">
                        {linkUrl}
                      </div>
                    </div>
                    <Badge variant={link.is_active ? 'default' : 'secondary'}>
                      {link.is_active ? '有効' : '無効'}
                    </Badge>
                  </div>
                  <div className="flex gap-2 flex-wrap text-xs mb-2">
                    {link.password_enabled && <Badge variant="outline">パスワード</Badge>}
                    {link.allow_download && <Badge variant="outline">DL可</Badge>}
                    {link.can_post_comments && <Badge variant="outline">投稿可</Badge>}
                  </div>
                  <div className="flex gap-2">
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => {
                        navigator.clipboard.writeText(linkUrl);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      }}
                    >
                      <Copy className="w-3 h-3 mr-1" />
                      コピー
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => window.open(linkUrl, '_blank')}
                    >
                      <ExternalLink className="w-3 h-3 mr-1" />
                      開く
                    </Button>
                  </div>
                </div>
                );
              })
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}