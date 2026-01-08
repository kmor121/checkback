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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { 
  Download, 
  ZoomIn, 
  ZoomOut, 
  ChevronLeft, 
  ChevronRight,
  MessageSquare,
  Send,
  Paintbrush,
  User,
  MoreVertical,
  Edit,
  Trash,
  Link as LinkIcon,
  X,
  Trash2,
  Check,
  Circle,
  Reply
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
  const [paintMode, setPaintMode] = useState(false);
  const [tool, setTool] = useState('select');
  const [strokeColor, setStrokeColor] = useState('#ff0000');
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });
  const [showBoundingBoxes, setShowBoundingBoxes] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [activeCommentId, setActiveCommentId] = useState(null);
  const [composerText, setComposerText] = useState('');
  const [showAllPaint, setShowAllPaint] = useState(false);
  const [isDockOpen, setIsDockOpen] = useState(false);
  
  // Draft paint session state
  const [paintSessionCommentId, setPaintSessionCommentId] = useState(null);
  const [draftShapes, setDraftShapes] = useState([]);
  const draftShapesRef = useRef([]);
  const [canvasSessionNonce, setCanvasSessionNonce] = useState(0);
  
  // Composer mode (new or edit or reply)
  const [composerMode, setComposerMode] = useState('new');
  const [composerTargetCommentId, setComposerTargetCommentId] = useState(null);
  const [composerParentCommentId, setComposerParentCommentId] = useState(null);
  const [pendingFiles, setPendingFiles] = useState([]);
  const [replyingThreadId, setReplyingThreadId] = useState(null);
  
  const viewerCanvasRef = useRef(null);
  const queryClient = useQueryClient();
  const didInitActiveRef = useRef(false);

  // DEBUG: Trace ReviewComment.create calls
  useEffect(() => {
    if (DEBUG_MODE && base44.entities.ReviewComment) {
      const original = base44.entities.ReviewComment.create;
      base44.entities.ReviewComment.create = async (...args) => {
        console.trace('[🔍 TRACE ShareView] ReviewComment.create called from:', args);
        return original.apply(base44.entities.ReviewComment, args);
      };
      return () => {
        base44.entities.ReviewComment.create = original;
      };
    }
  }, []);

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

  const { data: shareLink, isLoading: linkLoading } = useQuery({
    queryKey: ['shareLink', token],
    queryFn: async () => {
      const links = await base44.entities.ShareLink.filter({ token });
      return links[0];
    },
    enabled: !!token,
    staleTime: 60000,
  });

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

  const { data: comments = [] } = useQuery({
    queryKey: ['sharedComments', shareLink?.file_id, token],
    queryFn: () => base44.entities.ReviewComment.filter({ 
      file_id: shareLink.file_id,
      share_token: token 
    }),
    enabled: isReady && !!shareLink?.file_id && shareLink?.can_view_comments,
    staleTime: 30000,
  });

  const { data: attachments = [] } = useQuery({
    queryKey: ['commentAttachments', shareLink?.file_id, token],
    queryFn: () => base44.entities.ReviewCommentAttachment.filter({
      file_id: shareLink.file_id,
      share_token: token
    }),
    enabled: isReady && !!shareLink?.file_id,
    staleTime: 30000,
  });

  const { data: file } = useQuery({
    queryKey: ['sharedFile', shareLink?.file_id],
    queryFn: async () => {
      const files = await base44.entities.FileAsset.filter({ id: shareLink.file_id });
      return files[0];
    },
    enabled: isReady && !!shareLink?.file_id,
    staleTime: 60000,
  });

  // Ready状態の詳細判定（useMemoで遅延評価）
  const readyDetails = React.useMemo(() => ({
    tokenOk: !!token,
    shareLinkOk: !!shareLink,
    fileOk: !!shareLink?.file_id,
    pageOk: currentPage >= 0,
    passOk: !shareLink?.password_enabled || isPasswordVerified,
  }), [token, shareLink, currentPage, isPasswordVerified]);

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

  const handlePaintModeChange = (mode) => {
    if (!mode) {
      setPaintMode(false);
      setTool('select');
      return;
    }

    if (!guestName.trim()) {
      setShowNameDialog(true);
      return;
    }

    // 編集セッションか新規セッションかを判定
    const isEditSession = composerMode === 'edit' && !!composerTargetCommentId;

    if (isEditSession) {
      // 既存コメント編集: そのコメントの描画を表示・編集可能
      setPaintSessionCommentId(composerTargetCommentId);
      setActiveCommentId(composerTargetCommentId);
    } else {
      // 新規作成: 既存コメント描画は非表示・編集不可
      setActiveCommentId(null);
      setPaintSessionCommentId(null);
      setDraftShapes([]);
      draftShapesRef.current = [];
      setComposerMode('new');
      setComposerTargetCommentId(null);
      setShowAllPaint(false);
      viewerCanvasRef.current?.clear();
      setCanvasSessionNonce(n => n + 1);
    }

    setPaintMode(true);
    setTool('pen');
    setIsDockOpen(true);
  };

  const handleBeginPaint = () => {
    // ペイント開始時はコメントを作らず、セッション開始のみ
    setPaintSessionCommentId(activeCommentId ?? null);
    if (!activeCommentId) {
      setDraftShapes([]);
    }
  };

  // 初回ロード時のみ activeCommentId を初期化（URLにcomment指定がある場合のみ選択）
  useEffect(() => {
    if (!token || !shareLink?.file_id) return;
    if (didInitActiveRef.current) return;

    const params = new URLSearchParams(window.location.search);
    const commentIdFromUrl = params.get('comment');

    // comment指定がない共有リンクは「何も選択しない」で確定（後から勝手に選ばれないよう初期化完了にする）
    if (!commentIdFromUrl) {
      setActiveCommentId(null);
      didInitActiveRef.current = true;
      return;
    }

    // comment指定がある場合は comments が揃うのを待つ
    if (!comments || comments.length === 0) return;

    const target = comments.find(c => c.id === commentIdFromUrl);
    if (target) {
      setCurrentPage(target.page_no);
      setActiveCommentId(target.id);
    } else {
      setActiveCommentId(null);
    }

    didInitActiveRef.current = true;
  }, [token, shareLink?.file_id, comments]);

  useEffect(() => {
    if (!token || !shareLink?.file_id || !activeCommentId) return;
    const key = `lastActiveCommentId:${token}:${shareLink.file_id}:${currentPage}`;
    localStorage.setItem(key, activeCommentId);
  }, [activeCommentId, token, shareLink?.file_id, currentPage]);

  // CRITICAL: comment_idで絞らず、全shapesをフェッチ（表示フィルタはクライアント側）
  const { data: paintShapes = [], isFetching: shapesFetching } = useQuery({
    queryKey: ['paintShapes', token, shareLink?.file_id, currentPage],
    queryFn: async () => {
      console.log('[ShareView] Fetching all shapes for page:', { 
        token: token?.substring(0, 10), 
        fileId: shareLink.file_id, 
        pageNo: currentPage 
      });
      const shapes = await base44.entities.PaintShape.filter({ 
        share_token: token,
        file_id: shareLink.file_id,
        page_no: currentPage
      });
      console.log('[ShareView] Fetched shapes count:', shapes.length);
      return shapes;
    },
    enabled: isReady && !!shareLink?.file_id && !!token,
    refetchOnWindowFocus: false,
    staleTime: 60000,
    placeholderData: (previousData) => previousData,
  });



  // CRITICAL: _idベース保存で増殖・not found対策
  const handleSaveShape = async (shape, mode) => {
    if (!isReady) {
      console.warn('[ShareView] Not ready yet, save aborted');
      return;
    }
    
    try {
      const targetCommentId = paintSessionCommentId;
      
      // Draft（新規コメント）の場合はメモリに保存のみ（ref即時更新）
      if (!targetCommentId) {
        if (mode === 'create') {
          draftShapesRef.current = [...draftShapesRef.current, shape];
        } else {
          draftShapesRef.current = draftShapesRef.current.map(s => (s.id === shape.id ? shape : s));
        }
        setDraftShapes(draftShapesRef.current);
        return { draft: true };
      }

      // 既存コメントの場合はDBに保存
      const shapeData = {
        file_id: shareLink.file_id,
        share_token: token,
        comment_id: targetCommentId,
        page_no: currentPage,
        client_shape_id: shape.id,
        shape_type: shape.tool,
        data_json: JSON.stringify(shape),
        author_key: guestId,
        author_name: guestName || 'Guest',
      };
      
      let result;
      
      if (shape.dbId) {
        try {
          result = await base44.entities.PaintShape.update(shape.dbId, shapeData);
          if (DEBUG_MODE) console.log('[ShareView] Updated existing shape:', shape.dbId);
        } catch (err) {
          if (err.message?.includes('not found') || err.message?.includes('Not Found')) {
            console.warn('[ShareView] Update failed (not found), creating:', shape.dbId);
            result = await base44.entities.PaintShape.create(shapeData);
          } else {
            throw err;
          }
        }
      } else {
        result = await base44.entities.PaintShape.create(shapeData);
        if (DEBUG_MODE) console.log('[ShareView] Created new shape:', result.id);
      }

      await queryClient.invalidateQueries({ queryKey: ['paintShapes', token, shareLink?.file_id, currentPage] });

      return { ...result, dbId: result.id };
    } catch (error) {
      console.error('[ShareView] Save shape error:', error);
      const errorMsg = error.response?.data?.error || error.message || String(error);
      showToast(`保存失敗: ${errorMsg}`, 'error');
      throw new Error(errorMsg);
    }
  };

  const handleDeleteShape = async (shape) => {
    if (!isReady) {
      console.warn('[ShareView] Not ready yet, delete aborted');
      return;
    }
    
    try {
      // Draft中の場合はメモリから削除（ref即時更新）
      if (!paintSessionCommentId) {
        draftShapesRef.current = draftShapesRef.current.filter(s => s.id !== shape.id);
        setDraftShapes(draftShapesRef.current);
        return;
      }

      // CRITICAL: 必ずdbId(_id)で削除（client_shape_idは使わない）
      if (shape.dbId) {
        await base44.entities.PaintShape.delete(shape.dbId);
        if (DEBUG_MODE) console.log('[ShareView] Deleted shape by dbId:', shape.dbId);
      } else {
        console.warn('[ShareView] No dbId for shape, cannot delete:', shape.id);
        showToast('削除できませんでした（IDが見つかりません）', 'error');
        return;
      }

      await queryClient.invalidateQueries({ queryKey: ['paintShapes', token, shareLink?.file_id, currentPage] });
      showToast('削除完了', 'success');
    } catch (error) {
      console.error('[ShareView] Delete shape error:', error);
      const errorMsg = error.response?.data?.error || error.message || String(error);
      showToast(`削除失敗: ${errorMsg}`, 'error');
      throw new Error(errorMsg);
    }
  };

  const handleClearAll = async () => {
    try {
      const targetCommentId = paintSessionCommentId || activeCommentId;
      
      // Draft中の場合（ref即時更新）
      if (!targetCommentId) {
        draftShapesRef.current = [];
        setDraftShapes([]);
        viewerCanvasRef.current?.clear();
        showToast('描画をクリアしました');
        return;
      }
      
      // 既存コメントの描画を削除
      const shapesToDelete = paintShapes.filter(s => 
        s.comment_id === targetCommentId && 
        s.author_key === guestId
      );
      
      for (const shape of shapesToDelete) {
        await base44.entities.PaintShape.delete(shape.id);
      }

      await queryClient.invalidateQueries({ queryKey: ['paintShapes', token, shareLink?.file_id, currentPage] });
      viewerCanvasRef.current?.clear();
      showToast(`${shapesToDelete.length}個の描画を削除しました`, 'success');
    } catch (error) {
      console.error('Clear all error:', error);
      const errorMsg = error.message || String(error);
      showToast(`削除失敗: ${errorMsg}`, 'error');
    }
  };



  const handleSendComment = async () => {
    if (!guestName.trim()) {
      setShowNameDialog(true);
      return;
    }

    const hasText = composerText.trim().length > 0;
    
    if (!hasText) {
      showToast('コメント本文を入力してください（描画だけでは送信できません）', 'error');
      return;
    }

    const shapesToCommit = draftShapesRef.current || [];
    const hasDraftShapes = shapesToCommit.length > 0;
    const hasFiles = pendingFiles.length > 0;

    try {
      if (composerMode === 'edit' && composerTargetCommentId) {
        // 編集モード: 既存コメントを更新
        await base44.entities.ReviewComment.update(composerTargetCommentId, {
          body: composerText,
        });
        
        // 添付ファイルがあれば追加
        if (pendingFiles.length > 0) {
          for (const file of pendingFiles) {
            const { file_url } = await base44.integrations.Core.UploadFile({ file });
            await base44.entities.ReviewCommentAttachment.create({
              file_id: shareLink.file_id,
              share_token: token,
              comment_id: composerTargetCommentId,
              uploader_type: 'guest',
              uploader_key: guestId,
              uploader_name: guestName,
              file_url,
              original_filename: file.name,
              mime_type: file.type,
              size_bytes: file.size,
            });
          }
        }
        
        showToast('コメントを更新しました', 'success');
      } else if (composerMode === 'reply' && composerParentCommentId) {
        // 返信モード: 返信コメントを作成
        const parentComment = comments.find(c => c.id === composerParentCommentId);
        if (!parentComment) {
          showToast('親コメントが見つかりません', 'error');
          return;
        }

        const comment = await base44.entities.ReviewComment.create({
          file_id: shareLink.file_id,
          share_token: token,
          page_no: parentComment.page_no,
          seq_no: 0,
          anchor_nx: parentComment.anchor_nx || 0.5,
          anchor_ny: parentComment.anchor_ny || 0.5,
          author_type: 'guest',
          author_key: guestId,
          author_name: guestName,
          body: composerText,
          resolved: false,
          parent_comment_id: composerParentCommentId,
          has_paint: false,
        });

        // 添付ファイルがあればアップロード＆保存
        if (pendingFiles.length > 0) {
          for (const file of pendingFiles) {
            const { file_url } = await base44.integrations.Core.UploadFile({ file });
            await base44.entities.ReviewCommentAttachment.create({
              file_id: shareLink.file_id,
              share_token: token,
              comment_id: comment.id,
              uploader_type: 'guest',
              uploader_key: guestId,
              uploader_name: guestName,
              file_url,
              original_filename: file.name,
              mime_type: file.type,
              size_bytes: file.size,
            });
          }
        }

        showToast('返信を送信しました', 'success');
      } else {
        // 新規モード: 新しい親コメントを作成
        const existingComments = await base44.entities.ReviewComment.filter({ 
          file_id: shareLink.file_id,
          share_token: token 
        });
        const maxSeqNo = existingComments.reduce((max, c) => Math.max(max, c.seq_no || 0), 0);

        // アンカー位置の計算（shapesToCommitがあればその中心）
        let anchor_nx = 0.5;
        let anchor_ny = 0.5;
        
        if (shapesToCommit.length > 0) {
          const allPoints = [];
          shapesToCommit.forEach(shape => {
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

        const comment = await base44.entities.ReviewComment.create({
          file_id: shareLink.file_id,
          share_token: token,
          page_no: currentPage,
          seq_no: maxSeqNo + 1,
          anchor_nx,
          anchor_ny,
          author_type: 'guest',
          author_key: guestId,
          author_name: guestName,
          body: composerText,
          resolved: false,
          has_paint: shapesToCommit.length > 0,
        });

        // DraftShapesをDBに保存（refから取得）
        if (shapesToCommit.length > 0) {
          for (const shape of shapesToCommit) {
            await base44.entities.PaintShape.create({
              file_id: shareLink.file_id,
              share_token: token,
              comment_id: comment.id,
              page_no: currentPage,
              client_shape_id: shape.id,
              shape_type: shape.tool,
              data_json: JSON.stringify(shape),
              author_key: guestId,
              author_name: guestName,
            });
          }
        }

        // 添付ファイルがあればアップロード＆保存
        if (pendingFiles.length > 0) {
          for (const file of pendingFiles) {
            const { file_url } = await base44.integrations.Core.UploadFile({ file });
            await base44.entities.ReviewCommentAttachment.create({
              file_id: shareLink.file_id,
              share_token: token,
              comment_id: comment.id,
              uploader_type: 'guest',
              uploader_key: guestId,
              uploader_name: guestName,
              file_url,
              original_filename: file.name,
              mime_type: file.type,
              size_bytes: file.size,
            });
          }
        }
        
        showToast('コメントを送信しました', 'success');
      }

      // CRITICAL: 送信成功後は必ず状態を完全リセット（ref含む）
      setComposerText('');
      setDraftShapes([]);
      draftShapesRef.current = [];
      setPendingFiles([]);
      setComposerMode('new');
      setComposerTargetCommentId(null);
      setComposerParentCommentId(null);
      setPaintSessionCommentId(null);
      setActiveCommentId(null);
      setPaintMode(false);
      setReplyingThreadId(null);
      setIsDockOpen(false);
      
      await queryClient.invalidateQueries({ queryKey: ['sharedComments', shareLink.file_id, token] });
      await queryClient.invalidateQueries({ queryKey: ['commentAttachments', shareLink.file_id, token] });
      await queryClient.invalidateQueries({ queryKey: ['paintShapes', token, shareLink?.file_id, currentPage] });
    } catch (error) {
      showToast(`送信失敗: ${error.message}`, 'error');
    }
  };

  const selectComment = (comment) => {
    if (paintMode) {
      showToast('ペイントを終了してから選択してください', 'info');
      return;
    }

    // 同じコメントを再クリック → 選択解除＆新規モードに戻す
    if (activeCommentId === comment.id) {
      setActiveCommentId(null);
      setComposerMode('new');
      setComposerTargetCommentId(null);
      setComposerText('');
      setDraftShapes([]);
      draftShapesRef.current = [];
      setPaintSessionCommentId(null);
      setIsDockOpen(false);
      return;
    }

    // 別のコメントをクリック → 選択のみ（編集には入らない）
    setCurrentPage(comment.page_no);
    setActiveCommentId(comment.id);
    setIsDockOpen(true);

    // クリックだけで edit にならないように必ず new に戻す
    setComposerMode('new');
    setComposerTargetCommentId(null);
    setComposerText('');
    setDraftShapes([]);
    draftShapesRef.current = [];
  };

  const enterEdit = (comment) => {
    if (paintMode) {
      showToast('ペイントを終了してから編集してください', 'info');
      return;
    }

    setCurrentPage(comment.page_no);
    setActiveCommentId(comment.id);
    setComposerMode('edit');
    setComposerTargetCommentId(comment.id);
    setComposerText(comment.body || '');
    setIsDockOpen(true);

    // 編集開始時はペイント/ドラフトを解除して事故防止
    setPaintMode(false);
    setPaintSessionCommentId(null);
    setDraftShapes([]);
    draftShapesRef.current = [];
  };

  const handleStartEditComment = (comment) => {
    enterEdit(comment);
  };

  const resetEditorSession = () => {
    viewerCanvasRef.current?.clear();
    setPaintMode(false);
    setIsDockOpen(false);
    setPaintSessionCommentId(null);

    // 編集解除
    setComposerMode('new');
    setComposerTargetCommentId(null);
    setComposerParentCommentId(null);

    // 選択解除
    setActiveCommentId(null);

    // draftクリア
    setDraftShapes([]);
    draftShapesRef.current = [];
    setComposerText('');
    setPendingFiles([]);
    setReplyingThreadId(null);
  };

  const handleCancelEdit = () => {
    // 編集中のコメントを取得して本文が変更されているか確認
    const editingComment = comments.find(c => c.id === composerTargetCommentId);
    const hasUnsavedChanges = editingComment && composerText.trim() !== (editingComment.body || '').trim();

    if (hasUnsavedChanges && !window.confirm('編集内容を破棄しますか？')) {
      return;
    }

    // 編集モードのみ終了（選択は維持）
    setComposerMode('new');
    setComposerTargetCommentId(null);
    setComposerText('');
    setPendingFiles([]);
    setPaintMode(false);
    setPaintSessionCommentId(null);
  };

  const handleStartReply = (parentComment) => {
    if (paintMode) {
      showToast('ペイントを終了してから返信してください', 'info');
      return;
    }

    setReplyingThreadId(parentComment.id);
    setComposerMode('reply');
    setComposerParentCommentId(parentComment.id);
    setComposerTargetCommentId(null);
    setComposerText('');
    setPendingFiles([]);
    setActiveCommentId(parentComment.id);
    setIsDockOpen(true);
  };

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files || []);
    setPendingFiles(prev => [...prev, ...files]);
  };

  const handleRemoveFile = (index) => {
    setPendingFiles(prev => prev.filter((_, i) => i !== index));
  };

  // コメント削除（関連PaintShapeも削除）
  const handleDeleteComment = async (comment) => {
    if (!window.confirm('このコメントと関連する描画を削除しますか？')) {
      return;
    }

    try {
      // 関連するPaintShapeを全削除
      const relatedShapes = paintShapes.filter(s => s.comment_id === comment.id);
      for (const shape of relatedShapes) {
        await base44.entities.PaintShape.delete(shape.id);
      }

      // コメント削除
      await base44.entities.ReviewComment.delete(comment.id);
      
      queryClient.invalidateQueries({ queryKey: ['sharedComments', shareLink.file_id, token] });
      queryClient.invalidateQueries({ queryKey: ['paintShapes', token, shareLink?.file_id, currentPage] });
      
      // 削除したコメントが選択中だったらクリア
      if (activeCommentId === comment.id) {
        setActiveCommentId(null);
      }
      
      showToast('コメントと描画を削除しました', 'success');
    } catch (error) {
      showToast(`削除失敗: ${error.message}`, 'error');
    }
  };

  // コメントURLをコピー
  const handleCopyCommentUrl = (comment) => {
    const url = `${window.location.origin}${window.location.pathname}?token=${token}&comment=${comment.id}`;
    navigator.clipboard.writeText(url).then(() => {
      showToast('URLをコピーしました', 'success');
    }).catch(() => {
      showToast('コピーに失敗しました', 'error');
    });
  };

  // 対応済みトグル
  const toggleResolvedMutation = useMutation({
    mutationFn: async ({ commentId, resolved }) => {
      return await base44.entities.ReviewComment.update(commentId, {
        resolved,
        resolved_at: resolved ? new Date().toISOString() : null,
        resolved_by: resolved ? guestName : null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sharedComments', shareLink.file_id, token] });
    },
  });

  const handleToggleResolved = async (comment, e) => {
    e.stopPropagation();
    const newResolved = !comment.resolved;

    // 楽観更新
    queryClient.setQueryData(['sharedComments', shareLink.file_id, token], (old) => {
      return old.map(c => c.id === comment.id ? { ...c, resolved: newResolved } : c);
    });

    try {
      await toggleResolvedMutation.mutateAsync({ commentId: comment.id, resolved: newResolved });
      showToast(newResolved ? '対応済みにしました' : '未対応に戻しました', 'success');
    } catch (error) {
      // 失敗時はrevert
      queryClient.setQueryData(['sharedComments', shareLink.file_id, token], (old) => {
        return old.map(c => c.id === comment.id ? { ...c, resolved: !newResolved } : c);
      });
      showToast(`更新失敗: ${error.message}`, 'error');
    }
  };



  // PaintShapeをViewerCanvas用の形式に変換（draft含む）
  const existingShapes = React.useMemo(() => {
    if (!isReady || !paintShapes) {
      return [...draftShapes];
    }

    const targetCommentId = paintSessionCommentId || activeCommentId;
    const filtered = showAllPaint 
      ? paintShapes 
      : targetCommentId 
        ? paintShapes.filter(ps => ps.comment_id === targetCommentId)
        : [];

    const result = filtered
      .map(ps => {
        try {
          const data = JSON.parse(ps.data_json);
          return {
            id: ps.client_shape_id || ps.id,
            dbId: ps.id,
            tool: ps.shape_type,
            commentId: ps.comment_id,
            ...data,
          };
        } catch (e) {
          console.error('[ShareView] Failed to parse shape:', e);
          return null;
        }
      })
      .filter(Boolean);

    return [...result, ...draftShapes];
  }, [paintShapes, isReady, activeCommentId, paintSessionCommentId, showAllPaint, draftShapes]);

  // 親コメントと返信を分離（条件付きreturnの前に配置）
  const filteredComments = React.useMemo(() => {
    return comments.filter(c => {
      if (commentFilter === 'resolved') return c.resolved;
      if (commentFilter === 'unresolved') return !c.resolved;
      return true;
    });
  }, [comments, commentFilter]);

  const topLevelComments = React.useMemo(() => {
    return filteredComments.filter(c => !c.parent_comment_id);
  }, [filteredComments]);

  const repliesByParent = React.useMemo(() => {
    const map = new Map();
    filteredComments.forEach(c => {
      if (c.parent_comment_id) {
        if (!map.has(c.parent_comment_id)) {
          map.set(c.parent_comment_id, []);
        }
        map.get(c.parent_comment_id).push(c);
      }
    });
    // 返信を日付順にソート
    map.forEach((replies) => {
      replies.sort((a, b) => new Date(a.created_date) - new Date(b.created_date));
    });
    return map;
  }, [filteredComments]);

  const attachmentsByComment = React.useMemo(() => {
    const map = new Map();
    attachments.forEach(att => {
      if (!map.has(att.comment_id)) {
        map.set(att.comment_id, []);
      }
      map.get(att.comment_id).push(att);
    });
    return map;
  }, [attachments]);

  const sortedComments = React.useMemo(() => {
    return [...topLevelComments].sort((a, b) => {
      if (commentSort === 'page') return a.page_no - b.page_no || a.seq_no - b.seq_no;
      if (commentSort === 'oldest') return new Date(a.created_date) - new Date(b.created_date);
      if (commentSort === 'newest') return new Date(b.created_date) - new Date(a.created_date);
      return 0;
    });
  }, [topLevelComments, commentSort]);

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
              key={`${token}:${shareLink?.file_id}:${currentPage}:${canvasSessionNonce}`}
              ref={viewerCanvasRef}
              fileUrl={file?.file_url}
              mimeType={file?.mime_type}
              pageNumber={currentPage}
              existingShapes={existingShapes}
              comments={comments.filter(c => c.page_no === currentPage)}
              activeCommentId={activeCommentId}
              onCommentClick={(id) => {
                const comment = comments.find(c => c.id === id);
                if (!comment) return;
                selectComment(comment);
              }}
              onBeginPaint={handleBeginPaint}
              onSaveShape={handleSaveShape}
              onDeleteShape={handleDeleteShape}
              paintMode={isReady && paintMode}
              tool={tool}
              onToolChange={setTool}
              onStrokeColorChange={setStrokeColor}
              onStrokeWidthChange={setStrokeWidth}
              strokeColor={strokeColor}
              strokeWidth={strokeWidth}
              zoom={zoom}
              showBoundingBoxes={showBoundingBoxes}
              showAllPaint={showAllPaint}
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

        {/* 右：コメント一覧 */}
        {shareLink.can_view_comments && (
          <div className="w-96 border-l bg-white flex flex-col">
            <div className="p-4 border-b space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-sm">コメント</h3>
                <Button
                  variant={showAllPaint ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setShowAllPaint(!showAllPaint)}
                  className="text-xs"
                >
                  <Paintbrush className="w-3 h-3 mr-1" />
                  全表示
                </Button>
              </div>

              <Tabs value={commentFilter} onValueChange={setCommentFilter} className="w-full">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="all" className="text-xs">全て</TabsTrigger>
                  <TabsTrigger value="unresolved" className="text-xs">未対応</TabsTrigger>
                  <TabsTrigger value="resolved" className="text-xs">対応済</TabsTrigger>
                </TabsList>
              </Tabs>

              <Select value={commentSort} onValueChange={setCommentSort}>
                <SelectTrigger className="h-8 text-xs">
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
                                  const isSelected = activeCommentId === comment.id;
                                  const isEditing = composerMode === 'edit' && composerTargetCommentId === comment.id;
                                  const isPaintingThis = paintMode && paintSessionCommentId === comment.id;
                                  const replies = repliesByParent.get(comment.id) || [];
                                  const commentAttachments = attachmentsByComment.get(comment.id) || [];
                                  const isThreadOpen = replyingThreadId === comment.id;

                  return (
                    <div key={comment.id} className="space-y-2">
                      <Card 
                        className={`hover:shadow-md transition-shadow ${
                          isEditing ? 'border-2 border-green-600 bg-green-50' : 
                          isSelected ? 'border-2 border-blue-600 bg-blue-50' : 
                          comment.resolved ? 'opacity-75 bg-gray-50' : ''
                        }`}
                      >
                        <CardContent className="p-3">
                          <div className="flex items-start gap-2">
                            <div 
                              className="flex-1 cursor-pointer" 
                              onClick={() => selectComment(comment)}
                              onDoubleClick={() => enterEdit(comment)}
                            >
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-sm font-medium">{comment.author_name}</span>
                                {comment.author_type === 'guest' && (
                                  <Badge variant="outline" className="text-xs">ゲスト</Badge>
                                )}
                                {comment.resolved && (
                                  <Badge className="text-xs bg-green-600 text-white">
                                    対応済
                                  </Badge>
                                )}
                                {shapesCount > 0 && (
                                  <Badge variant="outline" className="text-xs flex items-center gap-1">
                                    <Paintbrush className="w-3 h-3" />
                                    {shapesCount}
                                  </Badge>
                                )}
                                {isEditing && (
                                  <Badge className="text-xs bg-green-600 text-white">
                                    編集中
                                  </Badge>
                                )}
                                {isPaintingThis && !isEditing && (
                                  <Badge className="text-xs bg-orange-600 text-white">
                                    ペイント中
                                  </Badge>
                                )}
                              </div>

                              <p className="text-sm text-gray-700">{comment.body || '（本文なし）'}</p>

                              {/* 添付ファイル表示 */}
                              {commentAttachments.length > 0 && (
                                <div className="mt-2 space-y-1">
                                  {commentAttachments.map((att) => (
                                    <a
                                      key={att.id}
                                      href={att.file_url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="flex items-center gap-2 text-xs text-blue-600 hover:underline"
                                    >
                                      <Download className="w-3 h-3" />
                                      {att.original_filename}
                                    </a>
                                  ))}
                                </div>
                              )}

                              <div className="flex items-center gap-2 mt-2 text-xs text-gray-500">
                                <span>{comment.page_no}枚目</span>
                                <span>•</span>
                                <span>{format(new Date(comment.created_date), 'yyyy/MM/dd HH:mm', { locale: ja })}</span>
                                {replies.length > 0 && (
                                  <>
                                    <span>•</span>
                                    <Button
                                      variant="link"
                                      size="sm"
                                      className="h-auto p-0 text-xs text-blue-600"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setReplyingThreadId(isThreadOpen ? null : comment.id);
                                      }}
                                    >
                                      {replies.length}件の返信
                                    </Button>
                                  </>
                                )}
                              </div>
                              </div>

                              {/* 対応済みチェック */}
                              <Button
                              variant="ghost"
                              size="sm"
                              className={`h-auto p-1 ${comment.resolved ? 'text-green-600' : 'text-gray-400'}`}
                              onClick={(e) => handleToggleResolved(comment, e)}
                              title={comment.resolved ? '未対応に戻す' : '対応済みにする'}
                              >
                              {comment.resolved ? (
                                <div className="w-5 h-5 rounded-full bg-green-600 flex items-center justify-center">
                                  <Check className="w-3 h-3 text-white" />
                                </div>
                              ) : (
                                <Circle className="w-5 h-5" />
                              )}
                              </Button>

                              {/* 返信ボタン */}
                              <Button
                              variant="ghost"
                              size="sm"
                              className="h-auto p-1 text-gray-600"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleStartReply(comment);
                              }}
                              title="返信"
                              >
                              <Reply className="w-4 h-4" />
                              </Button>

                              <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm" className="h-auto p-1">
                                  <MoreVertical className="w-4 h-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => handleStartEditComment(comment)}>
                                  <Edit className="w-4 h-4 mr-2" />
                                  編集
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleStartReply(comment)}>
                                  <MessageSquare className="w-4 h-4 mr-2" />
                                  返信
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleCopyCommentUrl(comment)}>
                                  <LinkIcon className="w-4 h-4 mr-2" />
                                  URLをコピー
                                </DropdownMenuItem>
                                <DropdownMenuItem 
                                  onClick={() => handleDeleteComment(comment)}
                                  className="text-red-600"
                                >
                                  <Trash className="w-4 h-4 mr-2" />
                                  削除
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </CardContent>
                      </Card>

                      {/* 返信リスト */}
                      {isThreadOpen && replies.length > 0 && (
                        <div className="ml-6 space-y-2">
                          {replies.map((reply) => {
                            const replyAttachments = attachmentsByComment.get(reply.id) || [];
                            return (
                              <Card key={reply.id} className="bg-gray-50">
                                <CardContent className="p-3">
                                  <div className="flex items-start gap-2">
                                    <ChevronRight className="w-4 h-4 text-gray-400 mt-1 flex-shrink-0" />
                                    <div className="flex-1">
                                      <div className="flex items-center gap-2 mb-1">
                                        <span className="text-xs font-medium">{reply.author_name}</span>
                                        {reply.author_type === 'guest' && (
                                          <Badge variant="outline" className="text-xs">ゲスト</Badge>
                                        )}
                                      </div>
                                      <p className="text-xs text-gray-700">{reply.body}</p>
                                      
                                      {/* 返信の添付ファイル */}
                                      {replyAttachments.length > 0 && (
                                        <div className="mt-2 space-y-1">
                                          {replyAttachments.map((att) => (
                                            <a
                                              key={att.id}
                                              href={att.file_url}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="flex items-center gap-2 text-xs text-blue-600 hover:underline"
                                            >
                                              <Download className="w-3 h-3" />
                                              {att.original_filename}
                                            </a>
                                          ))}
                                        </div>
                                      )}

                                      <div className="text-xs text-gray-500 mt-1">
                                        {format(new Date(reply.created_date), 'yyyy/MM/dd HH:mm', { locale: ja })}
                                      </div>
                                    </div>
                                  </div>
                                </CardContent>
                              </Card>
                            );
                          })}
                        </div>
                      )}

                      {/* 返信入力欄 */}
                      {isThreadOpen && (
                        <div className="ml-6 bg-white rounded-lg border-2 border-blue-200 p-3 space-y-2">
                          <Textarea
                            placeholder="返信を入力..."
                            value={composerMode === 'reply' && composerParentCommentId === comment.id ? composerText : ''}
                            onChange={(e) => {
                              if (composerMode !== 'reply' || composerParentCommentId !== comment.id) {
                                handleStartReply(comment);
                              }
                              setComposerText(e.target.value);
                            }}
                            rows={2}
                            className="text-sm resize-none"
                          />
                          
                          {/* 添付ファイル一覧 */}
                          {pendingFiles.length > 0 && composerMode === 'reply' && composerParentCommentId === comment.id && (
                            <div className="space-y-1">
                              {pendingFiles.map((file, idx) => (
                                <div key={idx} className="flex items-center gap-2 text-xs text-gray-600">
                                  <Download className="w-3 h-3" />
                                  <span className="flex-1 truncate">{file.name}</span>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-auto p-0 text-red-600"
                                    onClick={() => handleRemoveFile(idx)}
                                  >
                                    <X className="w-3 h-3" />
                                  </Button>
                                </div>
                              ))}
                            </div>
                          )}

                          <div className="flex items-center gap-2">
                            <input
                              type="file"
                              multiple
                              className="hidden"
                              id={`file-input-${comment.id}`}
                              onChange={(e) => {
                                if (composerMode !== 'reply' || composerParentCommentId !== comment.id) {
                                  handleStartReply(comment);
                                }
                                handleFileSelect(e);
                              }}
                            />
                            <label htmlFor={`file-input-${comment.id}`}>
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-xs"
                                asChild
                              >
                                <span>
                                  <Download className="w-3 h-3 mr-1" />
                                  添付
                                </span>
                              </Button>
                            </label>
                            <Button
                              size="sm"
                              className="bg-blue-600 hover:bg-blue-700 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                              onClick={handleSendComment}
                              disabled={!composerText.trim()}
                            >
                              <Send className="w-3 h-3 mr-1" />
                              送信
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-xs"
                              onClick={() => {
                                setReplyingThreadId(null);
                                setComposerMode('new');
                                setComposerParentCommentId(null);
                                setComposerText('');
                                setPendingFiles([]);
                              }}
                            >
                              閉じる
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>

      {/* ツールバー（ペイントモード時のみ、ドック直上） */}
      {paintMode && shareLink.can_post_comments && isReady && (
        <div className="fixed bottom-32 left-1/2 transform -translate-x-1/2 z-40">
          <FloatingToolbar
            paintMode={paintMode}
            onPaintModeChange={handlePaintModeChange}
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
            onComplete={() => {
              setPaintMode(false);
              setTool('select');
            }}
            onResetView={() => setZoom(100)}
            showBoundingBoxes={showBoundingBoxes}
            onToggleBoundingBoxes={DEBUG_MODE ? () => setShowBoundingBoxes(!showBoundingBoxes) : undefined}
            hasActiveComment={!!(paintSessionCommentId || activeCommentId || draftShapes.length > 0)}
          />
        </div>
      )}

      {/* 中央下ドック（コメント入力） */}
      {shareLink.can_post_comments && (
        <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 z-50 w-full max-w-2xl px-4">
          <div className="bg-white rounded-xl shadow-2xl border-2 border-gray-200 p-4">
            <div className="flex gap-3 items-start">
              {/* ペイントボタン */}
              <Button
                variant={paintMode ? 'default' : 'outline'}
                size="sm"
                onClick={() => handlePaintModeChange(!paintMode)}
                className="mt-1"
              >
                <Paintbrush className="w-4 h-4 mr-1" />
                {paintMode ? 'ペイント中' : 'ペイント'}
              </Button>

              {/* 本文入力 */}
              <div className="flex-1 space-y-2">
                <Textarea
                  placeholder={composerMode === 'edit' ? '編集中...' : composerMode === 'reply' ? '返信を入力...' : 'コメントを入力...'}
                  value={composerText}
                  onChange={(e) => setComposerText(e.target.value)}
                  onFocus={() => setIsDockOpen(true)}
                  rows={2}
                  className="text-sm resize-none"
                />
                
                {/* 添付ファイル一覧 */}
                {pendingFiles.length > 0 && (
                  <div className="space-y-1">
                    {pendingFiles.map((file, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-xs text-gray-600">
                        <Download className="w-3 h-3" />
                        <span className="flex-1 truncate">{file.name}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-auto p-0 text-red-600"
                          onClick={() => handleRemoveFile(idx)}
                        >
                          <X className="w-3 h-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 添付ボタン */}
              <input
                type="file"
                multiple
                className="hidden"
                id="dock-file-input"
                onChange={handleFileSelect}
              />
              <label htmlFor="dock-file-input">
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-1"
                  asChild
                >
                  <span>
                    <Download className="w-4 h-4" />
                  </span>
                </Button>
              </label>

              {/* 送信ボタン */}
              <Button
                onClick={handleSendComment}
                disabled={!composerText.trim()}
                className="bg-blue-600 hover:bg-blue-700 mt-1 disabled:opacity-50 disabled:cursor-not-allowed"
                size="sm"
                title={composerMode === 'edit' ? '保存' : '送信'}
              >
                <Send className="w-4 h-4" />
              </Button>

              {/* キャンセルボタン（編集モード時のみ） */}
              {composerMode === 'edit' && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleCancelEdit}
                  className="mt-1"
                  title="編集キャンセル"
                >
                  <X className="w-4 h-4" />
                </Button>
              )}
            </div>

            {(composerMode === 'edit' || paintSessionCommentId || draftShapes.length > 0) && (
              <div className="mt-2 text-xs text-gray-500 flex items-center gap-2">
                <Badge className="bg-green-600 text-white">
                  {composerMode === 'edit' ? 'コメント編集中' : paintSessionCommentId ? 'コメントに追記中' : '新規作成中'}
                </Badge>
                <span>
                  {composerMode === 'edit' ? '保存して更新' : 'コメントを入力してください。'}
                </span>
                {draftShapes.length > 0 && (
                  <Badge variant="secondary">{draftShapes.length}個の描画</Badge>
                )}
              </div>
            )}
          </div>
        </div>
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