// Drag & Transform handlers extracted from ViewerCanvas

import { mapSet } from './canvasMapHelpers';
import { markDirty, commitShapeToMap, onSaveSuccess, onSaveRevert } from './canvasMapHelpers';

/**
 * Create drag/transform handler functions.
 * @param {object} ctx - shared context refs/state/callbacks
 */
export function createDragTransformHandlers(ctx) {
  const {
    shapesMapRef, bump, onShapesChange, onSaveShape,
    normalizeCoords, denormalizeCoords, bgSize,
    addToUndoStack, isEditableShape,
    canMutateExisting, isSaving, setIsSaving,
    isInteractingRef, isDraggingRef, pendingIncomingShapesRef,
    dragRafRef, pendingDragRef,
    debugRef,
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
      if (shape.tool === 'rect' || shape.tool === 'circle' || shape.tool === 'text') {
        const { nx, ny } = normalizeCoords(x, y);
        mapSet(shapesMapRef, shape.id, { ...cur, nx, ny });
      } else if (shape.tool === 'pen' || shape.tool === 'arrow') {
        mapSet(shapesMapRef, shape.id, { ...cur, dragX: x, dragY: y });
      }
      bump();
    });
  };

  const handleDragEnd = async (shape, e) => {
    if (!canMutateExisting || !isEditableShape(shape) || isSaving[shape.id]) {
      isDraggingRef.current = false;
      return;
    }

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

    const updatedWithDirty = markDirty(updatedShape);
    addToUndoStack({ type: 'update', shapeId: shape.id, before: shape, after: updatedWithDirty });
    commitShapeToMap(shapesMapRef, updatedWithDirty, bump, onShapesChange);

    isDraggingRef.current = false;
    isInteractingRef.current = false;
    if (pendingIncomingShapesRef.current) bump();

    if (onSaveShape) {
      setIsSaving(prev => ({ ...prev, [shape.id]: true }));
      debugRef.current.mutation = 'update-drag';
      debugRef.current.saveStatus = 'saving';
      try {
        const result = await onSaveShape(updatedShape, 'upsert');
        debugRef.current.saveStatus = 'success';
        debugRef.current.error = null;
        onSaveSuccess(shapesMapRef, updatedShape.id, result?.dbId, bump, onShapesChange);
      } catch (err) {
        console.error('Update shape error:', err);
        debugRef.current.saveStatus = 'error';
        debugRef.current.error = err.message;
        onSaveRevert(shapesMapRef, shape, bump, onShapesChange);
      } finally {
        setIsSaving(prev => ({ ...prev, [shape.id]: false }));
      }
    }
  };

  const handleTransformEnd = async (shape, e) => {
    if (!canMutateExisting || !isEditableShape(shape) || isSaving[shape.id]) return;

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
      updatedShape.boxResized = true; updatedShape.boxW = finalW / bgSize.width; updatedShape.boxH = finalH / bgSize.height;
    }

    // Clean up temporary fields
    delete updatedShape.points; delete updatedShape.startX; delete updatedShape.startY;
    delete updatedShape.x; delete updatedShape.y; delete updatedShape.width; delete updatedShape.height; delete updatedShape.radius;

    const updatedWithDirty = markDirty(updatedShape);
    addToUndoStack({ type: 'update', shapeId: shape.id, before: shape, after: updatedWithDirty });
    commitShapeToMap(shapesMapRef, updatedWithDirty, bump, onShapesChange);

    isInteractingRef.current = false;
    if (onSaveShape) {
      if (pendingIncomingShapesRef.current) bump();
      setIsSaving(prev => ({ ...prev, [shape.id]: true }));
      debugRef.current.mutation = 'update-transform';
      debugRef.current.saveStatus = 'saving';
      try {
        const result = await onSaveShape(updatedShape, 'upsert');
        debugRef.current.saveStatus = 'success'; debugRef.current.error = null;
        onSaveSuccess(shapesMapRef, updatedShape.id, result?.dbId, bump, onShapesChange);
      } catch (err) {
        console.error('[ViewerCanvas] onSaveShape error:', err);
        debugRef.current.saveStatus = 'error'; debugRef.current.error = err.message;
        onSaveRevert(shapesMapRef, shape, bump, onShapesChange);
      } finally {
        setIsSaving(prev => ({ ...prev, [shape.id]: false }));
      }
    }
  };

  return { handleDragStart, handleTransformStart, handleDragMove, handleDragEnd, handleTransformEnd };
}