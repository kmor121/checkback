import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Shield, Mail } from 'lucide-react';

export default function AccountSettings() {
  const [user, setUser] = useState(null);
  const [displayName, setDisplayName] = useState('');
  const [language, setLanguage] = useState('');
  const [showNotificationSettings, setShowNotificationSettings] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    base44.auth.me().then(u => {
      setUser(u);
      setDisplayName(u.full_name || '');
      // languageは後でprofileから設定するので、ここでは初期値を設定しない
    }).catch(() => {});
  }, []);
  
  // profileが読み込まれたらlanguageを設定
  useEffect(() => {
    if (profile?.language) {
      setLanguage(profile.language);
    }
  }, [profile]);

  const { data: profile } = useQuery({
    queryKey: ['userProfile', user?.id],
    queryFn: async () => {
      const profiles = await base44.entities.UserProfile.filter({ user_id: user?.id });
      return profiles[0];
    },
    enabled: !!user,
  });

  const { data: notifPrefs } = useQuery({
    queryKey: ['notifPrefs', user?.id],
    queryFn: async () => {
      const prefs = await base44.entities.UserNotificationPreference.filter({ user_id: user?.id });
      return prefs[0];
    },
    enabled: !!user,
  });

  const { data: mutedProjects = [] } = useQuery({
    queryKey: ['mutedProjects', user?.id],
    queryFn: () => base44.entities.ProjectMute.filter({ user_id: user?.id, is_muted: true }),
    enabled: !!user,
  });

  const updateProfileMutation = useMutation({
    mutationFn: async (data) => {
      if (profile) {
        await base44.entities.UserProfile.update(profile.id, data);
      } else {
        await base44.entities.UserProfile.create({
          user_id: user?.id,
          ...data,
        });
      }
      await base44.auth.updateMe({ full_name: displayName });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['userProfile']);
      alert('保存しました');
    },
  });

  const updateNotifPrefsMutation = useMutation({
    mutationFn: async (data) => {
      if (notifPrefs) {
        await base44.entities.UserNotificationPreference.update(notifPrefs.id, data);
      } else {
        await base44.entities.UserNotificationPreference.create({
          user_id: user?.id,
          ...data,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['notifPrefs']);
      alert('保存しました');
    },
  });

  const handleSaveProfile = () => {
    updateProfileMutation.mutate({
      display_name: displayName,
      language,
      email: user?.email,
    });
  };

  const [emailTalk, setEmailTalk] = useState('all');
  const [emailFile, setEmailFile] = useState('on');
  const [emailReview, setEmailReview] = useState('all');
  const [emailSchedule, setEmailSchedule] = useState('on');
  const [emailNote, setEmailNote] = useState('all');
  const [emailOps, setEmailOps] = useState('on');

  useEffect(() => {
    if (notifPrefs) {
      setEmailTalk(notifPrefs.email_talk || 'all');
      setEmailFile(notifPrefs.email_file || 'on');
      setEmailReview(notifPrefs.email_review || 'all');
      setEmailSchedule(notifPrefs.email_schedule || 'on');
      setEmailNote(notifPrefs.email_note || 'all');
      setEmailOps(notifPrefs.email_ops || 'on');
    }
  }, [notifPrefs]);

  const handleSaveNotifPrefs = () => {
    updateNotifPrefsMutation.mutate({
      email_talk: emailTalk,
      email_file: emailFile,
      email_review: emailReview,
      email_schedule: emailSchedule,
      email_note: emailNote,
      email_ops: emailOps,
    });
  };

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-3xl font-bold mb-8">アカウント設定</h1>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>基本設定</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>言語を選択</Label>
              <Select value={language || 'ja'} onValueChange={setLanguage}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="言語を選択" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ja">日本語</SelectItem>
                  <SelectItem value="en">English</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>名前</Label>
              <Input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="mt-1"
              />
            </div>

            <div>
              <Label>メールアドレス</Label>
              <div className="flex gap-2 mt-1">
                <Input value={user?.email || ''} readOnly className="flex-1" />
                <Button variant="outline">変更</Button>
              </div>
            </div>

            <Button onClick={handleSaveProfile} className="bg-blue-600 hover:bg-blue-700">
              保存
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5" />
              2要素認証
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">未認証</p>
                <p className="text-xs text-gray-500 mt-1">
                  アカウントのセキュリティを強化するために2要素認証を有効にしてください
                </p>
              </div>
              <Badge variant="secondary">未認証</Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="w-5 h-5" />
              通知設定
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Button onClick={() => setShowNotificationSettings(true)} variant="outline">
              通知設定を開く
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* 通知設定モーダル */}
      <Dialog open={showNotificationSettings} onOpenChange={setShowNotificationSettings}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>アカウント通知設定</DialogTitle>
          </DialogHeader>

          <Tabs defaultValue="email">
            <TabsList className="grid grid-cols-4 w-full">
              <TabsTrigger value="email">メール通知</TabsTrigger>
              <TabsTrigger value="push">プッシュ通知</TabsTrigger>
              <TabsTrigger value="apps">アプリ連携</TabsTrigger>
              <TabsTrigger value="muted">ミュート</TabsTrigger>
            </TabsList>

            <TabsContent value="email" className="space-y-4">
              <div>
                <Label>トーク</Label>
                <Select value={emailTalk} onValueChange={setEmailTalk}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">すべて</SelectItem>
                    <SelectItem value="mentions">メンションのみ</SelectItem>
                    <SelectItem value="none">通知なし</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>ファイル</Label>
                <Select value={emailFile} onValueChange={setEmailFile}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="on">通知あり</SelectItem>
                    <SelectItem value="off">通知なし</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>レビュー</Label>
                <Select value={emailReview} onValueChange={setEmailReview}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">すべて</SelectItem>
                    <SelectItem value="mentions">メンションのみ</SelectItem>
                    <SelectItem value="none">通知なし</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>スケジュール</Label>
                <Select value={emailSchedule} onValueChange={setEmailSchedule}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="on">通知あり</SelectItem>
                    <SelectItem value="off">通知なし</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>ノート</Label>
                <Select value={emailNote} onValueChange={setEmailNote}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">すべて</SelectItem>
                    <SelectItem value="mentions">メンションのみ</SelectItem>
                    <SelectItem value="none">通知なし</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>運営からのお知らせ</Label>
                <Select value={emailOps} onValueChange={setEmailOps}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="on">通知あり</SelectItem>
                    <SelectItem value="off">通知なし</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Button onClick={handleSaveNotifPrefs} className="w-full bg-blue-600 hover:bg-blue-700">
                保存
              </Button>
            </TabsContent>

            <TabsContent value="push" className="text-center text-gray-500 py-8">
              プッシュ通知設定（実装予定）
            </TabsContent>

            <TabsContent value="apps" className="text-center text-gray-500 py-8">
              アプリ連携設定（実装予定）
            </TabsContent>

            <TabsContent value="muted" className="space-y-4">
              {mutedProjects.length === 0 ? (
                <div className="text-center text-gray-500 py-8">
                  ミュート中のプロジェクトはありません
                </div>
              ) : (
                <div className="space-y-2">
                  {mutedProjects.map(mp => (
                    <div key={mp.id} className="border rounded p-3 flex items-center justify-between">
                      <span>プロジェクト</span>
                      <Button variant="outline" size="sm">解除</Button>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-sm text-gray-600 mt-4">
                ミュート解除はプロジェクト画面から行うことができます
              </p>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </div>
  );
}