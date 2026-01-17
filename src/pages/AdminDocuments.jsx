import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Download, FileText, AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function AdminDocuments() {
  const [downloading, setDownloading] = useState({});

  const { data: user, isLoading } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const documents = [
    { name: 'SPEC.md', path: 'functions/documentation/SPEC.md', description: 'アーキテクチャ仕様・Do-not-break契約' },
    { name: 'BUGS.md', path: 'functions/documentation/BUGS.md', description: 'バグトラッキング・ステータス管理' },
    { name: 'VERIFY.md', path: 'functions/documentation/VERIFY.md', description: '回帰テスト手順・実行記録' },
    { name: 'STATE.md', path: 'functions/documentation/STATE.md', description: '現在の状態・直近の変更・次のステップ' },
  ];

  const handleDownload = async (doc) => {
    setDownloading(prev => ({ ...prev, [doc.name]: true }));
    
    try {
      const response = await fetch(`/${doc.path}`);
      if (!response.ok) throw new Error('ファイルの取得に失敗しました');
      
      const content = await response.text();
      const blob = new Blob([content], { type: 'text/markdown' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.name;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Download error:', error);
      alert(`ダウンロード失敗: ${error.message}`);
    } finally {
      setDownloading(prev => ({ ...prev, [doc.name]: false }));
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-600">読み込み中...</div>
      </div>
    );
  }

  if (!user || user.role !== 'admin') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-600">
              <AlertCircle className="w-5 h-5" />
              アクセス権限がありません
            </CardTitle>
            <CardDescription>
              このページは管理者のみアクセス可能です
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">ドキュメント管理</h1>
          <p className="text-gray-600">プロジェクトドキュメントのダウンロード（管理者専用）</p>
        </div>

        <Alert className="mb-6">
          <AlertCircle className="w-4 h-4" />
          <AlertDescription>
            これらのドキュメントはプロジェクトの重要な情報を含みます。取り扱いには注意してください。
          </AlertDescription>
        </Alert>

        <div className="grid gap-4">
          {documents.map((doc) => (
            <Card key={doc.name}>
              <CardContent className="pt-6">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-4">
                    <div className="p-3 bg-blue-50 rounded-lg">
                      <FileText className="w-6 h-6 text-blue-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-lg mb-1">{doc.name}</h3>
                      <p className="text-sm text-gray-600 mb-2">{doc.description}</p>
                      <p className="text-xs text-gray-400 font-mono">{doc.path}</p>
                    </div>
                  </div>
                  <Button
                    onClick={() => handleDownload(doc)}
                    disabled={downloading[doc.name]}
                    className="flex items-center gap-2"
                  >
                    <Download className="w-4 h-4" />
                    {downloading[doc.name] ? 'ダウンロード中...' : 'ダウンロード'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-base">使用方法</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="text-sm text-gray-600 space-y-2">
              <li>• 各ドキュメントの「ダウンロード」ボタンをクリックすると、Markdownファイルがダウンロードされます</li>
              <li>• ダウンロードしたファイルはテキストエディタやMarkdownビューアで開けます</li>
              <li>• これらのドキュメントは開発プロセスの重要な記録です</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}