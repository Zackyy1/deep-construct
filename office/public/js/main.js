// Boots the office: loads the sprite sheet, connects to Claude through the office server,
// and runs the frame loop.
import { SHEET_URL } from './sprites.js';
import { WORLD } from './layout.js';
import { describeStatus } from './agents.js';
import { fitCamera, clampCamera, easeCamera, isSettled, screenToWorld, zoomAt } from './camera.js';
import { buildStaticLayer, buildSkyStrip, drawWorld } from './render.js';
import { drawOverlay } from './overlay.js';
import { attachInput } from './input.js';
import { PALETTE } from './palette.js';
import { createScene, stepScene, agentAt, assignWork, syncWithBridge, demoWork } from './scene.js';
import { connectBridge } from './bridge-client.js';
import { createConsolePanel } from './console-panel.js';

const MAX_DT = 0.1;
const FOCUS_ZOOM = 6;
const EASE_RATE = 8; // higher = snappier camera moves

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${url}`));
    img.src = url;
  });
}

function renderCard(card, agent, isDemo) {
  card.hidden = !agent;
  if (!agent) return;
  const toggle = card.querySelector('[data-action=toggle-work]');
  toggle.hidden = !isDemo;
  toggle.textContent = agent.work ? 'Stop work (demo)' : 'Give work (demo)';
  card.querySelector('[data-field=name]').textContent = agent.def.name;
  card.querySelector('[data-field=model]').textContent = agent.def.model;
  card.querySelector('[data-field=model]').dataset.model = agent.def.model;
  card.querySelector('[data-field=role]').textContent = agent.def.role;
  card.querySelector('[data-field=status]').textContent = describeStatus(agent);
}

async function main() {
  const canvas = document.getElementById('office');
  const ctx = canvas.getContext('2d');
  const card = document.getElementById('agent-card');
  const sheet = await loadImage(SHEET_URL);
  const gfx = { sheet, staticLayer: buildStaticLayer(), skyStrip: buildSkyStrip(sheet) };

  let scene = createScene();
  let view = { w: canvas.clientWidth, h: canvas.clientHeight };
  let cam = fitCamera(WORLD, view);
  let target = null; // where the camera is easing to, if anywhere
  let followId = null; // agent the camera follows after a click
  let hoveredId = null;
  let selectedId = null;
  let bridgeState = null; // what Claude is doing, once a project is open
  const isForcedDemo = new URLSearchParams(window.location.search).has('demo');
  const isDemo = () => isForcedDemo || !bridgeState?.project.root;

  // --- Claude bridge -------------------------------------------------------
  const demoPanel = document.getElementById('demo-panel');
  let consolePanel = null;
  const bridge = connectBridge({
    onState: (state) => {
      bridgeState = state;
      demoPanel.hidden = !isDemo();
      if (!isDemo()) scene = syncWithBridge(scene, state);
      consolePanel?.update(state);
    },
    onConnection: (isConnected) => consolePanel?.setConnected(isConnected),
  });
  consolePanel = createConsolePanel(document.getElementById('console'), bridge);
  if (bridgeState) consolePanel.update(bridgeState);

  // --- Camera and input ----------------------------------------------------
  const resize = () => {
    const dpr = window.devicePixelRatio || 1;
    view = { w: canvas.clientWidth, h: canvas.clientHeight };
    canvas.width = Math.round(view.w * dpr);
    canvas.height = Math.round(view.h * dpr);
    cam = clampCamera(cam, WORLD, view);
  };
  new ResizeObserver(resize).observe(canvas);
  resize();
  cam = fitCamera(WORLD, view);

  const store = {
    view: () => view,
    update: (fn) => {
      target = null;
      followId = null;
      cam = clampCamera(fn(cam), WORLD, view);
    },
    hover: (p) => {
      hoveredId = p ? agentAt(scene, screenToWorld(cam, view, p))?.id ?? null : null;
      canvas.classList.toggle('is-pointing', Boolean(hoveredId));
    },
    click: (p) => {
      const agent = agentAt(scene, screenToWorld(cam, view, p));
      selectedId = agent?.id ?? null;
      followId = selectedId;
      if (agent) target = { x: agent.pos.x, y: agent.pos.y - 10, zoom: Math.max(cam.zoom, FOCUS_ZOOM) };
    },
    reset: () => {
      followId = null;
      selectedId = null;
      target = fitCamera(WORLD, view);
    },
  };
  attachInput(canvas, store);

  const zoomButton = (factor) => () => store.update((c) => zoomAt(c, factor, { x: view.w / 2, y: view.h / 2 }, view));
  document.getElementById('zoom-in').addEventListener('click', zoomButton(1.4));
  document.getElementById('zoom-out').addEventListener('click', zoomButton(1 / 1.4));
  document.getElementById('zoom-fit').addEventListener('click', store.reset);
  card.querySelector('[data-action=close]').addEventListener('click', () => {
    selectedId = null;
    followId = null;
  });

  // --- Demo controls (only without a project, or with ?demo) ----------------
  card.querySelector('[data-action=toggle-work]').addEventListener('click', () => {
    scene = assignWork(scene, (a) => (a.id !== selectedId ? undefined : a.work ? null : demoWork(a)));
  });
  document.getElementById('demo-all').addEventListener('click', () => {
    scene = assignWork(scene, (a) => (a.work ? undefined : demoWork(a)));
  });
  document.getElementById('demo-none').addEventListener('click', () => {
    scene = assignWork(scene, (a) => (a.work ? null : undefined));
  });
  document.getElementById('demo-mix').addEventListener('click', () => {
    scene = assignWork(scene, (a) => (Math.random() < 0.5 ? demoWork(a) : null));
  });
  document.getElementById('toggle-console').addEventListener('click', (e) => {
    const isOpen = document.body.classList.toggle('console-closed') === false;
    e.currentTarget.setAttribute('aria-expanded', String(isOpen));
  });

  // --- Frame loop ----------------------------------------------------------
  let last = performance.now();
  const frame = (now) => {
    const dt = Math.min(MAX_DT, (now - last) / 1000);
    last = now;
    const time = now / 1000;
    scene = stepScene(scene, dt);

    const followed = followId && scene.agents.find((a) => a.id === followId);
    if (followed) target = { x: followed.pos.x, y: followed.pos.y - 10, zoom: target?.zoom ?? cam.zoom };
    if (target) {
      cam = clampCamera(easeCamera(cam, target, 1 - Math.exp(-EASE_RATE * dt)), WORLD, view);
      if (!followed && isSettled(cam, target)) target = null;
    }

    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = PALETTE.black;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const scale = cam.zoom * dpr;
    ctx.setTransform(scale, 0, 0, scale, Math.round((view.w / 2 - cam.x * cam.zoom) * dpr), Math.round((view.h / 2 - cam.y * cam.zoom) * dpr));
    ctx.imageSmoothingEnabled = false;
    drawWorld(ctx, gfx, scene, time, new Date());

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawOverlay(ctx, scene, cam, view, time, hoveredId ?? selectedId);
    renderCard(card, scene.agents.find((a) => a.id === selectedId), isDemo());
    document.getElementById('zoom-level').textContent = `${cam.zoom.toFixed(1)}×`;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

main().catch((error) => {
  const banner = document.getElementById('error');
  banner.hidden = false;
  banner.textContent = `The office failed to load: ${error.message}`;
  throw error;
});
