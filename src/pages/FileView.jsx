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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Download, 
  Share2, 
  ZoomIn, 
  ZoomOut, 
  Send,
  CheckCircle2,
  Paintbrush,
  X,
  MoreVertical,
  Edit,
  Trash,
  Check,
  Circle as CircleIcon,
  Copy,
  Paperclip
} from 'lucide-react';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import ErrorBoundary from '../components/ErrorBoundary';
import ViewerCanvas from '../components/viewer/ViewerCanvas';
import FloatingToolbarPortal from '../components/viewer/FloatingToolbarPortal';
import ShareLinkModal from '../components/viewer/ShareLinkModal';
import ReplyThread from '../components/viewer/ReplyThread';
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
  const [fitMode, setFitMode] = useState('all');
  const [displayPercent, setDisplayPercent] = useState(100);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });
  
  // Draft paint session state
  const [paintSessionCommentId, setPaintSessionCommentId] = useState(null);
  const [draftShapes, setDraftShapes] = useState([]);
  const [activeCommentId, setActiveCommentId] = useState(null);
  const [showAllPaint, setShowAllPaint] = useState(false);
  
  // ★★★ P0-FV: 新規コメント用の temp ID（ViewerCanvas の draftCommentId に渡す）★★★
  // ★★★ 初期値を即座に生成（paintMode ON前でも有効にする）★★★
  const [tempCommentId, setTempCommentId] = useState(() => 'temp_' + crypto.randomUUID());
  
  // Composer mode (new or edit)
  const [composerMode, setComposerMode] = useState('new');
  const [composerTargetCommentId, setComposerTargetCommentId] = useState(null);
  
  // ★★★ 選択抑制: 新規テキスト入力中フラグ（ShareView同等）★★★
  const [isNewCommentInputActive, setIsNewCommentInputActive] = useState(false);
  
  // 添付ファイル state
  const [pendingFiles, setPendingFiles] = useState([]);

  // CRITICAL: 送信完了後のキャンバスクリア用nonce & 連打防止
  const [clearAfterSubmitNonce, setClearAfterSubmitNonce] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // CRITICAL: useRefでロック管理（コンポーネント内で確実に保持）
  const submitLockRef = useRef(false);
  const mutationIdRef = useRef(null);
  
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

  // ★★★ P0-FV: activeCommentId変更時はdraftShapesをクリア（前コメントの下書き混入防止）★★★
  const prevActiveCommentIdRef = useRef(activeCommentId);
  useEffect(() => {
    const prev = prevActiveCommentIdRef.current;
    prevActiveCommentIdRef.current = activeCommentId;
    if (String(prev ?? '') !== String(activeCommentId ?? '')) {
      setDraftShapes([]);
    }
  }, [activeCommentId]);

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

  // 添付ファイル取得
  const { data: attachments = [] } = useQuery({
    queryKey: ['commentAttachments', fileId],
    queryFn: () => base44.entities.ReviewCommentAttachment.filter({ file_id: fileId }),
    enabled: !!fileId,
    staleTime: 30000,
  });

  const attachmentsByComment = React.useMemo(() => {
    const map = {};
    attachments.forEach(att => {
      if (!map[att.comment_id]) map[att.comment_id] = [];
      map[att.comment_id].push(att);
    });
    return map;
  }, [attachments]);

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

  // ★★★ P0-FV: tempCommentId 再生成（送信後など、temp IDがnullになった場合用）★★★
  const ensureTempCommentId = () => {
    if (tempCommentId) return tempCommentId;
    const newId = 'temp_' + crypto.randomUUID();
    console.log('[FileView] ensureTempCommentId: generated', newId);
    setTempCommentId(newId);
    return newId;
  };

  // ★★★ P0-FV: onBeginPaint — ペイント開始時のセッション初期化 ★★★
  const handleBeginPaint = () => {
    console.log('[handleBeginPaint] called, activeCommentId:', activeCommentId, 'tempCommentId:', tempCommentId);
    // 既存コメント選択中ならそのIDを使用、未選択なら新規モード（tempCommentId使用）
    setPaintSessionCommentId(activeCommentId ?? null);
    if (!activeCommentId) {
      setDraftShapes([]);
    }
  };

  // ★★★ P0-FV: handleSaveShape — ShareView同等のdraft-first方式 ★★★
  // 新規コメント中（activeCommentId=null）はメモリ/draftShapesのみ保存。
  // 既存コメント選択中でもdraftShapesに保存（DBへの即時永続化はしない）。
  const handleSaveShape = async (shape, mode) => {
    console.log('[handleSaveShape]', { mode, activeCommentId, tempCommentId: tempCommentId?.substring(0, 12) });
    
    const shapeWithMeta = {
      ...shape,
      id: shape.id || crypto.randomUUID(),
      comment_id: activeCommentId ? String(activeCommentId) : (tempCommentId || ''),
      _dirty: true,
      _localTs: Date.now(),
    };
    
    setDraftShapes(prev => {
      if (mode === 'create') {
        if (prev.some(s => s.id === shapeWithMeta.id)) return prev;
        return [...prev, shapeWithMeta];
      }
      return prev.map(s => s.id === shapeWithMeta.id ? shapeWithMeta : s);
    });
    
    return { draft: true };
  };

  // ★★★ P0-FV: handleDeleteShape — draftShapesから削除のみ ★★★
  const handleDeleteShape = async (shape) => {
    setDraftShapes(prev => prev.filter(s => s.id !== shape.id));
  };

  // ★★★ CRITICAL: 全削除処理を統一（編集モード・新規モード両対応）★★★
  const handleClearAll = async () => {
    // ★★★ CRITICAL: targetIdは編集中コメント > 選択中コメント の優先順 ★★★
    const targetId = String(composerTargetCommentId ?? activeCommentId ?? '');
    
    // ★★★ DEBUG HUD: 削除前の状態を出力 ★★★
    console.log('[handleClearAll] ========== DELETE ALL START ==========');
    console.log('[handleClearAll] targetId:', targetId);
    console.log('[handleClearAll] draftShapesCount:', draftShapes.length);
    console.log('[handleClearAll] state:', {
      composerTargetCommentId,
      activeCommentId,
      paintSessionCommentId,
    });
    
    try {
      // ★★★ 1. draftShapesをクリア（新規・編集両方で実行）★★★
      const draftCount = draftShapes.length;
      setDraftShapes([]);
      
      // ★★★ 2. targetIdが空なら新規モード（draftのみ削除で完了）★★★
      if (!targetId) {
        viewerCanvasRef.current?.clear();
        showToast(`${draftCount}個の描画をクリアしました`);
        console.log('[handleClearAll] draft only, deletedLocalCount:', draftCount, 'deletedDbCount:', 0);
        return;
      }
      
      // ★★★ 3. 既存コメントの描画をDBから削除（編集モード）★★★
      const shapes = await base44.entities.PaintShape.filter({
        file_id: fileId,
        comment_id: targetId,
        page_no: 1,
      });
      
      const deleteAllCandidateCount = shapes.length;
      console.log('[handleClearAll] deleteAllCandidateCount:', deleteAllCandidateCount);
      console.log('[handleClearAll] DB shapes to delete:', {
        targetId,
        shapesToDeleteCount: shapes.length,
        shapeIds: shapes.map(s => s.id),
      });
      
      let deletedDbCount = 0;
      for (const shape of shapes) {
        try {
          await base44.entities.PaintShape.delete(shape.id);
          deletedDbCount++;
        } catch (e) {
          console.error('[handleClearAll] Failed to delete shape:', shape.id, e);
        }
      }
      
      await queryClient.invalidateQueries(['paintShapes', fileId, 1]);
      viewerCanvasRef.current?.clear();
      
      const totalDeleted = draftCount + deletedDbCount;
      console.log('[handleClearAll] ========== DELETE ALL COMPLETE ==========');
      console.log('[handleClearAll] deletedLocalCount:', draftCount);
      console.log('[handleClearAll] deletedDbCount:', deletedDbCount);
      console.log('[handleClearAll] totalDeleted:', totalDeleted);
      
      showToast(`${totalDeleted}個の描画を削除しました`);
    } catch (error) {
      console.error('[handleClearAll] ERROR:', error);
      const errorMsg = error.message || String(error);
      showToast(`削除失敗: ${errorMsg}`, 'error');
    }
  };

  // transientフィールド除去（DB保存前）
  const stripTransient = (shape) => {
    if (!shape) return shape;
    const { _dirty, _localTs, ...clean } = shape;
    return clean;
  };

  // 添付ファイル操作
  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files || []);
    setPendingFiles(prev => [...prev, ...files]);
    e.target.value = ''; // 同じファイルを再選択可能にする
  };

  const handleRemoveFile = (index) => {
    setPendingFiles(prev => prev.filter((_, i) => i !== index));
  };

  // CRITICAL: useMutationで送信処理を管理（React Queryが重複防止を担当）
  const createCommentMutation = useMutation({
    mutationFn: async ({ body, shapes, files }) => {
      const clientMutationId = crypto.randomUUID();
      console.log(`[comment] create called mid=${clientMutationId}`);
      
      const existingComments = await base44.entities.ReviewComment.filter({ file_id: fileId });
      const maxSeqNo = existingComments.reduce((max, c) => Math.max(max, c.seq_no || 0), 0);

      let anchor_nx = 0.5;
      let anchor_ny = 0.5;
      
      if (shapes.length > 0) {
        const allPoints = [];
        shapes.forEach(shape => {
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
        file_id: fileId,
        page_no: 1,
        seq_no: maxSeqNo + 1,
        anchor_nx,
        anchor_ny,
        author_type: 'user',
        author_user_id: user?.id,
        author_name: user?.full_name,
        body,
        resolved: false,
        has_paint: shapes.length > 0,
        client_mutation_id: clientMutationId,
      });

      // ★★★ CRITICAL: 新規コメント作成時にdraftShapesをDBに永続化（ShareView同等）★★★
      if (shapes.length > 0) {
        console.log(`[FileView] Saving ${shapes.length} shapes to DB for comment ${comment.id}`);
        for (const shape of shapes) {
          const cleanShape = stripTransient(shape);
          await base44.entities.PaintShape.create({
            file_id: fileId,
            comment_id: comment.id,
            page_no: 1,
            client_shape_id: cleanShape.id,
            shape_type: cleanShape.tool,
            data_json: JSON.stringify(cleanShape),
            author_key: user?.id,
            author_name: user?.full_name,
          });
        }
      }

      // 添付ファイルアップロード
      if (files && files.length > 0) {
        for (const file of files) {
          const { file_url } = await base44.integrations.Core.UploadFile({ file });
          await base44.entities.ReviewCommentAttachment.create({
            file_id: fileId,
            comment_id: comment.id,
            uploader_type: 'user',
            uploader_key: user?.id,
            uploader_name: user?.full_name,
            file_url,
            original_filename: file.name,
            mime_type: file.type,
            size_bytes: file.size,
          });
        }
      }

      return comment;
    },
    onSuccess: () => {
      showToast('コメントを送信しました', 'success');
      // ★★★ CRITICAL: 描画クリアを最優先で実行 ★★★
      viewerCanvasRef.current?.afterSubmitClear();
      viewerCanvasRef.current?.clear();
      
      // リセット処理
      setCommentBody('');
      setDraftShapes([]);
      setPendingFiles([]);
      setComposerMode('new');
      setComposerTargetCommentId(null);
      setPaintSessionCommentId(null);
      setActiveCommentId(null);
      setTempCommentId('temp_' + crypto.randomUUID()); // ★★★ P0-FV: 新しいtempIdを再生成 ★★★
      setPaintMode(false);
      setTool('select');
      setClearAfterSubmitNonce(n => n + 1);
      
      // invalidateは少し遅らせて描画クリアを確実に先に完了させる
      setTimeout(() => {
        queryClient.invalidateQueries(['comments']);
        queryClient.invalidateQueries(['paintShapes']);
        queryClient.invalidateQueries(['commentAttachments']);
      }, 100);
    },
    onError: (error) => {
      showToast(`送信失敗: ${error.message}`, 'error');
    },
  });

  const updateCommentMutation = useMutation({
    mutationFn: async ({ targetId, body, hasShapes, shapes, files }) => {
      await base44.entities.ReviewComment.update(targetId, {
        body,
        has_paint: hasShapes,
      });

      // ★★★ CRITICAL: 編集時は既存shape削除→再作成（ShareView同等の置換方式）★★★
      if (shapes && shapes.length > 0) {
        const existingPaintShapes = await base44.entities.PaintShape.filter({ comment_id: targetId, file_id: fileId });
        for (const existing of existingPaintShapes) {
          await base44.entities.PaintShape.delete(existing.id);
        }
        for (const shape of shapes) {
          const cleanShape = stripTransient(shape);
          await base44.entities.PaintShape.create({
            file_id: fileId,
            comment_id: targetId,
            page_no: 1,
            client_shape_id: cleanShape.id,
            shape_type: cleanShape.tool,
            data_json: JSON.stringify(cleanShape),
            author_key: user?.id,
            author_name: user?.full_name,
          });
        }
      }

      // 添付ファイルアップロード（編集時）
      if (files && files.length > 0) {
        for (const file of files) {
          const { file_url } = await base44.integrations.Core.UploadFile({ file });
          await base44.entities.ReviewCommentAttachment.create({
            file_id: fileId,
            comment_id: targetId,
            uploader_type: 'user',
            uploader_key: user?.id,
            uploader_name: user?.full_name,
            file_url,
            original_filename: file.name,
            mime_type: file.type,
            size_bytes: file.size,
          });
        }
      }
    },
    onSuccess: () => {
      showToast('コメントを更新しました', 'success');
      // ★★★ CRITICAL: 描画クリアを最優先で実行 ★★★
      viewerCanvasRef.current?.afterSubmitClear();
      viewerCanvasRef.current?.clear();
      
      // リセット処理
      setCommentBody('');
      setDraftShapes([]);
      setPendingFiles([]);
      setComposerMode('new');
      setComposerTargetCommentId(null);
      setPaintSessionCommentId(null);
      setActiveCommentId(null);
      setTempCommentId('temp_' + crypto.randomUUID()); // ★★★ P0-FV: 新しいtempIdを再生成 ★★★
      setPaintMode(false);
      setTool('select');
      setClearAfterSubmitNonce(n => n + 1);
      
      // invalidateは少し遅らせて描画クリアを確実に先に完了させる
      setTimeout(() => {
        queryClient.invalidateQueries(['comments']);
        queryClient.invalidateQueries(['paintShapes']);
        queryClient.invalidateQueries(['commentAttachments']);
      }, 100);
    },
    onError: (error) => {
      showToast(`更新失敗: ${error.message}`, 'error');
    },
  });

  // CRITICAL: 送信処理（完全同期的なロック管理）
  const handleSendComment = React.useCallback((e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    
    // CRITICAL: 全ての条件を同期的にチェック
    // 1. refロック（最速・最も確実）
    if (submitLockRef.current === true) {
      console.log("[submit] BLOCKED by submitLockRef.current === true");
      return;
    }
    
    // 2. stateロック（UIと連動）
    if (isSubmitting === true) {
      console.log("[submit] BLOCKED by isSubmitting === true");
      return;
    }
    
    // 3. mutation状態（React Queryの内部状態）
    if (createCommentMutation.isPending || updateCommentMutation.isPending) {
      console.log("[submit] BLOCKED by mutation.isPending");
      return;
    }
    
    // 4. 入力チェック
    if (!commentBody.trim() || !user) {
      console.log("[submit] BLOCKED: empty body or no user");
      return;
    }
    
    // ★★★ CRITICAL: ここで即座に全てのロックを取得 ★★★
    // これ以降のコードが実行される前に、他のクリックをブロック
    submitLockRef.current = true;
    setIsSubmitting(true);
    
    console.log("[submit] === LOCK ACQUIRED ===", new Date().toISOString());
    
    // 現在の値をキャプチャ（クロージャの問題を避ける）
    const currentBody = commentBody;
    const currentDraftShapes = [...draftShapes];
    const currentFiles = [...pendingFiles];
    const currentComposerMode = composerMode;
    const currentTargetId = composerTargetCommentId || activeCommentId;
    
    // CRITICAL: 編集モード or activeCommentIdがある場合は「更新」
    if ((currentComposerMode === 'edit' && currentTargetId) || activeCommentId) {
      updateCommentMutation.mutate(
        { targetId: currentTargetId, body: currentBody, hasShapes: currentDraftShapes.length > 0, shapes: currentDraftShapes, files: currentFiles },
        {
          onSettled: () => {
            console.log("[submit] === LOCK RELEASED (update) ===", new Date().toISOString());
            submitLockRef.current = false;
            setIsSubmitting(false);
          },
        }
      );
    } else {
      // 新規モード
      createCommentMutation.mutate(
        { body: currentBody, shapes: currentDraftShapes, files: currentFiles },
        {
          onSettled: () => {
            console.log("[submit] === LOCK RELEASED (create) ===", new Date().toISOString());
            submitLockRef.current = false;
            setIsSubmitting(false);
          },
        }
      );
    }
  }, [
    isSubmitting,
    commentBody,
    user,
    draftShapes,
    pendingFiles,
    composerMode,
    composerTargetCommentId,
    activeCommentId,
    createCommentMutation,
    updateCommentMutation,
  ]);

  // ★★★ 選択抑制: 新規テキスト入力時にコメント選択をブロック（ShareView同等）★★★
  const enterNewTextOnlyComposer = (e) => {
    e?.stopPropagation?.();
    setComposerMode('new');
    setPaintMode(false);
    if (activeCommentId) setActiveCommentId(null);
    if (composerTargetCommentId) setComposerTargetCommentId(null);
    setIsNewCommentInputActive(true);
  };

  // ★★★ ペイントモード切替（ShareView同等）★★★
  const handlePaintModeChange = (mode) => {
    if (!mode) { setPaintMode(false); setTool('select'); return; }
    if (mode) setIsNewCommentInputActive(false);
    
    if (activeCommentId) {
      // 既存コメント選択中：そのコメントの描画を編集
      setPaintSessionCommentId(activeCommentId);
      setComposerMode('edit');
      setComposerTargetCommentId(activeCommentId);
      if (!commentBody) {
        const comment = comments.find(c => c.id === activeCommentId);
        if (comment) setCommentBody(comment.body || '');
      }
    } else {
      // 新規：既存コメント描画は非表示
      setActiveCommentId(null);
      setPaintSessionCommentId(null);
      setComposerMode('new');
      setComposerTargetCommentId(null);
    }
    setPaintMode(true);
  };

  const handleCommentClick = (comment) => {
    // ★★★ 選択抑制: 新規テキスト入力中はクリック無視（ShareView同等）★★★
    if (isNewCommentInputActive) {
      console.log('[FileView] selection suppressed (new text-only composer active)');
      return;
    }
    
    console.log('[FileView] handleCommentClick:', { commentId: comment.id, activeCommentId, paintMode });
    
    if (paintMode) {
      setPaintMode(false);
      setTool('select');
    }

    // 同じコメントを再クリック → 選択解除
    if (String(activeCommentId) === String(comment.id) && composerMode !== 'edit') {
      console.log('[FileView] Deselecting comment');
      setActiveCommentId(null);
      setDraftShapes([]);
      setComposerMode('new');
      setComposerTargetCommentId(null);
      setCommentBody('');
      return;
    }
    
    // 別のコメントをクリック → 選択
    console.log('[FileView] Selecting comment:', comment.id);
    setActiveCommentId(comment.id);
    setPaintSessionCommentId(null);
    setDraftShapes([]);
    setIsNewCommentInputActive(false);
    
    if (composerMode === 'edit' && String(composerTargetCommentId) !== String(comment.id)) {
      setComposerMode('new');
      setComposerTargetCommentId(null);
      setCommentBody('');
    }
  };

  // ★★★ ダブルクリックで編集モードに入る ★★★
  const handleCommentDoubleClick = (e, comment) => {
    e.preventDefault();
    e.stopPropagation();
    console.log('[FileView] handleCommentDoubleClick:', comment.id);
    
    if (paintMode) {
      showToast('ペイントを終了してから編集してください', 'error');
      return;
    }
    
    setActiveCommentId(comment.id);
    setPaintSessionCommentId(comment.id);
    setComposerMode('edit');
    setComposerTargetCommentId(comment.id);
    setCommentBody(comment.body || '');
  };

  // ★★★ CRITICAL: 編集モード解除の統一関数 ★★★
  const exitEditMode = () => {
    // ViewerCanvasの描画をクリア
    viewerCanvasRef.current?.afterSubmitClear();
    viewerCanvasRef.current?.clear();
    
    // 編集モード解除
    setComposerMode('new');
    setComposerTargetCommentId(null);
    
    // ★★★ CRITICAL: activeCommentIdをnullにして描画表示を消す ★★★
    setActiveCommentId(null);
    
    // ペイント関連
    setPaintMode(false);
    setTool('select');
    setPaintSessionCommentId(null);
    
    // draft/描画一時stateクリア
    setDraftShapes([]);
    setCommentBody('');
    
    // clearAfterSubmitNonceを更新してViewerCanvasに完全リセットを通知
    setClearAfterSubmitNonce(n => n + 1);
  };

  const handleCancelEdit = () => {
    // ★★★ CRITICAL: 統一関数を呼ぶ ★★★
    exitEditMode();
  };

  const toggleResolveMutation = useMutation({
    mutationFn: ({ id, resolved }) => base44.entities.ReviewComment.update(id, { resolved }),
    onSuccess: () => {
      queryClient.invalidateQueries(['comments']);
    },
  });

  // PaintShapeをViewerCanvas用の形式に変換
  // ★★★ CRITICAL FIX: DBの comment_id フィールドを最優先で使い、スプレッドの後で上書き ★★★
  const allShapes = React.useMemo(() => {
    console.log('[FileView] allShapes recalculating, paintShapes count:', paintShapes.length);

    const result = paintShapes.map(ps => {
      try {
        const data = JSON.parse(ps.data_json);

        // ★★★ CRITICAL: DBの ps.comment_id を最優先（これが実際のReviewComment ID）★★★
        const dbCommentId = ps.comment_id;

        console.log('[FileView] parsing shape:', {
          psId: ps.id,
          psCommentId: ps.comment_id,  // これが正しいID
          dataCommentId: data.comment_id,  // これは仮UUID（無視すべき）
        });

        // ★★★ CRITICAL: comment_idが無いshapeは除外（表示しない）★★★
        if (dbCommentId == null || dbCommentId === '') {
          console.log('[FileView] Skipping shape with empty comment_id:', ps.id);
          return null;
        }

        // ★★★ CRITICAL: スプレッドの前にdata.comment_idを削除して混入防止 ★★★
        const cleanData = { ...data };
        delete cleanData.comment_id;
        delete cleanData.commentId;
        delete cleanData.commentID;

        return {
          ...cleanData,
          id: ps.id,
          tool: ps.shape_type,
          comment_id: String(dbCommentId),  // ★ String型で統一
        };
      } catch (e) {
        console.error('Failed to parse shape:', e);
        return null;
      }
    }).filter(Boolean);

    console.log('[FileView] allShapes parsed:', {
      count: result.length,
      commentIds: result.map(s => s.comment_id),
    });

    return result;
  }, [paintShapes]);

  // ★★★ P0-FV: 既存の複雑な effectiveActiveId / targetIdForShapes は不要 ★★★
  // shapesForCanvas は normalizedActiveCommentId + draftShapes で直接計算（下で定義）

  // ★★★ P0-FV: ViewerCanvas に渡す props の算出 ★★★
  const normalizedActiveCommentId = activeCommentId != null ? String(activeCommentId) : null;
  const isUnselected = !normalizedActiveCommentId;
  // ★★★ P0-FV: 未選択時は showAllPaint 強制 false（ShareView同等）★★★
  const effectiveShowAllPaint = !isUnselected && showAllPaint;
  // renderTargetCommentId: 既存コメント選択時のみ設定（未選択時はnull→showDraftOnlyで下書き表示）
  const renderTargetCommentIdForCanvas = isUnselected ? null : normalizedActiveCommentId;
  // draftCommentId: 常にtempCommentIdを渡す（ViewerCanvasが新規描画の紐付け先に使う）
  const draftCommentIdForCanvas = tempCommentId;
  // paintContextId: ViewerCanvasのcanvasContextKey用（描画モードの一意識別）
  const paintContextId = activeCommentId ? String(activeCommentId) : (tempCommentId || 'none');

  // ★★★ P0-FV: ViewerCanvasに渡すshapes ★★★
  // 未選択時（新規コメント中）→ draftShapesのみ
  // 選択時 → allShapes から activeCommentId でフィルタ + draftShapes をマージ
  const shapesForCanvas = React.useMemo(() => {
    if (isUnselected) {
      // 新規コメント中: draftShapesのみ（tempCommentIdに紐付いた下書き）
      return draftShapes;
    }

    // 既存コメント選択中: DB shapesからフィルタ
    const filtered = allShapes.filter(s => {
      const cid = s.comment_id;
      if (cid == null || cid === '') return false;
      return String(cid) === normalizedActiveCommentId;
    });

    // draftShapesとマージ（IDベースで重複排除、draftが優先）
    const shapeMap = new Map();
    filtered.forEach(s => shapeMap.set(s.id, s));
    draftShapes.forEach(s => shapeMap.set(s.id, s));
    return Array.from(shapeMap.values());
  }, [allShapes, draftShapes, isUnselected, normalizedActiveCommentId]);

  // 親コメントと返信を分離
  const parentComments = comments.filter(c => !c.parent_comment_id);
  const repliesByParent = React.useMemo(() => {
    const map = {};
    comments.forEach(c => {
      if (c.parent_comment_id) {
        if (!map[c.parent_comment_id]) map[c.parent_comment_id] = [];
        map[c.parent_comment_id].push(c);
      }
    });
    return map;
  }, [comments]);

  const filteredComments = parentComments.filter(c => {
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
      {/* ヘッダー */}
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
        {/* 左：サムネ（簡易版、ShareView同等） */}
        <div className="w-48 border-r bg-gray-50 overflow-y-auto p-4">
          <div className="space-y-2">
            <div className="border-2 border-blue-600 rounded p-2 text-center text-sm bg-blue-50">
              1
            </div>
          </div>
        </div>

        {/* 中央：プレビュー + 下部Composer（ShareView同等の grid構成） */}
        <div className="flex-1 grid grid-rows-[1fr_auto] min-h-0">
          {/* 上段：素材表示エリア */}
          <div className="bg-gray-100 overflow-auto relative min-h-0">
            <ViewerCanvas
              ref={viewerCanvasRef}
              fileUrl={file?.file_url}
              mimeType={file?.mime_type}
              pageNumber={1}
              existingShapes={shapesForCanvas}
              activeCommentId={normalizedActiveCommentId}
              showAllPaint={effectiveShowAllPaint}
              clearAfterSubmitNonce={clearAfterSubmitNonce}
              renderTargetCommentId={renderTargetCommentIdForCanvas}
              draftCommentId={draftCommentIdForCanvas}
              showDraftOnly={isUnselected && draftShapes.length > 0}
              draftReady={true}
              canvasContextKey={`${fileId}:1:${paintContextId}`}
              fitMode={fitMode}
              externalPan={pan}
              onPanChange={setPan}
              onScaleInfoChange={(info) => setDisplayPercent(info.effectivePercent)}
              onShapesChange={(updated) => {
                if (updated.length === 0 && draftShapes.length > 0) {
                  console.log('[FileView] onShapesChange IGNORED (empty would overwrite draft)');
                  return;
                }
                setDraftShapes(updated);
              }}
              onSaveShape={handleSaveShape}
              onDeleteShape={handleDeleteShape}
              onBeginPaint={handleBeginPaint}
              paintMode={paintMode}
              tool={tool}
              onToolChange={setTool}
              strokeColor={strokeColor}
              onStrokeColorChange={setStrokeColor}
              strokeWidth={strokeWidth}
              onStrokeWidthChange={setStrokeWidth}
              zoom={zoom}
            />

            {/* ズーム制御 */}
            <div className="absolute top-4 right-4 bg-white rounded-lg shadow-lg p-2 flex items-center gap-2">
              <Button variant="outline" size="icon" onClick={() => setZoom(Math.max(25, zoom - 25))}>
                <ZoomOut className="w-4 h-4" />
              </Button>
              <span className="text-sm font-medium w-16 text-center">{displayPercent}%</span>
              <Button variant="outline" size="icon" onClick={() => setZoom(Math.min(400, zoom + 25))}>
                <ZoomIn className="w-4 h-4" />
              </Button>
              <div className="border-l pl-2 ml-1 flex gap-1">
                <Button
                  variant={fitMode === 'all' ? 'default' : 'outline'}
                  size="sm"
                  className="text-xs px-2"
                  onClick={() => { setFitMode('all'); setZoom(100); setPan({ x: 0, y: 0 }); }}
                >
                  全体
                </Button>
                <Button
                  variant={fitMode === 'width' ? 'default' : 'outline'}
                  size="sm"
                  className="text-xs px-2"
                  onClick={() => { setFitMode('width'); setZoom(100); setPan({ x: 0, y: 0 }); }}
                >
                  横幅
                </Button>
                <Button
                  variant={fitMode === 'height' ? 'default' : 'outline'}
                  size="sm"
                  className="text-xs px-2"
                  onClick={() => { setFitMode('height'); setZoom(100); setPan({ x: 0, y: 0 }); }}
                >
                  縦幅
                </Button>
              </div>
            </div>
          </div>

          {/* 下段：Composer（ShareView同等のカード型） */}
          {(() => {
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
                        placeholder={composerMode === 'edit' ? '編集中...' : 'コメントを入力...'}
                        value={commentBody}
                        onChange={(e) => setCommentBody(e.target.value)}
                        onPointerDownCapture={(e) => enterNewTextOnlyComposer(e)}
                        onBlur={() => {
                          if (!commentBody.trim()) setIsNewCommentInputActive(false);
                        }}
                        rows={2}
                        className="text-sm resize-none"
                        disabled={isLocked}
                      />

                      {/* 添付ファイル一覧 */}
                      {pendingFiles.length > 0 && (
                        <div className="space-y-1">
                          {pendingFiles.map((f, idx) => (
                            <div key={idx} className="flex items-center gap-2 text-xs text-gray-600">
                              <Paperclip className="w-3 h-3" />
                              <span className="flex-1 truncate">{f.name}</span>
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
                      id="fv-file-input"
                      onChange={handleFileSelect}
                      disabled={isLocked}
                    />
                    <label htmlFor="fv-file-input">
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-1"
                        asChild
                        disabled={isLocked}
                      >
                        <span>
                          <Paperclip className="w-4 h-4" />
                        </span>
                      </Button>
                    </label>

                    {/* 送信ボタン */}
                    <Button
                      onClick={handleSendComment}
                      disabled={isSubmitting || createCommentMutation.isPending || updateCommentMutation.isPending || !commentBody.trim() || isLocked}
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
                        title="キャンセル"
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    )}
                  </div>

                  {/* ステータス表示 */}
                  <div className="h-6 mt-2 flex items-center">
                    {isLocked ? (
                      <div className="text-xs text-orange-600 flex items-center gap-2">
                        <Badge className="bg-orange-100 text-orange-700 border border-orange-300">
                          対応済みのため編集できません
                        </Badge>
                      </div>
                    ) : (composerMode === 'edit' || paintMode || draftShapes.length > 0) ? (
                      <div className="text-xs text-gray-500 flex items-center gap-2">
                        <Badge className="bg-green-600 text-white">
                          {composerMode === 'edit' ? 'コメント編集中' : paintMode ? 'ペイント中' : '新規作成中'}
                        </Badge>
                        <span>
                          {composerMode === 'edit' ? '保存して更新' : 'コメントを入力してください'}
                        </span>
                        {draftShapes.length > 0 && (
                          <Badge variant="secondary" className="bg-blue-100 text-blue-800">
                            📝 下書き {draftShapes.length}個
                          </Badge>
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

        {/* 右：コメント一覧（ShareView同等） */}
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
            {(draftShapes.length > 0 || commentBody.trim()) && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-2">
                <div className="flex items-center gap-2 text-sm">
                  <Badge className="bg-blue-600 text-white">📝 下書き</Badge>
                  <span className="text-blue-800">
                    {[
                      draftShapes.length > 0 && `描画${draftShapes.length}個`,
                      commentBody.trim() && 'テキスト入力中',
                    ].filter(Boolean).join(' / ')}
                  </span>
                </div>
              </div>
            )}
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
            {commentsLoading ? (
              <div className="text-center text-gray-500 py-8">
                コメントを読み込み中...
              </div>
            ) : sortedComments.length === 0 ? (
              <div className="text-center text-gray-500 py-8">
                コメントはありません
              </div>
            ) : (
              sortedComments.map((comment) => {
                const shapesCount = paintShapes.filter(s => s.comment_id === comment.id).length;
                const isSelected = String(activeCommentId) === String(comment.id) && !isNewCommentInputActive;
                const isEditing = composerMode === 'edit' && String(composerTargetCommentId) === String(comment.id) && !isNewCommentInputActive;

                return (
                  <Card 
                    key={comment.id} 
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
                          onClick={() => handleCommentClick(comment)}
                          onDoubleClick={(e) => handleCommentDoubleClick(e, comment)}
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-medium">{comment.author_name}</span>
                            {comment.resolved && (
                              <Badge className="text-xs bg-green-600 text-white">対応済</Badge>
                            )}
                            {shapesCount > 0 && (
                              <Badge variant="outline" className="text-xs flex items-center gap-1">
                                <Paintbrush className="w-3 h-3" />
                                {shapesCount}
                              </Badge>
                            )}
                            {isEditing && (
                              <Badge className="text-xs bg-green-600 text-white">編集中</Badge>
                            )}
                          </div>
                          <p className="text-sm text-gray-700">{comment.body || '（本文なし）'}</p>

                          {/* 添付ファイル表示 */}
                          {(attachmentsByComment[comment.id] || []).length > 0 && (
                            <div className="mt-2 space-y-1">
                              {(attachmentsByComment[comment.id]).map((att) => (
                                <a
                                  key={att.id}
                                  href={att.file_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-2 text-xs text-blue-600 hover:underline"
                                >
                                  <Paperclip className="w-3 h-3" />
                                  {att.original_filename}
                                </a>
                              ))}
                            </div>
                          )}

                          <div className="flex items-center gap-2 mt-2 text-xs text-gray-500">
                            <span>{comment.page_no}枚目</span>
                            <span>•</span>
                            <span>{format(new Date(comment.created_date), 'yyyy/MM/dd HH:mm', { locale: ja })}</span>
                          </div>
                        </div>

                        {/* 対応済みトグル */}
                        <Button
                          variant="ghost"
                          size="sm"
                          className={`h-auto p-1 ${comment.resolved ? 'text-green-600' : 'text-gray-400'}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleResolveMutation.mutate({ id: comment.id, resolved: !comment.resolved });
                          }}
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

                        {/* メニュー */}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-auto p-1">
                              <MoreVertical className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => {
                              if (comment.resolved) { showToast('対応済みのコメントは編集できません', 'error'); return; }
                              handleCommentDoubleClick({ preventDefault: () => {}, stopPropagation: () => {} }, comment);
                            }}>
                              <Edit className="w-4 h-4 mr-2" />
                              編集
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => {
                              const url = `${window.location.origin}${window.location.pathname}?fileId=${fileId}`;
                              navigator.clipboard.writeText(url).then(() => {
                                showToast('URLをコピーしました');
                              }).catch(() => {
                                showToast('コピーに失敗しました', 'error');
                              });
                            }}>
                              <Copy className="w-4 h-4 mr-2" />
                              URLをコピー
                            </DropdownMenuItem>
                            <DropdownMenuItem 
                            onClick={async () => {
                            if (!window.confirm('このコメントと関連する描画を削除しますか？')) return;
                                const relatedShapes = paintShapes.filter(s => s.comment_id === comment.id);
                                for (const shape of relatedShapes) {
                                  await base44.entities.PaintShape.delete(shape.id);
                                }
                                await base44.entities.ReviewComment.delete(comment.id);
                                queryClient.invalidateQueries(['comments']);
                                queryClient.invalidateQueries(['paintShapes']);
                                if (String(activeCommentId) === String(comment.id)) setActiveCommentId(null);
                                showToast('コメントと描画を削除しました');
                              }}
                              className="text-red-600"
                            >
                              <Trash className="w-4 h-4 mr-2" />
                              削除
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>

                      {/* 返信スレッド（選択中のみ表示） */}
                      {isSelected && (
                        <ReplyThread
                          parentCommentId={comment.id}
                          fileId={fileId}
                          replies={repliesByParent[comment.id] || []}
                          user={user}
                        />
                      )}
                    </CardContent>
                  </Card>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* フローティングツールバー（Portal化: z-index問題を回避） */}
      <FloatingToolbarPortal
        show={paintMode && !!file}
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