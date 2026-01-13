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

const DEBUG_MODE = import.meta.env.VITE_DEBUG === 'true' || false;

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
    id: base.id ?? base.client_shape_id ?? base._local_id ?? (base._local_id = safeUUID()),
  };
};

// Hunk J: transientフィールド除去関数（DB由来shape用）
const stripTransient = (shape) => {
  if (!shape) return shape;
  const { _dirty, _localTs, ...clean } = shape;
  return clean;
};

function ShareViewContent() {
  const [guestName, setGuestName] = useState('');
  const [guestId, setGuestId] = useState('');
  const [showNameDialog, setShowNameDialog] = useState(false);
  const [authUser, setAuthUser] = useState(null);
  const [userAppRole, setUserAppRole] = useState(null);
  const [authStatus, setAuthStatus] = useState('pending');
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
  const lastDrawToolRef = useRef('pen'); // 最後に使った描画ツール
  const [strokeColor, setStrokeColor] = useState('#ff0000');
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });
  const [showBoundingBoxes, setShowBoundingBoxes] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [activeCommentId, setActiveCommentId] = useState(null);
  const [composerText, setComposerText] = useState('');
  const [showAllPaint, setShowAllPaint] = useState(false);
  const [isDockOpen, setIsDockOpen] = useState(false);

  // ★★★ P1 FIX: activeCommentId がある場合は showAllPaint を強制的に false にする不変条件 ★★★
  const effectiveShowAllPaint = showAllPaint && !activeCommentId;
  
  // Draft paint session state
  const [paintSessionCommentId, setPaintSessionCommentId] = useState(null);
  const [draftShapes, setDraftShapes] = useState([]);
  const draftShapesRef = useRef([]);
  const draftCacheRef = useRef(new Map()); // ★★★ P1: targetKey -> shapes[] のキャッシュ ★★★
  const seededFromDBRef = useRef(false); // ★★★ Hunk1: DB seed直後の autosave スキップ用フラグ ★★★
  const justEnteredEditRef = useRef({ key: null, active: false }); // ★★★ P0: 編集突入直後のdirty化防止 ★★★
  
  // ★★★ P0: baseline比較でautosaveスキップ（dirty誤付与に頼らない確実なガード）★★★
  const seedBaselineSigRef = useRef(null);
  const seedBaselineKeyRef = useRef(null);
  const seedBaselineArmedRef = useRef(false);
  
  // ★★★ P0-A: autosave解禁フラグ（ユーザー操作で初めてtrueにする）★★★
  const autosaveArmedRef = useRef(false);
  
  // シグネチャ計算（ローカルメタを除外してJSON化）
  const stableSig = (shapes) => {
    const cleaned = (shapes || [])
      .map(s => {
        const { _dirty, _localTs, _lastEditedBy, ...rest } = s;
        return rest;
      })
      .sort((a, b) => String(a.id || '').localeCompare(String(b.id || '')));
    return JSON.stringify(cleaned);
  };
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
  const stablePaintContextIdRef = useRef(null); // A: 一瞬もnullにしない安定ID
  const lastMergedShapesRef = useRef([]); // D: チラつき防止用
  const debugLogBufferRef = useRef([]); // Debug: ログ保持用
  const prevPaintContextIdForMergedRef = useRef(null); // FIX-3: lastMerged保持条件用
  const lastNonNullPaintContextIdRef = useRef(null); // FIX-NO-BLANK: null落ち防止用
  const deletedShapeIdsRef = useRef(new Set()); // FIX-DELETE: 削除復活防止用
  const lastDeletedKeyRef = useRef(null); // P0-FIX: 空ドラフトの無限削除防止
  const handoffRef = useRef(null); // P0-FLICKER: 送信直後のハンドオフバッファ { key, snapshot, pendingIds }
  
  
  // ★★★ FIX-4: addDebugLog を最優先定義（TDZ根絶）★★★
  const addDebugLog = (msg) => {
    debugLogBufferRef.current.push(`[${new Date().toISOString().substring(11, 23)}] ${msg}`);
    if (debugLogBufferRef.current.length > 200) {
      debugLogBufferRef.current.shift();
    }
  };

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
  
  const [token, setToken] = useState(null);
  const [debugParam, setDebugParam] = useState(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      setToken(params.get('token'));
      setDebugParam(params.get('debug'));
    }
  }, []);
  
  // ★★★ FIX-A: forceDebugフラグ永続化（iframe対策）★★★
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (debugParam === '1') {
      localStorage.setItem('forceDebug', '1');
    }
  }, [debugParam]);

  const authCheckAttemptedRef = useRef(false); // Hunk C: 認証トライ記録

  useEffect(() => {
    if (!token) return;
    
    // Hunk C: 同一セッションでの認証チェックは1回のみ（無限ループ防止）
    if (authCheckAttemptedRef.current) return;
    authCheckAttemptedRef.current = true;
    
    // guestId生成または復元
    let storedGuestId = localStorage.getItem(`guestId_${token}`);
    if (!storedGuestId) {
      storedGuestId = `guest_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      localStorage.setItem(`guestId_${token}`, storedGuestId);
    }
    setGuestId(storedGuestId);
    
    const tokenName = localStorage.getItem(`guestName_${token}`);
    const globalName = localStorage.getItem('guestName_global');

    base44.auth.me()
      .then(user => {
        if (user) {
          // ログイン済み：ログイン名を強制適用
          const displayName = user.full_name || 'ログインユーザー';
          setGuestName(prev => prev === displayName ? prev : displayName);
          localStorage.setItem(`guestName_${token}`, displayName);
          localStorage.setItem('guestName_global', displayName);
          setShowNameDialog(prev => prev ? false : prev);
          setAuthUser(prev => prev?.id === user.id ? prev : user);
          setAuthStatus(prev => prev === 'authed' ? prev : 'authed');
          
          // UserRoleを取得
          base44.entities.UserRole.filter({ user_id: user.id })
            .then(roles => {
              const newRole = roles?.[0]?.app_role || 'member';
              setUserAppRole(prev => prev === newRole ? prev : newRole);
            })
            .catch(() => {
              setUserAppRole(prev => prev === 'member' ? prev : 'member');
            });

        } else {
          // 未ログイン：localStorageを確認
          setAuthStatus(prev => prev === 'guest' ? prev : 'guest');
          if (tokenName) {
            setGuestName(prev => prev === tokenName ? prev : tokenName);
          } else if (globalName) {
            setGuestName(prev => prev === globalName ? prev : globalName);
            localStorage.setItem(`guestName_${token}`, globalName);
          } else {
            setShowNameDialog(prev => prev ? prev : true);
          }
          setAuthUser(prev => prev === null ? prev : null);
          setUserAppRole(prev => prev === null ? prev : null);
        }
      })
      .catch(() => {
        // auth.me自体がネットワークエラー等で失敗した場合
        setAuthStatus(prev => prev === 'guest' ? prev : 'guest');
        if (tokenName) {
          setGuestName(prev => prev === tokenName ? prev : tokenName);
        } else if (globalName) {
          setGuestName(prev => prev === globalName ? prev : globalName);
        } else {
          setShowNameDialog(prev => prev ? prev : true);
        }
        setAuthUser(prev => prev === null ? prev : null);
        setUserAppRole(prev => prev === null ? prev : null);
      });

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
    if (savedTempId && savedTempId !== 'null' && savedTempId !== 'undefined' && savedTempId.trim() !== '') {
      setTempCommentId(savedTempId);
      console.log('[ShareView] ✓ Restored tempCommentId:', {
        scopeId: shareLink.file_id.substring(0, 12),
        tempCommentId: savedTempId.substring(0, 12),
      });
    } else {
      if (savedTempId && (savedTempId === 'null' || savedTempId === 'undefined' || savedTempId.trim() === '')) {
        localStorage.removeItem(`tempCommentId:${shareLink.file_id}`);
      }
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
    if (!shareLink?.file_id) return;
    if (!tempCommentId || tempCommentId === 'null' || tempCommentId === 'undefined') {
      localStorage.removeItem(`tempCommentId:${shareLink.file_id}`);
      return;
    }
    localStorage.setItem(`tempCommentId:${shareLink.file_id}`, tempCommentId);
    console.log('[ShareView] Saved tempCommentId to localStorage:', tempCommentId);
  }, [shareLink?.file_id, tempCommentId]);

  // ★★★ CRITICAL: mode判定（TDZ回避のため、computedPaintContextIdより先に定義）★★★
  const isEditMode = composerMode === 'edit' && !!composerTargetCommentId;
  const isNewMode = composerMode === 'new' && !!tempCommentId;

  // ★★★ CRITICAL: Draft state logic moved here to resolve TDZ
  const hydratedKeyRef = useRef(null);
  const [hydratedKeyState, setHydratedKeyState] = useState(null);
  const storageDraftReady = !!(hydratedKeyState); // Ready when hydrate completes
  const shouldShowDraft = composerMode === 'new' || composerMode === 'edit';

  // ★★★ FIX-2: computed版（通常計算）- Original logic restored
  const computedPaintContextId = React.useMemo(() => {
    // Hunk 1: paintContextIdの決定をモード別に固定
    if (composerMode === 'new') {
      // newモードはtempCommentIdが唯一のソース
      return tempCommentId ? String(tempCommentId) : null;
    }
    if (composerMode === 'edit') {
      return composerTargetCommentId ? String(composerTargetCommentId) : null;
    }
    if (composerMode === 'view') {
      // viewモードはactiveCommentId（選択解除でnullになり、描画が消える）
      return activeCommentId ? String(activeCommentId) : null;
    }

    // 上記以外のモード（replyなど）やフォールバック
    if (showAllPaint) return null;
    if (activeCommentId) return String(activeCommentId);
    
    return null;
  }, [composerMode, tempCommentId, composerTargetCommentId, activeCommentId, showAllPaint]);
  
  // ★★★ FIX-2: stable版（一瞬もnullにしない、fileId変更時のみクリア）★★★
  const stablePaintContextId = React.useMemo(() => {
    const fileId = shareLink?.file_id || '';
    const prevFileIdRef = stablePaintContextIdRef.current?.fileId || '';
    const prev = stablePaintContextIdRef.current?.id || null;
    const computed = computedPaintContextId;
    
    // ファイル変更時は強制クリア
    if (fileId && fileId !== prevFileIdRef) {
      stablePaintContextIdRef.current = { fileId, id: null };
      lastNonNullPaintContextIdRef.current = null; // FIX-NO-BLANK: ファイル変更時にrefもクリア
      return null;
    }
    
    // computed有効値なら即座に更新
    if (computed) {
      stablePaintContextIdRef.current = { fileId, id: computed };
      lastNonNullPaintContextIdRef.current = computed; // FIX-NO-BLANK: 非nullを記録
      return computed;
    }
    
    // computed=nullでも前回値があれば保持（チラつき防止）
    if (prev && fileId === prevFileIdRef) {
      return prev;
    }
    
    // FIX-NO-BLANK: 最後の非nullを使う（完全null回避）
    if (lastNonNullPaintContextIdRef.current) {
      return lastNonNullPaintContextIdRef.current;
    }
    
    return null;
  }, [computedPaintContextId, shareLink?.file_id]);
  
  const paintContextId = stablePaintContextId;

  // ★★★ CRITICAL: renderTargetCommentId は paintContextId と完全同一（Single Source of Truth）★★★
  const renderTargetCommentId = paintContextId;
  const viewContextId = paintContextId;

  // ★★★ CRITICAL: draftScope（TDZ回避のため単純const、useMemoより先に定義）★★★
  const draftScope = 
    composerMode === 'edit' ? 'edit' :
    composerMode === 'new' ? 'new' :
    null;



  // temp かどうかの判定
  const isTempCid = (cid) => typeof cid === 'string' && cid.startsWith('temp_');
  
  // ★★★ CRITICAL: draft filter用のID（型統一）★★★
  const draftFilterId = isEditMode ? String(composerTargetCommentId) : (isNewMode ? String(tempCommentId) : null);

  // ★★★ CRITICAL: targetKey（scope分離版、view時はnullで表示しない）★★★
  // ★★★ P0-5: commentId/tempId が無ければ null を返す（無効キー生成防止）★★★
  const targetKey = React.useMemo(() => {
    if (!shareLink?.file_id || !paintContextId || !draftScope) return null;
    
    if (draftScope === 'edit') {
      // ★★★ P0-5: paintContextIdが空文字や無効値ならnull ★★★
      if (!paintContextId || paintContextId === '' || paintContextId === 'null' || paintContextId === 'undefined') {
        console.warn('[P0-5] targetKey: edit mode but paintContextId invalid, returning null');
        return null;
      }
      return getDraftKey(shareLink.file_id, paintContextId, null, 'edit');
    }
    if (draftScope === 'new') {
      // ★★★ P0-5: paintContextIdが空文字や無効値ならnull ★★★
      if (!paintContextId || paintContextId === '' || paintContextId === 'null' || paintContextId === 'undefined') {
        console.warn('[P0-5] targetKey: new mode but paintContextId invalid, returning null');
        return null;
      }
      return getDraftKey(shareLink.file_id, null, paintContextId, 'new');
    }
    
    return null;
  }, [shareLink?.file_id, paintContextId, draftScope]);

    // ★★★ CRITICAL: paintContextId変化検知（コメント切替時のクリーンスタート）★★★
  const prevPaintContextIdRef = useRef(paintContextId);
  
  useEffect(() => {
    const prev = prevPaintContextIdRef.current;
    prevPaintContextIdRef.current = paintContextId;
    
    if (prev !== paintContextId) {
      console.log('[ShareView] paintContextId changed, clearing hydrate state:', {
        prev: prev?.substring(0, 12) || 'null',
        next: paintContextId?.substring(0, 12) || 'null',
      });
      setHydratedKeyState(null);
    }
  }, [paintContextId]);
  
  // ★★★ DEBUG: shouldShowDraft変化ログ ★★★
  useEffect(() => {
    console.log('[DRAFT_DEBUG] shouldShowDraft changed:', {
      shouldShowDraft,
      composerMode,
      draftScope,
      targetKey: targetKey?.substring(0, 30) || 'null',
    });
  }, [shouldShowDraft, composerMode, draftScope, targetKey]);
  
  // ★★★ CRITICAL: 下書きをcanvasに混ぜるか（storage準備完了 && mode判定）★★★
  const includeDraftInCanvas = React.useMemo(() => {
    return shouldShowDraft && storageDraftReady;
  }, [shouldShowDraft, storageDraftReady]);

  // ★★★ CRITICAL: draftReady フラグ（hydrate完了判定、state化で再レンダー保証）★★★
  const draftReady = storageDraftReady;
  
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
    
    console.log('[DRAFT_DEBUG] hydrate start:', JSON.stringify({
      targetKey: targetKey.substring(0, 30),
      draftScope,
      composerMode,
      scopeId: shareLink?.file_id?.substring(0, 12),
      paintContextId: paintContextId?.substring(0, 12) || 'null',
      tempCommentId: tempCommentId?.substring(0, 12) || 'null',
    }));
    
    // ★★★ P1 FIX: キャッシュから即座に復元（置換防止）★★★
    const cached = draftCacheRef.current.get(targetKey) || [];
    draftShapesRef.current = cached;
    setDraftShapes(cached);
    console.log('[DRAFT_DEBUG] cache restored:', JSON.stringify({
      targetKey: targetKey.substring(0, 30),
      cachedCount: cached.length,
      composerMode,
      draftScope,
    }));
    
    // ★★★ P0 FIX: ここで hydratedKeyState をセットせず、非同期のloadDraft完了後に移動 ★★★
    // hydratedKeyRef.current = targetKey;
    // setHydratedKeyState(targetKey);

    
    // ★★★ P0: localStorage読み込み → authorKey＋commentId照合 → 正規化 ★★★
    const draft = loadDraft(targetKey);
    
    // ★★★ P0-CHECK: draft が null なら早期return ★★★
    if (!draft) {
      console.log('[draft] No draft loaded (null):', { targetKey });
      hydratedKeyRef.current = targetKey;
      setHydratedKeyState(targetKey);
      return;
    }
    
    // ★★★ Hunk S (P0): authorKey無しドラフトを救済（upgrade） ★★★
    if (!draft.authorKey) {
      // legacy下書きをupgrade（authorKeyを補充）
      const currentAuthorKey = authUser?.id || guestId;
      console.log('[draft] Legacy draft upgraded (missing authorKey):', { 
        targetKey,
        upgradeAuthorKey: currentAuthorKey?.substring(0, 12) || 'unknown',
        shapesCount: draft.shapes?.length || 0
      });
      
      // 読み込んだ下書きに authorKey を補う
      draft.authorKey = currentAuthorKey;
      
      // localStorage に upgrade を保存（重要：削除ルートに入らないようにするため）
      saveDraft(targetKey, draft.shapes || [], {
        pageNo: draft.pageNo,
        authorKey: currentAuthorKey,
        authorName: draft.authorName || guestName,
        commentId: draft.commentId,
      });
      
      // 以降の処理を続行（draft は now authorKey を持つ）
    }
    
    // ★★★ Hunk U: backward-compat — authorKey 無い場合は author を試す ★★★
    if (!draft.authorKey && draft.author) {
     draft.authorKey = draft.author;
     console.log('[draft] Backward-compat: adopted author as authorKey:', {
       targetKey,
       authorKey: draft.authorKey?.substring(0, 12) || 'unknown',
     });
    }

    // ★★★ P0-A: 本人の下書きのみ復元（混線防止）★★★
    if (draft.authorKey !== guestId) {
     console.warn('[draft] Ignoring draft from different author:', {
       targetKey,
       draftAuthor: draft.authorKey?.substring(0, 12),
       currentGuestId: guestId?.substring(0, 12),
     });
     setDraftShapes([]);
     draftShapesRef.current = [];
     draftCacheRef.current.set(targetKey, []);
     // ★★★ P0 FIX: 0件/legacyでもhydrate完了を通知し、gateを開ける ★★★
     hydratedKeyRef.current = targetKey;
     setHydratedKeyState(targetKey);
     return;
    }
    
    // ★★★ P0-B: commentId必須チェック（古い下書き除外、安全優先）★★★
    if (!draft?.commentId) {
      console.warn('[draft] Ignoring draft without commentId (legacy):', { targetKey });
      setDraftShapes([]);
      draftShapesRef.current = [];
      draftCacheRef.current.set(targetKey, []);
      // ★★★ P0 FIX: 0件/legacyでもhydrate完了を通知し、gateを開ける ★★★
      hydratedKeyRef.current = targetKey;
      setHydratedKeyState(targetKey);
      return;
    }
    
    // ★★★ P0-B: commentId照合（キーから抽出したIDと一致確認、混線レース防止）★★★
    const prefix = draftScope === 'edit' 
      ? `draftPaint:${shareLink.file_id}:edit:`
      : `draftPaint:${shareLink.file_id}:new:`;
    const commentIdFromKey = targetKey ? targetKey.substring(prefix.length) : null;
    
    if (!commentIdFromKey || String(draft.commentId) !== String(commentIdFromKey)) {
      console.warn('[draft] Ignoring draft with mismatched commentId:', {
        targetKey: targetKey?.substring(0, 40),
        draftCommentId: draft.commentId?.substring(0, 12),
        commentIdFromKey: commentIdFromKey?.substring(0, 12),
      });
      setDraftShapes([]);
      draftShapesRef.current = [];
      draftCacheRef.current.set(targetKey, []);
      // ★★★ P0 FIX: 0件/legacyでもhydrate完了を通知し、gateを開ける ★★★
      hydratedKeyRef.current = targetKey;
      setHydratedKeyState(targetKey);
      return;
    }
    
    const shapes = draft?.shapes || [];
    
    // ★★★ CRITICAL: edit時はtempCommentIdを使わず、paintContextIdで正規化 ★★★
    const normalizeCtxId = (draftScope === 'edit') ? paintContextId : tempCommentId;
    const normalizedShapes = shapes.map(s => normalizeShape(s, normalizeCtxId)).filter(Boolean);
    
    // ★★★ CRITICAL: hydrateは置換ではなくマージ（メモリ上の最新を優先）★★★
    const prevShapes = draftShapesRef.current || [];
    
    // localStorage由来のshapesをベースマップに
    const mergedMap = new Map();
    normalizedShapes.forEach(s => mergedMap.set(s.id, s));

    // メモリ上の最新shapesを上書きマージ（ユーザーの編集を優先）
    prevShapes.forEach(s => mergedMap.set(s.id, s));
    
    const merged = Array.from(mergedMap.values());
    
    // ★★★ P1: キャッシュに保存 ★★★
    draftCacheRef.current.set(targetKey, merged);
    draftShapesRef.current = merged;
    setDraftShapes(merged);
    
    // ★★★ CRITICAL: hydrate完了後に必ずキーを記録（loadedCount=0でもready扱い）★★★
    hydratedKeyRef.current = targetKey;
    setHydratedKeyState(targetKey);
    
    console.log('[DRAFT_DEBUG] hydrate end merged:', JSON.stringify({
      targetKey: targetKey.substring(0, 30),
      draftScope,
      composerMode,
      loadedCount: normalizedShapes.length,
      prevCount: prevShapes.length,
      mergedCount: merged.length,
      savedAt: draft?.updatedAt,
      scopeId: shareLink?.file_id?.substring(0, 12),
      paintContextId: paintContextId?.substring(0, 12) || 'null',
      tempCommentId: tempCommentId?.substring(0, 12) || 'null',
      hydratedKeyState: 'SET',
    }));
    
    if (normalizedShapes.length > 0) {
      showToast(`${normalizedShapes.length}個の下書きを復元しました`, 'info');
    }

    // ★★★ P0 FIX: loadDraft完了後にhydratedStateをセット ★★★
    hydratedKeyRef.current = targetKey;
    setHydratedKeyState(targetKey);

    // ★★★ P0 FIX: loadDraft完了後にhydratedStateをセット ★★★
    hydratedKeyRef.current = targetKey;
    setHydratedKeyState(targetKey);

    // ★★★ P0 FIX: loadDraft完了後にhydratedStateをセット ★★★
    hydratedKeyRef.current = targetKey;
    setHydratedKeyState(targetKey);
  }, [targetKey, shareLink?.file_id, tempCommentId, draftScope, composerMode, paintContextId]);

  // ★★★ P3: draftShapes 変更時に自動保存（debounce付き）★★★
  // ★★★ FIX: 空になっただけでdeleteDraftしない、didHydrateDraftRefでガード ★★★
  useEffect(() => {
    if (!targetKey) return;
    
    // Hunk G2: hydrate未完了でも、draftShapes.length > 0 なら早期hydrate完了として保存継続
    if (hydratedKeyRef.current !== targetKey) {
      if (draftShapes.length > 0) {
        console.log('[Hunk G2] Early hydrate in autosave: accepting first draft save:', {
          targetKey: targetKey.substring(0, 30),
          draftShapesLength: draftShapes.length,
        });
        hydratedKeyRef.current = targetKey;
        setHydratedKeyState(prev => prev === targetKey ? prev : targetKey);
        // 以降の保存処理に進む
      } else {
        console.log('[draft] autosave SKIPPED (not hydrated, empty draft):', { 
          targetKey: targetKey.substring(0, 30),
          hydratedKey: hydratedKeyRef.current?.substring(0, 30) || 'null',
        });
        return;
      }
    }
    
    // ★★★ Hunk X (P0): legacy draft（authorKey無し）削除を防止 + 条件厳格化 ★★★
    // 「本当に空」のときだけ削除（loadDraftが null だけでは削除しない）
    // new/edit 中は削除しない（下書き勝手消失を止血）
    if (draftShapes.length === 0 && draftScope !== 'new' && draftScope !== 'edit') {
      const loadedDraft = loadDraft(targetKey);
      
      // ★★★ Hunk X: legacy draftも救済（authorKey無しなら author をキー化） ★★★
      let rescuedDraft = loadedDraft;
      if (loadedDraft && !loadedDraft.authorKey && loadedDraft.author) {
        rescuedDraft = { ...loadedDraft, authorKey: loadedDraft.author };
        console.log('[Hunk X] Legacy draft rescued: author→authorKey', { targetKey, authorKey: loadedDraft.author?.substring(0, 12) });
      }
      
      const isActuallyEmpty = !rescuedDraft || (rescuedDraft?.shapes?.length === 0);
      
      if (!isActuallyEmpty) {
        // loadDraft が何か返した（shapes がある）のに draftShapes=0 なのは一時的な不整合
        // 削除せずに続行（ユーザーの下書きを失わない）
        console.log('[Hunk T] Skip delete: loadedDraft has shapes but draftShapes=0 (temporary mismatch):', { 
          targetKey, 
          loadedCount: rescuedDraft?.shapes?.length || 0,
          draftCount: draftShapes.length 
        });
        // continue to save (if there are shapes to save)
        // fall through to autosave section
      } else {
        // 本当に空の下書き（rescuedDraft が null または shapes=0）のみ削除
        if (lastDeletedKeyRef.current === targetKey) {
          return;
        }
        console.log('[P0-FIX] Deleting truly empty draft to prevent ghost shapes:', { targetKey, draftScope });
        deleteDraft(targetKey);
        draftCacheRef.current.delete(targetKey);
        lastDeletedKeyRef.current = targetKey;
        return;
      }
    }

    // 空でなければ削除記録をリセット
    lastDeletedKeyRef.current = null;
    
    // debounce保存
    if (saveDraftTimeoutRef.current) {
      clearTimeout(saveDraftTimeoutRef.current);
    }
    
    saveDraftTimeoutRef.current = setTimeout(() => {
      // ★★★ P0-2: 空の下書き（shapesCount=0）は保存しない ★★★
      if (draftShapes.length === 0) {
        console.log('[P0-2] autosave SKIPPED (empty draft, shapesCount=0):', {
          targetKey: targetKey?.substring(0, 30),
          draftScope,
        });
        return;
      }
      
      // ★★★ P0-A: autosave未解禁なら保存しない（編集突入直後のsync対策）★★★
      if (!autosaveArmedRef.current) {
        console.log('[P0-A] autosave SKIPPED (not armed yet):', {
          targetKey: targetKey?.substring(0, 30),
          shapesCount: draftShapes.length,
        });
        return;
      }
      
      // ★★★ P0: baseline比較ガード（DBと同一内容なら保存しない）★★★
      if (seedBaselineArmedRef.current && targetKey === seedBaselineKeyRef.current) {
        const curSig = stableSig(draftShapes);
        if (curSig === seedBaselineSigRef.current) {
          console.log('[P0] autosave SKIPPED (baseline same as DB on enterEdit):', {
            targetKey: targetKey?.substring(0, 30),
            shapesCount: draftShapes.length,
          });
          return; // ★ここで止める
        }
        // 1回でもユーザー変更が入ったら以後は通常運用へ
        seedBaselineArmedRef.current = false;
        addDebugLog(`[P0] baseline disarmed (content changed)`);
      }
      
      // ★★★ Hunk1: DB seed直後で_dirtyが無ければ保存スキップ ★★★
      if (draftScope === 'edit' && seededFromDBRef.current) {
        const hasUserChange = draftShapes.some(s => s?._dirty);
        if (!hasUserChange) {
          console.log('[Hunk1] autosave SKIPPED (DB seed, no user change yet):', {
            targetKey: targetKey?.substring(0, 30),
            shapesCount: draftShapes.length,
          });
          return;
        }
        // dirty が出た＝ユーザーが触った。以降は通常autosaveでOK
        seededFromDBRef.current = false;
      }
      
      // ★★★ P0-B: commentIdをtargetKeyから抽出（レース根絶）★★★
      const prefix = draftScope === 'edit' 
        ? `draftPaint:${shareLink.file_id}:edit:`
        : `draftPaint:${shareLink.file_id}:new:`;
      const commentIdFromKey = targetKey.substring(prefix.length);
      
      // ★★★ P0.5: authorKey/commentIdが空なら保存しない (防御) ★★★
      if (!guestId || !commentIdFromKey) {
        console.warn('[draft] autosave skipped: missing guestId or commentIdFromKey', { guestId, commentIdFromKey });
        return;
      }

      saveDraft(targetKey, draftShapes, { 
       pageNo: currentPage,
       author: guestId, // for backward-compatibility
       authorKey: guestId,
       authorName: guestName,
       commentId: commentIdFromKey,
      });
      console.log('[draft] autosave fired:', { targetKey, shapesCount: draftShapes.length, commentId: commentIdFromKey?.substring(0, 12) || 'null' });
      
      // ★★★ P1: バッジのリアルタイム更新（edit時のみ）★★★
      if (draftScope === 'edit' && composerTargetCommentId) {
        setDraftCountByCommentId(prev => ({
          ...prev,
          [composerTargetCommentId]: draftShapes.length
        }));
      }
    }, 500);
    
    return () => {
      if (saveDraftTimeoutRef.current) {
        clearTimeout(saveDraftTimeoutRef.current);
      }
    };
  }, [targetKey, draftShapes, currentPage, guestId, guestName, draftScope, shareLink?.file_id]);

  // ★★★ デバッグHUD用の情報 ★★★
  const [draftDebugInfo, setDraftDebugInfo] = useState({ targetKey: null, loadedCount: 0, renderedCount: 0, savedAt: null, loadDraftFound: false });
  
  useEffect(() => {
    const draft = targetKey ? loadDraft(targetKey) : null;
    
    const newInfo = {
      targetKey: targetKey,
      loadedCount: draft?.shapes?.length || 0,
      renderedCount: draftShapes.length,
      savedAt: draft?.updatedAt || null,
      loadDraftFound: !!draft,
    };
    
    // Hunk D: 差分がある場合のみ更新（無限ループ防止）
    setDraftDebugInfo(prev => {
      if (prev.targetKey === newInfo.targetKey &&
          prev.loadedCount === newInfo.loadedCount &&
          prev.renderedCount === newInfo.renderedCount &&
          prev.savedAt === newInfo.savedAt &&
          prev.loadDraftFound === newInfo.loadDraftFound) {
        return prev;
      }
      return newInfo;
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
    addDebugLog(`[paint] request: mode=${mode} composerMode=${composerMode} tool=${tool}`);

    if (!mode) {
      setPaintMode(false);
      setTool('select');
      return;
    }

    if (authStatus === 'guest' && !guestName.trim()) {
      setShowNameDialog(true);
      return;
    }
    
    // ★★★ FIX-2削除: tool制御はuseEffectに集約（重複排除）★★★

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
      
      // ★★★ P0-1: 既存draft優先ガード（DB seedで上書きしない）★★★
      const editDraftKey = getDraftKey(shareLink.file_id, editingComment.id, null, 'edit');
      const cached = draftCacheRef.current.get(editDraftKey);
      const existingDraft = (cached && cached.length > 0)
        ? { shapes: cached }
        : loadDraft(editDraftKey);
      
      if (existingDraft?.shapes?.length > 0) {
        console.log('[P0-1] Seed skipped in handlePaintModeChange: existing draft present', { 
          editDraftKey: editDraftKey.substring(0, 40), 
          shapes: existingDraft.shapes.length 
        });
        seededFromDBRef.current = false;
        // state/ref/cacheを既存draftで揃える（破壊しない）
        draftCacheRef.current.set(editDraftKey, existingDraft.shapes);
        draftShapesRef.current = existingDraft.shapes;
        setDraftShapes(existingDraft.shapes);
        setPaintSessionCommentId(null);
        // seed処理をスキップして下書きを保持
      } else {
        // ★★★ 既存draftがない場合のみDB seed ★★★
        const shapesToSeed = allShapes.filter(s => resolveCommentId(s) === String(editingComment.id));
        setDraftShapes(shapesToSeed);
        draftShapesRef.current = shapesToSeed;
        draftCacheRef.current.set(editDraftKey, shapesToSeed);
        console.log(`[C-FIX] Seeded ${shapesToSeed.length} shapes to draft for comment ${editingComment.id.substring(0, 12)}`);
        setPaintSessionCommentId(null);
      }

      // ★★★ 下書き復元はtargetKey変更時のuseEffectで自動実行される ★★★
      // （composerMode='edit' & composerTargetCommentId設定 → targetKey変更 → 自動復元）
            } else {
              // ★★★ CRITICAL: 新規時にtempCommentIdが無ければ即座に生成（送信後対策）★★★
              let effectiveTempId = tempCommentId;
              if (!effectiveTempId) {
                effectiveTempId = generateTempCommentId();
                setTempCommentId(effectiveTempId);
                if (shareLink?.file_id) {
                  localStorage.setItem(`tempCommentId:${shareLink.file_id}`, effectiveTempId);
                }
                console.log('[ShareView] generated tempCommentId for paint:', effectiveTempId.substring(0, 12));
              }

              // 新規作成: 既存コメント描画は非表示・編集不可
              setActiveCommentId(null);
              setPaintSessionCommentId(null);
              setComposerMode('new');
              setComposerTargetCommentId(null);
              setShowAllPaint(false);
              viewerCanvasRef.current?.clear();
            }

            setPaintMode(true);
            setIsDockOpen(true);
  };
  
  // ★★★ FIX-2: 描画ツール記録 + paintMode変化時のtool制御（1箇所集約）★★★
  const prevPaintModeRef = useRef(paintMode);
  useEffect(() => {
    // 描画ツール記録
    if (['pen', 'rect', 'circle', 'arrow', 'text'].includes(tool)) {
      lastDrawToolRef.current = tool;
      addDebugLog(`[tool] recorded: ${tool}`);
    }
    
    // paintMode false→true の瞬間だけ tool制御
    const prev = prevPaintModeRef.current;
    prevPaintModeRef.current = paintMode;
    
    if (!prev && paintMode && tool === 'select') {
      const drawTool = lastDrawToolRef.current || 'pen';
      setTool(drawTool);
      addDebugLog(`[FIX-2] paint ON: select → ${drawTool}`);
    }
  }, [tool, paintMode]);

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

    // comment指定がない共有リンクは「先頭コメントを自動選択」で初期表示を安定させる
    if (!commentIdFromUrl) {
      // comments が揃うのを待つ
      if (!comments || comments.length === 0) {
        setActiveCommentId(null);
        didInitActiveRef.current = true;
        return;
      }
      
      // ★★★ FIX-INIT: 先頭コメントを自動選択（初回のみ）★★★
      const firstComment = comments[0];
      if (firstComment) {
        setCurrentPage(firstComment.page_no);
        setActiveCommentId(firstComment.id);
        console.log('[ShareView] Auto-selected first comment:', firstComment.id.substring(0, 12));
      } else {
        setActiveCommentId(null);
      }
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
  const { data: paintShapes = [], isFetching: shapesFetching, isSuccess: shapesLoaded } = useQuery({
    queryKey: ['paintShapes', token, shareLink?.file_id, currentPage],
    queryFn: async () => {
      console.log('[ShareView] Fetching all shapes for page:', { 
        token: token?.substring(0, 10), 
        fileId: shareLink.file_id, 
        pageNo: currentPage 
      });
      const allShapesOnPage = await base44.entities.PaintShape.filter({
        share_token: token,
        file_id: shareLink.file_id
      });
      const shapes = allShapesOnPage.filter(s => s.page_no === currentPage);
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
    console.log('[DRAW_DEBUG] ShareView.handleSaveShape start:', {
      shapeId: shape.id?.substring(0, 8),
      mode,
      paintContextId: paintContextId?.substring(0, 12) || 'null',
      targetKey: targetKey?.substring(0, 30) || 'null',
      draftShapesLength: draftShapesRef.current.length,
      cacheSize: draftCacheRef.current.size,
    });
    
    // ★★★ P0-A: ユーザー操作でautosaveを解禁 ★★★
    if (!autosaveArmedRef.current) {
      autosaveArmedRef.current = true;
      addDebugLog(`[P0-A] autosave armed by handleSaveShape (mode=${mode})`);
    }

    if (!isReady) {
      console.warn('[DRAW_DEBUG] ShareView.handleSaveShape aborted: not ready');
      return;
    }
    
    // ★★★ CRITICAL: paintContextId が無ければ abort（UUID生成禁止）★★★
    if (!paintContextId) {
      console.error('[DRAW_DEBUG] ShareView.handleSaveShape aborted: paintContextId missing');
      return;
    }
    
    // Hunk H2: targetKey未hydrated時に early-hydrate 実行（保険として onShapesChange前でも受理）
    if (targetKey && hydratedKeyRef.current !== targetKey) {
      console.log('[Hunk H2] Early hydrate in handleSaveShape:', {
        targetKey: targetKey.substring(0, 30),
        shapeId: shape.id?.substring(0, 8),
      });
      hydratedKeyRef.current = targetKey;
      setHydratedKeyState(prev => prev === targetKey ? prev : targetKey);
    }
    
    // ★★★ P2 FIX: 必ずユニークIDを確保（functional update で追記）★★★
    const shapeWithId = {
      ...shape,
      id: shape.id || crypto.randomUUID(),
    };
    
    // ★★★ CRITICAL: comment_id を必ず paintContextId に固定（UUID禁止）★★★
    const shapeWithDirty = { 
      ...shapeWithId, 
      comment_id: paintContextId || '',
      commentId: paintContextId || '',
      _dirty: true, 
      _localTs: Date.now() 
    };
    
    // ★★★ DEBUG: 保存する shape の comment_id を必ず出力 ★★★
    console.log('[ShareView] handleSaveShape:', {
      shapeId: shapeWithId.id.substring(0, 8),
      mode,
      composerMode,
      composerTargetCommentId: composerTargetCommentId?.substring(0, 12) || 'null',
      activeCommentId: activeCommentId?.substring(0, 12) || 'null',
      tempCommentId: tempCommentId?.substring(0, 12) || 'null',
      paintContextId: paintContextId.substring(0, 12),
      'shape.comment_id': shapeWithDirty.comment_id.substring(0, 12),
    });
    
    setDraftShapes(prev => {
      let next;
      if (mode === 'create') {
        // 同じIDが既に存在する場合は追記しない（重複防止）
        if (prev.some(s => s.id === shapeWithDirty.id)) {
          return prev;
        }
        next = [...prev, shapeWithDirty];
      } else {
        // update mode: 既存shapeを置き換え
        next = prev.map(s => (s.id === shapeWithDirty.id ? shapeWithDirty : s));
      }
      
      // ★★★ P1: キャッシュ更新 ★★★
      if (targetKey) {
        draftCacheRef.current.set(targetKey, next);
      }
      draftShapesRef.current = next;
      return next;
    });
    
    console.log('[DRAW_DEBUG] ShareView.handleSaveShape end:', {
      shapeId: shapeWithId.id?.substring(0, 8),
      mode,
      targetKey: targetKey?.substring(0, 30) || 'null',
      paintContextId: paintContextId?.substring(0, 12),
      draftCount: draftShapesRef.current.length,
      cacheSize: draftCacheRef.current.size,
      cacheHasTargetKey: targetKey ? draftCacheRef.current.has(targetKey) : false,
    });
    
    return { draft: true };
  };

  // ★★★ CRITICAL: 削除もDB操作せず、localStorageのみ ★★★
  const handleDeleteShape = async (shape) => {
    if (!isReady) {
      console.warn('[ShareView] Not ready yet, delete aborted');
      return;
    }
    
    // ★★★ FIX-DELETE: 削除IDを記録（復活防止）★★★
    deletedShapeIdsRef.current.add(shape.id);
    
    // P2 FIX: functional update でメモリから削除
    setDraftShapes(prev => {
      const next = prev.filter(s => s.id !== shape.id);
      
      // ★★★ P1: キャッシュ更新 ★★★
      if (targetKey) {
        draftCacheRef.current.set(targetKey, next);
      }
      draftShapesRef.current = next;
      return next;
    });
    
    // ★★★ P1: バッジのリアルタイム更新（edit時のみ）★★★
    if (draftScope === 'edit' && composerTargetCommentId) {
      setDraftCountByCommentId(prev => ({
        ...prev,
        [composerTargetCommentId]: draftShapesRef.current.length
      }));
    }
    
    console.log('[ShareView] Shape deleted from draft (NOT DB), added to deletedSet:', {
      shapeId: shape.id,
      targetKey,
      remainingDraftCount: draftShapesRef.current.length,
      deletedSetSize: deletedShapeIdsRef.current.size,
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
    
    // ★★★ P1: キャッシュクリア ★★★
    if (targetKey) {
      draftCacheRef.current.delete(targetKey);
    }
    
    // ★★★ 2. localStorageから明示的に削除（FIX: autosaveでは消えないので手動削除）★★★
    if (targetKey) {
      deleteDraft(targetKey);
      console.log('[draft] deleteDraft called (clearAll):', targetKey);
    }
    
    // ★★★ 3. ViewerCanvasもクリア（明示クリアトークンをインクリメント）★★★
    setForceClearToken(prev => prev + 1);
    viewerCanvasRef.current?.clear();
    
    // ★★★ P1: バッジのリアルタイム更新（edit時のみ）★★★
    if (draftScope === 'edit' && composerTargetCommentId) {
      setDraftCountByCommentId(prev => ({
        ...prev,
        [composerTargetCommentId]: 0
      }));
    }
    
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

    if (authStatus === 'guest' && !guestName.trim()) {
      setShowNameDialog(true);
      return;
    }

    const hasText = composerText.trim().length > 0;
    
    if (!hasText) {
      showToast('コメント本文を入力してください（描画だけでは送信できません）', 'error');
      return;
    }
    
    // ★★★ FIX-B: 送信時のscope/key固定（async中のレース対策）★★★
    const sendDraftScope = draftScope;
    const sendTargetKey = targetKey;

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

    // ★★★ P0-FLICKER: 送信直前にhandoffバッファを作成（ちらつき防止）★★★
    if (shapesToCommit.length > 0) {
      handoffRef.current = {
        key: paintContextId || targetKey,
        snapshot: [...shapesToCommit],
        pendingIds: new Set(shapesToCommit.map(s => String(s.id))),
        createdAt: Date.now(),
      };
      console.log('[P0-FLICKER] handoff buffer created:', {
        key: handoffRef.current.key?.substring(0, 20) || 'null',
        snapshotCount: shapesToCommit.length,
        pendingIdsCount: handoffRef.current.pendingIds.size,
      });
    }

    try {
      if (composerMode === 'edit' && composerTargetCommentId) {
        // 編集モード: 既存コメントを更新
        await base44.entities.ReviewComment.update(composerTargetCommentId, {
          body: composerText,
          has_paint: shapesToCommit.length > 0,
        });

        // ★★★ P0 FIX: 編集送信は「置換」(既存削除→再作成)とし、削除を永続化 ★★★
        const existingPaintShapes = await base44.entities.PaintShape.filter({ comment_id: composerTargetCommentId, share_token: token, file_id: shareLink.file_id });
        for (const existingShape of existingPaintShapes) {
          await base44.entities.PaintShape.delete(existingShape.id);
        }

        if (shapesToCommit.length > 0) {
          console.log(`[P0] Re-creating ${shapesToCommit.length} shapes for comment ${composerTargetCommentId.substring(0,12)}`);
          for (const shape of shapesToCommit) {
            const cleanShape = stripTransient(shape);  // Hunk L: DB保存前transient除去
            await base44.entities.PaintShape.create({
              file_id: shareLink.file_id,
              share_token: token,
              comment_id: composerTargetCommentId,
              page_no: currentPage,
              client_shape_id: cleanShape.id,
              shape_type: cleanShape.tool,
              data_json: JSON.stringify(cleanShape),
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
        
        // ★★★ P1: バッジのリアルタイム更新（edit送信後にクリア）★★★
        if (composerTargetCommentId) {
          setDraftCountByCommentId(prev => {
            const next = { ...prev };
            delete next[composerTargetCommentId];
            return next;
          });
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
            const cleanShape = stripTransient(shape);  // Hunk L2: DB保存前transient除去
            await base44.entities.PaintShape.create({
              file_id: shareLink.file_id,
              share_token: token,
              comment_id: comment.id,
              page_no: currentPage,
              client_shape_id: cleanShape.id,
              shape_type: cleanShape.tool,
              data_json: JSON.stringify(cleanShape),
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
        
        // ★★★ P1: 新規送信後はバッジ不要（tempCommentIdなのでcommentsに無い）★★★

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

      // Hunk O: 新規投稿成功時にtempCommentIdを完全クリア（newの残骸根絶）
      if (composerMode === 'new' || sendDraftScope === 'new') {
        setTempCommentId(null);
        if (shareLink?.file_id) {
          localStorage.removeItem(`tempCommentId:${shareLink.file_id}`);
        }
        console.log('[Hunk O] tempCommentId cleared after new comment submit');
      }

      // ★★★ CRITICAL: 描画クリアを最優先で実行（明示クリアトークンをインクリメント）★★★
      setForceClearToken(prev => prev + 1);
      viewerCanvasRef.current?.afterSubmitClear();
      viewerCanvasRef.current?.clear();
      
      // ★★★ FIX-DELETE: 削除IDセットをクリア（送信完了で復活許可）★★★
      deletedShapeIdsRef.current.clear();
      
      // ★★★ P2: 送信完了時に showAllPaint=false をセット（安全性向上）★★★
      setShowAllPaint(false);
      
      // ★★★ FIX-B: スコープ別クリア（edit送信時は新規下書きを壊さない）★★★
      setComposerText('');
      
      if (sendDraftScope === 'new') {
        // 新規送信時のみ：新規draftをクリア（tempCommentIdはHunk Oで既にクリア済み）
        setDraftShapes([]);
        draftShapesRef.current = [];
        if (sendTargetKey) {
          draftCacheRef.current.delete(sendTargetKey);
        }
      } else if (sendDraftScope === 'edit') {
        // 編集送信時：編集対象のdraftのみクリア（新規下書きは保持）
        if (sendTargetKey) {
          draftCacheRef.current.delete(sendTargetKey);
        }
        // P2 FIX: メモリとstateもクリア（復活防止）
        setDraftShapes([]);
        draftShapesRef.current = [];
        setHydratedKeyState(null);
        hydratedKeyRef.current = null;
      }
      
      setPendingFiles([]);
      setComposerMode('new');
      setComposerTargetCommentId(null);
      setComposerParentCommentId(null);
      setPaintSessionCommentId(null);
      setActiveCommentId(null);
      setPaintMode(false);
      setReplyingThreadId(null);
      setIsDockOpen(false);
      
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
    // 対応済みチェック
    if (comment.resolved) {
      showToast('対応済みのコメントは編集できません', 'info');
      return;
    }

    // ★★★ FIX-5: paintMode中は自動OFF（警告なし、下書き保持）★★★
    if (paintMode) {
      addDebugLog(`[FIX-5] selectComment: auto-OFF paint (draft preserved)`);
      setPaintMode(false);
      setTool('select');
    }

    // ★★★ FIX: 同じコメント再クリック → 選択解除（トグル）★★★
    if (activeCommentId === comment.id) {
      addDebugLog(`[C] deselect same (toggle off)`);
      setActiveCommentId(null);
      // setShowAllPaint(true); // ★★★ FIX: コメント選択解除時に全描画が残るのを防ぐため削除 ★★★
      setComposerMode('view');
      setComposerTargetCommentId(null);
      setComposerText('');
      setPendingFiles([]);
      setReplyingThreadId(null);
      setForceClearToken(prev => prev + 1);
      return;
    }

    // 別のコメントをクリック → 選択のみ（編集には入らない）
    setCurrentPage(comment.page_no);
    // ★★★ P2: activeCommentIdは維持（paintContextId null防止でちらつき根絶）★★★
    setActiveCommentId(comment.id);
    setPaintSessionCommentId(null);
    setIsDockOpen(true);
    // ★★★ P1 FIX: コメント選択時は showAllPaint=false にする（前コメントの描画消失対策）★★★
    setShowAllPaint(false);

    // ★★★ CRITICAL: 既存コメント選択時は view 状態に（"新規作成中"バッジ防止）★★★
    setComposerMode('view');
    setComposerTargetCommentId(null);
    setComposerText('');
    // ★★★ P2: draftShapesはクリアしない（view時も下書き表示するため保持）★★★
    // setDraftShapes([]);
    // draftShapesRef.current = [];
    
    // ★★★ P1: 前のedit/new draftkeyをクリア ★★★
    hydratedKeyRef.current = null;
    setHydratedKeyState(null);
  };

  const enterEdit = (comment) => {
    // 対応済みコメントは編集不可
    if (comment.resolved) {
      showToast('対応済みのコメントは編集できません（未対応に戻すと編集できます）', 'error');
      return;
    }

    // ★★★ FIX-5: paintMode中は自動OFF（警告なし、下書き保持）★★★
    if (paintMode) {
      addDebugLog(`[FIX-5] enterEdit: auto-OFF paint (draft preserved)`);
      setPaintMode(false);
      setTool('select');
    }

    // Hunk P: 編集開始時にtempCommentIdを強制無効化（newの残骸リーク防止）
    setTempCommentId(null);
    if (shareLink?.file_id) {
      localStorage.removeItem(`tempCommentId:${shareLink.file_id}`);
    }
    console.log('[Hunk P] tempCommentId cleared before entering edit mode');

    // ★★★ FIX-2/A: ID確定→mode切替の順序保証★★★
    setCurrentPage(comment.page_no);
    setComposerTargetCommentId(comment.id); // 先にID確定
    setActiveCommentId(comment.id);
    setComposerText(comment.body || '');
    setComposerMode('edit'); // 後にmode切替
    setIsDockOpen(true);
    addDebugLog(`[A] enterEdit: targetId=${comment.id.substring(0, 12)} → mode=edit`);

    // ★★★ P1-seed FIX: 編集開始時に localStorage の下書き優先、無ければDB shapes ★★★
    const editDraftKey = getDraftKey(shareLink.file_id, comment.id, null, 'edit');
    const existingDraft = loadDraft(editDraftKey);

    let shapesToSeed = [];
    // ★★★ P0: authorKey検証（自分の下書きだけ復元）★★★
    const currentAuthorKey = authUser?.id || guestId;
    const draftAuthorKey = existingDraft?.authorKey;
    const isDraftMine = draftAuthorKey && currentAuthorKey && String(draftAuthorKey) === String(currentAuthorKey);

    // ★★★ Hunk W (P0): seed誤発火防止 - storage/cache/ref のいずれかにdraftあれば seed をスキップ ★★★
    const storedDraftCount = existingDraft?.shapes?.length || 0;
    const cachedDraftCount = editDraftKey ? (draftCacheRef.current.get(editDraftKey)?.length || 0) : 0;
    const refDraftCount = draftShapesRef.current?.length || 0;
    const hasAnyDraft = storedDraftCount > 0 || cachedDraftCount > 0 || refDraftCount > 0;

    // ★★★ P0-1: 既存draft優先ガード（enterEdit内）★★★
    // cache/storage/refのいずれかにdraftあれば、それを使いDB seedしない
    if (storedDraftCount > 0 && isDraftMine) {
      shapesToSeed = existingDraft.shapes;
      seededFromDBRef.current = false;
      addDebugLog(`[P0-1] enterEdit: using stored draft (${storedDraftCount} shapes), DB seed skipped`);
      showToast('下書きを復元しました', 'info');
    } else if (cachedDraftCount > 0) {
      shapesToSeed = draftCacheRef.current.get(editDraftKey);
      seededFromDBRef.current = false;
      addDebugLog(`[P0-1] enterEdit: using cached draft (${cachedDraftCount} shapes), DB seed skipped`);
    } else if (refDraftCount > 0) {
      shapesToSeed = draftShapesRef.current;
      seededFromDBRef.current = false;
      addDebugLog(`[P0-1] enterEdit: using ref draft (${refDraftCount} shapes), DB seed skipped`);
    } else {
      // ★★★ 既存draftが全く無い場合のみDB seed ★★★
      if (existingDraft?.shapes?.length > 0 && !isDraftMine) {
        addDebugLog(`[P0] Ignoring draft from different author: expected=${currentAuthorKey}, draft=${draftAuthorKey}`);
      }
      shapesToSeed = allShapes.filter(s => resolveCommentId(s) === String(comment.id));
      seededFromDBRef.current = true;
      addDebugLog(`[P1-seed] Seeded ${shapesToSeed.length} DB shapes for comment ${comment.id.substring(0, 12)}`);
    }
    
    // Hunk K: seed時のtransient除去（DB由来shape→draftShapesでdirty混入防止）
    shapesToSeed = shapesToSeed.map(stripTransient);
    
    // draftShapes にコピーし、既存ドラフトとして扱う
    setDraftShapes(shapesToSeed);
    draftShapesRef.current = shapesToSeed;
    
    // キャッシュにも即座に反映
    draftCacheRef.current.set(editDraftKey, shapesToSeed);

    addDebugLog(`[P1-seed] Seeded ${shapesToSeed.length} shapes to draft for comment ${comment.id.substring(0, 12)}`);

    setPaintSessionCommentId(null);
    
    // ★★★ P0-1 FIX: seed完了後は hydratedKey を editDraftKey に確定（下書き上書き防止）★★★
    // これにより、hydrate useEffect が再度 loadDraft() しても、hydratedKey が一致したスキップされる
    hydratedKeyRef.current = editDraftKey;
    setHydratedKeyState(editDraftKey);
    
    // ★★★ P0: 編集突入フラグを立てる（onShapesChangeでの誤dirty化を防止）★★★
    justEnteredEditRef.current = { key: editDraftKey, active: true };
    addDebugLog(`[P0] justEnteredEdit set active for key=${editDraftKey.substring(0, 30)}`);
    
    // ★★★ P0: baseline比較用のシグネチャを保存（autosaveガード）★★★
    seedBaselineKeyRef.current = editDraftKey;
    seedBaselineSigRef.current = stableSig(shapesToSeed);
    seedBaselineArmedRef.current = true;
    addDebugLog(`[P0] baseline armed for key=${editDraftKey.substring(0, 30)}, shapes=${shapesToSeed.length}`);
    
    // ★★★ P0-A: 編集突入時はautosaveを無効化（ユーザー操作まで保存しない）★★★
    autosaveArmedRef.current = false;
    addDebugLog(`[P0-A] autosave disarmed on enterEdit`);
  };

  // ★★★ P1: コメント編集/削除権限判定（admin=オーナー、manager=管理者、member=本人のみ）★★★
  const canEditDeleteComment = (comment) => {
    // admin（Base44組み込み）はオーナー権限（全て可）
    if (authUser?.role === 'admin') return true;
    
    // manager（アプリ権限）は管理者権限（全て可）
    if (userAppRole === 'manager') return true;
    
    // member（またはログインなし）は本人のみ
    return comment.author_key === guestId;
  };

  const handleStartEditComment = (comment) => {
    // ★★★ P1: 権限判定（admin/manager/本人のみ）★★★
    if (!canEditDeleteComment(comment)) {
      showToast('他のユーザーのコメントは編集できません', 'error');
      return;
    }
    enterEdit(comment);
  };

  // ★★★ FIX-4: 編集モード解除（明示破棄時のみ下書き削除）★★★
  const exitEditMode = (reason = 'unknown') => {
    addDebugLog(`[exitEditMode] reason=${reason} mode=${composerMode}`);

    // ★★★ P0-6 FIX: 明示的破棄はhandleDiscardで完了済み、ここではUI状態のみクリア ★★★
    const shouldDeleteDraft = reason === 'discard_explicitly';
    
    // ★★★ 破棄処理（破棄時のみ実行）★★★
    if (shouldDeleteDraft) {
      // ★★★ P0-6: localStorage削除はhandleDiscardで完了済み、ここではメモリのみクリア ★★★
      const currentDraftScope = draftScope;
      
      // メモリクリア
      setDraftShapes([]);
      draftShapesRef.current = [];
      
      // ★★★ P0-6: キャッシュは該当キーのみ削除済み（全クリアしない）★★★
      // draftCacheRef.current.clear(); // 削除: 他コメントのキャッシュを壊さない
      
      // 新規の場合のみtempCommentIdクリア
      if (currentDraftScope === 'new' && shareLink?.file_id) {
        setTempCommentId(null);
        localStorage.removeItem(`tempCommentId:${shareLink.file_id}`);
      }
    } else {
      addDebugLog(`[exitEditMode] draft preserved: reason=${reason}`);
    }
    
    // ★★★ 閉じる処理（常に実行）★★★
    // ViewerCanvasの描画をクリア
    viewerCanvasRef.current?.afterSubmitClear();
    viewerCanvasRef.current?.clear();
    
    // composerModeを'view'に
    setComposerMode('view');
    setComposerTargetCommentId(null);
    setComposerParentCommentId(null);
    
    // ペイント関連
    seededFromDBRef.current = false; // Hunk B: 編集終了時にseedフラグをリセット（次回edit時の📝防止）
    setPaintMode(false);
    setTool('select');
    setPaintSessionCommentId(null);
    
    // hydrateStateクリア
    hydratedKeyRef.current = null;
    setHydratedKeyState(null);
    
    // UI状態
    setComposerText('');
    setPendingFiles([]);
    setReplyingThreadId(null);
    setIsDockOpen(false);
    
    console.log('[EXIT_DEBUG] exitEditMode END:', {
      reason,
      composerMode: 'view',
      draftPreserved: !shouldDeleteDraft,
    });
  };

  // 後方互換用エイリアス
  const resetEditorSession = exitEditMode;

  const handleCancelEdit = () => {
    console.log('[EXIT_DEBUG] handleCancelEdit called (× button)');
    
    // ★★★ FIX: ×は閉じるだけ（下書き保持）★★★
    exitEditMode('close_only');
  };

  const handleDiscard = () => {
    console.log('[EXIT_DEBUG] handleDiscard called (破棄 button)');
    
    // ★★★ P0-6: scopeId退避（state変更前に必ず取得、完全一致キー生成用）★★★
    const discardTargetCommentId = composerTargetCommentId || activeCommentId;
    const discardDraftScope = draftScope;
    const discardFileId = shareLink?.file_id;
    
    // ★★★ P0-6: 完全一致キーを手動生成（曖昧キー防止）★★★
    let discardTargetKey = null;
    if (discardFileId && discardTargetCommentId && discardDraftScope === 'edit') {
      discardTargetKey = `draftPaint:${discardFileId}:edit:${discardTargetCommentId}`;
    } else if (discardFileId && tempCommentId && discardDraftScope === 'new') {
      discardTargetKey = `draftPaint:${discardFileId}:new:${tempCommentId}`;
    }
    
    // ★★★ P0-6: キーが曖昧なら何も消さない（他コメント巻き込み防止）★★★
    if (!discardTargetKey) {
      console.warn('[P0-6] handleDiscard aborted: cannot build exact key', {
        discardFileId: discardFileId?.substring(0, 12) || 'null',
        discardTargetCommentId: discardTargetCommentId?.substring(0, 12) || 'null',
        discardDraftScope,
        tempCommentId: tempCommentId?.substring(0, 12) || 'null',
      });
      return;
    }
    
    console.log('[P0-6] handleDiscard: exact key to delete:', discardTargetKey.substring(0, 50));
    
    // 確認ダイアログ
    if (typeof window !== 'undefined' && !window.confirm('下書きを破棄しますか？この操作は元に戻せません。')) {
      return;
    }
    
    // ★★★ P0-6: 先に完全一致キーのみを削除（exitEditModeより先に実行）★★★
    deleteDraft(discardTargetKey);
    draftCacheRef.current.delete(discardTargetKey);
    console.log('[P0-6] Deleted exact draft key:', discardTargetKey.substring(0, 50));
    
    // ★★★ P0-6: バッジを即時更新（新しい参照で強制再描画）★★★
    if (discardDraftScope === 'edit' && discardTargetCommentId) {
      setDraftCountByCommentId(prev => {
        const next = { ...prev };
        delete next[discardTargetCommentId];
        console.log('[P0-6] Badge cleared for:', discardTargetCommentId.substring(0, 12));
        return next;
      });
    }
    
    // 明示的破棄（exitEditModeはUI状態クリアのみ、削除は上で完了済み）
    exitEditMode('discard_explicitly');
    
    // ★★★ P0-6: 破棄後にバッジ再計算（scan）して新しい参照で更新 ★★★
    if (discardFileId && guestId) {
      // 少し遅らせてlocalStorage削除が確実に反映されてからスキャン
      setTimeout(() => {
        const refreshed = scanEditDraftsForFile(discardFileId, guestId);
        setDraftCountByCommentId({ ...refreshed }); // 新しい参照で強制更新
        console.log('[P0-6] Badge refreshed after discard:', Object.keys(refreshed).length, 'drafts remaining');
      }, 50);
    }
  };

  const handleStartReply = (parentComment) => {
    // 対応済みチェック
    if (parentComment.resolved) {
      showToast('対応済みのコメントには返信できません', 'info');
      return;
    }

    // ★★★ FIX-5: paintMode中は自動OFF（警告なし、下書き保持）★★★
    if (paintMode) {
      addDebugLog(`[FIX-5] handleStartReply: auto-OFF paint (draft preserved)`);
      setPaintMode(false);
      setTool('select');
    }

    if (authStatus === 'guest' && !guestName.trim()) {
      setShowNameDialog(true);
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
    // ★★★ P1: 権限判定（admin/manager/本人のみ）★★★
    if (!canEditDeleteComment(comment)) {
      showToast('他のユーザーのコメントは削除できません', 'error');
      return;
    }
    
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
        
        return stripTransient(normalized);  // Hunk J: DB由来shapeのtransient除去
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

  // ★★★ DEBUG: context算出ログ ★★★
  useEffect(() => {
    console.log('[ShareView] context resolved:', {
      composerMode,
      paintContextId: paintContextId?.substring(0, 12) || 'null',
      shouldShowDraft,
      storageDraftReady,
      activeCommentId: activeCommentId?.substring(0, 12) || 'null',
      tempCommentId: tempCommentId?.substring(0, 12) || 'null',
    });
  }, [paintContextId, shouldShowDraft, storageDraftReady, composerMode, activeCommentId, tempCommentId]);

  // ★★★ P1: canvasContextKey（再マウント用、ファイル＋ページのみ）★★★
  const canvasContextKey = React.useMemo(() => {
    const fileId = shareLink?.file_id || 'no-file';
    const page = currentPage;
    return `${fileId}:${page}`;
  }, [shareLink?.file_id, currentPage]);
  
  // ★★★ P1: ViewerCanvas内部リセット用キー（fileId + paintContextIdのみ）★★★
  const canvasInternalResetKey = React.useMemo(() => {
    const fileId = shareLink?.file_id || 'no-file';
    if (showAllPaint) return `${fileId}:all`;
    return `${fileId}:${paintContextId || 'none'}`;
  }, [shareLink?.file_id, showAllPaint, paintContextId]);
  
  // ★★★ FIX-T3: Canvas遷移中フラグ（ctx変化→shapesLoaded完了まで）★★★
  const [isTransitioningCtx, setIsTransitioningCtx] = useState(false);
  const transitionTimeoutRef = useRef(null);
  const prevPaintContextIdForTransitionRef = useRef(paintContextId);
  
  useEffect(() => {
    const prev = prevPaintContextIdForTransitionRef.current;
    if (prev !== paintContextId) {
      prevPaintContextIdForTransitionRef.current = paintContextId;
      setIsTransitioningCtx(true);
      addDebugLog(`[FIX-T3] ctx changed, start transition`);
      
      if (transitionTimeoutRef.current) clearTimeout(transitionTimeoutRef.current);
      transitionTimeoutRef.current = setTimeout(() => {
        setIsTransitioningCtx(false);
        addDebugLog(`[FIX-T3] transition timeout (200ms)`);
      }, 200);
    }
  }, [paintContextId]);
  
  useEffect(() => {
    if (isTransitioningCtx && shapesLoaded && !shapesFetching) {
      setIsTransitioningCtx(false);
      addDebugLog(`[FIX-T3] transition end (shapes loaded)`);
      if (transitionTimeoutRef.current) clearTimeout(transitionTimeoutRef.current);
    }
  }, [isTransitioningCtx, shapesLoaded, shapesFetching]);
  
  // ★★★ FIX-FLICKER: shapesFetching除外（送信後refetchでちらつき防止）★★★
  const isCanvasTransitioning = isTransitioningCtx;

  // ★★★ C: チラつき防止 - DB素材が読み込まれるまでドラフトを表示しない ★★★
  const canvasReady = React.useMemo(() => {
    return !!isReady && !!shapesLoaded;
  }, [isReady, shapesLoaded]);

  // CRITICAL: 親側でフィルタリング（ViewerCanvasに渡すshapes）
  // ★★★ CRITICAL: viewContextId（表示）と paintContextId（描画）を分離 ★★★
  const shapesForCanvas = React.useMemo(() => {
    // ★★★ Hunk 0: console.logのみ許可、addDebugLog呼び出し禁止（レンダー中setState防止）★★★
    
    // ★★★ P0-FLICKER: handoffバッファ有効チェック（送信直後のちらつき防止）★★★
    const handoff = handoffRef.current;
    const handoffActive = !!(handoff && handoff.snapshot?.length > 0);
    const handoffKeyMatch = handoffActive && (handoff.key === paintContextId || handoff.key === targetKey);
    
    // ★★★ P0-FLICKER: handoff期限切れチェック（5秒でタイムアウト）★★★
    if (handoffActive && handoff.createdAt && Date.now() - handoff.createdAt > 5000) {
      console.log('[P0-FLICKER] handoff expired, clearing');
      handoffRef.current = null;
    }
    
    // ★★★ CRITICAL: allShapes は既に正規化済み（defaultCommentId=null で DB値保持）★★★
    const allShapesNormalized = allShapes;
    
    // ★★★ CRITICAL: draftShapes を正規化（defaultCommentId=tempCommentId）★★★
    const draftShapesNormalized = draftShapes.map(s => normalizeShape(s, tempCommentId)).filter(Boolean);
    
    // ★★★ FIX-2: DB shapes を常にベースにする（DB優先、merged≥dbを保証）★★★
    // ★★★ P1 FIX: edit/new 中はDB shapesを混ぜない（ドラフト単一ソース）★★★
    // ★★★ FIX-v6: view + activeCommentId=null なら必ず [] （選択解除で描画消失）★★★
    const dbShapesForView = (() => {
      // Hunk A: 表示コンテキストを安全に決定
      const viewCtxId = paintContextId ||
                        (isEditMode ? composerTargetCommentId : null) ||
                        (isNewMode ? tempCommentId : null) ||
                        activeCommentId;

      if (composerMode === 'view' && !activeCommentId) {
        return []; // viewモードでコメント未選択時は完全クリア（既存仕様維持）
      }

      if (showAllPaint) {
        return allShapesNormalized;
      }
      
      if (!viewCtxId) {
        return []; // コンテキストがなければ何も表示しない
      }

      return allShapesNormalized.filter(s => resolveCommentId(s) === String(viewCtxId));
    })();
    
    // ★★★ FIX-DELETE: 削除済みshapeを除外（復活防止）★★★
    const dbShapesFiltered = dbShapesForView.filter(s => !deletedShapeIdsRef.current.has(s.id));
    
    // ★★★ FIX-NO-BLANK: view時はdraftを混ぜない（欠損/ちらつき防止）★★★
    if (!shouldShowDraft) {
      lastMergedShapesRef.current = dbShapesFiltered;
      return dbShapesFiltered;
    }
    
    // ★★★ FIX-2/4: 下書き表示条件（素材ロード後のみ、edit/new時のみ）★★★
    const showEditDraft = !!(shapesLoaded && isEditMode && storageDraftReady);
    const showNewDraft = !!(shapesLoaded && isNewMode && storageDraftReady);
    const shouldShowAnyDraft = showEditDraft || showNewDraft;
    const filterIdForDraft = isEditMode ? String(composerTargetCommentId) : (isNewMode ? String(tempCommentId) : null);
    
    const draftShapesForView = shouldShowAnyDraft && filterIdForDraft
      ? draftShapesNormalized.filter(s => String(resolveCommentId(s) || '') === filterIdForDraft)
      : [];
    
    // ★★★ FIX-DELETE: 削除済みshapeを除外（復活防止）★★★
    const draftShapesFiltered = draftShapesForView.filter(s => !deletedShapeIdsRef.current.has(s.id));
    
    // ★★★ FIX-A: shapeIdベースMapマージ（count比較禁止、DB+draft上書き）★★★
    const shapeMap = new Map();
    dbShapesFiltered.forEach(s => shapeMap.set(s.id, s));
    draftShapesFiltered.forEach(s => shapeMap.set(s.id, s));
    let merged = Array.from(shapeMap.values());
    
    // ★★★ P0-FLICKER: handoffバッファからの補完（送信直後のちらつき防止）★★★
    // edit/new終了直後（composerMode='view'）でhandoffが有効、かつDBにまだ全て反映されていない場合
    const handoffNow = handoffRef.current;
    if (handoffNow && handoffNow.snapshot?.length > 0) {
      const existingIds = new Set(merged.map(s => String(s.id)));
      const allIncluded = [...handoffNow.pendingIds].every(id => existingIds.has(id));
      
      if (!allIncluded) {
        // DBにまだ反映されていないshapeをhandoffから補完
        const supplemented = [...merged];
        handoffNow.snapshot.forEach(s => {
          if (!existingIds.has(String(s.id))) {
            supplemented.push(s);
          }
        });
        console.log('[P0-FLICKER] handoff补完:', {
          mergedBefore: merged.length,
          supplementedAfter: supplemented.length,
          pendingCount: handoffNow.pendingIds.size,
        });
        merged = supplemented;
      } else {
        // 全て反映されたのでhandoffをクリア
        console.log('[P0-FLICKER] handoff cleared (all shapes now in DB)');
        handoffRef.current = null;
      }
    }
    
    // P1 FIX: 描画混入の直接原因であるため、このブロックを削除。
    // これにより、描画がないコメントを選択した際に、古い描画が返されることがなくなります。
    
    // P1 FIX: 描画混入の直接原因であるため、このブロックを削除。
    // これにより、描画がないコメントを選択した際に、古い描画が返されることがなくなります。

    // ★★★ Hunk S (P0): sticky guard — 同一ctxで空配列になるのを防ぐ ★★★
    if (merged.length === 0 && (shouldShowDraft || composerMode === 'edit') && lastMergedShapesRef.current?.length > 0 && prevPaintContextIdForMergedRef.current === paintContextId) {
      addDebugLog(`[Hunk S] sticky guard triggered: returning last merged shapes (${lastMergedShapesRef.current.length}) to prevent clear`);
      return lastMergedShapesRef.current;
    }

    prevPaintContextIdForMergedRef.current = paintContextId;
    if (merged.length > 0) {
      lastMergedShapesRef.current = merged;
    }
    return merged;
  }, [allShapes, draftShapes, showAllPaint, paintContextId, shouldShowDraft, storageDraftReady, composerMode, tempCommentId, canvasReady, activeCommentId]);
  
  // ★★★ Hunk 0: useEffect でデバッグログを分離（レンダー中のaddDebugLog呼び出し廃止）★★★
  const lastResultLogRef = useRef(null);
  useEffect(() => {
    const resultLog = `paintCtx=${paintContextId?.substring(0, 12) || 'null'} mode=${composerMode} db=${(shapesForCanvas.filter(s => !isTempCid(resolveCommentId(s))).length)} draft=${(shapesForCanvas.filter(s => isTempCid(resolveCommentId(s))).length)} merged=${shapesForCanvas.length} trans=${isCanvasTransitioning}`;
    if (lastResultLogRef.current !== resultLog) {
      lastResultLogRef.current = resultLog;
      console.log('[shapesForCanvas]', resultLog);
      addDebugLog(`[shapesForCanvas] ${resultLog}`);
    }
  }, [shapesForCanvas, paintContextId, composerMode, isCanvasTransitioning]);

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

  // ★★★ P0: localStorage直接スキャンで下書き検出（comments不要、初回から安定）★★★
  const [draftCountByCommentId, setDraftCountByCommentId] = useState({});
  
  // ヘルパー: fileId単位でedit下書きをスキャン（P0: 本人＋commentId照合＋古い下書き除外）
  const scanEditDraftsForFile = React.useCallback((fileId, currentGuestId) => {
    if (!fileId) return {};
    
    const map = {};
    const prefix = `draftPaint:${fileId}:edit:`;
    
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) {
        try {
          const draft = loadDraft(key);
          
          // ★★★ P0-A: authorKey必須チェック（古い下書き除外）★★★
          if (!draft?.authorKey) {
            console.warn('[scanEditDrafts] skipping draft without authorKey (legacy):', key.substring(0, 40));
            continue;
          }
          
          // ★★★ P0-A: 本人の下書きのみカウント（混線防止）★★★
          if (draft.authorKey !== currentGuestId) {
            continue;
          }
          
          // ★★★ P0-B: commentId必須チェック（古い下書き除外）★★★
          if (!draft?.commentId) {
            console.warn('[scanEditDrafts] skipping draft without commentId (legacy):', key.substring(0, 40));
            continue;
          }
          
          // ★★★ P0-B: commentId照合（キー由来とdraft内部で一致確認）★★★
          const commentIdFromKey = key.substring(prefix.length);
          if (String(draft.commentId) !== String(commentIdFromKey)) {
            console.warn('[scanEditDrafts] commentId mismatch, skipping:', {
              key: key.substring(0, 40),
              keyCommentId: commentIdFromKey.substring(0, 12),
              draftCommentId: draft.commentId?.substring(0, 12),
            });
            continue;
          }
          
          const count = draft?.shapes?.length || 0;
          if (count > 0) {
            map[commentIdFromKey] = count;
          }
        } catch (e) {
          console.warn('[scanEditDrafts] parse error:', key, e);
        }
      }
    }
    
    return map;
  }, []);
  
  useEffect(() => {
    if (!shareLink?.file_id || !guestId) {
      setDraftCountByCommentId({});
      return;
    }
    
    // ★ まずlocalStorageをスキャン（P0: 本人の下書きのみ、comments不要）
    const scanned = scanEditDraftsForFile(shareLink.file_id, guestId);
    
    // ★ commentsが揃ったら追加補正（本人チェック付き）
    if (comments && comments.length > 0) {
      comments.forEach((comment) => {
        if (!scanned[comment.id]) {
          const editDraftKey = getDraftKey(shareLink.file_id, comment.id, null, 'edit');
          try {
            const draft = loadDraft(editDraftKey);
            
            // ★★★ P0-A: authorKey必須チェック（古い下書き除外）★★★
            if (!draft?.authorKey) {
              return;
            }
            
            // ★★★ P0-A: 本人の下書きのみカウント ★★★
            if (draft.authorKey !== guestId) {
              return;
            }
            
            // ★★★ P0-B: commentId必須チェック（古い下書き除外）★★★
            if (!draft?.commentId) {
              return;
            }
            
            // ★★★ P0-B: commentId照合（混線防止）★★★
            if (String(draft.commentId) !== String(comment.id)) {
              console.warn('[draftCountByCommentId] commentId mismatch, skipping:', {
                commentId: comment.id.substring(0, 12),
                draftCommentId: draft.commentId?.substring(0, 12),
              });
              return;
            }
            
            const count = draft?.shapes?.length || 0;
            if (count > 0) {
              scanned[comment.id] = count;
            }
          } catch (e) {
            // ignore
          }
        }
      });
    }
    
    // ★★★ P1 FIX: 差分がある場合のみ更新して無限ループを防止 ★★★
    const hasChanged = 
      Object.keys(scanned).length !== Object.keys(draftCountByCommentId).length ||
      Object.keys(scanned).some(key => scanned[key] !== draftCountByCommentId[key]);

    if (hasChanged) {
      setDraftCountByCommentId(scanned);
    }
  }, [shareLink?.file_id, guestId, comments, scanEditDraftsForFile]);

  const handleSaveName = () => {
    if (!guestName.trim()) return;
    localStorage.setItem(`guestName_${token}`, guestName);
    localStorage.setItem('guestName_global', guestName);
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
    {/* Debugボタン（固定表示、isReady不問） */}
    {(debugParam === '1' || (typeof window !== 'undefined' && localStorage.getItem('forceDebug') === '1') || DEBUG_MODE) && (
      <div style={{ position: 'fixed', top: '12px', right: '12px', zIndex: 99999, pointerEvents: 'auto' }}>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            try {
              const debugData = {
                timestamp: new Date().toISOString(),
                paintMode,
                tool,
                composerMode,
                isEditMode,
                isNewMode,
                paintContextId: paintContextId?.substring(0, 12) || 'null',
                targetKey: targetKey?.substring(0, 50) || 'null',
                draftScope,
                draftReady,
                shapesLoaded,
                shapesFetching,
                dbCount: paintShapes.length,
                draftCount: draftShapes.length,
                mergedCount: shapesForCanvas.length,
                isCanvasTransitioning,
                ctx: canvasInternalResetKey?.substring(0, 50) || 'null',
                recentLogs: debugLogBufferRef.current.slice(-100),
              };
              const text = JSON.stringify(debugData, null, 2);
              
              if (typeof navigator !== 'undefined' && navigator.clipboard) {
                navigator.clipboard.writeText(text).then(() => {
                  showToast('📋 Debug情報をコピーしました', 'success');
                }).catch(() => {
                  const textarea = document.createElement('textarea');
                  textarea.value = text;
                  textarea.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:80%;height:60%;z-index:99999;padding:20px;font-family:monospace;font-size:12px;border:2px solid #000;background:white;';
                  document.body.appendChild(textarea);
                  textarea.focus();
                  textarea.select();
                  setTimeout(() => textarea.remove(), 60000);
                });
              } else {
                const textarea = document.createElement('textarea');
                textarea.value = text;
                textarea.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:80%;height:60%;z-index:99999;padding:20px;font-family:monospace;font-size:12px;border:2px solid #000;background:white;';
                document.body.appendChild(textarea);
                textarea.focus();
                textarea.select();
                setTimeout(() => textarea.remove(), 60000);
              }
            } catch (e) {
              showToast('コピー失敗: ' + e.message, 'error');
            }
          }}
          className="text-xs bg-yellow-100 hover:bg-yellow-200 border-yellow-400 shadow-lg font-bold"
        >
          📋 Debug
        </Button>
      </div>
    )}
    
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
                /* P0-FLICKER: key削除でremount防止、内部リセットはcanvasContextKeyで制御 */
                ref={viewerCanvasRef}
                fileUrl={file?.file_url}
                mimeType={file?.mime_type}
                pageNumber={currentPage}
                existingShapes={shapesForCanvas}
                comments={comments.filter(c => c.page_no === currentPage)}
                activeCommentId={activeCommentId}
                canvasContextKey={canvasInternalResetKey}
                isCanvasTransitioning={isCanvasTransitioning}
                onCommentClick={(id) => {
                  const comment = comments.find(c => c.id === id);
                  if (!comment) return;
                  selectComment(comment);
                }}
                onShapesChange={(updated) => {
                  // ★★★ CRITICAL: ViewerCanvasからの同期コールバック ★★★
                  
                  // Hunk F: targetKey未確定なら即reject
                  if (!targetKey) {
                    console.log('[ShareView] onShapesChange IGNORED (no targetKey):', {
                      updatedCount: updated.length,
                      targetKey: targetKey?.substring(0, 30) || 'null',
                      hydratedKey: hydratedKeyRef.current?.substring(0, 30) || 'null',
                    });
                    return;
                  }
                  
                  // Hunk F: まだhydrate未完了だが、updatedが空でない最初の描画なら「早期hydrate完了」として受け入れる
                  if (hydratedKeyRef.current !== targetKey) {
                    if (updated.length > 0) {
                      console.log('[Hunk F] Early hydrate: first draw accepted as hydrate complete:', {
                        updatedCount: updated.length,
                        targetKey: targetKey.substring(0, 30),
                      });
                      hydratedKeyRef.current = targetKey;
                      setHydratedKeyState(targetKey);
                      // 以降の処理（キャッシュ更新・draftShapes更新）に進む
                    } else {
                      console.log('[ShareView] onShapesChange IGNORED (not hydrated, empty update):', {
                        updatedCount: updated.length,
                        targetKey: targetKey.substring(0, 30),
                      });
                      return;
                    }
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
                    paintContextId: paintContextId?.substring(0, 12) || 'null',
                  });
                  
                  // Hunk M: 既存draftShapes側の_dirty/_localTsを保持（上書きで消えないように）
                  const prev = draftShapesRef.current || [];
                  const prevMap = new Map(prev.map(s => [s.id, s]));
                  
                  // ★★★ P0: 編集突入直後は新規shapeへのdirty付与をスキップ ★★★
                  const skipMarkNewAsDirty = justEnteredEditRef.current.active;
                  if (skipMarkNewAsDirty) {
                    console.log('[P0] justEnteredEdit active -> skip mark-new-as-dirty');
                    // 一度処理したらフラグを解除
                    justEnteredEditRef.current = { key: null, active: false };
                    addDebugLog(`[P0] justEnteredEdit cleared`);
                  }
                  
                  const updatedWithTransient = updated.map(s => {
                    const p = prevMap.get(s.id);
                    if (p) {
                      // 既存shape: transient保持
                      return { ...s, _dirty: s._dirty ?? p._dirty, _localTs: s._localTs ?? p._localTs };
                    } else {
                      // Hunk M' (P0): 新規shape（prevMapに無い）には_dirtyを付与（初回描画救済）
                      // ★★★ P0: ただし編集突入直後はスキップ（DB shapesを誤dirty化しない）★★★
                      if (skipMarkNewAsDirty) {
                        return s; // dirty付与しない
                      }
                      return { ...s, _dirty: s._dirty ?? true, _localTs: s._localTs ?? Date.now() };
                    }
                  });
                  
                  // ★★★ P1: キャッシュ更新 ★★★
                  if (targetKey) {
                    draftCacheRef.current.set(targetKey, updatedWithTransient);
                  }
                  
                  // メモリに保存（useEffectでlocalStorage自動保存される）
                  draftShapesRef.current = updatedWithTransient;
                  setDraftShapes(updatedWithTransient);
                }}
                onBeginPaint={handleBeginPaint}
                onSaveShape={handleSaveShape}
                onDeleteShape={handleDeleteShape}
                paintMode={isReady && paintMode}
                draftReady={storageDraftReady}
                tool={tool}
                onToolChange={setTool}
                onStrokeColorChange={setStrokeColor}
                onStrokeWidthChange={setStrokeWidth}
                strokeColor={strokeColor}
                strokeWidth={strokeWidth}
                zoom={zoom}
                showBoundingBoxes={showBoundingBoxes}
                showAllPaint={effectiveShowAllPaint}
                forceClearToken={forceClearToken}
                draftCommentId={paintContextId}
                renderTargetCommentId={paintContextId}
                activeCommentId={paintContextId}
                debugInfo={{
                  isReady: isReady,
                  readyDetails: readyDetails,
                  paintContextId: paintContextId,
                  composerMode: composerMode,
                  queryKey: ['paintShapes', token, shareLink?.file_id, currentPage],
                  fetchedCount: paintShapes?.length || 0,
                  filteredCount: shapesForCanvas?.length || 0,
                  showAllPaint: effectiveShowAllPaint,
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

                    {/* 閉じるボタン（編集モード時のみ） */}
                    {composerMode === 'edit' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleCancelEdit}
                        className="mt-1"
                        title="閉じる（下書き保持）"
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    )}
                    
                    {/* 破棄ボタン（編集/新規時、下書きがある場合のみ） */}
                    {(composerMode === 'edit' || composerMode === 'new') && (draftShapes.length > 0 || composerText.trim().length > 0) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleDiscard}
                        className="mt-1 text-red-600 hover:text-red-700"
                        title="下書きを破棄"
                      >
                        <Trash2 className="w-4 h-4" />
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
                    ) : (composerMode === 'edit' || paintSessionCommentId || (composerMode === 'new' && !activeCommentId && draftShapes.length > 0)) ? (
                      <div className="text-xs text-gray-500 flex items-center gap-2">
                        <Badge className="bg-green-600 text-white">
                          {composerMode === 'edit' ? 'コメント編集中' : paintSessionCommentId ? 'コメントに追記中' : '新規作成中'}
                        </Badge>
                        <span>
                          {composerMode === 'edit' ? '保存して更新' : 'コメントを入力してください。'}
                        </span>
                        {/* ★★★ P5: 下書きバッジ（cache含む正確なカウント）★★★ */}
                        {(() => {
                          const cacheCount = targetKey ? (draftCacheRef.current.get(targetKey)?.length || 0) : 0;
                          const displayCount = Math.max(draftShapes.length, cacheCount);
                          return displayCount > 0 ? (
                            <Badge variant="secondary" className="bg-blue-100 text-blue-800">
                              📝 下書き {displayCount}個
                            </Badge>
                          ) : null;
                        })()}
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
                                  
                                  // ★★★ P0: state辞書から参照（確実な再描画）★★★
                                  const draftCount = draftCountByCommentId[comment.id] || 0;
                                  const hasDraft = draftCount > 0;

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
                              onDoubleClick={() => !comment.resolved && handleStartEditComment(comment)}
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
                                {/* ★★★ P5: 下書き表示（ドット）★★★ */}
                                {draftCount > 0 && (
                                  <Badge variant="outline" className="text-xs flex items-center gap-1 bg-blue-50 text-blue-700 border-blue-300">
                                    📝 下書き {draftCount}
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
                                {canEditDeleteComment(comment) && (
                                  <>
                                    <DropdownMenuItem onClick={() => handleStartEditComment(comment)}>
                                      <Edit className="w-4 h-4 mr-2" />
                                      編集
                                    </DropdownMenuItem>
                                    <DropdownMenuItem 
                                      onClick={() => handleDeleteComment(comment)}
                                      className="text-red-600"
                                    >
                                      <Trash className="w-4 h-4 mr-2" />
                                      削除
                                    </DropdownMenuItem>
                                  </>
                                )}
                                <DropdownMenuItem onClick={() => handleStartReply(comment)}>
                                  <MessageSquare className="w-4 h-4 mr-2" />
                                  返信
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleCopyCommentUrl(comment)}>
                                  <LinkIcon className="w-4 h-4 mr-2" />
                                  URLをコピー
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