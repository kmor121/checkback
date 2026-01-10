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
  Circle as CircleIcon,
  Reply
} from 'lucide-react';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import ViewerCanvas from '../components/viewer/ViewerCanvas';
import FloatingToolbar from '../components/viewer/FloatingToolbar';
import ErrorBoundary from '../components/ErrorBoundary';
import DebugOverlay from '../components/DebugOverlay';
import {
  getDraftKey,
  generateTempCommentId,
  saveDraft,
  loadDraft,
  deleteDraft,
  cleanupExpiredDrafts,
} from '../components/utils/draftPaintStorage';

// CRITICAL: ShareViewは認証不要の公開ページ
// Base44の仕様上、アプリ全体をPublicにするか、このページを完全に独立させる必要がある
// このコンポーネントは認証API(base44.auth.me等)を一切呼ばない

const DEBUG_MODE = import.meta.env.VITE_DEBUG === 'true';

// ★★★ CRITICAL: SSR安全なUUID生成（crypto.randomUUID代替）★★★
const safeUUID = () => {
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}_${Math.random().toString(36).slice(2)}`;
};

// ★★★ CRITICAL: commentId解決ユーティリティ（キー揺れ完全吸収、入れ子対応）★★★
const resolveCommentId = (s) => {
  const v = s?.comment_id ?? s?.commentId ?? s?.commentID ?? 
            s?.comment?.id ?? 
            s?.data?.comment_id ?? s?.data?.commentId ?? s?.data?.commentID ??
            s?.shape?.comment_id ?? s?.shape?.commentId ?? s?.shape?.commentID;
  return v == null ? null : String(v);
};

// ★★★ CRITICAL: shape正規化（入れ子を平坦化、comment_id を canonical 化）★★★
// defaultCommentId: shapeにcomment_idが無い場合のみ使用（既存値は上書きしない）
const normalizeShape = (s, defaultCommentId = null) => {
  if (!s) return null;
  
  // 入れ子を平坦化
  const base = s.data ? { ...s, ...s.data } : (s.shape ? { ...s, ...s.shape } : s);
  
  // comment_id を canonical 化
  let commentId = resolveCommentId(base);
  
  // ★ CRITICAL: 既存comment_idがある場合は保持、無い場合のみdefaultを使用
  if (commentId == null || commentId === '') {
    commentId = defaultCommentId != null ? String(defaultCommentId) : null;
  }
  
  return {
    ...base,
    comment_id: commentId,
    id: base.id || base.client_shape_id || safeUUID(),
  };
};

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
  
  // ★★★ P2: 明示クリア用トークン（全削除/送信成功後のみインクリメント）★★★
  const [forceClearToken, setForceClearToken] = useState(0);
  
  // ★★★ 新規コメント用の仮ID（localStorage下書き用）★★★
  const [tempCommentId, setTempCommentId] = useState(null);
  const saveDraftTimeoutRef = useRef(null);
  
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
  
  // ★★★ CRITICAL: SSRガード（window未定義時は空params）★★★
  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
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

  // ★★★ 初期化時に期限切れ下書きをクリーンアップ ★★★
  useEffect(() => {
    cleanupExpiredDrafts();
  }, []);

  // ★★★ P1: 下書き復元トリガー（初回ロード & targetKey変更時）★★★
  // ★★★ CRITICAL FIX: tempCommentIdを同期的に確定（レース根絶）★★★
  useEffect(() => {
    if (!shareLink?.file_id) return;
    
    // ★★★ CRITICAL: 復元 or 即座に生成（どちらかを必ず実行）★★★
    const savedTempId = localStorage.getItem(`tempCommentId:${shareLink.file_id}`);
    if (savedTempId) {
      setTempCommentId(savedTempId);
      console.log('[ShareView] ✓ Restored tempCommentId:', {
        scopeId: shareLink.file_id.substring(0, 12),
        tempCommentId: savedTempId.substring(0, 12),
      });
    } else {
      // ★★★ CRITICAL: 無ければ即座に生成（描画開始前に必ず確定）★★★
      const newTempId = generateTempCommentId();
      setTempCommentId(newTempId);
      localStorage.setItem(`tempCommentId:${shareLink.file_id}`, newTempId);
      console.log('[ShareView] ✓ Generated new tempCommentId:', {
        scopeId: shareLink.file_id.substring(0, 12),
        tempCommentId: newTempId.substring(0, 12),
      });
    }
  }, [shareLink?.file_id]);

  // ★★★ tempCommentIdの永続化 ★★★
  useEffect(() => {
    if (!shareLink?.file_id || !tempCommentId) return;
    localStorage.setItem(`tempCommentId:${shareLink.file_id}`, tempCommentId);
    console.log('[ShareView] Saved tempCommentId to localStorage:', tempCommentId);
  }, [shareLink?.file_id, tempCommentId]);

  // ★★★ P1: targetKey を useMemo で安定計算（paintMode依存なし）★★★
  const targetKey = React.useMemo(() => {
    if (!shareLink?.file_id) return null;
    
    // 編集モード：既存commentId
    // 新規モード：tempCommentId
    const targetCommentId = composerMode === 'edit' ? composerTargetCommentId : null;
    const effectiveTempId = targetCommentId ? null : tempCommentId;
    
    return getDraftKey(shareLink.file_id, targetCommentId, effectiveTempId);
  }, [shareLink?.file_id, composerMode, composerTargetCommentId, tempCommentId]);

  // ★★★ CRITICAL FIX: hydratedKeyRef を string ref に変更（targetKey追跡用）★★★
  const hydratedKeyRef = useRef(null);
  
  useEffect(() => {
    // ★★★ CRITICAL: targetKey未確定時はスキップ（完了扱いにしない）★★★
    if (!targetKey) {
      console.log('[draft] hydrate skipped: no targetKey yet', { 
        targetKey, 
        scopeId: shareLink?.file_id?.substring(0, 12) || 'null',
        tempCommentId: tempCommentId?.substring(0, 12) || 'null',
      });
      return;
    }
    
    // ★★★ CRITICAL: 同一キーの二重hydrate防止 ★★★
    if (hydratedKeyRef.current === targetKey) return;
    
    console.log('[draft] hydrate start:', { 
      targetKey: targetKey.substring(0, 30),
      scopeId: shareLink?.file_id?.substring(0, 12),
      tempCommentId: tempCommentId?.substring(0, 12) || 'null',
    });
    
    const draft = loadDraft(targetKey);
    const shapes = draft?.shapes || [];
    
    // ★★★ CRITICAL: 復元直後に normalizeShape で完全正規化（defaultにtempCommentId使用）★★★
    const normalizedShapes = shapes.map(s => normalizeShape(s, tempCommentId)).filter(Boolean);
    
    draftShapesRef.current = normalizedShapes;
    setDraftShapes(normalizedShapes);
    
    // ★★★ CRITICAL: hydrate完了後にキーを記録 ★★★
    hydratedKeyRef.current = targetKey;
    
    console.log('[draft] hydrate end:', {
      targetKey: targetKey.substring(0, 30),
      loadedCount: normalizedShapes.length,
      savedAt: draft?.updatedAt,
      scopeId: shareLink?.file_id?.substring(0, 12),
      tempCommentId: tempCommentId?.substring(0, 12) || 'null',
    });
    
    if (shapes.length > 0) {
      showToast(`${shapes.length}個の下書きを復元しました`, 'info');
    }
  }, [targetKey, shareLink?.file_id, tempCommentId]);

  // ★★★ P3: draftShapes 変更時に自動保存（debounce付き）★★★
  // ★★★ FIX: 空になっただけでdeleteDraftしない、didHydrateDraftRefでガード ★★★
  useEffect(() => {
    if (!targetKey) return;
    
    // ★★★ CRITICAL FIX: この targetKey を hydrate 済みの時だけ autosave ★★★
    if (hydratedKeyRef.current !== targetKey) {
      console.log('[draft] autosave SKIPPED (not hydrated for this key yet):', { 
        targetKey: targetKey.substring(0, 30),
        hydratedKey: hydratedKeyRef.current?.substring(0, 30) || 'null',
      });
      return;
    }
    
    // ★★★ FIX: 空になっただけでは削除しない（明示操作時のみ削除）★★★
    if (draftShapes.length === 0) {
      console.log('[draft] autosave SKIPPED (empty, but not deleting):', { targetKey });
      return;
    }
    
    // debounce保存
    if (saveDraftTimeoutRef.current) {
      clearTimeout(saveDraftTimeoutRef.current);
    }
    
    saveDraftTimeoutRef.current = setTimeout(() => {
      saveDraft(targetKey, draftShapes, { pageNo: currentPage });
      console.log('[draft] autosave fired:', { targetKey, shapesCount: draftShapes.length });
    }, 500);
    
    return () => {
      if (saveDraftTimeoutRef.current) {
        clearTimeout(saveDraftTimeoutRef.current);
      }
    };
  }, [targetKey, draftShapes, currentPage]);

  // ★★★ デバッグHUD用の情報 ★★★
  const [draftDebugInfo, setDraftDebugInfo] = useState({ targetKey: null, loadedCount: 0, renderedCount: 0, savedAt: null, loadDraftFound: false });
  
  useEffect(() => {
    const draft = targetKey ? loadDraft(targetKey) : null;
    
    setDraftDebugInfo({
      targetKey: targetKey,
      loadedCount: draft?.shapes?.length || 0,
      renderedCount: draftShapes.length,
      savedAt: draft?.updatedAt || null,
      loadDraftFound: !!draft,
    });
  }, [targetKey, draftShapes.length]);

  // ★★★ 下書き保存関数（debounce付き）- 後方互換用、実際はuseEffectで自動保存 ★★★
  const saveDraftDebounced = React.useCallback((shapes, commentId, tempId) => {
    // ★★★ P3で自動保存されるため、ここでは何もしない ★★★
    // （後方互換のため関数は残す）
    console.log('[ShareView] saveDraftDebounced called (noop, auto-save handles this)');
  }, []);

  // ★★★ 下書き復元関数（後方互換用）★★★
  const restoreDraft = React.useCallback((commentId, tempId) => {
    if (!shareLink?.file_id) return [];
    
    const key = getDraftKey(shareLink.file_id, commentId, tempId);
    const draft = loadDraft(key);
    
    if (draft?.shapes && draft.shapes.length > 0) {
      console.log('[ShareView] Restoring draft:', key, 'shapes:', draft.shapes.length);
      return draft.shapes;
    }
    return [];
  }, [shareLink?.file_id]);

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

    // 対応済みコメントのチェック
    if (isEditSession) {
      const targetComment = comments.find(c => c.id === composerTargetCommentId);
      if (targetComment?.resolved) {
        showToast('対応済みのコメントは編集できません', 'info');
        return;
      }
    }
    
    if (activeCommentId) {
      const activeComment = comments.find(c => c.id === activeCommentId);
      if (activeComment?.resolved) {
        showToast('対応済みのコメントは編集できません', 'info');
        return;
      }
    }

    if (isEditSession) {
      // 既存コメント編集時：対応済みかどうか確認
      const editingComment = comments.find(c => c.id === composerTargetCommentId);
      if (editingComment?.resolved) {
        showToast('対応済みのコメントはペイント編集できません（未対応に戻すと編集できます）', 'error');
        return;
      }

      // 既存コメント編集: そのコメントの描画を表示・編集可能
      setPaintSessionCommentId(composerTargetCommentId);
      setActiveCommentId(composerTargetCommentId);
      
      // ★★★ 下書き復元はtargetKey変更時のuseEffectで自動実行される ★★★
      // （composerMode='edit' & composerTargetCommentId設定 → targetKey変更 → 自動復元）
    } else {
      // 新規作成: 既存コメント描画は非表示・編集不可
      setActiveCommentId(null);
      setPaintSessionCommentId(null);
      
      // ★★★ CRITICAL: tempCommentIdは既にuseEffectで確定済み（ここでは生成しない）★★★
      // もし未確定なら描画を許可しない（レース防止）
      if (!tempCommentId) {
        console.warn('[ShareView] tempCommentId not ready yet, cannot start paint');
        return;
      }
      
      setComposerMode('new');
      setComposerTargetCommentId(null);
      setShowAllPaint(false);
      viewerCanvasRef.current?.clear();
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



  // ★★★ CRITICAL: 描画確定時はDB保存せず、localStorageのみに保存 ★★★
  const handleSaveShape = async (shape, mode) => {
    if (!isReady) {
      console.warn('[ShareView] Not ready yet, save aborted');
      return;
    }
    
    // ★★★ CRITICAL: tempCommentIdが無ければ描画を保存しない（レース防止）★★★
    if (!activeCommentId && !tempCommentId) {
      console.error('[ShareView] handleSaveShape: tempCommentId not ready, aborting save');
      return;
    }
    
    // ★★★ P2 FIX: 必ずユニークIDを確保（functional update で追記）★★★
    const shapeWithId = {
      ...shape,
      id: shape.id || crypto.randomUUID(),
    };
    
    // ★★★ CRITICAL: comment_idは必ずtempCommentId（新規時）またはactiveCommentId（編集時）★★★
    const effectiveDraftCommentId = activeCommentId || tempCommentId;
    if (!effectiveDraftCommentId) {
      console.error('[ShareView] handleSaveShape: no valid commentId available');
      return;
    }
    
    // ★★★ CRITICAL: comment_id を正規化して保存（キー揺れ防止）★★★
    const shapeWithDirty = { 
      ...shapeWithId, 
      comment_id: String(effectiveDraftCommentId),
      commentId: String(effectiveDraftCommentId),  // 念のため両方
      _dirty: true, 
      _localTs: Date.now() 
    };
    
    // ★★★ DEBUG: 保存する shape の comment_id を必ず出力 ★★★
    console.log('[ShareView] handleSaveShape:', {
      shapeId: shapeWithId.id.substring(0, 8),
      mode,
      tempCommentId: tempCommentId?.substring(0, 12) || 'null',
      activeCommentId: activeCommentId?.substring(0, 12) || 'null',
      effectiveDraftCommentId: effectiveDraftCommentId.substring(0, 12),
      'shape.comment_id': shapeWithDirty.comment_id.substring(0, 12),
    });
    
    setDraftShapes(prev => {
      if (mode === 'create') {
        // 同じIDが既に存在する場合は追記しない（重複防止）
        if (prev.some(s => s.id === shapeWithDirty.id)) {
          return prev;
        }
        const next = [...prev, shapeWithDirty];
        draftShapesRef.current = next;
        return next;
      } else {
        // update mode: 既存shapeを置き換え
        const next = prev.map(s => (s.id === shapeWithDirty.id ? shapeWithDirty : s));
        draftShapesRef.current = next;
        return next;
      }
    });
    
    console.log('[ShareView] Shape saved to draft (NOT DB):', {
      shapeId: shapeWithId.id,
      mode,
      targetKey,
      effectiveDraftCommentId,
      totalDraftCount: draftShapesRef.current.length,
    });
    
    return { draft: true };
  };

  // ★★★ CRITICAL: 削除もDB操作せず、localStorageのみ ★★★
  const handleDeleteShape = async (shape) => {
    if (!isReady) {
      console.warn('[ShareView] Not ready yet, delete aborted');
      return;
    }
    
    // P2 FIX: functional update でメモリから削除
    setDraftShapes(prev => {
      const next = prev.filter(s => s.id !== shape.id);
      draftShapesRef.current = next;
      return next;
    });
    
    console.log('[ShareView] Shape deleted from draft (NOT DB):', {
      shapeId: shape.id,
      targetKey,
      remainingDraftCount: draftShapesRef.current.length,
    });
  };

  // ★★★ CRITICAL: 全削除処理（下書きのみクリア、DBは送信時まで触らない）★★★
  const handleClearAll = async () => {
    console.log('[draft] delete reason: clearAll');
    console.log('[handleClearAll] ========== CLEAR ALL START ==========');
    console.log('[handleClearAll] draftShapesCount:', draftShapesRef.current.length);
    console.log('[handleClearAll] targetKey:', targetKey);
    
    const draftCount = draftShapesRef.current.length;
    
    // ★★★ 1. メモリから全削除 ★★★
    draftShapesRef.current = [];
    setDraftShapes([]);
    
    // ★★★ 2. localStorageから明示的に削除（FIX: autosaveでは消えないので手動削除）★★★
    if (targetKey) {
      deleteDraft(targetKey);
      console.log('[draft] deleteDraft called (clearAll):', targetKey);
    }
    
    // ★★★ 3. ViewerCanvasもクリア（明示クリアトークンをインクリメント）★★★
    setForceClearToken(prev => prev + 1);
    viewerCanvasRef.current?.clear();
    
    console.log('[handleClearAll] ========== CLEAR ALL COMPLETE ==========');
    console.log('[handleClearAll] deletedCount:', draftCount);
    
    showToast(`${draftCount}個の描画をクリアしました`, 'success');
  };



  // CRITICAL: 送信ロック用ref（ShareView用）
  const submitLockRef = useRef(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSendComment = async () => {
    // CRITICAL: 同期的なロックチェック（最優先）
    if (submitLockRef.current === true) {
      console.log("[ShareView submit] BLOCKED by submitLockRef");
      return;
    }
    if (isSubmitting === true) {
      console.log("[ShareView submit] BLOCKED by isSubmitting");
      return;
    }

    if (!guestName.trim()) {
      setShowNameDialog(true);
      return;
    }

    const hasText = composerText.trim().length > 0;
    
    if (!hasText) {
      showToast('コメント本文を入力してください（描画だけでは送信できません）', 'error');
      return;
    }

    // 対応済みコメントの編集/返信チェック
    if (composerMode === 'edit' && composerTargetCommentId) {
      const targetComment = comments.find(c => c.id === composerTargetCommentId);
      if (targetComment?.resolved) {
        showToast('対応済みのコメントは編集できません', 'error');
        return;
      }
    }
    
    if (composerMode === 'reply' && composerParentCommentId) {
      const parentComment = comments.find(c => c.id === composerParentCommentId);
      if (parentComment?.resolved) {
        showToast('対応済みのコメントには返信できません', 'error');
        return;
      }
    }

    // ★★★ CRITICAL: ここで即座にロック ★★★
    submitLockRef.current = true;
    setIsSubmitting(true);
    console.log("[ShareView submit] === LOCK ACQUIRED ===", new Date().toISOString());

    const shapesToCommit = draftShapesRef.current || [];
    const hasDraftShapes = shapesToCommit.length > 0;
    const hasFiles = pendingFiles.length > 0;

    try {
      if (composerMode === 'edit' && composerTargetCommentId) {
        // 編集モード: 既存コメントを更新
        await base44.entities.ReviewComment.update(composerTargetCommentId, {
          body: composerText,
        });
        
        // ★★★ 編集モードでも下書きshapesをDBに保存 ★★★
        if (shapesToCommit.length > 0) {
          console.log('[ShareView] Saving draft shapes to DB (edit mode):', shapesToCommit.length);
          for (const shape of shapesToCommit) {
            await base44.entities.PaintShape.create({
              file_id: shareLink.file_id,
              share_token: token,
              comment_id: composerTargetCommentId,
              page_no: currentPage,
              client_shape_id: shape.id,
              shape_type: shape.tool,
              data_json: JSON.stringify(shape),
              author_key: guestId,
              author_name: guestName,
            });
          }
        }
        
        // ★★★ 送信成功後にlocalStorageの下書きを削除（targetKeyを使用）★★★
        if (targetKey) {
          console.log('[draft] delete reason: submit (edit)');
          deleteDraft(targetKey);
          console.log('[ShareView] Deleted edit draft after submit:', targetKey);
        }
        
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

        // ★★★ CRITICAL: 送信時にのみDraftShapesをDBに保存 ★★★
        if (shapesToCommit.length > 0) {
          console.log('[ShareView] Saving draft shapes to DB:', shapesToCommit.length);
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
        
        // ★★★ 送信成功後にlocalStorageの下書きを削除（targetKeyを使用）★★★
        if (targetKey) {
          console.log('[draft] delete reason: submit (new)');
          deleteDraft(targetKey);
          console.log('[ShareView] Deleted draft after submit:', targetKey);
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

      // ★★★ CRITICAL: 描画クリアを最優先で実行（明示クリアトークンをインクリメント）★★★
      setForceClearToken(prev => prev + 1);
      viewerCanvasRef.current?.afterSubmitClear();
      viewerCanvasRef.current?.clear();
      
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
      
      // ★★★ 仮IDもリセット（次の新規コメント用に新しいIDを発行させる）★★★
      setTempCommentId(null);
      // localStorageからも削除
      if (shareLink?.file_id) {
        localStorage.removeItem(`tempCommentId:${shareLink.file_id}`);
      }
      
      // invalidateは少し遅らせて描画クリアを確実に先に完了させる
      setTimeout(async () => {
        await queryClient.invalidateQueries({ queryKey: ['sharedComments', shareLink.file_id, token] });
        await queryClient.invalidateQueries({ queryKey: ['commentAttachments', shareLink.file_id, token] });
        await queryClient.invalidateQueries({ queryKey: ['paintShapes', token, shareLink?.file_id, currentPage] });
      }, 100);
    } catch (error) {
      showToast(`送信失敗: ${error.message}`, 'error');
    } finally {
      // ★★★ CRITICAL: 成功/失敗に関わらず必ずロック解除 ★★★
      console.log("[ShareView submit] === LOCK RELEASED ===", new Date().toISOString());
      submitLockRef.current = false;
      setIsSubmitting(false);
    }
  };

  const selectComment = (comment) => {
    if (paintMode) {
      showToast('ペイントを終了してから選択してください', 'info');
      return;
    }

    // 対応済みチェック
    if (comment.resolved) {
      showToast('対応済みのコメントは編集できません', 'info');
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
      setPaintMode(false); // CRITICAL: ペイントも強制OFF
      setTool('select');
      return;
    }

    // 別のコメントをクリック → 選択のみ（編集には入らない）
    // ★★★ CRITICAL: 前の描画セッションをクリア（他コメント編集の描画が残らないように）★★★
    if (paintMode) {
      viewerCanvasRef.current?.clear();
      setPaintMode(false);
      setTool('select');
    }
    
    setCurrentPage(comment.page_no);
    setActiveCommentId(comment.id);
    setPaintSessionCommentId(null); // CRITICAL: paintSessionをクリア
    setIsDockOpen(true);

    // クリックだけで edit にならないように必ず new に戻す
    setComposerMode('new');
    setComposerTargetCommentId(null);
    setComposerText('');
    setDraftShapes([]);
    draftShapesRef.current = [];
  };

  const enterEdit = (comment) => {
    // 対応済みコメントは編集不可
    if (comment.resolved) {
      showToast('対応済みのコメントは編集できません（未対応に戻すと編集できます）', 'error');
      return;
    }

    if (paintMode) {
      showToast('ペイントを終了してから編集してください', 'info');
      return;
    }

    // 対応済みチェック
    if (comment.resolved) {
      showToast('対応済みのコメントは編集できません', 'info');
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

  // ★★★ CRITICAL: 編集モード解除の統一関数 ★★★
  // ★★★ NOTE: 下書きはlocalStorageに残す（B案：復元可能にする）★★★
  const exitEditMode = () => {
    // ViewerCanvasの描画をクリア
    viewerCanvasRef.current?.afterSubmitClear();
    viewerCanvasRef.current?.clear();
    
    // 編集/返信モード解除
    setComposerMode('new');
    setComposerTargetCommentId(null);
    setComposerParentCommentId(null);
    
    // ★★★ CRITICAL: activeCommentIdをnullにして描画表示を消す ★★★
    setActiveCommentId(null);
    
    // ペイント関連
    setPaintMode(false);
    setTool('select');
    setPaintSessionCommentId(null);
    
    // draft/描画一時stateクリア（メモリのみ、localStorageは残す）
    setDraftShapes([]);
    draftShapesRef.current = [];
    
    // UI状態
    setComposerText('');
    setPendingFiles([]);
    setReplyingThreadId(null);
    setIsDockOpen(false);
    
    // ★★★ tempCommentIdは保持（新規コメントの下書きを復元可能にする）★★★
    // setTempCommentId(null); // 意図的にリセットしない
  };

  // 後方互換用エイリアス
  const resetEditorSession = exitEditMode;

  const handleCancelEdit = () => {
    // 編集中のコメントを取得して本文が変更されているか確認
    const editingComment = comments.find(c => c.id === composerTargetCommentId);
    const hasUnsavedChanges = editingComment && composerText.trim() !== (editingComment.body || '').trim();

    if (hasUnsavedChanges && typeof window !== 'undefined' && !window.confirm('編集内容を破棄しますか？')) {
      return;
    }

    // ★★★ CRITICAL: 統一関数を呼ぶ ★★★
    exitEditMode();
  };

  const handleStartReply = (parentComment) => {
    if (paintMode) {
      showToast('ペイントを終了してから返信してください', 'info');
      return;
    }

    // 対応済みチェック
    if (parentComment.resolved) {
      showToast('対応済みのコメントには返信できません', 'info');
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
    if (typeof window !== 'undefined' && !window.confirm('このコメントと関連する描画を削除しますか？')) {
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
    if (typeof window === 'undefined' || !navigator.clipboard) {
      showToast('コピーに失敗しました', 'error');
      return;
    }
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



  // PaintShapeをViewerCanvas用の形式に変換（CRITICAL: 親側でフィルタ）
  // ★★★ CRITICAL FIX: data_json内のcomment_id系フィールドを完全削除してから展開 ★★★
  const allShapes = React.useMemo(() => {
    if (!isReady || !paintShapes) return [];

    console.log('[ShareView] allShapes recalculating, paintShapes count:', paintShapes.length);

    const result = paintShapes.map(ps => {
      try {
        const data = JSON.parse(ps.data_json);
        
        // ★★★ CRITICAL: DBの ps.comment_id を唯一の真実（source of truth）とする ★★★
        const rawShape = {
          ...data,
          id: ps.client_shape_id || ps.id,
          dbId: ps.id,
          tool: ps.shape_type,
          comment_id: ps.comment_id,
        };
        
        // ★★★ CRITICAL: normalizeShape で正規化（defaultCommentId=null でDB値保持）★★★
        const normalized = normalizeShape(rawShape, null);
        
        // ★★★ CRITICAL: comment_idが空のshapeは除外（データ異常）★★★
        if (!normalized || !normalized.comment_id) {
          console.warn('[ShareView] Skipping shape with empty comment_id:', ps.id);
          return null;
        }
        
        return normalized;
      } catch (e) {
        console.error('[ShareView] Failed to parse shape:', e);
        return null;
      }
    }).filter(Boolean);

    // ★★★ DEBUG: 結果のcomment_id分布を確認 ★★★
    const uniqueCids = [...new Set(result.map(s => resolveCommentId(s)))].filter(Boolean);
    console.log('[ShareView] allShapes result:', {
      count: result.length,
      uniqueCommentIds: uniqueCids.slice(0, 10).map(id => id.substring(0, 12)),
    });

    return result;
  }, [paintShapes, isReady]);

  // ★★★ CRITICAL FIX: renderTargetCommentId の優先順位（選択中コメント最優先）★★★
  const renderTargetCommentId = React.useMemo(() => {
    if (showAllPaint) return null;
    // ★ CRITICAL: 選択中コメント（activeCommentId）が最優先
    if (activeCommentId != null && activeCommentId !== '') return String(activeCommentId);
    // 選択中コメントが無い時のみ tempCommentId（新規下書き）
    if (tempCommentId != null && tempCommentId !== '') return String(tempCommentId);
    return null;
  }, [showAllPaint, activeCommentId, tempCommentId]);

  // ★★★ DEBUG: renderTargetCommentId 算出ログ ★★★
  useEffect(() => {
    console.log('[ShareView] renderTargetCommentId resolved:', {
      activeCommentId: activeCommentId?.substring(0, 12) || 'null',
      tempCommentId: tempCommentId?.substring(0, 12) || 'null',
      renderTargetCommentId: renderTargetCommentId?.substring(0, 12) || 'null',
    });
  }, [renderTargetCommentId, activeCommentId, tempCommentId]);

  // ★★★ CRITICAL: canvasContextKey（コメント切替検知用）★★★
  const canvasContextKey = React.useMemo(() => {
    const fileId = shareLink?.file_id || 'no-file';
    if (showAllPaint) return `${fileId}:all`;
    return `${fileId}:cid:${renderTargetCommentId || 'none'}`;
  }, [shareLink?.file_id, showAllPaint, renderTargetCommentId]);

  // CRITICAL: 親側でフィルタリング（ViewerCanvasに渡すshapes）
  // ★★★ CRITICAL FIX: normalizeShape で正規化してからフィルタ ★★★
  const shapesForCanvas = React.useMemo(() => {
    console.log('[ShareView] shapesForCanvas calculation:', {
      renderTargetCommentId: renderTargetCommentId?.substring(0, 12) || 'null',
      showAllPaint,
      draftShapesCount: draftShapes.length,
      allShapesCount: allShapes.length,
    });
    
    // ★★★ CRITICAL: allShapes は既に正規化済み（defaultCommentId=null で DB値保持）★★★
    const allShapesNormalized = allShapes;
    
    // ★★★ CRITICAL: draftShapes を正規化（defaultCommentId=tempCommentId）★★★
    const draftShapesNormalized = draftShapes.map(s => normalizeShape(s, tempCommentId)).filter(Boolean);
    
    // ★★★ CRITICAL: showAllPaint時はDB shapes + draftShapes を全て表示 ★★★
    if (showAllPaint) {
      const draftIds = new Set(draftShapesNormalized.map(s => s.id));
      const dbShapesWithoutDuplicates = allShapesNormalized.filter(s => !draftIds.has(s.id));
      return [...dbShapesWithoutDuplicates, ...draftShapesNormalized];
    }
    
    // ★★★ CRITICAL FIX: renderTargetCommentId でフィルタ（resolveCommentId使用）★★★
    const dbShapesFiltered = renderTargetCommentId
      ? allShapesNormalized.filter(s => resolveCommentId(s) === renderTargetCommentId)
      : [];
    
    const draftShapesFiltered = renderTargetCommentId
      ? draftShapesNormalized.filter(s => resolveCommentId(s) === renderTargetCommentId)
      : draftShapesNormalized;
    
    // ★★★ CRITICAL: DB shapes + draftShapes を合流（draftが優先） ★★★
    const draftIds = new Set(draftShapesFiltered.map(s => s.id));
    const dbShapesWithoutDuplicates = dbShapesFiltered.filter(s => !draftIds.has(s.id));
    const merged = [...dbShapesWithoutDuplicates, ...draftShapesFiltered];
    
    console.log('[ShareView] shapesForCanvas result:', {
      renderTargetCommentId: renderTargetCommentId?.substring(0, 12) || 'null',
      dbFilteredCount: dbShapesFiltered.length,
      draftFilteredCount: draftShapesFiltered.length,
      mergedTotal: merged.length,
    });
    
    return merged;
  }, [allShapes, showAllPaint, renderTargetCommentId, draftShapes, tempCommentId]);

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
        if (typeof sessionStorage !== 'undefined') {
          sessionStorage.setItem(`passwordVerified_${token}`, '1');
        }
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
    {/* ★★★ デバッグHUD（下書き状態表示）★★★ */}
    {DEBUG_MODE && (
      <div className="fixed top-0 left-0 z-[9999] bg-black/90 text-green-400 text-xs font-mono p-2 max-w-sm">
        <div className="text-yellow-400 font-bold mb-1">📝 Draft Debug</div>
        <div>targetKey: <span className="text-cyan-400 break-all">{draftDebugInfo.targetKey || 'null'}</span></div>
        <div>loadDraftFound: <span className={draftDebugInfo.loadDraftFound ? 'text-green-400' : 'text-red-400'}>{draftDebugInfo.loadDraftFound ? 'true' : 'false'}</span></div>
        <div>draftLoadedCount: <span className="text-yellow-400">{draftDebugInfo.loadedCount}</span></div>
        <div>draftRenderedCount: <span className="text-yellow-400">{draftDebugInfo.renderedCount}</span></div>
        <div>draftSavedAt: <span className="text-cyan-400">{draftDebugInfo.savedAt || 'never'}</span></div>
        <div className="border-t border-gray-600 mt-1 pt-1">
          <div>composerMode: <span className="text-cyan-400">{composerMode}</span></div>
          <div>tool: <span className="text-cyan-400">{tool}</span></div>
          <div>paintMode: <span className={paintMode ? 'text-green-400' : 'text-red-400'}>{paintMode ? 'ON' : 'OFF'}</span></div>
          <div>tempCommentId: <span className="text-cyan-400">{tempCommentId?.substring(0, 12) || 'null'}</span></div>
          <div>activeCommentId: <span className="text-cyan-400">{activeCommentId?.substring(0, 12) || 'null'}</span></div>
          <div>draftShapes.length: <span className="text-yellow-400">{draftShapes.length}</span></div>
          <div>shapesForCanvas: <span className="text-yellow-400">{shapesForCanvas.length}</span></div>
        </div>
      </div>
    )}
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
                if (typeof document === 'undefined') return;
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

        {/* 中央：プレビュー（grid: 上段=素材, 下段=composer） */}
        <div className="flex-1 grid grid-rows-[1fr_auto] min-h-0">
          {/* 上段：素材表示エリア */}
          <div className="bg-gray-100 overflow-auto relative min-h-0">
            {!isReady ? (
              <div className="w-full h-full flex items-center justify-center">
                <div className="text-center">
                  <div className="animate-spin w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4"></div>
                  <div className="text-lg font-medium">準備中...</div>
                </div>
              </div>
            ) : (
              <ViewerCanvas
                key={`${token}:${shareLink?.file_id}:${currentPage}`}
                ref={viewerCanvasRef}
                fileUrl={file?.file_url}
                mimeType={file?.mime_type}
                pageNumber={currentPage}
                existingShapes={shapesForCanvas}
                comments={comments.filter(c => c.page_no === currentPage)}
                activeCommentId={activeCommentId}
                canvasContextKey={canvasContextKey}
                onCommentClick={(id) => {
                  const comment = comments.find(c => c.id === id);
                  if (!comment) return;
                  selectComment(comment);
                }}
                onShapesChange={(updated) => {
                  // ★★★ CRITICAL: ViewerCanvasからの同期コールバック ★★★
                  // ★★★ CRITICAL FIX: この targetKey を hydrate 済みの時だけ同期 ★★★
                  if (!targetKey || hydratedKeyRef.current !== targetKey) {
                    console.log('[ShareView] onShapesChange IGNORED (not hydrated for this key yet):', {
                      updatedCount: updated.length,
                      targetKey: targetKey?.substring(0, 30) || 'null',
                      hydratedKey: hydratedKeyRef.current?.substring(0, 30) || 'null',
                    });
                    return;
                  }
                  
                  // ★★★ P2 FIX: 空配列が来てもdraftが残っていれば上書きしない ★★★
                  const currentDraftCount = draftShapesRef.current.length;
                  if (updated.length === 0 && currentDraftCount > 0) {
                    console.log('[ShareView] onShapesChange IGNORED (empty array would overwrite draft):', {
                      updatedCount: updated.length,
                      currentDraftCount,
                      targetKey,
                    });
                    return;
                  }
                  
                  console.log('[ShareView] onShapesChange called:', {
                    updatedCount: updated.length,
                    targetKey,
                    activeCommentId,
                  });
                  
                  // メモリに保存（useEffectでlocalStorage自動保存される）
                  draftShapesRef.current = updated;
                  setDraftShapes(updated);
                }}
                onBeginPaint={handleBeginPaint}
                onSaveShape={handleSaveShape}
                onDeleteShape={handleDeleteShape}
                paintMode={isReady && paintMode && (activeCommentId || tempCommentId)}
                tool={tool}
                onToolChange={setTool}
                onStrokeColorChange={setStrokeColor}
                onStrokeWidthChange={setStrokeWidth}
                strokeColor={strokeColor}
                strokeWidth={strokeWidth}
                zoom={zoom}
                showBoundingBoxes={showBoundingBoxes}
                showAllPaint={showAllPaint}
                forceClearToken={forceClearToken}
                draftCommentId={tempCommentId}
                renderTargetCommentId={renderTargetCommentId}
                debugInfo={{
                  isReady: isReady,
                  readyDetails: readyDetails,
                  activeCommentId: activeCommentId,
                  queryKey: ['paintShapes', token, shareLink?.file_id, currentPage],
                  fetchedCount: paintShapes?.length || 0,
                  filteredCount: shapesForCanvas?.length || 0,
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

          {/* 下段：コメント入力（composer） */}
          {shareLink.can_post_comments && (() => {
            // 対応済みチェック
            const activeComment = comments.find(c => c.id === activeCommentId);
            const isLocked = activeComment?.resolved || false;
            
            return (
              <div className="bg-gray-100 p-4 flex justify-center">
                <div className="w-full max-w-2xl bg-white rounded-xl shadow-2xl border-2 border-gray-200 p-4">
                  <div className="flex gap-3 items-start">
                    {/* ペイントボタン */}
                    <Button
                      variant={paintMode ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => handlePaintModeChange(!paintMode)}
                      className="mt-1"
                      disabled={isLocked}
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
                        disabled={isLocked}
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
                      disabled={isLocked}
                    />
                    <label htmlFor="dock-file-input">
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-1"
                        asChild
                        disabled={isLocked}
                      >
                        <span>
                          <Download className="w-4 h-4" />
                        </span>
                      </Button>
                    </label>

                    {/* 送信ボタン */}
                    <Button
                      onClick={handleSendComment}
                      disabled={!composerText.trim() || isLocked || isSubmitting}
                      className="bg-blue-600 hover:bg-blue-700 mt-1 disabled:opacity-50 disabled:cursor-not-allowed"
                      size="sm"
                      title={composerMode === 'edit' ? '保存' : '送信'}
                      style={{ pointerEvents: isSubmitting ? 'none' : 'auto' }}
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

                  {/* 固定高さのステータス領域（高さ変化でチラつき防止） */}
                  <div className="h-6 mt-2 flex items-center">
                    {isLocked ? (
                      <div className="text-xs text-orange-600 flex items-center gap-2">
                        <Badge className="bg-orange-100 text-orange-700 border border-orange-300">
                          対応済みのため編集できません
                        </Badge>
                      </div>
                    ) : (composerMode === 'edit' || paintSessionCommentId || draftShapes.length > 0) ? (
                      <div className="text-xs text-gray-500 flex items-center gap-2">
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
                    ) : (
                      <div className="opacity-0 pointer-events-none">placeholder</div>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}
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
                              onDoubleClick={() => !comment.resolved && enterEdit(comment)}
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
                                <CircleIcon className="w-5 h-5" />
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
                              disabled={!composerText.trim() || isSubmitting}
                              style={{ pointerEvents: isSubmitting ? 'none' : 'auto' }}
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

      {/* ツールバー（ペイントモード時のみ） */}
      {paintMode && shareLink.can_post_comments && isReady && (
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