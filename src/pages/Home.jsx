import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { MessageSquare, FileText, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { Link } from 'react-router-dom';
import { createPageUrl } from '../utils';

export default function Home() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { data: recentFiles = [] } = useQuery({
    queryKey: ['recentFiles', user?.id],
    queryFn: async () => {
      const recents = await base44.entities.UserRecent.filter({ 
        user_id: user?.id,
        type: 'file'
      });
      const fileIds = recents.map(r => r.ref_id);
      const files = await Promise.all(
        fileIds.map(id => base44.entities.FileAsset.filter({ id }))
      );
      return recents.map((r, i) => ({
        ...files[i][0],
        context_label: r.context_label,
        last_viewed_at: r.last_viewed_at
      })).filter(f => f.id);
    },
    enabled: !!user,
  });

  const { data: recentTalks = [] } = useQuery({
    queryKey: ['recentTalks', user?.id],
    queryFn: async () => {
      const messages = await base44.entities.ProjectMessage.list('-created_date', 10);
      return messages;
    },
    enabled: !!user,
  });

  const formatRelativeTime = (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now - date;
    const hours = Math.floor(diff / (1000 * 60 * 60));
    
    if (hours < 24) {
      return `今日 ${format(date, 'HH:mm', { locale: ja })}`;
    } else if (hours < 48) {
      return `昨日 ${format(date, 'HH:mm', { locale: ja })}`;
    } else {
      return format(date, 'M月d日 HH:mm', { locale: ja });
    }
  };

  return (
    <div className="max-w-7xl mx-auto">
      <h1 className="text-3xl font-bold mb-8">ホーム</h1>
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 最近のトーク */}
        <Card className="lg:col-span-2">
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="w-5 h-5" />
              最近のトーク
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {recentTalks.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                最近のトークはありません
              </div>
            ) : (
              <div className="divide-y">
                {recentTalks.map((talk) => (
                  <div key={talk.id} className="p-4 hover:bg-gray-50 transition-colors">
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white text-sm font-semibold flex-shrink-0">
                        {talk.user_name?.[0] || 'U'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-sm">{talk.user_name}</span>
                          <span className="text-xs text-gray-500">
                            {formatRelativeTime(talk.created_date)}
                          </span>
                        </div>
                        <p className="text-sm text-gray-700 line-clamp-2">{talk.body}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 最近閲覧したファイル */}
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5" />
              最近閲覧したファイル
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {recentFiles.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                最近閲覧したファイルはありません
              </div>
            ) : (
              <div className="divide-y">
                {recentFiles.map((file) => (
                  <Link
                    key={file.id}
                    to={createPageUrl('FileView') + '?fileId=' + file.id}
                    className="block p-4 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <FileText className="w-4 h-4 text-gray-400" />
                      <span className="font-medium text-sm truncate">{file.title}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <Clock className="w-3 h-3" />
                      {formatRelativeTime(file.last_viewed_at)}
                    </div>
                    {file.context_label && (
                      <div className="text-xs text-gray-500 mt-1">in: {file.context_label}</div>
                    )}
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}