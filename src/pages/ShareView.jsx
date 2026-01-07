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
  Trash2
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
  const [composerText, setComposerText] = useState('');
  const [autoCommentCreating, setAutoCommentCreating] = useState(false);
  const [showAllPaint, setShowAllPaint] = useState(false);
  const [isDockOpen, setIsDockOpen] = useState(false);
  const viewerCanvasRef = useRef(null);
  const queryClient = useQueryClient();
  const didInitActiveRef = useRef(false);
  const lockedCommentIdRef = useRef(null); // CRITICAL: 保存先を固定

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

  // ペイントモードON時に下書きコメント自動作成
  const handlePaintModeChange = async (mode) => {
    if (!mode) {
      setPaintMode(false);
      return;
    }

    // 既にロック済みなら即座にON
    if (lockedCommentIdRef.current) {
      setPaintMode(true);
      return;
    }

    if (!guestName.trim()) {
      setShowNameDialog(true);
      return;
    }

    if (autoCommentCreating) return;
    setAutoCommentCreating(true);

    try {
      const anchor_nx = 0.5;
      const anchor_ny = 0.5;

      const existingComments = await base44.entities.ReviewComment.filter({ 
        file_id: shareLink.file_id,
        share_token: token 
      });
      const maxSeqNo = existingComments.reduce((max, c) => Math.max(max, c.seq_no || 0), 0);

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
        body: '',
        resolved: false,
        has_paint: false,
      });

      queryClient.invalidateQueries({ queryKey: ['sharedComments', shareLink.file_id, token] });
      setActiveCommentId(comment.id);
      lockedCommentIdRef.current = comment.id;
      setComposerText('');
      setAutoCommentCreating(false);
      setPaintMode(true);
      setIsDockOpen(true);
      
      if (DEBUG_MODE) {
        console.log('[ShareView] Created draft comment:', comment.id);
      }
    } catch (error) {
      console.error('[ShareView] Draft comment creation failed:', error);
      showToast(`コメント作成失敗: ${error.message}`, 'error');
      setAutoCommentCreating(false);
    }
  };

  // 描画開始時の処理（lockedCommentIdがない場合のみ自動作成）
  const handleBeginPaint = async (startX, startY, bgWidth, bgHeight) => {
    if (lockedCommentIdRef.current) return; // 既にロック済み
    if (autoCommentCreating) return;

    if (!guestName.trim()) {
      setShowNameDialog(true);
      setPaintMode(false);
      return;
    }

    setAutoCommentCreating(true);

    try {
      const anchor_nx = startX / bgWidth;
      const anchor_ny = startY / bgHeight;

      const existingComments = await base44.entities.ReviewComment.filter({ 
        file_id: shareLink.file_id,
        share_token: token 
      });
      const maxSeqNo = existingComments.reduce((max, c) => Math.max(max, c.seq_no || 0), 0);

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
        body: '',
        resolved: false,
        has_paint: false,
      });

      queryClient.invalidateQueries({ queryKey: ['sharedComments', shareLink.file_id, token] });
      setActiveCommentId(comment.id);
      lockedCommentIdRef.current = comment.id;
      setAutoCommentCreating(false);
      
      if (DEBUG_MODE) {
        console.log('[ShareView] Auto-created comment:', comment.id);
      }
    } catch (error) {
      console.error('[ShareView] Auto comment creation failed:', error);
      showToast(`コメント作成失敗: ${error.message}`, 'error');
      setAutoCommentCreating(false);
      setPaintMode(false);
    }
  };

  // lastActiveCommentId の復元（初回ロード時のみ、1回だけ実行）
  useEffect(() => {
    if (!token || !shareLink?.file_id || !comments.length) return;
    
    // CRITICAL: 初回のみ復元（ユーザー操作で activeCommentId=null にした場合は復元しない）
    if (didInitActiveRef.current) return;

    // URL params で comment 指定があれば優先
    const params = new URLSearchParams(window.location.search);
    const commentIdFromUrl = params.get('comment');
    
    if (commentIdFromUrl && comments.find(c => c.id === commentIdFromUrl)) {
      const targetComment = comments.find(c => c.id === commentIdFromUrl);
      setCurrentPage(targetComment.page_no);
      setActiveCommentId(commentIdFromUrl);
      didInitActiveRef.current = true;
      return;
    }

    // URL指定がない場合は localStorage から復元
    const key = `lastActiveCommentId:${token}:${shareLink.file_id}:${currentPage}`;
    const saved = localStorage.getItem(key);

    if (saved && comments.find(c => c.id === saved)) {
      const savedComment = comments.find(c => c.id === saved);
      setCurrentPage(savedComment.page_no);
      setActiveCommentId(saved);
    } else if (comments.length > 0) {
      // 無ければ最新コメント（seq_no最大）を開く
      const latest = comments.reduce((max, c) => 
        (c.seq_no || 0) > (max.seq_no || 0) ? c : max
      , comments[0]);
      setCurrentPage(latest.page_no);
      setActiveCommentId(latest.id);
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
    
    // CRITICAL: lockedCommentIdRefが無い場合は保存しない
    // （自動作成中なら待つ）
    if (!lockedCommentIdRef.current) {
      if (autoCommentCreating) {
        console.log('[ShareView] Waiting for auto comment creation...');
        // 最大3秒待つ
        for (let i = 0; i < 30; i++) {
          await new Promise(resolve => setTimeout(resolve, 100));
          if (lockedCommentIdRef.current) break;
        }
        if (!lockedCommentIdRef.current) {
          const msg = 'コメント作成が完了しませんでした';
          showToast(msg, 'error');
          throw new Error(msg);
        }
      } else {
        const msg = 'comment_idが必要です';
        console.error('[ShareView]', msg);
        throw new Error(msg);
      }
    }
    
    try {
      const shapeData = {
        file_id: shareLink.file_id,
        share_token: token,
        comment_id: lockedCommentIdRef.current, // CRITICAL: ロックされたIDを使用
        page_no: currentPage,
        client_shape_id: shape.id,
        shape_type: shape.tool,
        data_json: JSON.stringify(shape),
        author_key: guestId,
        author_name: guestName || 'Guest',
      };
      
      if (DEBUG_MODE) {
        console.log('[ShareView] Saving shape:', { mode, clientShapeId: shape.id, dbId: shape.dbId });
      }
      
      let result;
      
      // CRITICAL: dbIdがあれば必ずupdate、無ければcreate（増殖防止）
      if (shape.dbId) {
        try {
          result = await base44.entities.PaintShape.update(shape.dbId, shapeData);
          if (DEBUG_MODE) console.log('[ShareView] Updated existing shape:', shape.dbId);
        } catch (err) {
          // update失敗時のみcreate（極めて稀）
          if (err.message?.includes('not found') || err.message?.includes('Not Found')) {
            console.warn('[ShareView] Update failed (not found), creating:', shape.dbId);
            result = await base44.entities.PaintShape.create(shapeData);
          } else {
            throw err;
          }
        }
      } else {
        // dbId無し → 新規作成
        result = await base44.entities.PaintShape.create(shapeData);
        if (DEBUG_MODE) console.log('[ShareView] Created new shape:', result.id);
      }

      await queryClient.invalidateQueries({ queryKey: ['paintShapes', token, shareLink?.file_id, currentPage] });

      // CRITICAL: dbIdを返して呼び出し側で保存させる
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
    if (!isReady || !lockedCommentIdRef.current) return;
    
    if (!window.confirm('このコメントの自分の描画を全て削除しますか？')) {
      return;
    }
    
    try {
      // lockedCommentIdに紐づく自分のshapesを全削除
      const shapesToDelete = paintShapes.filter(s => 
        s.comment_id === lockedCommentIdRef.current && 
        s.author_key === guestId
      );
      
      for (const shape of shapesToDelete) {
        await base44.entities.PaintShape.delete(shape.id);
      }

      await queryClient.invalidateQueries({ queryKey: ['paintShapes', token, shareLink?.file_id, currentPage] });
      
      // ViewerCanvasをクリア
      if (viewerCanvasRef.current?.clear) {
        viewerCanvasRef.current.clear();
      }
      
      showToast(`${shapesToDelete.length}個の描画を削除しました`, 'success');
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
        body: data.body,
        resolved: false,
        has_paint: false,
      });

      return comment;
    },
    onSuccess: (comment) => {
      queryClient.invalidateQueries({ queryKey: ['sharedComments', shareLink.file_id, token] });
      setComposerText('');
      setCurrentPage(comment.page_no);
      setActiveCommentId(comment.id);
      lockedCommentIdRef.current = null;
      setIsDockOpen(false);
      showToast('コメントを作成しました', 'success');
    },
    onError: (error) => {
      showToast(`送信失敗: ${error.message}`, 'error');
    },
  });

  const handleSendComment = async () => {
    if (!guestName.trim()) {
      setShowNameDialog(true);
      return;
    }

    // 本文と描画の両方が無い場合のみエラー
    const hasText = composerText.trim().length > 0;
    const hasShapes = lockedCommentIdRef.current 
      ? paintShapes.filter(s => s.comment_id === lockedCommentIdRef.current).length > 0
      : false;

    if (!hasText && !hasShapes) {
      showToast('本文か描画を追加してください', 'error');
      return;
    }

    if (lockedCommentIdRef.current) {
      // 下書きコメントを更新
      try {
        await base44.entities.ReviewComment.update(lockedCommentIdRef.current, { body: composerText });
        queryClient.invalidateQueries({ queryKey: ['sharedComments', shareLink.file_id, token] });
        setComposerText('');
        lockedCommentIdRef.current = null;
        setActiveCommentId(null);
        setPaintMode(false);
        setIsDockOpen(false);
        showToast('コメントを送信しました', 'success');
      } catch (error) {
        showToast(`送信失敗: ${error.message}`, 'error');
      }
    } else {
      // フォールバック：新規作成
      createCommentMutation.mutate({
        anchor_nx: 0.5,
        anchor_ny: 0.5,
        body: composerText,
      });
    }
  };

  // コメント編集開始
  const handleStartEditComment = (comment) => {
    if (paintMode || isDockOpen) {
      if (!window.confirm('編集中の内容が失われますが、よろしいですか？')) {
        return;
      }
    }
    
    setActiveCommentId(comment.id);
    setCurrentPage(comment.page_no);
    lockedCommentIdRef.current = comment.id;
    setComposerText(comment.body || '');
    setPaintMode(false);
    setIsDockOpen(true);
  };

  // ドックを閉じる
  const handleCloseDock = async () => {
    if (lockedCommentIdRef.current) {
      // 本文も描画もない場合は下書きを削除
      const shapes = paintShapes.filter(s => s.comment_id === lockedCommentIdRef.current);
      if (!composerText.trim() && shapes.length === 0) {
        try {
          await base44.entities.ReviewComment.delete(lockedCommentIdRef.current);
          queryClient.invalidateQueries({ queryKey: ['sharedComments', shareLink.file_id, token] });
        } catch (error) {
          console.error('Failed to delete draft comment:', error);
        }
      }
    }
    
    setComposerText('');
    lockedCommentIdRef.current = null;
    setActiveCommentId(null);
    setPaintMode(false);
    setIsDockOpen(false);
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



  // PaintShapeをViewerCanvas用の形式に変換（全ペイント表示対応）
  const existingShapes = React.useMemo(() => {
    if (!isReady || !paintShapes) {
      return [];
    }

    // CRITICAL: フィルタロジック明確化
    // - showAllPaint=true: 全shapes表示（currentPageの全コメントのshape）
    // - showAllPaint=false: lockedCommentIdのshapesのみ表示（未選択なら空配列）
    const targetCommentId = lockedCommentIdRef.current || activeCommentId;
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

    if (DEBUG_MODE) {
      console.log('[ShareView] existingShapes:', {
        total: paintShapes.length,
        filtered: result.length,
        showAllPaint,
        lockedCommentId: lockedCommentIdRef.current,
        activeCommentId,
      });
    }

    return result;
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
    if (commentFilter === 'resolved') return c.resolved;
    if (commentFilter === 'unresolved') return !c.resolved;
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
              key={`${token}:${shareLink?.file_id}:${currentPage}:${showAllPaint ? 'all' : (lockedCommentIdRef.current || activeCommentId || 'none')}`}
              ref={viewerCanvasRef}
              fileUrl={file?.file_url}
              mimeType={file?.mime_type}
              pageNumber={currentPage}
              existingShapes={existingShapes}
              comments={comments.filter(c => c.page_no === currentPage)}
              activeCommentId={activeCommentId}
              onCommentClick={(id) => {
                if (id === activeCommentId) {
                  setActiveCommentId(null);
                } else {
                  const comment = comments.find(c => c.id === id);
                  if (comment) {
                    setCurrentPage(comment.page_no);
                    setActiveCommentId(id);
                  }
                }
              }}
              onBeginPaint={handleBeginPaint}
              onSaveShape={handleSaveShape}
              onDeleteShape={handleDeleteShape}
              paintMode={isReady && paintMode}
              tool={tool}
              onToolChange={setTool}
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
                  const isActive = activeCommentId === comment.id;
                  const isLocked = lockedCommentIdRef.current === comment.id;

                  return (
                    <Card 
                      key={comment.id} 
                      className={`hover:shadow-md transition-shadow ${isActive ? 'border-2 border-blue-600 bg-blue-50' : ''} ${isLocked ? 'ring-2 ring-green-500' : ''}`}
                    >
                      <CardContent className="p-3">
                        <div className="flex items-start gap-2">
                          <div 
                            className="flex-1 cursor-pointer" 
                            onClick={() => {
                              if (paintMode || isDockOpen) {
                                showToast('編集中は他のコメントを選択できません', 'info');
                                return;
                              }

                              if (isActive) {
                                setActiveCommentId(null);
                              } else {
                                setCurrentPage(comment.page_no);
                                setActiveCommentId(comment.id);
                              }
                            }}
                          >
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
                              {isLocked && (
                                <Badge className="text-xs bg-green-600">編集中</Badge>
                              )}
                            </div>

                            <p className="text-sm text-gray-700">{comment.body || '（本文なし）'}</p>
                            <div className="flex items-center gap-2 mt-2 text-xs text-gray-500">
                              <span>{comment.page_no}枚目</span>
                              <span>•</span>
                              <span>{format(new Date(comment.created_date), 'yyyy/MM/dd HH:mm', { locale: ja })}</span>
                            </div>
                          </div>

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
            onComplete={() => setPaintMode(false)}
            onResetView={() => setZoom(100)}
            showBoundingBoxes={showBoundingBoxes}
            onToggleBoundingBoxes={DEBUG_MODE ? () => setShowBoundingBoxes(!showBoundingBoxes) : undefined}
            showAllPaint={showAllPaint}
            onToggleShowAllPaint={() => setShowAllPaint(!showAllPaint)}
            hasActiveComment={!!lockedCommentIdRef.current}
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
                disabled={autoCommentCreating}
              >
                <Paintbrush className="w-4 h-4 mr-1" />
                {paintMode ? 'ペイント中' : 'ペイント'}
              </Button>

              {/* 本文入力 */}
              <Textarea
                placeholder="コメントを入力（描画のみでもOK）"
                value={composerText}
                onChange={(e) => setComposerText(e.target.value)}
                onFocus={() => setIsDockOpen(true)}
                rows={2}
                className="flex-1 text-sm resize-none"
              />

              {/* 送信ボタン */}
              <Button
                onClick={handleSendComment}
                className="bg-blue-600 hover:bg-blue-700 mt-1"
                size="sm"
              >
                <Send className="w-4 h-4" />
              </Button>

              {/* 閉じるボタン（編集中のみ） */}
              {(isDockOpen || lockedCommentIdRef.current) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleCloseDock}
                  className="mt-1"
                >
                  <X className="w-4 h-4" />
                </Button>
              )}
            </div>

            {lockedCommentIdRef.current && (
              <div className="mt-2 text-xs text-gray-500 flex items-center gap-2">
                <Badge className="bg-green-600 text-white">編集中</Badge>
                <span>本文または描画を追加して送信できます</span>
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