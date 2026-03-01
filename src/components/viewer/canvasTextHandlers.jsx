// Text editing handlers extracted from ViewerCanvas

import { generateUUID } from './canvasUtils';
import { markDirty, commitShapeToMap, onSaveSuccess } from './canvasMapHelpers';
import { TEXT_EDITOR_INITIAL } from './canvasConstants';

/**
 * Create text handler functions.
 * @param {object} ctx - shared context refs/state/callbacks
 */
export function createTextHandlers(ctx) {
  const {
    textInputRef, textEditor, setTextEditor, setIsComposing,
    normalizeCoords, denormalizeCoords, bgSize,
    shapes, shapesMapRef, bump, onShapesChange,
    addToUndoStack, setSelectedId,
    strokeColor, strokeWidth,
    activeCommentId, getCommentIdForDrawing, onBeginPaint,
    onSaveShape, onToolChange,
    isEditMode, contentGroupRef,
  } = ctx;

  const handleTextConfirm = async () => {
    const raw = textInputRef.current?.value ?? textEditor.value;
    const text = raw.trim();
    if (!text) {
      setTextEditor(TEXT_EDITOR_INITIAL);
      if (onToolChange) onToolChange('select');
      return;
    }

    const { imgX, imgY, shapeId } = textEditor;
    const { nx, ny } = normalizeCoords(imgX, imgY);
    const fontSize = Math.max(12, strokeWidth * 6);

    if (shapeId) {
      const existingShape = shapes.find(s => s.id === shapeId);
      if (existingShape) {
        const updatedShape = { ...existingShape, text, nx, ny, stroke: strokeColor, strokeWidth, fontSize };
        const updatedWithDirty = markDirty(updatedShape);
        addToUndoStack({ type: 'update', shapeId, before: existingShape, after: updatedWithDirty });
        commitShapeToMap(shapesMapRef, updatedWithDirty, bump, onShapesChange);

        if (onSaveShape) {
          try {
            await onSaveShape(updatedShape, 'upsert');
            onSaveSuccess(shapesMapRef, shapeId, undefined, bump, onShapesChange);
          } catch (err) {
            console.error('Save text error:', err);
          }
        }
      }
    } else {
      const commentIdForText = activeCommentId || getCommentIdForDrawing();
      if (!commentIdForText) { setTextEditor(TEXT_EDITOR_INITIAL); return; }

      const normalizedShape = {
        id: generateUUID(),
        comment_id: commentIdForText,
        commentId: commentIdForText,
        tool: 'text',
        stroke: strokeColor,
        strokeWidth,
        bgWidth: bgSize.width,
        bgHeight: bgSize.height,
        nx, ny, text, fontSize,
        boxResized: false,
      };

      if (!activeCommentId && onBeginPaint) {
        queueMicrotask(() => onBeginPaint(imgX, imgY, bgSize.width, bgSize.height));
      }

      addToUndoStack({ type: 'add', shapeId: normalizedShape.id });
      commitShapeToMap(shapesMapRef, normalizedShape, bump, onShapesChange);
      setSelectedId(normalizedShape.id);

      if (onSaveShape) {
        try {
          const result = await onSaveShape(normalizedShape, 'create');
          onSaveSuccess(shapesMapRef, normalizedShape.id, result?.dbId, bump, onShapesChange);
        } catch (err) {
          console.error('Save text error:', err);
        }
      }
    }

    setTextEditor(TEXT_EDITOR_INITIAL);
    setIsComposing(false);
    if (onToolChange) onToolChange('select');
  };

  const handleTextCancel = () => {
    setTextEditor(TEXT_EDITOR_INITIAL);
    setIsComposing(false);
    if (onToolChange) onToolChange('select');
  };

  const handleTextBlur = () => {
    if (textEditor.openedAt && Date.now() - textEditor.openedAt < 250) return;
    const raw = textInputRef.current?.value ?? textEditor.value;
    if (raw.trim()) { handleTextConfirm(); } else { handleTextCancel(); }
  };

  const handleTextDblClick = (shape) => {
    if (!isEditMode) return;
    const { x: imgX, y: imgY } = denormalizeCoords(shape.nx, shape.ny);
    const group = contentGroupRef.current;
    if (!group) return;
    const stagePoint = group.getAbsoluteTransform().copy().point({ x: imgX, y: imgY });
    setTextEditor({
      visible: true, x: stagePoint.x, y: stagePoint.y,
      value: shape.text || '', shapeId: shape.id,
      imgX, imgY, openedAt: Date.now(),
    });
  };

  return { handleTextConfirm, handleTextCancel, handleTextBlur, handleTextDblClick };
}