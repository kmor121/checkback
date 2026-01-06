import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FileText, Home, FolderOpen, Zap, Settings, HelpCircle } from 'lucide-react';

export default function DebugRoutes() {
  const [routes, setRoutes] = useState([]);
  const [currentUrl, setCurrentUrl] = useState('');

  useEffect(() => {
    // Base44 アプリ内の全ページを手動リスト化
    const appRoutes = [
      { path: '/', name: 'Home', component: 'pages/Home.js', icon: Home },
      { path: '/QuickCheck', name: 'QuickCheck', component: 'pages/QuickCheck.js', icon: Zap },
      { path: '/Projects', name: 'Projects', component: 'pages/Projects.js', icon: FolderOpen },
      { path: '/ProjectFiles', name: 'ProjectFiles', component: 'pages/ProjectFiles.js', icon: FileText },
      { path: '/ProjectTalk', name: 'ProjectTalk', component: 'pages/ProjectTalk.js', icon: FileText },
      { path: '/ProjectSchedule', name: 'ProjectSchedule', component: 'pages/ProjectSchedule.js', icon: FileText },
      { path: '/ProjectNotes', name: 'ProjectNotes', component: 'pages/ProjectNotes.js', icon: FileText },
      { path: '/FileView', name: 'FileView', component: 'pages/FileView.js', icon: FileText, description: 'ファイルビューワー（?fileId=...）' },
      { path: '/ShareView', name: 'ShareView', component: 'pages/ShareView.js', icon: FileText, description: '共有リンク閲覧' },
      { path: '/AccountSettings', name: 'AccountSettings', component: 'pages/AccountSettings.js', icon: Settings },
      { path: '/DebugRoutes', name: 'DebugRoutes', component: 'pages/DebugRoutes.js', icon: HelpCircle, description: 'このページ' },
    ];

    setRoutes(appRoutes);
    setCurrentUrl(window.location.href);
  }, []);

  const handleNavigate = (path) => {
    window.location.hash = path;
  };

  return (
    <div className="max-w-6xl mx-auto p-6">
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-2xl">🗺️ アプリルート一覧（デバッグ）</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="bg-gray-100 p-4 rounded mb-4">
            <div className="text-sm font-mono">
              <div><strong>Current URL:</strong> {currentUrl}</div>
              <div><strong>Pathname:</strong> {window.location.pathname}</div>
              <div><strong>Hash:</strong> {window.location.hash || '(none)'}</div>
              <div><strong>Search:</strong> {window.location.search || '(none)'}</div>
            </div>
          </div>

          <div className="space-y-2">
            {routes.map((route) => {
              const Icon = route.icon;
              const isCurrent = window.location.hash === `#${route.path}` || 
                               (window.location.hash === '' && route.path === '/');
              
              return (
                <Card key={route.path} className={`hover:shadow-md transition-shadow ${isCurrent ? 'border-2 border-blue-500' : ''}`}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 flex-1">
                        <Icon className="w-5 h-5 text-gray-600" />
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold">{route.name}</span>
                            {isCurrent && <Badge variant="secondary">現在のページ</Badge>}
                          </div>
                          <div className="text-xs text-gray-500 font-mono">#{route.path}</div>
                          {route.description && (
                            <div className="text-xs text-gray-600 mt-1">{route.description}</div>
                          )}
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleNavigate(route.path)}
                      >
                        開く
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <div className="mt-6 p-4 bg-yellow-50 border border-yellow-200 rounded">
            <h3 className="font-semibold mb-2">📝 ルーティングの仕様</h3>
            <ul className="text-sm space-y-1 text-gray-700">
              <li>• Base44 はフラットなページ構造のみサポート（サブフォルダ不可）</li>
              <li>• pages/*.js → ハッシュルート #/* にマップされます</li>
              <li>• 例: pages/FileView.js → #/FileView</li>
              <li>• Canonical URL: <code className="bg-gray-200 px-1 rounded">#/FileView?fileId=&lt;id&gt;</code></li>
              <li>• 共有リンク: <code className="bg-gray-200 px-1 rounded">/share/:token</code> （ハッシュなし）</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}