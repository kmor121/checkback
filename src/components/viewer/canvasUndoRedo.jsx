// Undo/Redo logic for ViewerCanvas (extracted for file size reduction)

export function performUndoAction(undoStack, setUndoStack, setRedoStack, shapesMapRef, bump, onShapesChange) {
  if (undoStack.length === 0) return;
  const action = undoStack[undoStack.length - 1];
  setUndoStack(prev => prev.slice(0, -1));
  setRedoStack(prev => [...prev, action]);

  const newMap = new Map(shapesMapRef.current);
  if (action.type === 'add') {
    newMap.delete(action.shapeId);
  } else if (action.type === 'update') {
    newMap.set(action.shapeId, action.before);
  } else if (action.type === 'delete') {
    newMap.set(action.shape.id, action.shape);
  }
  shapesMapRef.current = newMap;
  bump();
  onShapesChange?.(Array.from(newMap.values()));
}

export function performRedoAction(redoStack, setRedoStack, setUndoStack, shapesMapRef, bump, onShapesChange) {
  if (redoStack.length === 0) return;
  const action = redoStack[redoStack.length - 1];
  setRedoStack(prev => prev.slice(0, -1));
  setUndoStack(prev => [...prev, action]);

  const newMap = new Map(shapesMapRef.current);
  if (action.type === 'add') {
    // re-add is difficult, skip
  } else if (action.type === 'update') {
    newMap.set(action.shapeId, action.after);
  } else if (action.type === 'delete') {
    newMap.delete(action.shape.id);
  }
  shapesMapRef.current = newMap;
  bump();
  onShapesChange?.(Array.from(newMap.values()));
}