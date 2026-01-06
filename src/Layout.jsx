import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from './utils';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { isPublicRoute, isPublicPage } from './pages/_public';
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

// ==================== BOOT SCREEN (固定DOM) ====================
// document.body直下に固定で残す（Reactの再レンダーで消えない）
let bootElement = document.getElementById('__boot');
if (!bootElement) {
  bootElement = document.createElement('div');
  bootElement.id = '__boot';
  bootElement.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#111;color:#0f0;font:12px/1.4 monospace;padding:8px;white-space:pre-wrap;max-height:40vh;overflow:auto;';
  
  // DOM準備後に確実に追加
  const appendBoot = () => {
    if (!document.body.contains(bootElement)) {
      document.body.appendChild(bootElement);
    }
  };
  
  if (document.body) {
    appendBoot();
  } else {
    document.addEventListener('DOMContentLoaded', appendBoot);
  }
}

// ログ関数（既存のbootElementを再利用）
function bootLog(msg) {
  const boot = document.getElementById('__boot');
  if (boot) {
    boot.textContent += msg + '\n';
    boot.scrollTop = boot.scrollHeight;
  }
  console.log('[BOOT]', msg);
}

// 初期化ログ（毎回リセットせず追記）
bootLog('');
bootLog('========== BOOT: ' + new Date().toISOString() + ' ==========');
bootLog('href=' + window.location.href);
bootLog('pathname=' + window.location.pathname);
bootLog('search=' + window.location.search);

// 無限遷移検知（nav_cntをインクリメント）
let navCnt = Number(sessionStorage.getItem('__nav_cnt') || '0');
navCnt += 1;
sessionStorage.setItem('__nav_cnt', String(navCnt));
bootLog('nav_cnt=' + navCnt + (navCnt >= 10 ? ' ⚠️ LOOP DETECTED' : ''));

// グローバルエラーハンドラ（重複登録を防ぐ）
if (!window.__bootErrorHandlersSet) {
  window.__bootErrorHandlersSet = true;
  
  window.addEventListener('error', (e) => {
    bootLog('ERROR: ' + (e?.error?.message || e.message || 'unknown'));
    if (e?.error?.stack) bootLog(String(e.error.stack).substring(0, 800));
  });

  window.addEventListener('unhandledrejection', (e) => {
    bootLog('REJECTION: ' + (e?.reason?.message || e.reason || 'unknown'));
    if (e?.reason?.stack) bootLog(String(e.reason.stack).substring(0, 800));
  });
  
  bootLog('BOOT: error handlers registered');
}
// ==================== END BOOT SCREEN ====================

// リダイレクトコンポーネント（Base44 SDK のログインにリダイレクト）
function RedirectToLogin({ currentPath }) {
  bootLog('RedirectToLogin: rendering for ' + currentPath);
  const [redirecting, setRedirecting] = useState(false);
  
  useEffect(() => {
    // 無限遷移検知: nav_cnt >= 10 なら停止
    const navCnt = Number(sessionStorage.getItem('__nav_cnt') || '0');
    if (navCnt >= 10) {
      bootLog('RedirectToLogin: STOPPED due to nav_cnt >= 10');
      return;
    }

    // 同一セッションで既にリダイレクト中なら停止
    if (sessionStorage.getItem('__redirecting') === '1') {
      bootLog('RedirectToLogin: STOPPED - already redirecting');
      return;
    }

    if (redirecting) return;
    
    setRedirecting(true);
    sessionStorage.setItem('__redirecting', '1');

    // Base44 SDK のログインを使用（from_url に現在のURLを渡す）
    const nextUrl = window.location.href;
    bootLog('RedirectToLogin: calling base44.auth.redirectToLogin(' + nextUrl + ')');
    
    try {
      base44.auth.redirectToLogin(nextUrl);
    } catch (error) {
      bootLog('RedirectToLogin ERROR: ' + error.message);
      sessionStorage.removeItem('__redirecting');
    }
  }, [currentPath, redirecting]);

  return (
    <div className="min-h-screen bg-blue-50 flex items-center justify-center">
      <div className="bg-white rounded-lg shadow-lg p-8 max-w-md">
        <h2 className="text-xl font-bold mb-4">認証が必要です</h2>
        <p className="text-sm text-gray-600 mb-2">Path: {currentPath}</p>
        <div className="mt-4">Base44 ログインページにリダイレクトしています...</div>
        <div className="mt-4 text-xs text-gray-500">
          リダイレクトされない場合は、
          <button
            onClick={() => {
              sessionStorage.removeItem('__redirecting');
              base44.auth.redirectToLogin(window.location.href);
            }}
            className="text-blue-600 underline ml-1"
          >
            こちらをクリック
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Layout({ children, currentPageName }) {
  bootLog('Layout: component rendering, page=' + currentPageName);
  
  const contentPaddingTop = 'calc(40vh + 40px)';
  
  // CRITICAL: 公開ページ判定（認証チェック完全スキップ）
  const currentPath = window.location.pathname;
  const isPublic = isPublicRoute(currentPath) || isPublicPage(currentPageName);
  
  bootLog('Layout: path=' + currentPath + ', page=' + currentPageName + ', isPublic=' + isPublic);
  
  // 公開ページは即座にchildrenを返す（認証チェック不要）
  if (isPublic) {
    bootLog('Layout: PUBLIC PAGE - skipping all checks, rendering children directly');
    return (
      <>
        <div className="fixed left-0 right-0 bg-green-600 text-white text-xs font-mono p-2 overflow-auto" style={{ top: 0, zIndex: 9999 }}>
          ✓ PUBLIC PAGE: {currentPageName} | path: {currentPath} | NO AUTH REQUIRED
        </div>
        <div style={{ paddingTop: '32px' }}>
          {children}
        </div>
      </>
    );
  }
  
  // 無限ループ検知: nav_cnt >= 10 なら即座に停止画面を表示
  const currentNavCnt = Number(sessionStorage.getItem('__nav_cnt') || '0');
  if (currentNavCnt >= 10) {
    bootLog('Layout: STOPPING - nav_cnt >= 10');
    return (
      <div className="min-h-screen bg-red-50 flex items-center justify-center" style={{ paddingTop: contentPaddingTop }}>
        <div className="bg-white rounded-lg shadow-lg p-8 max-w-2xl">
          <h1 className="text-3xl font-bold text-red-600 mb-4">🚫 Redirect Loop Detected</h1>
          <p className="text-lg mb-4">
            ページ遷移が10回以上発生したため、無限ループを検知して停止しました。
          </p>
          <div className="bg-gray-100 p-4 rounded font-mono text-sm mb-4">
            <div><strong>Current Path:</strong> {window.location.pathname}</div>
            <div><strong>Search:</strong> {window.location.search || '(none)'}</div>
            <div><strong>Nav Count:</strong> {currentNavCnt}</div>
            <div><strong>Redir Count:</strong> {sessionStorage.getItem('redir_cnt') || '0'}</div>
          </div>
          <button
            onClick={() => {
              sessionStorage.clear();
              window.location.href = '/';
            }}
            className="px-6 py-3 bg-blue-600 text-white rounded hover:bg-blue-700 font-semibold"
          >
            セッションをクリアしてトップに戻る
          </button>
        </div>
      </div>
    );
  }
  
  const [user, setUser] = useState(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notificationTab, setNotificationTab] = useState('unread');
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [globalError, setGlobalError] = useState(null);
  
  bootLog('Layout: PRIVATE PAGE - starting auth check');

  // グローバルエラーハンドラ
  useEffect(() => {
    const handleError = (event) => {
      setGlobalError({
        message: event.message || event.reason?.message || String(event.reason),
        stack: event.error?.stack || event.reason?.stack || ''
      });
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleError);

    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleError);
    };
  }, []);

  // ALL HOOKS MUST BE CALLED BEFORE ANY CONDITIONAL RETURNS
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
    enabled: true,
  });

  useEffect(() => {
    bootLog('Layout: useEffect running (auth check for PRIVATE page)');
    
    base44.auth.me()
      .then(u => {
        bootLog('Layout: auth.me() SUCCESS, user=' + (u?.email || u?.id || 'unknown'));
        setUser(u);
        setIsCheckingAuth(false);
        // ログイン成功: カウンタをクリア
        sessionStorage.removeItem('redir_cnt');
        sessionStorage.removeItem('last_redirect_to');
        sessionStorage.removeItem('__nav_cnt');
        sessionStorage.removeItem('__redirecting');
      })
      .catch((err) => {
        bootLog('Layout: auth.me() FAILED: ' + (err?.message || String(err)));
        setUser(null);
        setIsCheckingAuth(false);
      });
  }, []);

  // React mount完了を通知
  useEffect(() => {
    bootLog('Layout: REACT MOUNTED');
  }, []);

  // デバッグバー（ブート画面の下に表示）
  const DebugBar = () => {
    return (
      <div className="fixed left-0 right-0 bg-black text-white text-xs font-mono p-2 overflow-auto" style={{ top: '40vh', zIndex: 9998 }}>
        <div className="flex flex-wrap gap-4">
          <span><strong>pathname:</strong> {window.location.pathname}</span>
          <span><strong>search:</strong> {window.location.search || '(none)'}</span>
          <span><strong>authed:</strong> {user ? 'true' : 'false'}</span>
          <span><strong>checking:</strong> {isCheckingAuth.toString()}</span>
          <span><strong>public:</strong> {isPublicRoute.toString()}</span>
          <span><strong>nav_cnt:</strong> {sessionStorage.getItem('__nav_cnt') || '0'}</span>
        </div>
      </div>
    );
  };



  // 認証チェック中
  if (isCheckingAuth) {
    bootLog('Layout: returning CHECKING auth screen');
    return (
      <>
        <DebugBar />
        <div className="min-h-screen bg-blue-50 flex items-center justify-center" style={{ paddingTop: '340px' }}>
          <div className="bg-white rounded-lg shadow-lg p-8 max-w-md">
            <h2 className="text-xl font-bold mb-4">AuthGuard: checking...</h2>
            <div className="mt-4">認証状態を確認中...</div>
          </div>
        </div>
      </>
    );
  }

  // 未認証ならリダイレクト
  if (!user) {
    bootLog('Layout: returning REDIRECT to login');
    return (
      <>
        <DebugBar />
        <div style={{ paddingTop: '340px' }}>
          <RedirectToLogin currentPath={currentPath} />
        </div>
      </>
    );
  }

  // グローバルエラー表示
  if (globalError) {
    return (
      <>
        <DebugBar />
        <div className="min-h-screen bg-red-50 p-8" style={{ paddingTop: '60px' }}>
          <div className="max-w-4xl mx-auto bg-white rounded-lg shadow-lg p-6">
            <h2 className="text-2xl font-bold text-red-600 mb-4">⚠️ Global Error Caught</h2>
            <div className="bg-red-100 p-4 rounded mb-4">
              <strong>Message:</strong> {globalError.message}
            </div>
            {globalError.stack && (
              <pre className="bg-gray-100 p-4 rounded overflow-auto text-xs">
                {globalError.stack}
              </pre>
            )}
            <button
              onClick={() => {
                setGlobalError(null);
                window.location.reload();
              }}
              className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              ページをリロード
            </button>
          </div>
        </div>
      </>
    );
  }

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
    <>
      <DebugBar />
      <div className="min-h-screen bg-gray-50" style={{ paddingTop: '40px' }}>
        {/* 上部ヘッダー */}
        <header className="fixed top-0 left-0 right-0 h-16 bg-white border-b border-gray-200 z-40 flex items-center justify-between px-6" style={{ top: '40px' }}>
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
      <aside className="fixed left-0 bottom-0 w-64 bg-white border-r border-gray-200 overflow-y-auto" style={{ top: `calc(${contentPaddingTop} + 4rem)` }}>
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
        <main className="ml-64 p-6" style={{ marginTop: `calc(${contentPaddingTop} + 4rem)` }}>
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
      </>
      );
      }