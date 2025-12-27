import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from './utils';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import {
  Home,
  Zap,
  FolderOpen,
  MessageSquare,
  Search,
  HelpCircle,
  Bell,
  User,
  Settings,
  LogOut,
  ChevronDown,
  X
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';

export default function Layout({ children, currentPageName }) {
  const [user, setUser] = useState(null);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notificationTab, setNotificationTab] = useState('unread');
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  
  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { data: notifications = [] } = useQuery({
    queryKey: ['notifications', user?.id],
    queryFn: () => base44.entities.UserNotification.filter({ user_id: user?.id }),
    enabled: !!user,
  });

  const { data: projects = [] } = useQuery({
    queryKey: ['projects', user?.id],
    queryFn: () => base44.entities.Project.filter({ owner_user_id: user?.id }),
    enabled: !!user,
  });

  const { data: workspace } = useQuery({
    queryKey: ['workspace'],
    queryFn: async () => {
      const workspaces = await base44.entities.Workspace.list();
      return workspaces[0] || { plan_tier: 'free', project_limit: 5 };
    },
  });

  const handleLogout = async () => {
    await base44.auth.logout();
  };

  const handleClearUnread = async () => {
    const unreadIds = notifications.filter(n => !n.is_read).map(n => n.id);
    for (const id of unreadIds) {
      await base44.entities.UserNotification.update(id, { is_read: true });
    }
  };

  const unreadCount = notifications.filter(n => !n.is_read).length;

  const filteredNotifications = notifications.filter(n => {
    if (notificationTab === 'unread' && n.is_read) return false;
    if (notificationTab === 'news' && n.kind !== 'ops') return false;
    if (notificationTab === 'ops' && n.kind !== 'ops') return false;
    if (categoryFilter !== 'all' && n.kind !== categoryFilter) return false;
    if (searchQuery && !n.title.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 上部ヘッダー */}
      <header className="fixed top-0 left-0 right-0 h-16 bg-white border-b border-gray-200 z-40 flex items-center justify-between px-6">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold text-blue-600">CheckBack</h1>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="検索 (Ctrl+K)"
              className="pl-10 w-80"
              readOnly
            />
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon">
            <HelpCircle className="w-5 h-5 text-gray-600" />
          </Button>
          
          <Button variant="ghost" size="icon" className="relative" onClick={() => setNotificationOpen(true)}>
            <Bell className="w-5 h-5 text-gray-600" />
            {unreadCount > 0 && (
              <Badge className="absolute -top-1 -right-1 h-5 min-w-5 flex items-center justify-center bg-red-500 text-white text-xs px-1">
                {unreadCount}
              </Badge>
            )}
          </Button>
          
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white font-semibold">
                  {user?.full_name?.[0] || 'U'}
                </div>
                <ChevronDown className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem asChild>
                <Link to={createPageUrl('AccountSettings')} className="flex items-center gap-2">
                  <Settings className="w-4 h-4" />
                  アカウント設定
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href="#" className="flex items-center gap-2">
                  <HelpCircle className="w-4 h-4" />
                  サポート
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleLogout} className="flex items-center gap-2 text-red-600">
                <LogOut className="w-4 h-4" />
                ログアウト
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* 左サイドバー */}
      <aside className="fixed left-0 top-16 bottom-0 w-64 bg-white border-r border-gray-200 overflow-y-auto">
        <div className="p-4">
          {workspace && (
            <div className="mb-6 p-3 bg-blue-50 rounded-lg">
              <div className="text-xs text-gray-600 mb-1">プロジェクト作成数</div>
              <div className="text-sm font-semibold mb-2">{projects.length} / {workspace.project_limit}</div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className="bg-blue-600 h-2 rounded-full transition-all"
                  style={{ width: `${(projects.length / workspace.project_limit) * 100}%` }}
                />
              </div>
            </div>
          )}

          <nav className="space-y-1">
            <Link to={createPageUrl('Home')}>
              <Button variant={currentPageName === 'Home' ? 'secondary' : 'ghost'} className="w-full justify-start gap-2">
                <Home className="w-5 h-5" />
                ホーム
              </Button>
            </Link>
            <Link to={createPageUrl('QuickCheck')}>
              <Button variant={currentPageName === 'QuickCheck' ? 'secondary' : 'ghost'} className="w-full justify-start gap-2">
                <Zap className="w-5 h-5" />
                クイックチェック
              </Button>
            </Link>
            <Link to={createPageUrl('Projects')}>
              <Button variant={currentPageName === 'Projects' ? 'secondary' : 'ghost'} className="w-full justify-start gap-2">
                <FolderOpen className="w-5 h-5" />
                プロジェクト
              </Button>
            </Link>
            <Button variant="ghost" className="w-full justify-start gap-2" disabled>
              <MessageSquare className="w-5 h-5" />
              ダイレクトメッセージ
            </Button>
          </nav>
        </div>
      </aside>

      {/* メインコンテンツ */}
      <main className="ml-64 mt-16 p-6">
        {children}
      </main>

      {/* 通知ドロワー */}
      <Sheet open={notificationOpen} onOpenChange={setNotificationOpen}>
        <SheetContent side="right" className="w-96 p-0">
          <SheetHeader className="p-4 border-b">
            <div className="flex items-center justify-between">
              <SheetTitle>通知</SheetTitle>
              <Button variant="ghost" size="icon" onClick={() => setNotificationOpen(false)}>
                <X className="w-4 h-4" />
              </Button>
            </div>
          </SheetHeader>
          
          <Tabs value={notificationTab} onValueChange={setNotificationTab} className="w-full">
            <TabsList className="w-full grid grid-cols-3 rounded-none border-b">
              <TabsTrigger value="unread">未読</TabsTrigger>
              <TabsTrigger value="news">お知らせ</TabsTrigger>
              <TabsTrigger value="ops">運営から</TabsTrigger>
            </TabsList>
            
            <div className="p-4 border-b space-y-2">
              <Input
                placeholder="検索"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <select
                className="w-full border rounded p-2 text-sm"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
              >
                <option value="all">すべてのカテゴリ</option>
                <option value="talk">トーク</option>
                <option value="file">ファイル</option>
                <option value="review">レビュー</option>
                <option value="schedule">スケジュール</option>
                <option value="note">ノート</option>
              </select>
              {notificationTab === 'unread' && unreadCount > 0 && (
                <Button variant="outline" size="sm" className="w-full" onClick={handleClearUnread}>
                  未読をクリアにする
                </Button>
              )}
            </div>
            
            <TabsContent value={notificationTab} className="m-0">
              <div className="divide-y">
                {filteredNotifications.length === 0 ? (
                  <div className="p-8 text-center text-gray-500">
                    通知はありません
                  </div>
                ) : (
                  filteredNotifications.map((notif) => (
                    <div
                      key={notif.id}
                      className={`p-4 hover:bg-gray-50 cursor-pointer ${!notif.is_read ? 'bg-blue-50' : ''}`}
                      onClick={async () => {
                        if (!notif.is_read) {
                          await base44.entities.UserNotification.update(notif.id, { is_read: true });
                        }
                      }}
                    >
                      <div className="flex items-start gap-2">
                        <Badge variant="secondary" className="text-xs">{notif.kind}</Badge>
                        {!notif.is_read && <div className="w-2 h-2 rounded-full bg-blue-600 mt-1" />}
                      </div>
                      <div className="font-medium text-sm mt-1">{notif.title}</div>
                      <div className="text-xs text-gray-600 mt-1">{notif.body_preview}</div>
                    </div>
                  ))
                )}
              </div>
            </TabsContent>
          </Tabs>
        </SheetContent>
      </Sheet>
    </div>
  );
}