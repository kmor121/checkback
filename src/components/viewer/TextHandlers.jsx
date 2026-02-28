// Extracted from ViewerCanvas: text editing handlers
// All functions receive a `ctx` object with shared refs/state/callbacks

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

export function createTextHandlers(ctx) {
  const {
    textInputRef, textEditor, setTextEditor, setIsComposing,
    shapes, shapesMapRef, bump, getAllShapes, onShapesChange,
    addToUndoStack, onSaveShape, onToolChange,
    activeCommentId, getCommentIdForDrawing, onBeginPaint,
    strokeColor, strokeWidth, bgSize, normalizeCoords, denormalizeCoords,
    isEditMode, contentGroupRef, setSelectedId,
    DEBUG_MODE,
  } = ctx;

  const handleTextConfirm = async () => {
    const raw = textInputRef.current?.value ?? textEditor.value;
    const text = raw.trim();
    if (!text) {
      setTextEditor({ visible: false, x: 0, y: 0, value: '', shapeId: null, imgX: 0, imgY: 0, openedAt: 0 });
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
        const updatedWithDirty = { ...updatedShape, _dirty: true, _localTs: Date.now() };
        addToUndoStack({ type: 'update', shapeId, before: existingShape, after: updatedWithDirty });
        const newMap = new Map(shapesMapRef.current);
        newMap.set(shapeId, updatedWithDirty);
        shapesMapRef.current = newMap;
        bump();
        onShapesChange?.(getAllShapes());

        if (onSaveShape) {
          try {
            await onSaveShape(updatedShape, 'upsert');
            const cur = shapesMapRef.current.get(shapeId);
            if (cur) {
              const dirtyMap = new Map(shapesMapRef.current);
              dirtyMap.set(shapeId, { ...cur, _dirty: false });
              shapesMapRef.current = dirtyMap;
              bump();
              onShapesChange?.(getAllShapes());
            }
          } catch (err) {
            console.error('Save text error:', err);
          }
        }
      }
    } else {
      const commentIdForText = activeCommentId || getCommentIdForDrawing();
      if (!commentIdForText) {
        console.error('[ViewerCanvas] Cannot create text: no commentId available');
        setTextEditor({ visible: false, x: 0, y: 0, value: '', shapeId: null, imgX: 0, imgY: 0, openedAt: 0 });
        return;
      }

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

      const shapeWithDirty = { ...normalizedShape, _dirty: true, _localTs: Date.now() };
      addToUndoStack({ type: 'add', shapeId: normalizedShape.id });
      const newMap = new Map(shapesMapRef.current);
      newMap.set(shapeWithDirty.id, shapeWithDirty);
      shapesMapRef.current = newMap;
      bump();
      onShapesChange?.(getAllShapes());
      setSelectedId(normalizedShape.id);

      if (onSaveShape) {
        try {
          const result = await onSaveShape(normalizedShape, 'create');
          const cur = shapesMapRef.current.get(normalizedShape.id);
          if (cur) {
            const dirtyMap = new Map(shapesMapRef.current);
            dirtyMap.set(normalizedShape.id, { ...cur, dbId: result?.dbId, _dirty: false });
            shapesMapRef.current = dirtyMap;
            bump();
            onShapesChange?.(getAllShapes());
          }
        } catch (err) {
          console.error('Save text error:', err);
        }
      }
    }

    setTextEditor({ visible: false, x: 0, y: 0, value: '', shapeId: null, imgX: 0, imgY: 0, openedAt: 0 });
    setIsComposing(false);
    if (onToolChange) onToolChange('select');
  };

  const handleTextCancel = () => {
    setTextEditor({ visible: false, x: 0, y: 0, value: '', shapeId: null, imgX: 0, imgY: 0, openedAt: 0 });
    setIsComposing(false);
    if (onToolChange) onToolChange('select');
  };

  const handleTextBlur = () => {
    if (textEditor.openedAt && Date.now() - textEditor.openedAt < 250) return;
    const raw = textInputRef.current?.value ?? textEditor.value;
    if (raw.trim()) {
      handleTextConfirm();
    } else {
      handleTextCancel();
    }
  };

  const handleTextDblClick = (shape) => {
    if (!isEditMode) return;
    const { x: imgX, y: imgY } = denormalizeCoords(shape.nx, shape.ny);
    const group = contentGroupRef.current;
    if (!group) return;
    const tr = group.getAbsoluteTransform().copy();
    const stagePoint = tr.point({ x: imgX, y: imgY });
    if (DEBUG_MODE) console.log('[ViewerCanvas] Text double-click edit:', { shapeId: shape.id, text: shape.text });
    setTextEditor({
      visible: true, x: stagePoint.x, y: stagePoint.y,
      value: shape.text || '', shapeId: shape.id,
      imgX, imgY, openedAt: Date.now(),
    });
  };

  return { handleTextConfirm, handleTextCancel, handleTextBlur, handleTextDblClick };
}