import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams, useLocation } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  Download, 
  Share2, 
  ZoomIn, 
  ZoomOut, 
  Send,
  CheckCircle2
} from 'lucide-react';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import ErrorBoundary from '../components/ErrorBoundary';
import ViewerCanvas from '../components/viewer/ViewerCanvas';
import FloatingToolbar from '../components/viewer/FloatingToolbar';
import ShareLinkModal from '../components/viewer/ShareLinkModal';
import DebugOverlay from '../components/DebugOverlay';

function FileViewContent() {
  const [user, setUser] = useState(null);
  const [commentFilter, setCommentFilter] = useState('all');
  const [commentSort, setCommentSort] = useState('page');
  const [commentBody, setCommentBody] = useState('');
  const [shareLinkOpen, setShareLinkOpen] = useState(false);
  const [debugInfo, setDebugInfo] = useState({});
  const [paintMode, setPaintMode] = useState(false);
  const [tool, setTool] = useState('pen');
  const [strokeColor, setStrokeColor] = useState('#ff0000');
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [zoom, setZoom] = useState(100);
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });
  
  // Draft paint session state
  const [paintSessionCommentId, setPaintSessionCommentId] = useState(null);
  const [draftShapes, setDraftShapes] = useState([]);
  const [activeCommentId, setActiveCommentId] = useState(null);
  
  // Composer mode (new or edit)
  const [composerMode, setComposerMode] = useState('new');
  const [composerTargetCommentId, setComposerTargetCommentId] = useState(null);
  
  // CRITICAL: 送信完了後のキャンバスクリア用nonce & 連打防止
  const [clearAfterSubmitNonce, setClearAfterSubmitNonce] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // NOTE: inFlightRef/mutationIdRefはモジュールスコープのglobalSubmitLock/globalMutationIdに移行
  
  const viewerCanvasRef = useRef(null);
  const queryClient = useQueryClient();

  // DEBUG: Trace ReviewComment.create calls + mount/unmount log
  useEffect(() => {
    console.log("[FileView] mounted");
    return () => console.log("[FileView] unmounted");
  }, []);

  useEffect(() => {
    const DEBUG_MODE = import.meta.env.VITE_DEBUG === 'true';
    if (DEBUG_MODE && base44.entities.ReviewComment) {
      const original = base44.entities.ReviewComment.create;
      base44.entities.ReviewComment.create = async (...args) => {
        console.trace('[🔍 TRACE] ReviewComment.create called from:', args);
        return original.apply(base44.entities.ReviewComment, args);
      };
      return () => {
        base44.entities.ReviewComment.create = original;
      };
    }
  }, []);

  const showToast = (message, type = 'success') => {
    setToast({ show: true, message, type });
    setTimeout(() => setToast({ show: false, message: '', type: 'success' }), 3000);
  };
  
  const [searchParams] = useSearchParams();
  const location = useLocation();
  
  const fileId = searchParams.get('fileId');

  useEffect(() => {
    setDebugInfo({
      currentUrl: window.location.href,
      searchParamsRaw: window.location.search,
      hashRaw: window.location.hash,
      locationSearch: location.search,
      locationHash: location.hash,
      locationPathname: location.pathname,
      fileIdFromSearchParams: searchParams.get('fileId'),
      fileIdFinal: fileId,
      timestamp: new Date().toISOString(),
    });
  }, [fileId, location, searchParams]);

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { data: file, isLoading: fileLoading, error: fileError } = useQuery({
    queryKey: ['file', fileId],
    queryFn: async () => {
      console.log('Fetching file with ID:', fileId);
      let files = await base44.entities.FileAsset.filter({ id: fileId });
      if (!files || files.length === 0) {
        files = await base44.entities.FileAsset.filter({ _id: fileId });
      }
      console.log('Files found:', files);
      return files[0];
    },
    enabled: !!fileId,
  });

  const { data: comments = [], isLoading: commentsLoading } = useQuery({
    queryKey: ['comments', fileId],
    queryFn: () => base44.entities.ReviewComment.filter({ file_id: fileId }),
    enabled: !!fileId && !!file,
  });

  const { data: paintShapes = [] } = useQuery({
    queryKey: ['paintShapes', fileId, 1],
    queryFn: () => base44.entities.PaintShape.filter({ file_id: fileId, page_no: 1 }),
    enabled: !!fileId,
    refetchOnWindowFocus: false,
    staleTime: 60000,
  });

  useEffect(() => {
    if (file && user) {
      const contextLabel = file.project_id ? 'in: プロジェクト' : 'in: クイックチェック';
      base44.entities.UserRecent.filter({ 
        user_id: user.id, 
        type: 'file', 
        ref_id: fileId 
      }).then(recents => {
        if (recents.length > 0) {
          base44.entities.UserRecent.update(recents[0].id, {
            last_viewed_at: new Date().toISOString(),
            context_label: contextLabel,
          });
        } else {
          base44.entities.UserRecent.create({
            user_id: user.id,
            type: 'file',
            ref_id: fileId,
            context_label: contextLabel,
            last_viewed_at: new Date().toISOString(),
          });
        }
      }).catch(err => console.error('UserRecent error:', err));
    }
  }, [file, user, fileId]);

  // CRITICAL: onBeginPaintではコメントを作成しない（送信時のみ作成に統一）
  // これにより二重作成を防止
  const handleBeginPaint = async (imgX, imgY, bgW, bgH) => {
    console.log('[handleBeginPaint] called, activeCommentId:', activeCommentId);
    
    // すでに編集中コメントがあるならそれを使う
    if (activeCommentId) {
      setPaintSessionCommentId(activeCommentId);
      return activeCommentId;
    }

    // CRITICAL: ここではコメントを作成しない
    // 描画開始位置だけ記録して、送信時にコメントを作成する
    // draftShapesに追加されるので、送信時にアンカー位置を計算する
    console.log('[handleBeginPaint] no activeCommentId, draft mode');
    return null;
  };

  const handleSaveShape = async (shape, mode) => {
    try {
      const targetCommentId = paintSessionCommentId;
      
      // Draft（新規コメント）の場合はメモリに保存のみ
      if (!targetCommentId) {
        if (mode === 'create') {
          setDraftShapes(prev => [...prev, shape]);
        } else {
          setDraftShapes(prev => prev.map(s => s.id === shape.id ? shape : s));
        }
        return { dbId: shape.id };
      }

      // 既存コメントの場合はDBに保存
      const result = await base44.functions.invoke('savePaintShape', {
        token: null,
        fileId: fileId,
        commentId: targetCommentId,
        pageNo: 1,
        clientShapeId: shape.id,
        shapeType: shape.tool,
        dataJson: JSON.stringify(shape),
        authorName: user?.full_name || 'User',
        authorKey: user?.id,
        mode: mode || 'upsert',
      });

      if (result.data.error) {
        throw new Error(result.data.error);
      }

      // CRITICAL: allShapesを即座に更新（ViewerCanvasのprops同期対策）
      queryClient.setQueryData(['paintShapes', fileId, 1], (old) => {
        if (!old) return old;
        const exists = old.find(ps => ps.id === result.data.dbId || ps.client_shape_id === shape.id);
        if (exists) {
          return old.map(ps => (ps.id === result.data.dbId || ps.client_shape_id === shape.id) 
            ? { ...ps, data_json: JSON.stringify(shape) } 
            : ps);
        }
        return old;
      });

      await queryClient.invalidateQueries(['paintShapes', fileId, 1]);

      return result.data;
    } catch (error) {
      console.error('Save shape error:', error);
      const errorMsg = error.response?.data?.error || error.message || String(error);
      showToast(`保存失敗: ${errorMsg}`, 'error');
      throw new Error(errorMsg);
    }
  };

  const handleDeleteShape = async (shape) => {
    try {
      // Draft中の場合はメモリから削除
      if (!paintSessionCommentId) {
        setDraftShapes(prev => prev.filter(s => s.id !== shape.id));
        return;
      }

      await base44.functions.invoke('savePaintShape', {
        token: null,
        fileId: fileId,
        pageNo: 1,
        clientShapeId: shape.id,
        authorKey: user?.id,
        mode: 'delete',
      });

      await queryClient.invalidateQueries(['paintShapes', fileId, 1]);
      showToast('削除完了', 'success');
    } catch (error) {
      console.error('Delete shape error:', error);
      const errorMsg = error.response?.data?.error || error.message || String(error);
      showToast(`削除失敗: ${errorMsg}`, 'error');
      throw new Error(errorMsg);
    }
  };

  const handleClearAll = async () => {
    try {
      const targetCommentId = paintSessionCommentId || activeCommentId;
      
      // Draft中の場合
      if (!targetCommentId) {
        setDraftShapes([]);
        viewerCanvasRef.current?.clear();
        showToast('描画をクリアしました');
        return;
      }
      
      // 既存コメントの描画を削除
      const shapes = await base44.entities.PaintShape.filter({
        file_id: fileId,
        comment_id: targetCommentId,
        page_no: 1,
      });
      
      for (const shape of shapes) {
        await base44.entities.PaintShape.delete(shape.id);
      }
      
      await queryClient.invalidateQueries(['paintShapes', fileId, 1]);
      viewerCanvasRef.current?.clear();
      showToast('このコメントの描画を削除しました');
    } catch (error) {
      console.error('Clear all error:', error);
      const errorMsg = error.message || String(error);
      showToast(`削除失敗: ${errorMsg}`, 'error');
    }
  };

  // CRITICAL: 送信ロック用のグローバルフラグ（モジュールスコープで管理）
  const handleSendComment = (e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    
    console.count("[submit] handler called");
    console.log("[submit] globalSubmitLock:", globalSubmitLock, "isSubmitting:", isSubmitting);
    
    // ★最優先チェック：グローバルロックで即座にブロック（同期的に判定）
    if (globalSubmitLock) {
      console.log("[submit] BLOCKED by globalSubmitLock");
      return;
    }
    
    if (!commentBody.trim() || !user) {
      console.log("[submit] BLOCKED: empty body or no user");
      return;
    }
    
    // ★ここで即座にロックをかける（非同期処理の前に同期的にロック）
    globalSubmitLock = true;
    setIsSubmitting(true);
    
    console.count("[submit] lock acquired");
    
    (async () => {
      try {
        console.count("[submit] api called");
        
        // CRITICAL: 編集モード or activeCommentIdがある場合は「更新」
        if ((composerMode === 'edit' && composerTargetCommentId) || activeCommentId) {
          const targetId = composerTargetCommentId || activeCommentId;
          
          await base44.entities.ReviewComment.update(targetId, {
            body: commentBody,
            has_paint: draftShapes.length > 0,
          });
          
          showToast('コメントを更新しました', 'success');
        } else {
          // 新規モード: 新しいコメントを作成
          // CRITICAL: idempotency用のclientMutationIdを使用
          if (!globalMutationId) {
            globalMutationId = crypto.randomUUID();
          }
          const clientMutationId = globalMutationId;
          console.log(`[comment] create called mid=${clientMutationId}`);
          
          const existingComments = await base44.entities.ReviewComment.filter({ file_id: fileId });
          const maxSeqNo = existingComments.reduce((max, c) => Math.max(max, c.seq_no || 0), 0);

          // アンカー位置の計算（draftShapesがあればその中心）
          let anchor_nx = 0.5;
          let anchor_ny = 0.5;
          
          if (draftShapes.length > 0) {
            const allPoints = [];
            draftShapes.forEach(shape => {
              if (shape.nx !== undefined) {
                allPoints.push({ x: shape.nx, y: shape.ny });
                if (shape.nw !== undefined) {
                  allPoints.push({ x: shape.nx + shape.nw, y: shape.ny + shape.nh });
                }
              }
              if (shape.normalizedPoints) {
                for (let i = 0; i < shape.normalizedPoints.length; i += 2) {
                  allPoints.push({ x: shape.normalizedPoints[i], y: shape.normalizedPoints[i + 1] });
                }
              }
            });
            
            if (allPoints.length > 0) {
              const xs = allPoints.map(p => p.x);
              const ys = allPoints.map(p => p.y);
              anchor_nx = (Math.min(...xs) + Math.max(...xs)) / 2;
              anchor_ny = (Math.min(...ys) + Math.max(...ys)) / 2;
            }
          }

          console.count(`[comment] network request`);
          await base44.entities.ReviewComment.create({
            file_id: fileId,
            page_no: 1,
            seq_no: maxSeqNo + 1,
            anchor_nx,
            anchor_ny,
            author_type: 'user',
            author_user_id: user?.id,
            author_name: user?.full_name,
            body: commentBody,
            resolved: false,
            has_paint: draftShapes.length > 0,
            client_mutation_id: clientMutationId,
          });
          
          showToast('コメントを送信しました', 'success');
        }

        // CRITICAL: 送信成功後は必ず状態を完全リセット
        setCommentBody('');
        setDraftShapes([]);
        setComposerMode('new');
        setComposerTargetCommentId(null);
        setPaintSessionCommentId(null);
        setActiveCommentId(null);
        setPaintMode(false);
        setTool('select');
        
        // CRITICAL: ViewerCanvasの描画もクリア（ref経由で確実に実行）
        setClearAfterSubmitNonce(n => n + 1);
        viewerCanvasRef.current?.afterSubmitClear();
        viewerCanvasRef.current?.clear();
        
        await queryClient.invalidateQueries(['comments']);
        await queryClient.invalidateQueries(['paintShapes']);
      } catch (error) {
        showToast(`送信失敗: ${error.message}`, 'error');
      } finally {
        console.count("[submit] lock released");
        setIsSubmitting(false);
        globalSubmitLock = false;
        globalMutationId = null; // ★完了したら次回用にクリア
      }
    })();
  };

  const handleCommentClick = (comment) => {
    if (paintMode) {
      showToast('ペイントを終了してからコメントを選択してください', 'error');
      return;
    }
    
    // 同じコメントを再クリック → 選択解除＆新規モードに戻す
    if (activeCommentId === comment.id) {
      setActiveCommentId(null);
      setPaintSessionCommentId(null); // CRITICAL: paintSessionも解除
      setComposerMode('new');
      setComposerTargetCommentId(null);
      setCommentBody('');
      setPaintMode(false);
      return;
    }
    
    // 別のコメントをクリック → 編集モードに切替
    setActiveCommentId(comment.id);
    setPaintSessionCommentId(comment.id); // CRITICAL: paintSessionも設定して描画を表示
    setComposerMode('edit');
    setComposerTargetCommentId(comment.id);
    setCommentBody(comment.body);
  };

  const handleCancelEdit = () => {
    setComposerMode('new');
    setComposerTargetCommentId(null);
    setCommentBody('');
    setDraftShapes([]);
    setPaintSessionCommentId(null);
    setActiveCommentId(null);
    setPaintMode(false); // CRITICAL: ペイントモードも解除
  };

  const toggleResolveMutation = useMutation({
    mutationFn: ({ id, resolved }) => base44.entities.ReviewComment.update(id, { resolved }),
    onSuccess: () => {
      queryClient.invalidateQueries(['comments']);
    },
  });

  // PaintShapeをViewerCanvas用の形式に変換（CRITICAL: comment_idを必ず含める、commentIdも吸収）
  const allShapes = paintShapes.map(ps => {
    try {
      const data = JSON.parse(ps.data_json);
      // CRITICAL: DBのcomment_id、またはdata内のcomment_id/commentIdを優先的に使う
      const commentId = ps.comment_id || data.comment_id || data.commentId;
      return {
        id: ps.id,
        comment_id: commentId, // CRITICAL: comment_idを必ず含める
        tool: ps.shape_type,
        ...data,
        comment_id: commentId, // スプレッド後に上書きで確実に設定
      };
    } catch (e) {
      console.error('Failed to parse shape:', e);
      return null;
    }
  }).filter(Boolean);

  // CRITICAL: ViewerCanvasに渡すshapes（activeCommentIdがある時のみ）
  const shapesForCanvas = React.useMemo(() => {
    // activeCommentIdが無い場合は空配列（描画を表示しない）
    if (!activeCommentId && !paintSessionCommentId && draftShapes.length === 0) return [];
    
    const targetId = activeCommentId || paintSessionCommentId;
    if (!targetId) return draftShapes;
    
    // allShapesとdraftShapesをマージして返す
    return [...allShapes.filter(s => s.comment_id === targetId), ...draftShapes];
  }, [allShapes, activeCommentId, paintSessionCommentId, draftShapes]);

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

  if (!fileId) {
    return (
      <div className="min-h-screen bg-yellow-50 p-8">
        <div className="max-w-4xl mx-auto bg-white rounded-lg shadow-lg p-6">
          <h1 className="text-2xl font-bold text-yellow-600 mb-4">⚠️ File View Page Loaded - fileId なし</h1>
          <pre className="bg-gray-100 p-4 rounded overflow-auto text-sm">
            {JSON.stringify(debugInfo, null, 2)}
          </pre>
        </div>
      </div>
    );
  }

  if (fileLoading) {
    return (
      <div className="min-h-screen bg-blue-50 p-8">
        <div className="max-w-4xl mx-auto bg-white rounded-lg shadow-lg p-6">
          <h1 className="text-2xl font-bold text-blue-600 mb-4">✓ File View Page Loaded - Loading...</h1>
          <pre className="bg-gray-100 p-4 rounded overflow-auto text-sm">
            {JSON.stringify(debugInfo, null, 2)}
          </pre>
          <div className="mt-4">ファイルを読み込み中...</div>
        </div>
      </div>
    );
  }

  if (fileError) {
    return (
      <div className="min-h-screen bg-red-50 p-8">
        <div className="max-w-4xl mx-auto bg-white rounded-lg shadow-lg p-6">
          <h1 className="text-2xl font-bold text-red-600 mb-4">✓ File View Page Loaded - Error</h1>
          <pre className="bg-gray-100 p-4 rounded overflow-auto text-sm">
            {JSON.stringify(debugInfo, null, 2)}
          </pre>
          <div className="mt-4">
            <h2 className="font-semibold mb-2">エラー:</h2>
            <pre className="bg-red-100 p-4 rounded overflow-auto text-sm">
              {fileError?.toString()}
            </pre>
          </div>
        </div>
      </div>
    );
  }

  if (!file) {
    return (
      <div className="min-h-screen bg-orange-50 p-8">
        <div className="max-w-4xl mx-auto bg-white rounded-lg shadow-lg p-6">
          <h1 className="text-2xl font-bold text-orange-600 mb-4">✓ File View Page Loaded - File Not Found</h1>
          <pre className="bg-gray-100 p-4 rounded overflow-auto text-sm">
            {JSON.stringify(debugInfo, null, 2)}
          </pre>
          <div className="mt-4">
            <p>FileAsset not found: {fileId}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-full mx-auto h-screen flex flex-col">
      <div className="bg-green-100 border-b-2 border-green-600 px-6 py-2">
        <div className="text-xs font-mono">
          <strong>✓ File View Page Loaded</strong> | 
          URL: {debugInfo.currentUrl} | 
          fileId: {debugInfo.fileIdFinal} | 
          file.title: {file?.title}
        </div>
      </div>

      <div className="border-b bg-white px-6 py-3 flex items-center justify-between">
        <h1 className="text-xl font-bold">{file?.title || 'ファイル'}</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShareLinkOpen(true)}>
            <Share2 className="w-4 h-4 mr-2" />
            共有リンク発行
          </Button>
          <Button variant="outline" onClick={() => {
            const link = document.createElement('a');
            link.href = file.file_url;
            link.download = file.original_filename || file.title || 'download';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
          }}>
            <Download className="w-4 h-4 mr-2" />
            ダウンロード
          </Button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* 中央：プレビュー */}
        <div className="flex-1 bg-gray-100 overflow-auto relative pb-24">
          <ViewerCanvas
            ref={viewerCanvasRef}
            fileUrl={file?.file_url}
            mimeType={file?.mime_type}
            pageNumber={1}
            existingShapes={shapesForCanvas}
            activeCommentId={activeCommentId}
            showAllPaint={false}
            clearAfterSubmitNonce={clearAfterSubmitNonce}
            onShapesChange={(updated) => {
              // CRITICAL: ViewerCanvasからの更新を即座にdraftShapesに反映
              if (!paintSessionCommentId) {
                setDraftShapes(updated);
              }
            }}
            onSaveShape={handleSaveShape}
            onDeleteShape={handleDeleteShape}
            onBeginPaint={handleBeginPaint}
            paintMode={paintMode}
            tool={tool}
            onToolChange={setTool}
            strokeColor={strokeColor}
            strokeWidth={strokeWidth}
            zoom={zoom}
          />

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
        <div className="w-96 border-l bg-white flex flex-col">
          <div className="p-4 border-b space-y-2">
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
            {commentsLoading ? (
              <div className="text-center text-gray-500 py-8">
                コメントを読み込み中...
              </div>
            ) : sortedComments.length === 0 ? (
              <div className="text-center text-gray-500 py-8">
                コメントはありません
              </div>
            ) : (
              sortedComments.map((comment) => (
                <Card 
                  key={comment.id} 
                  className={`hover:shadow-md transition-shadow cursor-pointer ${
                    activeCommentId === comment.id ? 'ring-2 ring-blue-500' : ''
                  }`}
                  onClick={() => handleCommentClick(comment)}
                >
                  <CardContent className="p-3">
                    <div className="flex items-start gap-2 mb-2">
                      <Badge variant="secondary" className="text-xs">#{comment.seq_no}</Badge>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-medium">{comment.author_name}</span>
                        </div>
                        <p className="text-sm text-gray-700">{comment.body}</p>
                        <div className="flex items-center gap-2 mt-2 text-xs text-gray-500">
                          <span>{format(new Date(comment.created_date), 'yyyy/MM/dd HH:mm', { locale: ja })}</span>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleResolveMutation.mutate({ id: comment.id, resolved: !comment.resolved });
                        }}
                      >
                        <CheckCircle2 className={`w-4 h-4 ${comment.resolved ? 'text-green-600' : 'text-gray-300'}`} />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>

          {/* 入力ドック */}
          <div className="border-t p-4 space-y-2">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">
                {composerMode === 'edit' ? 'コメント編集' : 'コメント追加'}
              </span>
              {composerMode === 'edit' && (
                <Button type="button" variant="ghost" size="sm" onClick={handleCancelEdit}>
                  キャンセル
                </Button>
              )}
            </div>
            <Textarea
              placeholder={composerMode === 'edit' ? '編集中...' : 'コメントを入力'}
              value={commentBody}
              onChange={(e) => setCommentBody(e.target.value)}
              rows={3}
            />
            <Button
              type="button"
              disabled={isSubmitting || globalSubmitLock || (!commentBody.trim() && draftShapes.length === 0)}
              className="w-full bg-blue-600 hover:bg-blue-700"
              style={{ pointerEvents: (isSubmitting || globalSubmitLock) ? "none" : "auto" }}
              onClick={handleSendComment}
            >
              <Send className="w-4 h-4 mr-2" />
              {composerMode === 'edit' ? '保存' : '送信'}
            </Button>
          </div>
        </div>
      </div>

      {/* フローティングツールバー */}
      <FloatingToolbar
        paintMode={paintMode}
        onPaintModeChange={setPaintMode}
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
        onClearAll={handleClearAll}
        onDelete={() => viewerCanvasRef.current?.delete()}
        onComplete={() => setPaintMode(false)}
        onResetView={() => setZoom(100)}
        hasActiveComment={!!(paintSessionCommentId || activeCommentId || draftShapes.length > 0)}
      />

      <ShareLinkModal open={shareLinkOpen} onOpenChange={setShareLinkOpen} fileId={fileId} />

      {/* トースト通知 */}
      {toast.show && (
        <div className="fixed bottom-4 right-4 z-50">
          <div className={`px-6 py-3 rounded-lg shadow-lg ${
            toast.type === 'error' ? 'bg-red-600 text-white' : 'bg-green-600 text-white'
          }`}>
            {toast.message}
          </div>
        </div>
      )}
    </div>
  );
}

export default function FileView() {
  return (
    <>
      <DebugOverlay />
      <ErrorBoundary>
        <FileViewContent />
      </ErrorBoundary>
    </>
  );
}