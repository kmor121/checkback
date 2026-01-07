import React, { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { 
  Download, 
  ZoomIn, 
  ZoomOut, 
  ChevronLeft, 
  ChevronRight,
  MessageSquare,
  Send,
  Paintbrush,
  User
} from 'lucide-react';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import ViewerCanvas from '../components/viewer/ViewerCanvas';
import FloatingToolbar from '../components/viewer/FloatingToolbar';
import ErrorBoundary from '../components/ErrorBoundary';
import DebugOverlay from '../components/DebugOverlay';

// CRITICAL: ShareViewは認証不要の公開ページ
// Base44の仕様上、アプリ全体をPublicにするか、このページを完全に独立させる必要がある
// このコンポーネントは認証API(base44.auth.me等)を一切呼ばない

const DEBUG_MODE = import.meta.env.VITE_DEBUG === 'true';

function ShareViewContent() {
  const [guestName, setGuestName] = useState('');
  const [guestId, setGuestId] = useState('');
  const [showNameDialog, setShowNameDialog] = useState(false);
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [isPasswordVerified, setIsPasswordVerified] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(100);
  const [commentFilter, setCommentFilter] = useState('all');
  const [commentSort, setCommentSort] = useState('page');
  const [commentBody, setCommentBody] = useState('');
  const [paintMode, setPaintMode] = useState(false);
  const [tool, setTool] = useState('pen');
  const [strokeColor, setStrokeColor] = useState('#ff0000');
  const [strokeWidth, setStrokeWidth] = useState(2);
  const [shapes, setShapes] = useState([]);
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });
  const [showBoundingBoxes, setShowBoundingBoxes] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [activeCommentId, setActiveCommentId] = useState(null);
  const [isCreatingComment, setIsCreatingComment] = useState(false);
  const [showAllPaint, setShowAllPaint] = useState(false);
  const viewerCanvasRef = useRef(null);
  const queryClient = useQueryClient();

  const showToast = (message, type = 'success') => {
    setToast({ show: true, message, type });
    setTimeout(() => setToast({ show: false, message: '', type: 'success' }), type === 'info' ? 5000 : 3000);
  };
  
  // token取得：URLパラメータから
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');

  useEffect(() => {
    if (!token) return;
    
    // guestId生成または復元
    let storedGuestId = localStorage.getItem(`guestId_${token}`);
    if (!storedGuestId) {
      storedGuestId = `guest_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      localStorage.setItem(`guestId_${token}`, storedGuestId);
    }
    setGuestId(storedGuestId);
    
    const storedName = localStorage.getItem(`guestName_${token}`);
    if (storedName) {
      setGuestName(storedName);
    } else {
      setShowNameDialog(true);
    }

    // パスワード検証済みフラグを確認
    const isVerified = sessionStorage.getItem(`passwordVerified_${token}`) === '1';
    setIsPasswordVerified(isVerified);
  }, [token]);

  // showAllPaint の復元と保存
  useEffect(() => {
    if (!token || !shareLink?.file_id) return;
    const key = `showAllPaint:${token}:${shareLink.file_id}:${currentPage}`;
    const saved = localStorage.getItem(key);
    if (saved !== null) {
      setShowAllPaint(saved === 'true');
    }
  }, [token, shareLink?.file_id, currentPage]);

  useEffect(() => {
    if (!token || !shareLink?.file_id) return;
    const key = `showAllPaint:${token}:${shareLink.file_id}:${currentPage}`;
    localStorage.setItem(key, String(showAllPaint));
  }, [showAllPaint, token, shareLink?.file_id, currentPage]);

  const { data: shareLink, isLoading: linkLoading } = useQuery({
    queryKey: ['shareLink', token],
    queryFn: async () => {
      const links = await base44.entities.ShareLink.filter({ token });
      return links[0];
    },
    enabled: !!token,
    staleTime: 60000,
  });

  // Ready状態の詳細判定（tokenとshareLinkの取得後）
  const readyDetails = {
    tokenOk: !!token,
    shareLinkOk: !!shareLink,
    fileOk: !!shareLink?.file_id,
    pageOk: currentPage >= 0,
    passOk: !shareLink?.password_enabled || isPasswordVerified,
  };

  // ShareLinkのパスワード検証と有効期限チェック
  useEffect(() => {
    if (!shareLink) {
      setIsReady(false);
      return;
    }
    
    // 有効性チェック
    if (!shareLink.is_active) {
      setIsReady(false);
      return;
    }
    
    if (shareLink.expires_at && new Date(shareLink.expires_at) < new Date()) {
      setIsReady(false);
      return;
    }
    
    // パスワード保護チェック
    if (shareLink.password_enabled && !isPasswordVerified) {
      setShowPasswordDialog(true);
      setIsReady(false);
      return;
    }
    
    // 全て問題なければready
    setIsReady(true);
  }, [shareLink, isPasswordVerified]);

  const { data: file } = useQuery({
    queryKey: ['sharedFile', shareLink?.file_id],
    queryFn: async () => {
      const files = await base44.entities.FileAsset.filter({ id: shareLink.file_id });
      return files[0];
    },
    enabled: isReady && !!shareLink?.file_id,
    staleTime: 60000,
  });

  const { data: comments = [] } = useQuery({
    queryKey: ['sharedComments', shareLink?.file_id],
    queryFn: () => base44.entities.ReviewComment.filter({ file_id: shareLink.file_id }),
    enabled: isReady && !!shareLink?.file_id && shareLink?.can_view_comments,
    staleTime: 30000,
  });

  const { data: paintShapes = [], isFetching: shapesFetching } = useQuery({
    queryKey: ['paintShapes', token, shareLink?.file_id, currentPage],
    queryFn: async () => {
      console.log('[ShareView] Fetching shapes:', { 
        token: token?.substring(0, 10), 
        fileId: shareLink.file_id, 
        pageNo: currentPage 
      });
      const shapes = await base44.entities.PaintShape.filter({ 
        file_id: shareLink.file_id,
        page_no: currentPage
      });
      console.log('[ShareView] Fetched shapes count:', shapes.length);
      return shapes;
    },
    enabled: isReady && !!shareLink?.file_id && !!token,
    refetchOnWindowFocus: false,
    staleTime: 60000,
    // 空配列での全消しを防ぐ
    placeholderData: (previousData) => previousData,
  });



  const handleSaveShape = async (shape, mode) => {
    if (!isReady) {
      console.warn('Not ready yet, save aborted');
      return;
    }
    
    // CRITICAL: comment_idが無い場合は保存しない
    if (!activeCommentId) {
      showToast('先にコメントを作成してください', 'error');
      setPaintMode(false);
      return;
    }
    
    try {
      const shapeData = {
        file_id: shareLink.file_id,
        share_token: token,
        comment_id: activeCommentId,
        page_no: currentPage,
        client_shape_id: shape.id,
        shape_type: shape.tool,
        data_json: JSON.stringify(shape),
        author_key: guestId,
        author_name: guestName || 'Guest',
      };
      
      if (DEBUG_MODE) {
        console.log('[DEBUG] Saving shape with payload:', shapeData);
      }
      
      let result;
      if (mode === 'create') {
        result = await base44.entities.PaintShape.create(shapeData);
      } else if (mode === 'update') {
        // 既存のshapeを更新（shape.dbIdがある場合）
        if (shape.dbId) {
          result = await base44.entities.PaintShape.update(shape.dbId, shapeData);
        } else {
          result = await base44.entities.PaintShape.create(shapeData);
        }
      } else {
        result = await base44.entities.PaintShape.create(shapeData);
      }

      await queryClient.invalidateQueries(['paintShapes', token, shareLink?.file_id, currentPage]);

      if (mode === 'update') {
        showToast('更新完了', 'success');
      } else {
        showToast('保存完了', 'success');
      }

      return { ...result, dbId: result.id };
    } catch (error) {
      console.error('Save shape error:', error);
      const errorMsg = error.response?.data?.error || error.message || String(error);
      showToast(`保存失敗: ${errorMsg}`, 'error');
      throw new Error(errorMsg);
    }
  };

  const handleDeleteShape = async (shape) => {
    if (!isReady) {
      console.warn('Not ready yet, delete aborted');
      return;
    }
    
    try {
      // dbIdがある場合はそれで削除、無い場合はclient_shape_idで検索して削除
      if (shape.dbId) {
        await base44.entities.PaintShape.delete(shape.dbId);
      } else if (shape.id) {
        const existing = await base44.entities.PaintShape.filter({
          client_shape_id: shape.id,
          file_id: shareLink.file_id,
        });
        if (existing.length > 0) {
          await base44.entities.PaintShape.delete(existing[0].id);
        }
      }

      await queryClient.invalidateQueries(['paintShapes', token, shareLink?.file_id, currentPage]);
      showToast('削除完了', 'success');
    } catch (error) {
      console.error('Delete shape error:', error);
      const errorMsg = error.response?.data?.error || error.message || String(error);
      showToast(`削除失敗: ${errorMsg}`, 'error');
      throw new Error(errorMsg);
    }
  };

  const handleClearAll = async () => {
    if (!isReady || !activeCommentId) return;
    
    if (!window.confirm('このコメントの自分の描画を全て削除しますか？')) {
      return;
    }
    
    try {
      // activeCommentIdに紐づく自分のshapesを全削除
      const shapes = await base44.entities.PaintShape.filter({
        file_id: shareLink.file_id,
        comment_id: activeCommentId,
        author_key: guestId,
      });
      
      for (const shape of shapes) {
        await base44.entities.PaintShape.delete(shape.id);
      }

      await queryClient.invalidateQueries(['paintShapes', token, shareLink?.file_id, currentPage]);
      showToast('全削除完了', 'success');
    } catch (error) {
      console.error('Clear all error:', error);
      const errorMsg = error.response?.data?.error || error.message || String(error);
      showToast(`全削除失敗: ${errorMsg}`, 'error');
    }
  };

  const createCommentMutation = useMutation({
    mutationFn: async (data) => {
      const existingComments = await base44.entities.ReviewComment.filter({ file_id: shareLink.file_id });
      const maxSeqNo = existingComments.reduce((max, c) => Math.max(max, c.seq_no || 0), 0);
      
      const comment = await base44.entities.ReviewComment.create({
        file_id: shareLink.file_id,
        share_token: token,
        page_no: currentPage,
        seq_no: maxSeqNo + 1,
        anchor_nx: data.anchor_nx,
        anchor_ny: data.anchor_ny,
        author_type: 'guest',
        author_key: guestId,
        author_name: guestName,
        body: data.body || '',
        resolved: false,
        has_paint: false,
      });

      return comment;
    },
    onSuccess: (comment) => {
      queryClient.invalidateQueries(['sharedComments']);
      setCommentBody('');
      setActiveCommentId(comment.id);
      setIsCreatingComment(false);
      showToast('コメントを作成しました', 'success');
    },
    onError: (error) => {
      showToast(`送信失敗: ${error.message}`, 'error');
      setIsCreatingComment(false);
    },
  });

  const handleSendComment = () => {
    if (!guestName.trim()) {
      setShowNameDialog(true);
      return;
    }
    if (!commentBody.trim()) return;
    
    if (activeCommentId) {
      // 既存コメントを更新
      base44.entities.ReviewComment.update(activeCommentId, { body: commentBody })
        .then(() => {
          queryClient.invalidateQueries(['sharedComments']);
          setCommentBody('');
          showToast('コメントを更新しました', 'success');
        })
        .catch((error) => {
          showToast(`更新失敗: ${error.message}`, 'error');
        });
    } else {
      showToast('先にピンを配置してください', 'error');
    }
  };

  // 「＋コメント」ボタンで新規コメント作成モード開始
  const handleStartCreateComment = () => {
    if (!guestName.trim()) {
      setShowNameDialog(true);
      return;
    }
    setIsCreatingComment(true);
    showToast('画像上をクリックしてピンを配置してください', 'info');
  };

  // キャンバスクリックでアンカー設定＆コメント作成
  const handleCanvasClick = (anchorX, anchorY, bgWidth, bgHeight) => {
    if (!isCreatingComment) return;
    
    const anchor_nx = anchorX / bgWidth;
    const anchor_ny = anchorY / bgHeight;
    
    createCommentMutation.mutate({
      anchor_nx,
      anchor_ny,
      body: '',
    });
  };

  // PaintShapeをViewerCanvas用の形式に変換
  const existingShapes = React.useMemo(() => {
    // ready状態でないなら空配列
    if (!isReady || !paintShapes) {
      return [];
    }
    
    // showAllPaint=true: 全shapes表示
    // showAllPaint=false: activeCommentIdのshapesのみ表示
    const filtered = showAllPaint 
      ? paintShapes 
      : paintShapes.filter(ps => ps.comment_id === activeCommentId);
    
    return filtered
      .map(ps => {
        try {
          const data = JSON.parse(ps.data_json);
          return {
            id: ps.client_shape_id || ps.id,
            dbId: ps.id,
            tool: ps.shape_type,
            ...data,
          };
        } catch (e) {
          console.error('Failed to parse shape:', e);
          return null;
        }
      })
      .filter(Boolean);
  }, [paintShapes, isReady, activeCommentId, showAllPaint]);

  const handleSaveName = () => {
    if (!guestName.trim()) return;
    localStorage.setItem(`guestName_${token}`, guestName);
    setShowNameDialog(false);
  };

  const handlePasswordSubmit = async () => {
    if (!password.trim()) {
      setPasswordError('パスワードを入力してください');
      return;
    }

    try {
      // パスワードハッシュと比較（実装は簡易版：実際は backend function で検証）
      // ここでは password_hash が存在すれば単純比較
      if (shareLink.password_hash === password) {
        sessionStorage.setItem(`passwordVerified_${token}`, '1');
        setIsPasswordVerified(true);
        setShowPasswordDialog(false);
        setPassword('');
        setPasswordError('');
      } else {
        setPasswordError('パスワードが正しくありません');
      }
    } catch (error) {
      setPasswordError('エラーが発生しました');
    }
  };



  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Card className="max-w-md">
          <CardContent className="p-8 text-center">
            <h2 className="text-xl font-bold text-red-600 mb-2">⚠️ トークンが不正です</h2>
            <p className="text-gray-600">共有リンクのURLが正しくありません。</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (linkLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4"></div>
          <div className="text-lg font-medium mb-2">読み込み中...</div>
        </div>
      </div>
    );
  }

  if (!shareLink) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Card className="max-w-md">
          <CardContent className="p-8 text-center">
            <h2 className="text-xl font-bold text-red-600 mb-2">🔗 リンクが見つかりません</h2>
            <p className="text-gray-600 mb-4">共有リンクが無効または削除されています。</p>
            <p className="text-sm text-gray-500">リンクの発行者にご確認ください。</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!shareLink.is_active) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Card className="max-w-md">
          <CardContent className="p-8 text-center">
            <h2 className="text-xl font-bold text-orange-600 mb-2">🚫 リンクが無効です</h2>
            <p className="text-gray-600 mb-4">このリンクは無効化されています。</p>
            <p className="text-sm text-gray-500">リンクの発行者にご確認ください。</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (shareLink.expires_at && new Date(shareLink.expires_at) < new Date()) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Card className="max-w-md">
          <CardContent className="p-8 text-center">
            <h2 className="text-xl font-bold text-red-600 mb-2">⏰ リンクの有効期限が切れています</h2>
            <p className="text-gray-600 mb-4">このリンクは期限切れです。</p>
            <p className="text-sm text-gray-500">
              有効期限: {format(new Date(shareLink.expires_at), 'yyyy/MM/dd HH:mm', { locale: ja })}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // パスワード検証前
  if (shareLink.password_enabled && !isPasswordVerified) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        {DEBUG_MODE && (
          <div className="fixed top-0 left-0 right-0 bg-yellow-100 border-b-2 border-yellow-600 p-2 text-xs font-mono z-50">
            <div><strong>[ShareView Debug]</strong></div>
            <div>ready: {isReady.toString()} | token: {token ? 'present' : 'missing'} | shareLink: {shareLink ? 'loaded' : 'null'} | passwordVerified: {isPasswordVerified.toString()}</div>
          </div>
        )}
        <Card className="max-w-md">
          <CardContent className="p-8">
            <h2 className="text-xl font-bold mb-4 text-center">🔒 パスワードが必要です</h2>
            <p className="text-sm text-gray-600 mb-4 text-center">
              このファイルは パスワードで保護されています。
            </p>
            <div className="space-y-4">
              <Input
                type="password"
                placeholder="パスワードを入力"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setPasswordError('');
                }}
                onKeyDown={(e) => e.key === 'Enter' && handlePasswordSubmit()}
              />
              {passwordError && (
                <div className="text-sm text-red-600">{passwordError}</div>
              )}
              <Button
                onClick={handlePasswordSubmit}
                className="w-full bg-blue-600 hover:bg-blue-700"
              >
                確認
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const filteredComments = comments.filter(c => {
    if (commentFilter === 'resolved' && !c.resolved) return false;
    if (commentFilter === 'unresolved' && c.resolved) return false;
    return true;
  });

  const sortedComments = [...filteredComments].sort((a, b) => {
    if (commentSort === 'page') return a.page_no - b.page_no || a.seq_no - b.seq_no;
    if (commentSort === 'oldest') return new Date(a.created_date) - new Date(b.created_date);
    if (commentSort === 'newest') return new Date(b.created_date) - new Date(a.created_date);
    return 0;
  });

  return (
    <div className="max-w-full mx-auto h-screen flex flex-col">
      <div className="border-b bg-white px-6 py-3 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">{file?.title || 'ファイル'}</h1>
          <div className="flex items-center gap-2 mt-1">
            <User className="w-4 h-4 text-gray-500" />
            <span className="text-sm text-gray-600">{guestName || 'ゲスト'}</span>
            <Button variant="link" size="sm" onClick={() => setShowNameDialog(true)} className="h-auto p-0 text-xs">
              変更
            </Button>
          </div>
        </div>
        <div className="flex gap-2">
          {shareLink.allow_download && file?.file_url && (
            <Button 
              variant="outline"
              onClick={() => {
                const link = document.createElement('a');
                link.href = file.file_url;
                link.download = file.original_filename || file.title || 'download';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
              }}
            >
              <Download className="w-4 h-4 mr-2" />
              ダウンロード
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* 左：サムネ（簡易版） */}
        <div className="w-48 border-r bg-gray-50 overflow-y-auto p-4">
          <div className="space-y-2">
            <div className="border-2 border-blue-600 rounded p-2 text-center text-sm bg-blue-50">
              1
            </div>
          </div>
        </div>

        {/* 中央：プレビュー */}
        <div className="flex-1 bg-gray-100 overflow-auto relative pb-24">
          {!isReady ? (
            <div className="w-full h-full flex items-center justify-center">
              <div className="text-center">
                <div className="animate-spin w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4"></div>
                <div className="text-lg font-medium">準備中...</div>
              </div>
            </div>
          ) : (
            <ViewerCanvas
              ref={viewerCanvasRef}
              fileUrl={file?.file_url}
              mimeType={file?.mime_type}
              pageNumber={currentPage}
              existingShapes={existingShapes}
              comments={comments}
              activeCommentId={activeCommentId}
              onCommentClick={setActiveCommentId}
              onSaveShape={handleSaveShape}
              onDeleteShape={handleDeleteShape}
              paintMode={isReady && paintMode && !!activeCommentId}
              tool={tool}
              onToolChange={setTool}
              strokeColor={strokeColor}
              strokeWidth={strokeWidth}
              zoom={zoom}
              showBoundingBoxes={showBoundingBoxes}
              showAllPaint={showAllPaint}
              isCreatingComment={isCreatingComment}
              onCanvasClick={handleCanvasClick}
              debugInfo={{
                isReady: isReady,
                readyDetails: readyDetails,
                activeCommentId: activeCommentId,
                queryKey: ['paintShapes', token, shareLink?.file_id, currentPage],
                fetchedCount: paintShapes?.length || 0,
                filteredCount: existingShapes?.length || 0,
                showAllPaint: showAllPaint,
                token: token,
                fileId: shareLink?.file_id,
                pageNo: currentPage,
                guestId: guestId,
              }}
            />
          )}

          {/* ズーム制御 */}
          <div className="absolute top-4 right-4 bg-white rounded-lg shadow-lg p-2 flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => setZoom(Math.max(50, zoom - 25))}>
              <ZoomOut className="w-4 h-4" />
            </Button>
            <span className="text-sm font-medium w-16 text-center">{zoom}%</span>
            <Button variant="outline" size="icon" onClick={() => setZoom(Math.min(200, zoom + 25))}>
              <ZoomIn className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* 右：コメント */}
        {shareLink.can_view_comments && (
          <div className="w-96 border-l bg-white flex flex-col">
            <div className="p-4 border-b space-y-2">
              <Button
                onClick={handleStartCreateComment}
                className="w-full bg-blue-600 hover:bg-blue-700"
                disabled={isCreatingComment}
              >
                <MessageSquare className="w-4 h-4 mr-2" />
                {isCreatingComment ? 'クリックしてピン配置' : '＋コメント'}
              </Button>
              <Select value={commentFilter} onValueChange={setCommentFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全て</SelectItem>
                  <SelectItem value="unresolved">未対応</SelectItem>
                  <SelectItem value="resolved">対応済</SelectItem>
                </SelectContent>
              </Select>
              <Select value={commentSort} onValueChange={setCommentSort}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="page">ページ順</SelectItem>
                  <SelectItem value="oldest">古い順</SelectItem>
                  <SelectItem value="newest">新しい順</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {sortedComments.length === 0 ? (
                <div className="text-center text-gray-500 py-8">
                  コメントはありません
                </div>
              ) : (
                sortedComments.map((comment) => {
                  const shapesCount = paintShapes.filter(s => s.comment_id === comment.id).length;
                  const isActive = activeCommentId === comment.id;
                  
                  return (
                    <Card 
                      key={comment.id} 
                      className={`hover:shadow-md transition-shadow cursor-pointer ${isActive ? 'border-2 border-blue-600 bg-blue-50' : ''}`}
                      onClick={() => setActiveCommentId(isActive ? null : comment.id)}
                    >
                      <CardContent className="p-3">
                        <div className="flex items-start gap-2 mb-2">
                          <Badge variant="secondary" className="text-xs">#{comment.seq_no}</Badge>
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-sm font-medium">{comment.author_name}</span>
                              {comment.author_type === 'guest' && (
                                <Badge variant="outline" className="text-xs">ゲスト</Badge>
                              )}
                              {shapesCount > 0 && (
                                <Badge variant="outline" className="text-xs flex items-center gap-1">
                                  <Paintbrush className="w-3 h-3" />
                                  {shapesCount}
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm text-gray-700">{comment.body || '（本文なし）'}</p>
                            <div className="flex items-center gap-2 mt-2 text-xs text-gray-500">
                              <span>{comment.page_no}枚目</span>
                              <span>•</span>
                              <span>{format(new Date(comment.created_date), 'yyyy/MM/dd HH:mm', { locale: ja })}</span>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })
              
              )}
            </div>

            {/* 入力ドック */}
            {shareLink.can_post_comments ? (
              <div className="border-t p-4 space-y-2">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">コメント追加</span>
                </div>
                <Textarea
                  placeholder="コメントを入力"
                  value={commentBody}
                  onChange={(e) => setCommentBody(e.target.value)}
                  rows={3}
                />
                <Button
                  onClick={handleSendComment}
                  disabled={!commentBody.trim()}
                  className="w-full bg-blue-600 hover:bg-blue-700"
                >
                  <Send className="w-4 h-4 mr-2" />
                  送信
                </Button>
              </div>
            ) : (
              <div className="border-t p-4 text-center text-sm text-gray-500">
                コメント機能は無効です
              </div>
            )}
          </div>
        )}
      </div>

      {/* フローティングツールバー */}
      {shareLink.can_post_comments && isReady && (
        <FloatingToolbar
          paintMode={paintMode}
          onPaintModeChange={(mode) => {
            if (mode && !activeCommentId) {
              showToast('先にコメントを選択/作成してください', 'error');
              return;
            }
            setPaintMode(mode);
          }}
          tool={tool}
          onToolChange={setTool}
          strokeColor={strokeColor}
          onStrokeColorChange={setStrokeColor}
          strokeWidth={strokeWidth}
          onStrokeWidthChange={setStrokeWidth}
          canUndo={viewerCanvasRef.current?.canUndo || false}
          canRedo={viewerCanvasRef.current?.canRedo || false}
          onUndo={() => viewerCanvasRef.current?.undo()}
          onRedo={() => viewerCanvasRef.current?.redo()}
          onClear={() => viewerCanvasRef.current?.clear()}
          onClearAll={activeCommentId ? handleClearAll : undefined}
          onDelete={() => viewerCanvasRef.current?.delete()}
          onComplete={() => setPaintMode(false)}
          onResetView={() => setZoom(100)}
          showBoundingBoxes={showBoundingBoxes}
          onToggleBoundingBoxes={DEBUG_MODE ? () => setShowBoundingBoxes(!showBoundingBoxes) : undefined}
          showAllPaint={showAllPaint}
          onToggleShowAllPaint={() => setShowAllPaint(!showAllPaint)}
        />
      )}

      {/* 名前入力ダイアログ */}
      <Dialog open={showNameDialog} onOpenChange={setShowNameDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>お名前を入力してください</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              placeholder="お名前"
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
            />
            <Button
              onClick={handleSaveName}
              disabled={!guestName.trim()}
              className="w-full bg-blue-600 hover:bg-blue-700"
            >
              保存
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* トースト通知 */}
      {toast.show && (
        <div className="fixed bottom-4 right-4 z-50">
          <div className={`px-6 py-3 rounded-lg shadow-lg ${
            toast.type === 'error' ? 'bg-red-600 text-white' : 
            toast.type === 'info' ? 'bg-blue-600 text-white' : 
            'bg-green-600 text-white'
          }`}>
            {toast.message}
          </div>
        </div>
      )}
      </div>
      );
      }

      export default function ShareView() {
  return (
    <>
      <DebugOverlay />
      <ErrorBoundary>
        <ShareViewContent />
      </ErrorBoundary>
    </>
  );
}