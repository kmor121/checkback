// Immutable Map helpers for ViewerCanvas shapes management

// Create a new Map with a shape added/updated (immutable)
export function mapSet(mapRef, id, shape) {
  const newMap = new Map(mapRef.current);
  newMap.set(id, shape);
  mapRef.current = newMap;
}

// Create a new Map with a shape removed (immutable)
export function mapDelete(mapRef, id) {
  const newMap = new Map(mapRef.current);
  newMap.delete(id);
  mapRef.current = newMap;
}

// Update a shape in map if it exists, returns true if updated
export function mapUpdateIfExists(mapRef, id, patchFn) {
  const cur = mapRef.current.get(id);
  if (!cur) return false;
  const newMap = new Map(mapRef.current);
  newMap.set(id, patchFn(cur));
  mapRef.current = newMap;
  return true;
}

// Mark shape as dirty with timestamp
export function markDirty(shape) {
  return { ...shape, _dirty: true, _localTs: Date.now() };
}

// Clear dirty flag on a shape
export function clearDirty(shape, dbId) {
  const patched = { ...shape, _dirty: false };
  if (dbId !== undefined) patched.dbId = dbId;
  return patched;
}

// Save shape to map + bump + notify parent (common pattern)
export function commitShapeToMap(mapRef, shape, bump, onShapesChange) {
  const dirty = markDirty(shape);
  mapSet(mapRef, dirty.id, dirty);
  bump();
  if (onShapesChange) onShapesChange(Array.from(mapRef.current.values()));
  return dirty;
}

// After DB save succeeds: clear dirty, optionally set dbId
export function onSaveSuccess(mapRef, shapeId, dbId, bump, onShapesChange) {
  const updated = mapUpdateIfExists(mapRef, shapeId, (cur) => clearDirty(cur, dbId));
  if (updated) {
    bump();
    if (onShapesChange) onShapesChange(Array.from(mapRef.current.values()));
  }
}

// After DB save fails: revert to original shape
export function onSaveRevert(mapRef, originalShape, bump, onShapesChange) {
  mapSet(mapRef, originalShape.id, originalShape);
  bump();
  if (onShapesChange) onShapesChange(Array.from(mapRef.current.values()));
}