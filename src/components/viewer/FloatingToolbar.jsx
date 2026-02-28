import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { 
  MessageSquare, 
  Pen, 
  Circle, 
  Square, 
  ArrowRight,
  Type,
  Undo2,
  Redo2,
  Trash2,
  Check,
  Paintbrush,
  MousePointer2,
  Maximize,
  Eye,
  GripVertical
} from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export default function FloatingToolbar({
  paintMode,
  onPaintModeChange,
  tool,
  onToolChange,
  strokeColor,
  onStrokeColorChange,
  strokeWidth,
  onStrokeWidthChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onClear,
  onClearAll,
  onDelete,
  onComplete,
  onResetView,
  showBoundingBoxes,
  onToggleBoundingBoxes,
  hasActiveComment = false,
}) {
  const DEBUG_MODE = import.meta.env.VITE_DEBUG === 'true';
  const toolbarRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ startX: 0, startY: 0, baseX: 0, baseY: 0 });
  
  // 初期位置: 画面下中央
  const getInitialPosition = () => {
    const saved = localStorage.getItem('paintToolbarPos');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        // fallback
      }
    }
    // デフォルト: 画面下中央（transform使わず絶対座標で）
    return {
      x: Math.max(0, window.innerWidth / 2 - 300), // 300px≈ツールバー幅の半分
      y: Math.max(0, window.innerHeight - 100)
    };
  };
  
  const [pos, setPos] = useState(getInitialPosition);
  
  // 画面端クランプ
  const clampPosition = (x, y) => {
    const toolbarWidth = toolbarRef.current?.offsetWidth || 600;
    const toolbarHeight = toolbarRef.current?.offsetHeight || 60;
    
    return {
      x: Math.min(Math.max(0, x), window.innerWidth - toolbarWidth),
      y: Math.min(Math.max(0, y), window.innerHeight - toolbarHeight)
    };
  };
  
  // ドラッグ開始
  const handleDragStart = (e) => {
    e.stopPropagation();
    setIsDragging(true);
    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      baseX: pos.x,
      baseY: pos.y
    };
    e.target.setPointerCapture?.(e.pointerId);
  };
  
  // ドラッグ中
  useEffect(() => {
    if (!isDragging) return;
    
    const handlePointerMove = (e) => {
      const dx = e.clientX - dragStartRef.current.startX;
      const dy = e.clientY - dragStartRef.current.startY;
      const next = clampPosition(
        dragStartRef.current.baseX + dx,
        dragStartRef.current.baseY + dy
      );
      setPos(next);
    };
    
    const handlePointerUp = (e) => {
      setIsDragging(false);
      // 位置をlocalStorageに保存
      localStorage.setItem('paintToolbarPos', JSON.stringify(pos));
    };
    
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [isDragging, pos]);
  
  // 画面リサイズ時にクランプ
  useEffect(() => {
    const handleResize = () => {
      setPos(prev => clampPosition(prev.x, prev.y));
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  
  const colors = [
    { value: '#ff0000', label: '赤' },
    { value: '#00ff00', label: '緑' },
    { value: '#0000ff', label: '青' },
    { value: '#ffff00', label: '黄' },
    { value: '#ff00ff', label: 'マゼンタ' },
    { value: '#00ffff', label: 'シアン' },
    { value: '#000000', label: '黒' },
  ];
  
  const widths = [
    { value: 2, label: '細' },
    { value: 4, label: '中' },
    { value: 8, label: '太' },
  ];
  
  return (
    <div 
      ref={toolbarRef}
      className="fixed z-[9999]"
      data-ft="toolbar"
      style={{
        left: `${pos.x}px`,
        top: `${pos.y}px`,
        touchAction: 'none',
        userSelect: 'none',
      }}
    >
      <div className="bg-white rounded-lg shadow-2xl border border-gray-200 p-3 flex items-center gap-2">
        {/* ドラッグハンドル */}
        <div
          onPointerDown={handleDragStart}
          className="flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 transition-colors"
          style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
        >
          <GripVertical className="w-4 h-4 text-gray-400" />
        </div>
        
        <div className="w-px h-6 bg-gray-300" />
        
        {/* モード切替 */}
        <Button
          variant={paintMode ? 'default' : 'outline'}
          size="sm"
          onClick={() => onPaintModeChange(!paintMode)}
          className="gap-2"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <Paintbrush className="w-4 h-4" />
          {paintMode ? 'ペイント中' : 'ペイント'}
        </Button>
        
        {paintMode && (
          <>
            <div className="w-px h-6 bg-gray-300" />
            
            {/* ツール選択（ドラッグ開始を抑制） */}
            <div onPointerDown={(e) => e.stopPropagation()}>
              <Button
                variant={tool === 'select' ? 'default' : 'outline'}
                size="sm"
                onClick={() => onToolChange('select')}
                title="選択・移動"
              >
                <MousePointer2 className="w-4 h-4" />
              </Button>
            </div>
            <div onPointerDown={(e) => e.stopPropagation()}>
              <Button
                variant={tool === 'pen' ? 'default' : 'outline'}
                size="sm"
                onClick={() => onToolChange('pen')}
                title="ペン"
              >
                <Pen className="w-4 h-4" />
              </Button>
            </div>
            <div onPointerDown={(e) => e.stopPropagation()}>
              <Button
                variant={tool === 'rect' ? 'default' : 'outline'}
                size="sm"
                onClick={() => onToolChange('rect')}
                title="四角"
              >
                <Square className="w-4 h-4" />
              </Button>
            </div>
            <div onPointerDown={(e) => e.stopPropagation()}>
              <Button
                variant={tool === 'circle' ? 'default' : 'outline'}
                size="sm"
                onClick={() => onToolChange('circle')}
                title="円"
              >
                <Circle className="w-4 h-4" />
              </Button>
            </div>
            <div onPointerDown={(e) => e.stopPropagation()}>
              <Button
                variant={tool === 'arrow' ? 'default' : 'outline'}
                size="sm"
                onClick={() => onToolChange('arrow')}
                title="矢印"
              >
                <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
            <div onPointerDown={(e) => e.stopPropagation()}>
              <Button
                variant={tool === 'text' ? 'default' : 'outline'}
                size="sm"
                onClick={() => onToolChange('text')}
                title="テキスト"
              >
                <Type className="w-4 h-4" />
              </Button>
            </div>

            <div className="w-px h-6 bg-gray-300" />

            {/* 色・太さ選択（ドラッグ開始を抑制） */}
            <div onPointerDown={(e) => e.stopPropagation()}>
              <Select value={strokeColor} onValueChange={onStrokeColorChange}>
                <SelectTrigger className="w-20 h-8">
                  <div className="flex items-center gap-2">
                    <div 
                      className="w-4 h-4 rounded border border-gray-300" 
                      style={{ backgroundColor: strokeColor }}
                    />
                    <span className="text-xs">色</span>
                  </div>
                </SelectTrigger>
                <SelectContent>
                  {colors.map(color => (
                    <SelectItem key={color.value} value={color.value}>
                      <div className="flex items-center gap-2">
                        <div 
                          className="w-4 h-4 rounded border border-gray-300" 
                          style={{ backgroundColor: color.value }}
                        />
                        {color.label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div onPointerDown={(e) => e.stopPropagation()}>
              <Select value={String(strokeWidth)} onValueChange={(v) => onStrokeWidthChange(Number(v))}>
                <SelectTrigger className="w-20 h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {widths.map(width => (
                    <SelectItem key={width.value} value={String(width.value)}>
                      {width.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="w-px h-6 bg-gray-300" />

            {/* Undo/Redo/Delete（ドラッグ開始を抑制） */}
            <div onPointerDown={(e) => e.stopPropagation()}>
              <Button
                variant="outline"
                size="sm"
                onClick={onUndo}
                disabled={!canUndo}
                title="元に戻す (Ctrl+Z)"
              >
                <Undo2 className="w-4 h-4" />
              </Button>
            </div>
            <div onPointerDown={(e) => e.stopPropagation()}>
              <Button
                variant="outline"
                size="sm"
                onClick={onRedo}
                disabled={!canRedo}
                title="やり直す"
              >
                <Redo2 className="w-4 h-4" />
              </Button>
            </div>
            <div onPointerDown={(e) => e.stopPropagation()}>
              <Button
                variant="outline"
                size="sm"
                onClick={onDelete}
                disabled={tool !== 'select'}
                title="削除 (Delete)"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>

            {onClearAll && hasActiveComment && (
              <div onPointerDown={(e) => e.stopPropagation()}>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onClearAll}
                  title="このコメントの自分の描画を全削除"
                  className="text-red-600 hover:text-red-700"
                >
                  <Trash2 className="w-4 h-4 mr-1" />
                  全削除
                </Button>
              </div>
            )}

            <div className="w-px h-6 bg-gray-300" />

            {/* Reset View */}
            {onResetView && (
              <div onPointerDown={(e) => e.stopPropagation()}>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onResetView}
                  title="ズーム・パンをリセット"
                >
                  <Maximize className="w-4 h-4" />
                </Button>
              </div>
            )}

            {/* Bounding Boxes (DEBUG only) */}
            {onToggleBoundingBoxes && (
              <div onPointerDown={(e) => e.stopPropagation()}>
                <Button
                  variant={showBoundingBoxes ? 'default' : 'outline'}
                  size="sm"
                  onClick={onToggleBoundingBoxes}
                  title="バウンディングボックス表示（デバッグ）"
                >
                  <Eye className="w-4 h-4" />
                </Button>
              </div>
            )}

            <div className="w-px h-6 bg-gray-300" />

            {/* 閉じる */}
            <div onPointerDown={(e) => e.stopPropagation()}>
              <Button
                variant="default"
                size="sm"
                onClick={onComplete}
                className="gap-2 bg-green-600 hover:bg-green-700"
              >
                <Check className="w-4 h-4" />
                閉じる
              </Button>
            </div>
            </>
            )}
            </div>
            </div>
            );
            }