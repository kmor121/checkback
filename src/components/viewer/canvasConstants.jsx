// Shared constants for ViewerCanvas and related components

export const TEXT_EDITOR_INITIAL = Object.freeze({
  visible: false, x: 0, y: 0, value: '', shapeId: null, imgX: 0, imgY: 0, openedAt: 0,
});

export const DEBUG_MODE = (typeof window !== 'undefined') && (
  new URLSearchParams(window.location.search).get('diag') === '1' ||
  localStorage.getItem('debugPaintLayer') === '1' ||
  import.meta.env.VITE_DEBUG === 'true'
);