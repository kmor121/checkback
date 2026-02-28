// ViewerCanvas から抽出した Map 操作ヘルパー

// shapesMapRef に対する不変更新パターンを1箇所に集約
// 全ての関数は新しいMapを返す（shapesMapRef.currentへの代入は呼び出し元で行う）

/**
 * Map に shape を upsert（dirty/localTs 付与）
 */
export function mapUpsertDirty(currentMap, shape) {
  const newMap = new Map(currentMap);
  newMap.set(shape.id, { ...shape, _dirty: true, _localTs: Date.now() });
  return newMap;
}

/**
 * Map から shape を削除
 */
export function mapDelete(currentMap, shapeId) {
  const newMap = new Map(currentMap);
  newMap.delete(shapeId);
  return newMap;
}

/**
 * Map 内の shape の dirty フラグを解除（dbId 付与）
 */
export function mapClearDirty(currentMap, shapeId, dbId) {
  const cur = currentMap.get(shapeId);
  if (!cur) return currentMap;
  const newMap = new Map(currentMap);
  const updated = { ...cur, _dirty: false };
  if (dbId !== undefined) updated.dbId = dbId;
  newMap.set(shapeId, updated);
  return newMap;
}

/**
 * Map 内の shape を部分更新（位置など）
 */
export function mapPatchShape(currentMap, shapeId, patch) {
  const cur = currentMap.get(shapeId);
  if (!cur) return currentMap;
  const newMap = new Map(currentMap);
  newMap.set(shapeId, { ...cur, ...patch });
  return newMap;
}

/**
 * Map を配列から再構築
 */
export function mapFromArray(shapes) {
  return new Map(shapes.map(s => [s.id, s]));
}

/**
 * dirty な shapes を抽出
 */
export function extractDirtyShapes(currentMap) {
  const dirtyShapes = new Map();
  for (const [id, shape] of currentMap.entries()) {
    if (shape._dirty) {
      dirtyShapes.set(id, shape);
    }
  }
  return dirtyShapes;
}