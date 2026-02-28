// Extracted from ViewerCanvas: drag and transform handlers

export function createDragTransformHandlers(ctx) {
  const {
    shapesMapRef, bump, getAllShapes, onShapesChange,
    addToUndoStack, onSaveShape, normalizeCoords, denormalizeCoords,
    bgSize, isEditableShape, canMutateExisting, isSaving, setIsSaving,
    isInteractingRef, isDraggingRef, pendingIncomingShapesRef,
    dragRafRef, pendingDragRef,
    debugRef, setSelectedId,
  } = ctx;

  const handleDragStart = (shape, e) => {
    isInteractingRef.current = true;
    isDraggingRef.current = true;
    e.cancelBubble = true;
  };

  const handleTransformStart = (shape, e) => {
    isInteractingRef.current = true;
  };

  const handleDragMove = (shape, e) => {
    if (!canMutateExisting) return;
    const node = e.target;
    pendingDragRef.current = { shape, x: node.x(), y: node.y() };
    if (dragRafRef.current) return;

    dragRafRef.current = requestAnimationFrame(() => {
      const p = pendingDragRef.current;
      dragRafRef.current = null;
      if (!p) return;
      const { shape, x, y } = p;
      const cur = shapesMapRef.current.get(shape.id);
      if (!cur) return;
      const newMap = new Map(shapesMapRef.current);
      if (shape.tool === 'rect' || shape.tool === 'circle' || shape.tool === 'text') {
        const { nx, ny } = normalizeCoords(x, y);
        newMap.set(shape.id, { ...cur, nx, ny });
      } else if (shape.tool === 'pen' || shape.tool === 'arrow') {
        newMap.set(shape.id, { ...cur, dragX: x, dragY: y });
      }
      shapesMapRef.current = newMap;
      bump();
    });
  };

  const handleDragEnd = async (shape, e) => {
    if (!canMutateExisting) { isDraggingRef.current = false; return; }
    if (!isEditableShape(shape)) { isDraggingRef.current = false; return; }
    if (isSaving[shape.id]) { isDraggingRef.current = false; return; }

    const node = e.target;
    const dx = shape.dragX ?? node.x();
    const dy = shape.dragY ?? node.y();
    const updatedShape = { ...shape };

    if (shape.tool === 'pen' && shape.normalizedPoints) {
      const newPoints = [];
      for (let i = 0; i < shape.normalizedPoints.length; i += 2) {
        const { x: px, y: py } = denormalizeCoords(shape.normalizedPoints[i], shape.normalizedPoints[i + 1]);
        const { nx, ny } = normalizeCoords(px + dx, py + dy);
        newPoints.push(nx, ny);
      }
      updatedShape.normalizedPoints = newPoints;
      updatedShape.dragX = 0; updatedShape.dragY = 0;
      node.position({ x: 0, y: 0 });
    } else if (shape.tool === 'rect' || shape.tool === 'circle' || shape.tool === 'text') {
      const { nx, ny } = normalizeCoords(dx, dy);
      updatedShape.nx = nx; updatedShape.ny = ny;
    } else if (shape.tool === 'arrow' && shape.normalizedPoints) {
      const newPoints = [];
      for (let i = 0; i < shape.normalizedPoints.length; i += 2) {
        const { x: px, y: py } = denormalizeCoords(shape.normalizedPoints[i], shape.normalizedPoints[i + 1]);
        const { nx, ny } = normalizeCoords(px + dx, py + dy);
        newPoints.push(nx, ny);
      }
      updatedShape.normalizedPoints = newPoints;
      updatedShape.dragX = 0; updatedShape.dragY = 0;
      node.position({ x: 0, y: 0 });
    }

    const updatedWithDirty = { ...updatedShape, _dirty: true, _localTs: Date.now() };
    addToUndoStack({ type: 'update', shapeId: shape.id, before: shape, after: updatedWithDirty });
    const newMap = new Map(shapesMapRef.current);
    newMap.set(updatedWithDirty.id, updatedWithDirty);
    shapesMapRef.current = newMap;
    bump();
    onShapesChange?.(getAllShapes());

    isDraggingRef.current = false;
    isInteractingRef.current = false;
    if (pendingIncomingShapesRef.current) { bump(); }

    if (onSaveShape) {
      setIsSaving(prev => ({ ...prev, [shape.id]: true }));
      debugRef.current.mutation = 'update-drag';
      debugRef.current.saveStatus = 'saving';
      try {
        const result = await onSaveShape(updatedShape, 'upsert');
        debugRef.current.saveStatus = 'success';
        debugRef.current.error = null;
        const cur = shapesMapRef.current.get(updatedShape.id);
        if (cur) {
          const nm = new Map(shapesMapRef.current);
          nm.set(updatedShape.id, { ...cur, dbId: result?.dbId, _dirty: false });
          shapesMapRef.current = nm;
          bump();
          onShapesChange?.(getAllShapes());
        }
      } catch (err) {
        console.error('Update shape error:', err);
        debugRef.current.saveStatus = 'error';
        debugRef.current.error = err.message;
        const revertMap = new Map(shapesMapRef.current);
        revertMap.set(shape.id, shape);
        shapesMapRef.current = revertMap;
        bump();
        onShapesChange?.(getAllShapes());
      } finally {
        setIsSaving(prev => ({ ...prev, [shape.id]: false }));
      }
    }
  };

  const handleTransformEnd = async (shape, e) => {
    if (!canMutateExisting) return;
    if (!isEditableShape(shape)) return;
    if (isSaving[shape.id]) return;

    const node = e.target;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    const updatedShape = { ...shape };

    if (shape.tool === 'rect') {
      const finalX = node.x(), finalY = node.y();
      const finalW = Math.max(5, node.width() * scaleX);
      const finalH = Math.max(5, node.height() * scaleY);
      node.scaleX(1); node.scaleY(1); node.width(finalW); node.height(finalH); node.x(finalX); node.y(finalY);
      const { nx, ny } = normalizeCoords(finalX, finalY);
      const { nx: nx2, ny: ny2 } = normalizeCoords(finalX + finalW, finalY + finalH);
      updatedShape.nx = nx; updatedShape.ny = ny; updatedShape.nw = nx2 - nx; updatedShape.nh = ny2 - ny;
    } else if (shape.tool === 'circle') {
      const finalX = node.x(), finalY = node.y();
      const finalR = Math.max(3, node.radius() * Math.max(scaleX, scaleY));
      node.scaleX(1); node.scaleY(1); node.radius(finalR); node.x(finalX); node.y(finalY);
      const { nx, ny } = normalizeCoords(finalX, finalY);
      updatedShape.nx = nx; updatedShape.ny = ny; updatedShape.nr = finalR / bgSize.width;
    } else if (shape.tool === 'arrow' && shape.normalizedPoints) {
      const transform = node.getAbsoluteTransform();
      const p1 = denormalizeCoords(shape.normalizedPoints[0], shape.normalizedPoints[1]);
      const p2 = denormalizeCoords(shape.normalizedPoints[2], shape.normalizedPoints[3]);
      const newP1 = transform.point({ x: p1.x, y: p1.y });
      const newP2 = transform.point({ x: p2.x, y: p2.y });
      const { nx: nx1, ny: ny1 } = normalizeCoords(newP1.x, newP1.y);
      const { nx: nx2, ny: ny2 } = normalizeCoords(newP2.x, newP2.y);
      updatedShape.normalizedPoints = [nx1, ny1, nx2, ny2];
      node.scaleX(1); node.scaleY(1); node.rotation(0); node.x(0); node.y(0);
    } else if (shape.tool === 'text') {
      const finalX = node.x(), finalY = node.y();
      const rectChild = node.findOne('Rect');
      const finalW = rectChild ? Math.max(20, rectChild.width() * scaleX) : 100;
      const finalH = rectChild ? Math.max(16, rectChild.height() * scaleY) : 24;
      node.scaleX(1); node.scaleY(1); node.x(finalX); node.y(finalY);
      const { nx, ny } = normalizeCoords(finalX, finalY);
      updatedShape.nx = nx; updatedShape.ny = ny;
      updatedShape.boxResized = true;
      updatedShape.boxW = finalW / bgSize.width;
      updatedShape.boxH = finalH / bgSize.height;
    }

    // 一時フィールド削除
    delete updatedShape.points; delete updatedShape.startX; delete updatedShape.startY;
    delete updatedShape.x; delete updatedShape.y; delete updatedShape.width;
    delete updatedShape.height; delete updatedShape.radius;

    const updatedWithDirty = { ...updatedShape, _dirty: true, _localTs: Date.now() };
    addToUndoStack({ type: 'update', shapeId: shape.id, before: shape, after: updatedWithDirty });
    const newMap = new Map(shapesMapRef.current);
    newMap.set(updatedWithDirty.id, updatedWithDirty);
    shapesMapRef.current = newMap;
    bump();
    onShapesChange?.(getAllShapes());

    isInteractingRef.current = false;
    if (onSaveShape) {
      if (pendingIncomingShapesRef.current) { bump(); }
      setIsSaving(prev => ({ ...prev, [shape.id]: true }));
      debugRef.current.mutation = 'update-transform';
      debugRef.current.saveStatus = 'saving';
      try {
        const result = await onSaveShape(updatedShape, 'upsert');
        debugRef.current.saveStatus = 'success';
        debugRef.current.error = null;
        const cur = shapesMapRef.current.get(updatedShape.id);
        if (cur) {
          const dm = new Map(shapesMapRef.current);
          dm.set(updatedShape.id, { ...cur, dbId: result?.dbId, _dirty: false });
          shapesMapRef.current = dm;
          bump();
          onShapesChange?.(getAllShapes());
        }
      } catch (err) {
        console.error('[ViewerCanvas] onSaveShape error:', err);
        debugRef.current.saveStatus = 'error';
        debugRef.current.error = err.message;
        const revertMap = new Map(shapesMapRef.current);
        revertMap.set(shape.id, shape);
        shapesMapRef.current = revertMap;
        bump();
        onShapesChange?.(getAllShapes());
      } finally {
        setIsSaving(prev => ({ ...prev, [shape.id]: false }));
      }
    }
  };

  return { handleDragStart, handleDragMove, handleDragEnd, handleTransformStart, handleTransformEnd };
}