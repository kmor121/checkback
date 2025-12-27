import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Calendar, Plus } from 'lucide-react';

export default function ProjectSchedule() {
  const [user, setUser] = useState(null);
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

  const { data: events = [] } = useQuery({
    queryKey: ['scheduleEvents', projectId],
    queryFn: () => base44.entities.ProjectScheduleEvent.filter({ project_id: projectId }),
    enabled: !!projectId,
  });

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">{project?.name || 'プロジェクト'}</h1>
        <Tabs defaultValue="schedule" className="mt-4">
          <TabsList>
            <TabsTrigger value="talk" onClick={() => window.location.href = '#/app/projects/' + projectId + '/talk'}>
              トーク
            </TabsTrigger>
            <TabsTrigger value="files" onClick={() => window.location.href = '#/app/projects/' + projectId + '/files'}>
              ファイル
            </TabsTrigger>
            <TabsTrigger value="schedule">スケジュール</TabsTrigger>
            <TabsTrigger value="notes" onClick={() => window.location.href = '#/app/projects/' + projectId + '/notes'}>
              ノート
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            スケジュール
          </CardTitle>
          <Button className="bg-blue-600 hover:bg-blue-700">
            <Plus className="w-4 h-4 mr-2" />
            イベント追加
          </Button>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <div className="text-center text-gray-500 py-12">
              スケジュールイベントはありません
            </div>
          ) : (
            <div className="space-y-3">
              {events.map((event) => (
                <div key={event.id} className="border rounded-lg p-4 hover:bg-gray-50 transition-colors">
                  <h3 className="font-medium mb-1">{event.title}</h3>
                  <p className="text-sm text-gray-600">
                    {event.start_date} 〜 {event.end_date}
                  </p>
                  {event.description && (
                    <p className="text-sm text-gray-500 mt-2">{event.description}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}