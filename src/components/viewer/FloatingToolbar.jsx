import React from 'react';
import { Button } from '@/components/ui/button';
import { 
  MessageSquare, 
  Pen, 
  Circle, 
  Square, 
  ArrowRight,
  Undo2,
  Redo2,
  Trash2,
  Check,
  Paintbrush
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
  onComplete,
}) {
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
    <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 z-50 pointer-events-none">
      <div className="bg-white rounded-lg shadow-2xl border border-gray-200 p-3 flex items-center gap-2 pointer-events-auto">
        {/* モード切替 */}
        <Button
          variant={paintMode ? 'default' : 'outline'}
          size="sm"
          onClick={() => onPaintModeChange(!paintMode)}
          className="gap-2"
        >
          <Paintbrush className="w-4 h-4" />
          {paintMode ? 'ペイント中' : 'ペイント'}
        </Button>
        
        {paintMode && (
          <>
            <div className="w-px h-6 bg-gray-300" />
            
            {/* ツール選択 */}
            <Button
              variant={tool === 'pen' ? 'default' : 'outline'}
              size="sm"
              onClick={() => onToolChange('pen')}
              title="ペン"
            >
              <Pen className="w-4 h-4" />
            </Button>
            <Button
              variant={tool === 'rect' ? 'default' : 'outline'}
              size="sm"
              onClick={() => onToolChange('rect')}
              title="四角"
            >
              <Square className="w-4 h-4" />
            </Button>
            <Button
              variant={tool === 'circle' ? 'default' : 'outline'}
              size="sm"
              onClick={() => onToolChange('circle')}
              title="円"
            >
              <Circle className="w-4 h-4" />
            </Button>
            <Button
              variant={tool === 'arrow' ? 'default' : 'outline'}
              size="sm"
              onClick={() => onToolChange('arrow')}
              title="矢印"
            >
              <ArrowRight className="w-4 h-4" />
            </Button>
            
            <div className="w-px h-6 bg-gray-300" />
            
            {/* 色選択 */}
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
            
            {/* 太さ選択 */}
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
            
            <div className="w-px h-6 bg-gray-300" />
            
            {/* Undo/Redo/Delete */}
            <Button
              variant="outline"
              size="sm"
              onClick={onUndo}
              disabled={!canUndo}
              title="元に戻す (Ctrl+Z)"
            >
              <Undo2 className="w-4 h-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onRedo}
              disabled={!canRedo}
              title="やり直す"
            >
              <Redo2 className="w-4 h-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onClear}
              title="全削除"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
            
            <div className="w-px h-6 bg-gray-300" />
            
            {/* 完了 */}
            <Button
              variant="default"
              size="sm"
              onClick={onComplete}
              className="gap-2 bg-green-600 hover:bg-green-700"
            >
              <Check className="w-4 h-4" />
              完了
            </Button>
          </>
        )}
      </div>
    </div>
  );
}