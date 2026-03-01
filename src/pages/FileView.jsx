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
import FloatingToolbarPortal from '../components/viewer/FloatingToolbarPortal';
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
  
  // ★★★ P0-FV: 新規コメント用の temp ID（ViewerCanvas の draftCommentId に渡す）★★★
  // ★★★ 初期値を即座に生成（paintMode ON前でも有効にする）★★★
  const [tempCommentId, setTempCommentId] = useState(() => 'temp_' + crypto.randomUUID());
  
  // Composer mode (new or edit)
  const [composerMode, setComposerMode] = useState('new');
  const [composerTargetCommentId, setComposerTargetCommentId] = useState(null);
  
  // CRITICAL: 送信完了後のキャンバスクリア用nonce & 連打防止
  const [clearAfterSubmitNonce, setClearAfterSubmitNonce] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // CRITICAL: useRefでロック管理（コンポーネント内で確実に保持）
  const submitLockRef = useRef(false);
  const mutationIdRef = useRef(null);
  
  // ★★★ CRITICAL: effectiveActiveIdRef - 描画の紐づけ先を常に最新で参照 ★★★
  // editingCommentId(composerTargetCommentId) > activeCommentId > paintSessionCommentId の優先順
  const effectiveActiveIdRef = useRef(null);
  
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

  // ★★★ CRITICAL: effectiveActiveIdRefを常に最新に同期 ★★★
  // 編集中(composerTargetCommentId) > 選択中(activeCommentId) > セッション(paintSessionCommentId)
  useEffect(() => {
    const newEffectiveId = composerTargetCommentId ?? activeCommentId ?? paintSessionCommentId ?? null;
    const newEffectiveIdStr = newEffectiveId != null ? String(newEffectiveId) : null;
    
    if (effectiveActiveIdRef.current !== newEffectiveIdStr) {
      console.log('[FileView] effectiveActiveIdRef updated:', {
        prev: effectiveActiveIdRef.current,
        next: newEffectiveIdStr,
        composerTargetCommentId,
        activeCommentId,
        paintSessionCommentId,
      });
      effectiveActiveIdRef.current = newEffectiveIdStr;
      
      // ★★★ CRITICAL: ID変更時はdraftShapesをクリア（前コメントの下書き混入防止）★★★
      setDraftShapes([]);
    }
  }, [composerTargetCommentId, activeCommentId, paintSessionCommentId]);

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

  // ★★★ V-06 FIX: tempCommentId の生成（新規コメント開始時に1回だけ）★★★
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

  // CRITICAL: useMutationで送信処理を管理（React Queryが重複防止を担当）
  const createCommentMutation = useMutation({
    mutationFn: async ({ body, shapes }) => {
      // CRITICAL: mutationIdを生成（一度だけ）
      const clientMutationId = crypto.randomUUID();
      console.log(`[comment] create called mid=${clientMutationId}`);
      
      const existingComments = await base44.entities.ReviewComment.filter({ file_id: fileId });
      const maxSeqNo = existingComments.reduce((max, c) => Math.max(max, c.seq_no || 0), 0);

      // アンカー位置の計算
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

      return base44.entities.ReviewComment.create({
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
    },
    onSuccess: () => {
      showToast('コメントを送信しました', 'success');
      // ★★★ CRITICAL: 描画クリアを最優先で実行 ★★★
      viewerCanvasRef.current?.afterSubmitClear();
      viewerCanvasRef.current?.clear();
      
      // リセット処理
      setCommentBody('');
      setDraftShapes([]);
      setComposerMode('new');
      setComposerTargetCommentId(null);
      setPaintSessionCommentId(null);
      setActiveCommentId(null);
      setTempCommentId(null); // ★★★ V-06: tempCommentId もリセット ★★★
      setPaintMode(false);
      setTool('select');
      setClearAfterSubmitNonce(n => n + 1);
      
      // invalidateは少し遅らせて描画クリアを確実に先に完了させる
      setTimeout(() => {
        queryClient.invalidateQueries(['comments']);
        queryClient.invalidateQueries(['paintShapes']);
      }, 100);
    },
    onError: (error) => {
      showToast(`送信失敗: ${error.message}`, 'error');
    },
  });

  const updateCommentMutation = useMutation({
    mutationFn: async ({ targetId, body, hasShapes }) => {
      return base44.entities.ReviewComment.update(targetId, {
        body,
        has_paint: hasShapes,
      });
    },
    onSuccess: () => {
      showToast('コメントを更新しました', 'success');
      // ★★★ CRITICAL: 描画クリアを最優先で実行 ★★★
      viewerCanvasRef.current?.afterSubmitClear();
      viewerCanvasRef.current?.clear();
      
      // リセット処理
      setCommentBody('');
      setDraftShapes([]);
      setComposerMode('new');
      setComposerTargetCommentId(null);
      setPaintSessionCommentId(null);
      setActiveCommentId(null);
      setTempCommentId(null); // ★★★ V-06: tempCommentId もリセット ★★★
      setPaintMode(false);
      setTool('select');
      setClearAfterSubmitNonce(n => n + 1);
      
      // invalidateは少し遅らせて描画クリアを確実に先に完了させる
      setTimeout(() => {
        queryClient.invalidateQueries(['comments']);
        queryClient.invalidateQueries(['paintShapes']);
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
    const currentComposerMode = composerMode;
    const currentTargetId = composerTargetCommentId || activeCommentId;
    
    // CRITICAL: 編集モード or activeCommentIdがある場合は「更新」
    if ((currentComposerMode === 'edit' && currentTargetId) || activeCommentId) {
      updateCommentMutation.mutate(
        { targetId: currentTargetId, body: currentBody, hasShapes: currentDraftShapes.length > 0 },
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
        { body: currentBody, shapes: currentDraftShapes },
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
    composerMode,
    composerTargetCommentId,
    activeCommentId,
    createCommentMutation,
    updateCommentMutation,
  ]);

  const handleCommentClick = (comment) => {
    console.log('[FileView] handleCommentClick:', { commentId: comment.id, activeCommentId, paintMode });
    
    if (paintMode) {
      showToast('ペイントを終了してからコメントを選択してください', 'error');
      return;
    }

    // 同じコメントを再クリック → 選択解除（統一関数を使用）
    if (String(activeCommentId) === String(comment.id) && composerMode !== 'edit') {
      console.log('[FileView] Deselecting comment');
      exitEditMode();
      return;
    }
    
    // 別のコメントをクリック → 選択のみ（編集モードには入らない）
    console.log('[FileView] Selecting comment:', comment.id);
    viewerCanvasRef.current?.afterSubmitClear();
    setDraftShapes([]);
    
    if (paintMode) {
      setPaintMode(false);
      setTool('select');
    }
    
    setActiveCommentId(comment.id);
    setPaintSessionCommentId(comment.id);
    // ★ 編集モードは維持しない（ダブルクリックでのみ編集）
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
    setTempCommentId(null); // ★★★ V-06: tempCommentId もリセット ★★★
    
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

  // ★★★ CRITICAL BUG FIX: 編集モード中は activeCommentId のみを targetId として使用 ★★★
  // paintSessionCommentId は「新規コメント作成中」のみ使用する
  // 編集モード（activeCommentId が存在）中に paintSessionCommentId が更新されても shapesForCanvas の対象は変わらない
  const isEditMode = !!activeCommentId;
  const targetIdForShapes = isEditMode
    ? String(activeCommentId)
    : (paintSessionCommentId ? String(paintSessionCommentId) : null);

  // ★ effectiveActiveId は Canvas への props 用（描画の紐づけ先）として別途定義
  const effectiveActiveId = composerTargetCommentId ?? activeCommentId ?? paintSessionCommentId ?? null;

  // ★★★ P0-FV: ViewerCanvas に渡す props の算出 ★★★
  const normalizedActiveCommentId = activeCommentId != null ? String(activeCommentId) : null;
  const isUnselected = !normalizedActiveCommentId;
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
            activeCommentId={normalizedActiveCommentId}
            showAllPaint={false}
            clearAfterSubmitNonce={clearAfterSubmitNonce}
            renderTargetCommentId={renderTargetCommentIdForCanvas}
            draftCommentId={draftCommentIdForCanvas}
            showDraftOnly={isUnselected && draftShapes.length > 0}
            draftReady={true}
            canvasContextKey={`${fileId}:1:${paintContextId}`}
            onShapesChange={(updated) => {
              // ★★★ P0-FV: draftShapesに同期（ShareView同等のシンプルなパターン）★★★
              // 空配列がdraftを上書きしないようガード
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
                    String(activeCommentId) === String(comment.id) ? 'ring-2 ring-blue-500' : ''
                  } ${composerMode === 'edit' && String(composerTargetCommentId) === String(comment.id) ? 'ring-2 ring-green-500 bg-green-50' : ''}`}
                  onClick={() => handleCommentClick(comment)}
                  onDoubleClick={(e) => handleCommentDoubleClick(e, comment)}
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
              disabled={isSubmitting || createCommentMutation.isPending || updateCommentMutation.isPending || (!commentBody.trim() && draftShapes.length === 0)}
              className="w-full bg-blue-600 hover:bg-blue-700"
              style={{ pointerEvents: isSubmitting ? "none" : "auto" }}
              onClick={handleSendComment}
            >
              <Send className="w-4 h-4 mr-2" />
              {composerMode === 'edit' ? '保存' : '送信'}
            </Button>
          </div>
        </div>
      </div>

      {/* フローティングツールバー（Portal化: z-index問題を回避） */}
      <FloatingToolbarPortal
        show={paintMode && !!file?.id}
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