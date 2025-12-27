import React, { useState, useEffect, useRef } from 'react';
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
  ChevronLeft, 
  ChevronRight,
  Upload,
  MessageSquare,
  Send,
  Paintbrush,
  CheckCircle2
} from 'lucide-react';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import * as pdfjsLib from 'pdfjs-dist';
import PaintCanvas from '../components/viewer/PaintCanvas';
import ShareLinkModal from '../components/viewer/ShareLinkModal';

pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

export default function FileView() {
  const [user, setUser] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [zoom, setZoom] = useState(100);
  const [commentFilter, setCommentFilter] = useState('all');
  const [commentSort, setCommentSort] = useState('page');
  const [commentBody, setCommentBody] = useState('');
  const [isPainting, setIsPainting] = useState(false);
  const [paintShapes, setPaintShapes] = useState([]);
  const [selectedCommentId, setSelectedCommentId] = useState(null);
  const [visiblePaints, setVisiblePaints] = useState(new Set());
  const [shareLinkOpen, setShareLinkOpen] = useState(false);
  const canvasRef = useRef(null);
  const pdfDocRef = useRef(null);
  const queryClient = useQueryClient();
  
  const params = new URLSearchParams(window.location.search);
  const fileId = params.get('fileId');

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { data: file } = useQuery({
    queryKey: ['file', fileId],
    queryFn: async () => {
      const files = await base44.entities.FileAsset.filter({ id: fileId });
      return files[0];
    },
    enabled: !!fileId,
  });

  const { data: comments = [] } = useQuery({
    queryKey: ['comments', fileId],
    queryFn: () => base44.entities.ReviewComment.filter({ file_id: fileId }),
    enabled: !!fileId,
  });

  const { data: allPaintShapes = [] } = useQuery({
    queryKey: ['paintShapes', fileId],
    queryFn: () => base44.entities.PaintShape.filter({ file_id: fileId }),
    enabled: !!fileId,
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
      });
    }
  }, [file, user, fileId]);

  useEffect(() => {
    if (file && file.mime_type === 'application/pdf') {
      loadPDF();
    }
  }, [file]);

  useEffect(() => {
    if (file && pdfDocRef.current) {
      renderPage(currentPage);
    }
  }, [currentPage, zoom, file]);

  const loadPDF = async () => {
    if (!file?.file_url) return;
    try {
      const pdf = await pdfjsLib.getDocument(file.file_url).promise;
      pdfDocRef.current = pdf;
      setTotalPages(pdf.numPages);
      renderPage(1);
    } catch (error) {
      console.error('PDF load error:', error);
    }
  };

  const renderPage = async (pageNum) => {
    if (!pdfDocRef.current || !canvasRef.current) return;
    const page = await pdfDocRef.current.getPage(pageNum);
    const viewport = page.getViewport({ scale: zoom / 100 });
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');
    canvas.height = viewport.height;
    canvas.width = viewport.width;
    await page.render({ canvasContext: context, viewport }).promise;
  };

  const createCommentMutation = useMutation({
    mutationFn: async (data) => {
      const existingComments = await base44.entities.ReviewComment.filter({ file_id: fileId });
      const maxSeqNo = existingComments.reduce((max, c) => Math.max(max, c.seq_no || 0), 0);
      
      const comment = await base44.entities.ReviewComment.create({
        file_id: fileId,
        page_no: currentPage,
        seq_no: maxSeqNo + 1,
        author_type: 'user',
        author_user_id: user?.id,
        author_name: user?.full_name,
        body: data.body,
        resolved: false,
        has_paint: paintShapes.length > 0,
      });

      if (paintShapes.length > 0) {
        await Promise.all(
          paintShapes.map(shape => 
            base44.entities.PaintShape.create({
              file_id: fileId,
              comment_id: comment.id,
              page_no: currentPage,
              shape_type: shape.type,
              data_json: JSON.stringify(shape),
            })
          )
        );
      }

      return comment;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['comments']);
      queryClient.invalidateQueries(['paintShapes']);
      setCommentBody('');
      setPaintShapes([]);
      setIsPainting(false);
    },
  });

  const toggleResolveMutation = useMutation({
    mutationFn: ({ id, resolved }) => base44.entities.ReviewComment.update(id, { resolved }),
    onSuccess: () => {
      queryClient.invalidateQueries(['comments']);
    },
  });

  const handleSendComment = () => {
    if (!commentBody.trim() && paintShapes.length === 0) return;
    createCommentMutation.mutate({ body: commentBody });
  };

  const handleCommentClick = (commentId) => {
    if (visiblePaints.has(commentId)) {
      const newVisible = new Set(visiblePaints);
      newVisible.delete(commentId);
      setVisiblePaints(newVisible);
    } else {
      const newVisible = new Set(visiblePaints);
      newVisible.add(commentId);
      setVisiblePaints(newVisible);
    }
    setSelectedCommentId(commentId);
  };

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

  const currentPagePaintShapes = allPaintShapes
    .filter(ps => ps.page_no === currentPage && visiblePaints.has(ps.comment_id))
    .map(ps => {
      const shape = JSON.parse(ps.data_json);
      return {
        ...shape,
        opacity: selectedCommentId === ps.comment_id ? 1 : 0.3,
      };
    });

  const isPDF = file?.mime_type === 'application/pdf';
  const isImage = file?.mime_type?.startsWith('image/');
  const canPreview = isPDF || isImage;

  const canvasWidth = 800 * (zoom / 100);
  const canvasHeight = isPDF ? 1000 * (zoom / 100) : 600 * (zoom / 100);

  return (
    <div className="max-w-full mx-auto h-screen flex flex-col">
      <div className="border-b bg-white px-6 py-3 flex items-center justify-between">
        <h1 className="text-xl font-bold">{file?.title || 'ファイル'}</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShareLinkOpen(true)}>
            <Share2 className="w-4 h-4 mr-2" />
            共有リンク発行
          </Button>
          <Button variant="outline">
            <Download className="w-4 h-4 mr-2" />
            ダウンロード
          </Button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* 左：サムネ */}
        <div className="w-48 border-r bg-gray-50 overflow-y-auto p-4">
          <div className="space-y-2">
            {isPDF && Array.from({ length: totalPages }, (_, i) => i + 1).map(pageNum => (
              <div
                key={pageNum}
                onClick={() => setCurrentPage(pageNum)}
                className={`cursor-pointer border-2 rounded p-2 text-center text-sm ${
                  currentPage === pageNum ? 'border-blue-600 bg-blue-50' : 'border-gray-200'
                }`}
              >
                {pageNum}
              </div>
            ))}
            {isImage && (
              <div className="border-2 border-blue-600 rounded p-2 text-center text-sm bg-blue-50">
                1
              </div>
            )}
          </div>
          <label htmlFor="version-upload" className="block mt-4">
            <div className="border-2 border-dashed border-gray-300 rounded p-4 text-center cursor-pointer hover:border-blue-500 hover:bg-blue-50 transition-colors">
              <Upload className="w-8 h-8 mx-auto mb-2 text-gray-400" />
              <p className="text-xs text-gray-600">新バージョン</p>
            </div>
            <input id="version-upload" type="file" className="hidden" />
          </label>
        </div>

        {/* 中央：プレビュー */}
        <div className="flex-1 bg-gray-100 overflow-auto p-4">
          <div className="bg-white rounded shadow-lg mx-auto" style={{ width: 'fit-content' }}>
            {canPreview ? (
              <div className="relative">
                {isPDF && (
                  <canvas ref={canvasRef} className="block" />
                )}
                {isImage && (
                  <img 
                    src={file.file_url} 
                    alt={file.title}
                    style={{ width: canvasWidth }}
                  />
                )}
                <div className="absolute top-0 left-0">
                  <PaintCanvas
                    width={canvasWidth}
                    height={canvasHeight}
                    onShapesChange={setPaintShapes}
                    existingShapes={currentPagePaintShapes}
                    isPainting={isPainting}
                  />
                </div>
              </div>
            ) : (
              <div className="p-12 text-center">
                <p className="text-gray-500 mb-4">プレビュー未対応の形式です</p>
                <Button>
                  <Download className="w-4 h-4 mr-2" />
                  ダウンロード
                </Button>
              </div>
            )}
          </div>

          {/* ズーム・ページ制御 */}
          {canPreview && (
            <div className="flex items-center justify-center gap-4 mt-4">
              <Button variant="outline" size="icon" onClick={() => setZoom(Math.max(50, zoom - 25))}>
                <ZoomOut className="w-4 h-4" />
              </Button>
              <span className="text-sm font-medium">{zoom}%</span>
              <Button variant="outline" size="icon" onClick={() => setZoom(Math.min(200, zoom + 25))}>
                <ZoomIn className="w-4 h-4" />
              </Button>
              {isPDF && (
                <>
                  <div className="w-px h-6 bg-gray-300" />
                  <Button variant="outline" size="icon" onClick={() => setCurrentPage(Math.max(1, currentPage - 1))} disabled={currentPage === 1}>
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <span className="text-sm">{currentPage} / {totalPages}</span>
                  <Button variant="outline" size="icon" onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))} disabled={currentPage === totalPages}>
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </>
              )}
            </div>
          )}
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
            {sortedComments.length === 0 ? (
              <div className="text-center text-gray-500 py-8">
                コメントはありません
              </div>
            ) : (
              sortedComments.map((comment) => (
                <Card 
                  key={comment.id} 
                  className={`cursor-pointer hover:shadow-md transition-shadow ${visiblePaints.has(comment.id) ? 'ring-2 ring-blue-500' : ''}`}
                  onClick={() => handleCommentClick(comment.id)}
                >
                  <CardContent className="p-3">
                    <div className="flex items-start gap-2 mb-2">
                      <Badge variant="secondary" className="text-xs">#{comment.seq_no}</Badge>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-medium">{comment.author_name}</span>
                          {comment.has_paint && <Paintbrush className="w-3 h-3 text-blue-600" />}
                        </div>
                        <p className="text-sm text-gray-700">{comment.body}</p>
                        <div className="flex items-center gap-2 mt-2 text-xs text-gray-500">
                          <span>{comment.page_no}枚目</span>
                          <span>•</span>
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
              <span className="text-sm font-medium">コメント追加</span>
              <Button
                variant={isPainting ? 'default' : 'outline'}
                size="sm"
                onClick={() => setIsPainting(!isPainting)}
              >
                <Paintbrush className="w-4 h-4 mr-2" />
                {isPainting ? 'ペイント中' : 'ペイント'}
              </Button>
            </div>
            <Textarea
              placeholder="コメントを入力"
              value={commentBody}
              onChange={(e) => setCommentBody(e.target.value)}
              rows={3}
            />
            <Button
              onClick={handleSendComment}
              disabled={!commentBody.trim() && paintShapes.length === 0}
              className="w-full bg-blue-600 hover:bg-blue-700"
            >
              <Send className="w-4 h-4 mr-2" />
              送信
            </Button>
          </div>
        </div>
      </div>

      <ShareLinkModal open={shareLinkOpen} onOpenChange={setShareLinkOpen} fileId={fileId} />
    </div>
  );
}