// Mouse, touch and keyboard controls. Each handler maps the current camera to a new one
// through `store.update`, so main.js stays the only owner of camera state.
import { zoomAt, panBy } from './camera.js';

const WHEEL_SENSITIVITY = 0.0018;
const KEY_PAN = 40; // screen px per key press
const KEY_ZOOM = 1.25;
const CLICK_SLOP = 5; // px of movement before a press counts as a drag

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ view: () => {w:number,h:number}, update: (fn: (cam: object) => object) => void,
 *   hover: (p: {x:number,y:number} | null) => void, click: (p: {x:number,y:number}) => void,
 *   reset: () => void }} store
 */
export function attachInput(canvas, store) {
  const pointers = new Map();
  let dragDistance = 0;
  let pinchDistance = 0;

  const local = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const pinchState = () => {
    const [a, b] = [...pointers.values()];
    return { mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, dist: Math.hypot(a.x - b.x, a.y - b.y) };
  };

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    // Trackpad pinch arrives as ctrl+wheel with small deltas; scale those up.
    const delta = e.ctrlKey ? e.deltaY * 6 : e.deltaY;
    store.update((cam) => zoomAt(cam, Math.exp(-delta * WHEEL_SENSITIVITY), local(e), store.view()));
  }, { passive: false });

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, local(e));
    dragDistance = 0;
    if (pointers.size === 2) pinchDistance = pinchState().dist;
    canvas.classList.add('is-dragging');
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = local(e);
    if (!pointers.has(e.pointerId)) {
      store.hover(p);
      return;
    }
    const prev = pointers.get(e.pointerId);
    pointers.set(e.pointerId, p);
    if (pointers.size === 1) {
      dragDistance += Math.hypot(p.x - prev.x, p.y - prev.y);
      store.update((cam) => panBy(cam, p.x - prev.x, p.y - prev.y));
      return;
    }
    if (pointers.size === 2) {
      dragDistance = Infinity;
      const { mid, dist } = pinchState();
      const factor = pinchDistance > 0 ? dist / pinchDistance : 1;
      pinchDistance = dist;
      store.update((cam) => zoomAt(cam, factor, mid, store.view()));
    }
  });

  const release = (e) => {
    const wasClick = pointers.size === 1 && dragDistance < CLICK_SLOP && e.type === 'pointerup';
    pointers.delete(e.pointerId);
    if (pointers.size === 0) canvas.classList.remove('is-dragging');
    if (wasClick) store.click(local(e));
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('pointerleave', () => store.hover(null));

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    const center = { x: store.view().w / 2, y: store.view().h / 2 };
    const actions = {
      ArrowLeft: (cam) => panBy(cam, KEY_PAN, 0), a: (cam) => panBy(cam, KEY_PAN, 0),
      ArrowRight: (cam) => panBy(cam, -KEY_PAN, 0), d: (cam) => panBy(cam, -KEY_PAN, 0),
      ArrowUp: (cam) => panBy(cam, 0, KEY_PAN), w: (cam) => panBy(cam, 0, KEY_PAN),
      ArrowDown: (cam) => panBy(cam, 0, -KEY_PAN), s: (cam) => panBy(cam, 0, -KEY_PAN),
      '+': (cam) => zoomAt(cam, KEY_ZOOM, center, store.view()), '=': (cam) => zoomAt(cam, KEY_ZOOM, center, store.view()),
      '-': (cam) => zoomAt(cam, 1 / KEY_ZOOM, center, store.view()),
    };
    if (e.key === '0' || e.key === 'Escape') {
      store.reset();
      return;
    }
    const action = actions[e.key];
    if (!action) return;
    e.preventDefault();
    store.update(action);
  });
}
