// Camera math: pure functions over { x, y, zoom }, where (x, y) is the world point at the
// centre of the view and zoom is screen px per world px.

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 12;
const EDGE_SLACK = 0.35; // fraction of the view that may show past the world's edge

/**
 * @typedef {{ x: number, y: number, zoom: number }} Camera
 * @typedef {{ w: number, h: number }} View   screen size in CSS px
 * @typedef {{ width: number, height: number }} World
 */

export const clampZoom = (zoom) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

/** @returns {Camera} the whole world in view, a little padded */
export function fitCamera(world, view) {
  const zoom = clampZoom(Math.min(view.w / world.width, view.h / world.height) * 0.94);
  return { x: world.width / 2, y: world.height / 2, zoom };
}

export function screenToWorld(cam, view, point) {
  return {
    x: cam.x + (point.x - view.w / 2) / cam.zoom,
    y: cam.y + (point.y - view.h / 2) / cam.zoom,
  };
}

export function worldToScreen(cam, view, point) {
  return {
    x: (point.x - cam.x) * cam.zoom + view.w / 2,
    y: (point.y - cam.y) * cam.zoom + view.h / 2,
  };
}

/** Keeps the centre inside the world, allowing a bit of overscroll at the edges. */
export function clampCamera(cam, world, view) {
  const clampAxis = (center, size, viewSize) => {
    const half = viewSize / 2 / cam.zoom;
    const slack = (viewSize * EDGE_SLACK) / cam.zoom;
    const min = Math.min(half - slack, size / 2);
    const max = Math.max(size - half + slack, size / 2);
    return Math.min(max, Math.max(min, center));
  };
  return {
    ...cam,
    x: clampAxis(cam.x, world.width, view.w),
    y: clampAxis(cam.y, world.height, view.h),
  };
}

/** Zooms by `factor`, keeping the world point under `anchor` (screen px) fixed. */
export function zoomAt(cam, factor, anchor, view) {
  const zoom = clampZoom(cam.zoom * factor);
  const before = screenToWorld(cam, view, anchor);
  const after = screenToWorld({ ...cam, zoom }, view, anchor);
  return { x: cam.x + before.x - after.x, y: cam.y + before.y - after.y, zoom };
}

/** Pans by a screen-space delta (dragging right moves the world right). */
export function panBy(cam, dx, dy) {
  return { ...cam, x: cam.x - dx / cam.zoom, y: cam.y - dy / cam.zoom };
}

/** Eases `cam` toward `target`; k is the fraction covered this frame (0..1). */
export function easeCamera(cam, target, k) {
  const zoom = cam.zoom * Math.pow(target.zoom / cam.zoom, k);
  return { x: cam.x + (target.x - cam.x) * k, y: cam.y + (target.y - cam.y) * k, zoom };
}

export const isSettled = (cam, target) =>
  Math.abs(cam.x - target.x) < 0.05 && Math.abs(cam.y - target.y) < 0.05 && Math.abs(cam.zoom / target.zoom - 1) < 0.002;
