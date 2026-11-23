// Serves files from office/public.
import fs from 'node:fs/promises';
import path from 'node:path';

const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
});

/** Maps a request URL to a file inside `root`, or null if it would escape it. */
export function resolvePublicPath(urlPath, root) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const full = path.resolve(root, relative);
  return full === root || full.startsWith(root + path.sep) ? full : null;
}

export async function serveStatic(req, res, root) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  const file = resolvePublicPath(req.url ?? '/', root);
  const type = file && MIME[path.extname(file)];
  if (!file || !type) {
    res.writeHead(404).end('Not found');
    return;
  }
  try {
    const body = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (error) {
    const isMissing = error.code === 'ENOENT' || error.code === 'EISDIR';
    if (!isMissing) process.stderr.write(`office: failed to read ${file}: ${error.message}\n`);
    res.writeHead(isMissing ? 404 : 500).end(isMissing ? 'Not found' : 'Server error');
  }
}
