import React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Pencil, Square, CircleIcon, ArrowRight, Undo, Redo, Trash2 } from 'lucide-react';

export default function PaintToolbar({ 
  tool, 
  onToolChange, 
  canUndo = false, 
  canRedo = false,
  onUndo,
  onRedo,
  onClear
}) {
  return (
    <Card className="mb-4">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">ペイントツール</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-4 gap-2">
          <Button
            variant={tool === 'pen' ? 'default' : 'outline'}
            size="icon"
            onClick={() => onToolChange('pen')}
            title="ペン"
          >
            <Pencil className="w-4 h-4" />
          </Button>
          <Button
            variant={tool === 'rect' ? 'default' : 'outline'}
            size="icon"
            onClick={() => onToolChange('rect')}
            title="四角形"
          >
            <Square className="w-4 h-4" />
          </Button>
          <Button
            variant={tool === 'circle' ? 'default' : 'outline'}
            size="icon"
            onClick={() => onToolChange('circle')}
            title="円"
          >
            <CircleIcon className="w-4 h-4" />
          </Button>
          <Button
            variant={tool === 'arrow' ? 'default' : 'outline'}
            size="icon"
            onClick={() => onToolChange('arrow')}
            title="矢印"
          >
            <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
        
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onUndo}
            disabled={!canUndo}
            className="flex-1"
          >
            <Undo className="w-4 h-4 mr-1" />
            元に戻す
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onRedo}
            disabled={!canRedo}
            className="flex-1"
          >
            <Redo className="w-4 h-4 mr-1" />
            やり直す
          </Button>
        </div>
        
        <Button
          variant="outline"
          size="sm"
          onClick={onClear}
          className="w-full"
        >
          <Trash2 className="w-4 h-4 mr-1" />
          クリア
        </Button>
      </CardContent>
    </Card>
  );
}