import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

test('local persistence, atomic batches, conflicts, backup, restore and origin protection', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'drugmap-test-'));
  let child;
  async function start() {
    child = spawn(process.execPath, ['scripts/server.mjs'], { env: { ...process.env, PORT: '0', DRUGMAP_DATA_DIR: dir }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('server timeout')), 15000);
      child.stdout.on('data', chunk => { output += chunk; const url = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; if (url) { clearTimeout(timer); resolve(url); } });
      child.once('exit', code => { clearTimeout(timer); reject(Error(`server exited ${code}: ${output}`)); });
      child.stderr.on('data', chunk => { output += chunk; });
    });
  }
  async function stop() { const exited = once(child, 'exit'); child.kill(); await exited; }
  try {
    let url = await start();
    const post = (path, body, extra = {}) => fetch(url + '/api/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(body) });
    const state = async () => (await fetch(url + '/api/state')).json();
    assert.deepEqual((await state()).collections.drugs, {});
    const initial = await state();
    let response = await post('commit', { operations: [{ type: 'set', collection: 'drugs', id: 'test', data: { chineseName: '測試藥品', quantity: 5 } }] });
    assert.equal(response.status, 200);
    response = await post('commit', { operations: [{ type: 'update', collection: 'drugs', id: 'test', data: { quantity: 6 } }, { type: 'update', collection: 'drugs', id: 'missing', data: { quantity: 7 } }] });
    assert.equal(response.status, 400);
    assert.equal((await state()).collections.drugs.test.quantity, 5, 'failed batch rolls back');
    response = await post('commit', { revision: initial.revision, operations: [] });
    assert.equal(response.status, 409);
    assert.equal((await post('commit', { operations: [] }, { Origin: 'https://example.com' })).status, 403);
    assert.equal((await post('commit', { operations: [{ type: 'set', collection: 'drugs', id: '__proto__', data: {} }] })).status, 400);
    // The existing v1 data shape accepts the new report without migration.
    const legacyBackup = await state();
    assert.equal((await post('restore', legacyBackup)).status, 200);
    const report = { fileName: 'synthetic.xlsx', startDate: '2026-10-01', endDate: '2026-10-22', rowCount: 2, items: [{ code: 'BC250721', quantity: 12.5 }], currentQuantities: { BC250721: 2 }, updatedAt: '2026-10-22T00:00:00.000Z' };
    assert.equal((await post('commit', { operations: [{ type: 'set', collection: 'settings', id: 'consumptionReport', data: report }] })).status, 200);
    const backup = await (await fetch(url + '/api/backup')).json();
    assert.deepEqual(backup.collections.settings.consumptionReport, report);
    await post('commit', { operations: [{ type: 'set', collection: 'settings', id: 'consumptionReport', data: { ...report, items: [{ code: 'AC123456', quantity: 1 }] } }] });
    assert.equal((await state()).collections.settings.consumptionReport.items.length, 1);
    assert.equal((await state()).collections.settings.consumptionReport.items[0].code, 'AC123456', 'new report replaces previous summary');
    assert.equal((await post('restore', { format: 'invalid' })).status, 400);
    await post('commit', { operations: [{ type: 'delete', collection: 'drugs', id: 'test' }] });
    assert.equal((await post('restore', backup)).status, 200);
    assert.equal((await state()).collections.drugs.test.chineseName, '測試藥品');
    assert.ok((await readdir(dir)).some(name => name.startsWith('before-restore-')));
    const revision = (await state()).revision;
    const conflicts = await Promise.all([post('commit', { revision, operations: [] }), post('commit', { revision, operations: [] })]);
    assert.deepEqual(conflicts.map(r => r.status).sort(), [200, 409]);
    await stop(); url = await start();
    assert.equal((await state()).collections.drugs.test.quantity, 5, 'survives restart');
    assert.equal(JSON.parse(await readFile(join(dir, 'database.json'), 'utf8')).collections.drugs.test.quantity, 5);
    assert.equal((await fetch(url + '/')).status, 200);
    assert.equal((await fetch(url + '/backup/')).status, 200);
    assert.equal((await fetch(url + '/consumption/')).status, 200);
    assert.equal((await fetch(url + '/purchase/')).status, 200);
    assert.equal((await fetch(url + '/purchase/setup/')).status, 200);
    assert.deepEqual((await state()).collections.settings.consumptionReport, report, 'report survives restore and restart');
    assert.equal((await post('commit', { operations: [{ type: 'delete', collection: 'settings', id: 'consumptionReport' }] })).status, 200);
    assert.equal((await state()).collections.settings.consumptionReport, undefined);
    assert.equal((await state()).collections.drugs.test.quantity, 5, 'clearing report preserves inventory');
    assert.equal((await fetch(url + '/data/database.json')).status, 404);
  } finally { if (child && child.exitCode === null) await stop(); await rm(dir, { recursive: true, force: true }); }
});
