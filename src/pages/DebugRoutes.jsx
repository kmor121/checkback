import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FileText, Home, FolderOpen, Zap, Settings, HelpCircle, CheckCircle2, XCircle } from 'lucide-react';

export default function DebugRoutes() {
  const navigate = useNavigate();
  const [routes, setRoutes] = useState([]);
  const [currentUrl, setCurrentUrl] = useState('');
  const [testResults, setTestResults] = useState({});

  useEffect(() => {
    // Base44 アプリ内の全ページを手動リスト化
    const appRoutes = [
      { path: 'Home', name: 'Home', component: 'pages/Home.js', icon: Home },
      { path: 'QuickCheck', name: 'QuickCheck', component: 'pages/QuickCheck.js', icon: Zap },
      { path: 'Projects', name: 'Projects', component: 'pages/Projects.js', icon: FolderOpen },
      { path: 'ProjectFiles', name: 'ProjectFiles', component: 'pages/ProjectFiles.js', icon: FileText, params: '?projectId=xxx' },
      { path: 'ProjectTalk', name: 'ProjectTalk', component: 'pages/ProjectTalk.js', icon: FileText, params: '?projectId=xxx' },
      { path: 'ProjectSchedule', name: 'ProjectSchedule', component: 'pages/ProjectSchedule.js', icon: FileText, params: '?projectId=xxx' },
      { path: 'ProjectNotes', name: 'ProjectNotes', component: 'pages/ProjectNotes.js', icon: FileText, params: '?projectId=xxx' },
      { path: 'FileView', name: 'FileView', component: 'pages/FileView.js', icon: FileText, params: '?fileId=xxx', description: 'ファイルビューワー（?fileId=...）' },
      { path: 'ShareView', name: 'ShareView', component: 'pages/ShareView.js', icon: FileText, description: '共有リンク閲覧（/share/:token）' },
      { path: 'AccountSettings', name: 'AccountSettings', component: 'pages/AccountSettings.js', icon: Settings },
      { path: 'DebugRoutes', name: 'DebugRoutes', component: 'pages/DebugRoutes.js', icon: HelpCircle, description: 'このページ' },
    ];

    setRoutes(appRoutes);
    updateCurrentUrl();

    // URL変更を監視
    const interval = setInterval(updateCurrentUrl, 500);
    return () => clearInterval(interval);
  }, []);

  const updateCurrentUrl = () => {
    setCurrentUrl(window.location.href);
  };

  const handleNavigate = (pageName, params = '') => {
    try {
      const url = createPageUrl(pageName);
      const fullUrl = params ? `${url}${params}` : url;
      
      console.log(`Navigating to: ${pageName}${params}`);
      console.log(`Generated URL: ${fullUrl}`);
      
      // navigate で遷移
      navigate(fullUrl);
      
      // 100ms後にテスト結果を記録
      setTimeout(() => {
        const success = window.location.href.includes(pageName);
        setTestResults(prev => ({
          ...prev,
          [pageName]: {
            success,
            generatedUrl: fullUrl,
            actualUrl: window.location.href,
            pathname: window.location.pathname,
            hash: window.location.hash,
            search: window.location.search,
          }
        }));
      }, 100);
    } catch (error) {
      console.error('Navigation error:', error);
      setTestResults(prev => ({
        ...prev,
        [pageName]: {
          success: false,
          error: error.message,
        }
      }));
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-6">
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-2xl">🗺️ アプリルート一覧（デバッグ）</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="bg-gray-100 p-4 rounded mb-4 font-mono text-xs">
            <div className="grid grid-cols-2 gap-2">
              <div><strong>Current URL:</strong></div>
              <div className="break-all">{currentUrl}</div>
              
              <div><strong>window.location.href:</strong></div>
              <div className="break-all">{window.location.href}</div>
              
              <div><strong>window.location.pathname:</strong></div>
              <div>{window.location.pathname}</div>
              
              <div><strong>window.location.hash:</strong></div>
              <div>{window.location.hash || '(none)'}</div>
              
              <div><strong>window.location.search:</strong></div>
              <div>{window.location.search || '(none)'}</div>
            </div>
          </div>

          <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded">
            <h3 className="font-semibold mb-2">📌 createPageUrl() の仕様確認</h3>
            <div className="text-sm space-y-1">
              <div>• createPageUrl('Home') = <code className="bg-white px-2 py-1 rounded">{createPageUrl('Home')}</code></div>
              <div>• createPageUrl('FileView') = <code className="bg-white px-2 py-1 rounded">{createPageUrl('FileView')}</code></div>
              <div>• createPageUrl('QuickCheck') = <code className="bg-white px-2 py-1 rounded">{createPageUrl('QuickCheck')}</code></div>
            </div>
          </div>

          <div className="space-y-2">
            {routes.map((route) => {
              const Icon = route.icon;
              const isCurrent = currentUrl.includes(route.path);
              const testResult = testResults[route.path];
              
              return (
                <Card key={route.path} className={`hover:shadow-md transition-shadow ${isCurrent ? 'border-2 border-blue-500' : ''}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <Icon className="w-5 h-5 text-gray-600 mt-1" />
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold">{route.name}</span>
                          {isCurrent && <Badge variant="secondary">現在のページ</Badge>}
                          {testResult?.success && <CheckCircle2 className="w-4 h-4 text-green-600" />}
                          {testResult?.success === false && <XCircle className="w-4 h-4 text-red-600" />}
                        </div>
                        <div className="text-xs text-gray-500 mb-2">
                          <div>Component: <code className="bg-gray-200 px-1 rounded">{route.component}</code></div>
                          {route.params && <div>Example params: <code className="bg-gray-200 px-1 rounded">{route.params}</code></div>}
                          {route.description && <div className="text-gray-600 mt-1">{route.description}</div>}
                        </div>
                        
                        {testResult && (
                          <div className="mt-2 p-2 bg-gray-50 rounded text-xs font-mono">
                            <div className={testResult.success ? 'text-green-700' : 'text-red-700'}>
                              {testResult.success ? '✓ 遷移成功' : '✗ 遷移失敗'}
                            </div>
                            <div className="mt-1 space-y-1 text-gray-700">
                              <div>Generated: <span className="text-blue-600">{testResult.generatedUrl}</span></div>
                              <div>Actual URL: <span className="text-purple-600 break-all">{testResult.actualUrl}</span></div>
                              <div>pathname: {testResult.pathname}</div>
                              <div>hash: {testResult.hash || '(none)'}</div>
                              <div>search: {testResult.search || '(none)'}</div>
                            </div>
                            {testResult.error && (
                              <div className="mt-1 text-red-600">Error: {testResult.error}</div>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleNavigate(route.path, route.params || '')}
                        >
                          遷移テスト
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <div className="mt-6 p-4 bg-yellow-50 border border-yellow-200 rounded">
            <h3 className="font-semibold mb-2">📝 Base44 ルーティングの仕様</h3>
            <ul className="text-sm space-y-1 text-gray-700">
              <li>• Base44 はフラットなページ構造のみサポート（サブフォルダ不可）</li>
              <li>• pages/*.js → createPageUrl() でルート生成</li>
              <li>• 例: pages/FileView.js → createPageUrl('FileView')</li>
              <li>• パラメータは ? で追加: createPageUrl('FileView') + '?fileId=xxx'</li>
              <li>• <strong>Canonical URL生成は必ず createPageUrl() を使用すること</strong></li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}