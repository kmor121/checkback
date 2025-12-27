import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FileText, Send } from 'lucide-react';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';

export default function ProjectNotes() {
  const [user, setUser] = useState(null);
  const [noteBody, setNoteBody] = useState('');
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

  const { data: notes = [] } = useQuery({
    queryKey: ['notes', projectId],
    queryFn: () => base44.entities.NotePost.filter({ project_id: projectId }),
    enabled: !!projectId,
  });

  const createNoteMutation = useMutation({
    mutationFn: (data) => base44.entities.NotePost.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['notes']);
      setNoteBody('');
    },
  });

  const handleSend = () => {
    if (!noteBody.trim()) return;
    createNoteMutation.mutate({
      project_id: projectId,
      user_id: user?.id,
      user_name: user?.full_name,
      body: noteBody,
    });
  };

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">{project?.name || 'プロジェクト'}</h1>
        <Tabs defaultValue="notes" className="mt-4">
          <TabsList>
            <TabsTrigger value="talk" onClick={() => window.location.href = '#/app/projects/' + projectId + '/talk'}>
              トーク
            </TabsTrigger>
            <TabsTrigger value="files" onClick={() => window.location.href = '#/app/projects/' + projectId + '/files'}>
              ファイル
            </TabsTrigger>
            <TabsTrigger value="schedule" onClick={() => window.location.href = '#/app/projects/' + projectId + '/schedule'}>
              スケジュール
            </TabsTrigger>
            <TabsTrigger value="notes">ノート</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" />
            ノート
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4 mb-4">
            {notes.length === 0 ? (
              <div className="text-center text-gray-500 py-8">
                まだノートがありません
              </div>
            ) : (
              notes.map((note) => (
                <div key={note.id} className="border-l-4 border-blue-500 pl-4 py-2">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium">{note.user_name}</span>
                    <span className="text-xs text-gray-500">
                      {format(new Date(note.created_date), 'yyyy/MM/dd HH:mm', { locale: ja })}
                    </span>
                  </div>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{note.body}</p>
                </div>
              ))
            )}
          </div>
          
          <div className="border-t pt-4">
            <Textarea
              placeholder="ノートを入力"
              value={noteBody}
              onChange={(e) => setNoteBody(e.target.value)}
              rows={5}
              className="mb-2"
            />
            <div className="flex justify-end">
              <Button onClick={handleSend} disabled={!noteBody.trim()} className="bg-blue-600 hover:bg-blue-700">
                <Send className="w-4 h-4 mr-2" />
                投稿
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}