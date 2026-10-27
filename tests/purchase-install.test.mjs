import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const script = readFileSync('browser-extension/bridge.js', 'utf8');
function bridge(url) {
  let listener; const requests = [], replies = [];
  const location = new URL(url);
  const window = { addEventListener: (_type, handler) => { listener = handler; }, postMessage: value => replies.push(value) };
  const chrome = { runtime: { sendMessage: (request, reply) => { requests.push(request); reply({ status: 'ok', offers: [] }); } } };
  vm.runInNewContext(script, { window, location, chrome });
  return { requests, replies, send: (data, overrides = {}) => listener?.({ source: window, origin: location.origin, data: { source: 'drugmap-purchase', id: 'fixture', ...data }, ...overrides }) };
}
test('local setup pings the companion but cannot dispatch supplier actions', () => {
  const setup = bridge('http://127.0.0.1:3210/purchase/setup/');
  setup.send({ type: 'ping' }); assert.equal(setup.replies[0].version, 6);
  setup.send({ type: 'cartTotal', supplier: 'gaoi' }); assert.equal(setup.requests.length, 0);
});
test('only the intended local purchase origin can dispatch; credentials are never forwarded', () => {
  for (const url of ['https://chencheng-drugmap.web.app/purchase', 'http://127.0.0.1:3211/purchase', 'http://127.0.0.1:3210/backup']) {
    const other = bridge(url); other.send({ type: 'ping' }); assert.equal(other.replies.length, 0);
    other.send({ type: 'search', supplier: 'gaoi', code: 'AC150781' }); assert.equal(other.requests.length, 0);
  }
  const local = bridge('http://127.0.0.1:3210/purchase');
  local.send({ type: 'search', supplier: 'gaoi', code: 'AC150781', password: 'SYNTHETIC_SECRET', username: 'SYNTHETIC_USER', cookie: 'SYNTHETIC_COOKIE' });
  assert.equal(local.requests.length, 1);
  assert.equal(JSON.stringify(local.requests).includes('SYNTHETIC'), false);
  local.send({ type: 'cartTotal', supplier: 'gaoi' }, { origin: 'https://example.com' });
  local.send({ type: 'cartTotal', supplier: 'gaoi' }, { source: {} });
  assert.equal(local.requests.length, 1);
});
test('companion permissions do not request credential storage or cookie access', () => {
  const manifest = JSON.parse(readFileSync('browser-extension/manifest.json', 'utf8'));
  assert.deepEqual(manifest.permissions || [], []);
  assert.deepEqual(manifest.host_permissions, ['http://www.yudan.com.tw/*', 'https://www.gaoipharma.com.tw/*', 'http://127.0.0.1/*']);
  for (const file of ['bridge.js', 'background.js', 'supplier.js']) {
    const source = readFileSync('browser-extension/' + file, 'utf8');
    assert.doesNotMatch(source, /document\.cookie|chrome\.(cookies|storage)|localStorage|sessionStorage|type=["']password/);
  }
});
