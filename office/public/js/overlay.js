// Screen-space text drawn over the world: name tags, speech bubbles, the corgi's z's.
// Text is drawn at screen resolution so it stays sharp at any zoom.
import { worldToScreen } from './camera.js';
import { agentBox } from './render.js';
import { PALETTE } from './palette.js';
import { POPUP_LIFE } from './agents.js';

const LABEL_MIN_ZOOM = 3;
const FONT = '600 11px ui-monospace, "SF Mono", Menlo, monospace';
const BUBBLE_FONT = '12px ui-monospace, "SF Mono", Menlo, "Apple Color Emoji", monospace';

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

const DOT = 6;

/** Name tag; a green dot means the agent has work, a grey one means it's free. */
function drawTag(ctx, text, x, y, isHighlighted, isWorking) {
  ctx.font = FONT;
  const textW = Math.ceil(ctx.measureText(text).width);
  const w = textW + DOT + 16;
  const h = 16;
  const left = Math.round(x - w / 2);
  roundRect(ctx, left, Math.round(y), w, h, 4);
  ctx.fillStyle = isHighlighted ? PALETTE.yellow : 'rgba(26, 28, 44, 0.78)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(left + 6 + DOT / 2, Math.round(y + h / 2), DOT / 2, 0, Math.PI * 2);
  ctx.fillStyle = isWorking ? PALETTE.green : PALETTE.slate;
  ctx.fill();
  ctx.fillStyle = isHighlighted ? PALETTE.black : PALETTE.white;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, left + DOT + 11, Math.round(y + h / 2 + 1));
}

/** Three bouncing dots above an agent who is typing at the desk. */
function drawTypingDots(ctx, x, y, time, phase) {
  const w = 30;
  const h = 14;
  roundRect(ctx, Math.round(x - w / 2), Math.round(y - h - 4), w, h, 7);
  ctx.fillStyle = 'rgba(26, 28, 44, 0.85)';
  ctx.fill();
  for (let i = 0; i < 3; i += 1) {
    const lift = Math.max(0, Math.sin(time * 7 + phase - i * 0.8)) * 2.5;
    ctx.beginPath();
    ctx.arc(x - 8 + i * 8, y - 4 - h / 2 - lift, 2, 0, Math.PI * 2);
    ctx.fillStyle = PALETTE.lime;
    ctx.fill();
  }
}

/** Work glyphs floating up from an agent's head and fading out. */
function drawPopups(ctx, popups, x, y, zoom) {
  ctx.font = '600 12px ui-monospace, "SF Mono", Menlo, "Apple Color Emoji", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const p of popups) {
    const t = p.age / POPUP_LIFE;
    ctx.globalAlpha = t < 0.1 ? t / 0.1 : t < 0.65 ? 1 : 1 - (t - 0.65) / 0.35;
    const px = x + p.dx * zoom * 0.6;
    const py = y - 26 - t * 34;
    ctx.lineWidth = 3;
    ctx.strokeStyle = PALETTE.black;
    ctx.strokeText(p.text, px, py);
    ctx.fillStyle = PALETTE.white;
    ctx.fillText(p.text, px, py);
  }
  ctx.globalAlpha = 1;
}

function drawBubble(ctx, text, x, y, alpha) {
  ctx.font = BUBBLE_FONT;
  const w = Math.max(24, Math.ceil(ctx.measureText(text).width) + 14);
  const h = 22;
  const left = Math.round(x - w / 2);
  const top = Math.round(y - h - 7);
  ctx.globalAlpha = alpha;
  roundRect(ctx, left, top, w, h, 6);
  ctx.fillStyle = PALETTE.white;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = PALETTE.black;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - 5, top + h - 1);
  ctx.lineTo(x, top + h + 6);
  ctx.lineTo(x + 5, top + h - 1);
  ctx.fillStyle = PALETTE.white;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x - 5, top + h + 1);
  ctx.lineTo(x, top + h + 6);
  ctx.lineTo(x + 5, top + h + 1);
  ctx.stroke();
  ctx.fillStyle = PALETTE.black;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, top + h / 2 + 1);
  ctx.globalAlpha = 1;
}

function drawSnore(ctx, cam, view, corgi, time) {
  const base = worldToScreen(cam, view, { x: corgi.pos.x - 4, y: corgi.pos.y - 10 });
  ctx.font = `700 ${Math.max(9, Math.round(cam.zoom * 2.4))}px ui-monospace, monospace`;
  ctx.fillStyle = PALETTE.white;
  ctx.textAlign = 'left';
  for (let i = 0; i < 2; i += 1) {
    const t = (time * 0.35 + i / 2) % 1;
    ctx.globalAlpha = Math.sin(t * Math.PI);
    ctx.fillText('z', base.x + t * cam.zoom * 6, base.y - t * cam.zoom * 10);
  }
  ctx.globalAlpha = 1;
}

export function drawOverlay(ctx, scene, cam, view, time, hoveredId) {
  const showAllTags = cam.zoom >= LABEL_MIN_ZOOM;
  scene.agents.forEach((agent, i) => {
    const box = agentBox(agent, i);
    const head = worldToScreen(cam, view, { x: agent.pos.x, y: box.y });
    const feet = worldToScreen(cam, view, { x: agent.pos.x, y: agent.pos.y });
    const isHovered = agent.id === hoveredId;
    const isWorking = Boolean(agent.work);
    if (showAllTags || isHovered) drawTag(ctx, agent.def.name, feet.x, feet.y + 3, isHovered, isWorking);
    if (agent.bubble) drawBubble(ctx, agent.bubble.text, head.x, head.y, Math.min(1, agent.bubble.ttl * 3));
    else if (isWorking && agent.mode === 'seated') drawTypingDots(ctx, head.x, head.y, time, agent.phase);
    if (agent.popups.length > 0) drawPopups(ctx, agent.popups, head.x, head.y, cam.zoom);
  });
  drawSnore(ctx, cam, view, scene.pets.corgi, time);
}
