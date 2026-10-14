import http from 'node:http';
import { readFile, writeFile, rename, mkdir, copyFile } from 'node:fs/promises';
import { resolve, extname, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = resolve(process.env.DRUGMAP_DATA_DIR || resolve(root, 'data'));
const file = resolve(dataDir, 'database.json');
await mkdir(dataDir, { recursive: true });
const empty = () => ({ format: 'drugmap-offline', version: 1, revision: randomUUID(), collections: { drugs: {}, stock_locations: {}, settings: {} } });
export function validate(value) {
  if (value?.format !== 'drugmap-offline' || value.version !== 1 || !value.collections || typeof value.collections !== 'object' || Array.isArray(value.collections)) throw Error('備份格式不正確');
  for (const [name, records] of Object.entries(value.collections)) {
    if (!['drugs', 'stock_locations', 'settings'].includes(name) || !records || typeof records !== 'object' || Array.isArray(records)) throw Error('資料集合不正確');
    for (const [id, record] of Object.entries(records)) {
      if (!id || ['__proto__', 'constructor', 'prototype'].includes(id) || !record || typeof record !== 'object' || Array.isArray(record)) throw Error('資料格式不正確');
    }
  }
  for (const name of ['drugs', 'stock_locations', 'settings']) if (!value.collections[name]) throw Error('缺少資料集合');
  return value;
}
let state;
try { state = validate(JSON.parse(await readFile(file, 'utf8'))); }
catch (error) { if (error.code !== 'ENOENT') throw error; state = empty(); await writeFile(file, JSON.stringify(state), { flag: 'wx' }); }
let queue = Promise.resolve();
async function persist(next, backup = false) {
  validate(next);
  if (backup) await copyFile(file, resolve(dataDir, `before-restore-${Date.now()}-${randomUUID()}.json`));
  next.revision = randomUUID();
  await writeFile(file + '.tmp', JSON.stringify(next));
  await rename(file + '.tmp', file);
  state = next;
}
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json' };
const server = http.createServer(async (req, res) => {
  const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
  try {
    const host = `127.0.0.1:${server.address().port}`;
    if (req.headers.host !== host || (req.headers.origin && req.headers.origin !== `http://${host}`)) return send(403, { error: '只允許本機程式存取' });
    const pathname = new URL(req.url, `http://${host}`).pathname;
    if (pathname.startsWith('/api/')) {
      if (req.method === 'GET' && (pathname === '/api/state' || pathname === '/api/backup')) {
        if (pathname.endsWith('backup')) res.setHeader('Content-Disposition', 'attachment; filename="drugmap-backup.json"');
        return send(200, state);
      }
      if (req.method !== 'POST' || !['/api/commit', '/api/restore'].includes(pathname)) return send(404, { error: '找不到功能' });
      if (req.headers['content-type'] !== 'application/json') return send(415, { error: '需要 JSON' });
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 50 * 1024 * 1024) return send(413, { error: '檔案超過 50 MB' }); chunks.push(chunk); }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const task = queue.then(async () => {
        if (pathname === '/api/restore') { await persist(structuredClone(validate(body)), true); return send(200, { ok: true }); }
        if (body.revision !== undefined && body.revision !== state.revision) return send(409, { error: '資料已變更，請重試' });
        if (!Array.isArray(body.operations) || body.operations.length > 1000) throw Error('操作格式不正確');
        const next = structuredClone(state);
        for (const op of body.operations) {
          if (!Object.hasOwn(next.collections, op.collection) || typeof op.id !== 'string' || !op.id || ['__proto__', 'constructor', 'prototype'].includes(op.id)) throw Error('資料路徑不正確');
          const records = next.collections[op.collection];
          if (op.type === 'delete') delete records[op.id];
          else {
            if (!['set', 'update'].includes(op.type) || !op.data || typeof op.data !== 'object' || Array.isArray(op.data)) throw Error('操作格式不正確');
            if (op.type === 'update' && !Object.hasOwn(records, op.id)) throw Error('資料已不存在');
            records[op.id] = op.type === 'update' || op.merge ? { ...records[op.id], ...op.data } : op.data;
          }
        }
        await persist(next); send(200, { ok: true });
      });
      queue = task.catch(() => {}); await task; return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, { error: '不支援的方法' });
    const out = resolve(root, 'out');
    let target = resolve(out, '.' + decodeURIComponent(pathname));
    if (target !== out && !target.startsWith(out + sep)) return send(403, { error: '路徑錯誤' });
    if (!extname(target)) target = resolve(target, 'index.html');
    try {
      const bytes = await readFile(target);
      res.writeHead(200, { 'Content-Type': mime[extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch { send(404, { error: '找不到頁面，請先完成建置' }); }
  } catch (error) { if (!res.headersSent) send(400, { error: error.message }); else res.end(); }
});
server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? '連接埠已被使用。請關閉另一個藥品地圖視窗或設定 PORT。' : error); process.exitCode = 1; });
server.listen(Number(process.env.PORT || 3210), '127.0.0.1', () => console.log(`藥品地圖：http://127.0.0.1:${server.address().port}\n資料：${file}\n關閉此視窗即停止服務。`));
