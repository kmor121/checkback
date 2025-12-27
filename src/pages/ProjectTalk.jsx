import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { MessageSquare, Send } from 'lucide-react';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';

export default function ProjectTalk() {
  const [user, setUser] = useState(null);
  const [message, setMessage] = useState('');
  const queryClient = useQueryClient();
  const params = new URLSearchParams(window.location.search);
  const projectId = params.get('projectId');

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

  const { data: messages = [] } = useQuery({
    queryKey: ['messages', projectId],
    queryFn: () => base44.entities.ProjectMessage.filter({ project_id: projectId }),
    enabled: !!projectId,
  });

  const sendMessageMutation = useMutation({
    mutationFn: (data) => base44.entities.ProjectMessage.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['messages']);
      setMessage('');
    },
  });

  const handleSend = () => {
    if (!message.trim()) return;
    sendMessageMutation.mutate({
      project_id: projectId,
      user_id: user?.id,
      user_name: user?.full_name,
      body: message,
    });
  };

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">{project?.name || 'プロジェクト'}</h1>
        <Tabs defaultValue="talk" className="mt-4">
          <TabsList>
            <TabsTrigger value="talk">トーク</TabsTrigger>
            <TabsTrigger value="files" onClick={() => window.location.href = '#/app/projects/' + projectId + '/files'}>
              ファイル
            </TabsTrigger>
            <TabsTrigger value="schedule" onClick={() => window.location.href = '#/app/projects/' + projectId + '/schedule'}>
              スケジュール
            </TabsTrigger>
            <TabsTrigger value="notes" onClick={() => window.location.href = '#/app/projects/' + projectId + '/notes'}>
              ノート
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5" />
            トーク
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4 mb-4 max-h-96 overflow-y-auto">
            {messages.length === 0 ? (
              <div className="text-center text-gray-500 py-8">
                まだメッセージがありません
              </div>
            ) : (
              messages.map((msg) => (
                <div key={msg.id} className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white text-sm font-semibold flex-shrink-0">
                    {msg.user_name?.[0] || 'U'}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-sm">{msg.user_name}</span>
                      <span className="text-xs text-gray-500">
                        {format(new Date(msg.created_date), 'yyyy/MM/dd HH:mm', { locale: ja })}
                      </span>
                    </div>
                    <p className="text-sm text-gray-700">{msg.body}</p>
                  </div>
                </div>
              ))
            )}
          </div>
          
          <div className="border-t pt-4">
            <Textarea
              placeholder="メッセージを入力"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              className="mb-2"
            />
            <div className="flex justify-end">
              <Button onClick={handleSend} disabled={!message.trim()} className="bg-blue-600 hover:bg-blue-700">
                <Send className="w-4 h-4 mr-2" />
                送信
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}