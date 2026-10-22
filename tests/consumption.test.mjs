import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import ts from 'typescript';
import XLSX from 'xlsx';

// Execute the production TypeScript parser; fixtures contain synthetic data only.
const require = createRequire(import.meta.url);
function loadTypeScript(path) {
  const source = readFileSync(path, 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
  const loadedModule = { exports: {} };
  const localRequire = name => name.startsWith('.') ? loadTypeScript(resolve(dirname(path), name + '.ts')) : require(name);
  new Function('module', 'exports', 'require', outputText)(loadedModule, loadedModule.exports, localRequire);
  return loadedModule.exports;
}
const { parseConsumptionFile, summarizeConsumption, indexConsumptionDrugs } = loadTypeScript(resolve('lib/consumption-report.ts'));
const fixture = [
  ['日期', '姓名', '身分證號', '健保碼', 'E', 'F', 'G', '總量'],
  ['115/10/01', 'SYNTHETIC_NAME', 'SYNTHETIC_ID', 'BC25072100', '', '', '', '1,200'],
  ['2026-10-02', 'SYNTHETIC_NAME', 'SYNTHETIC_ID', 'BC250721G0', '', '', '', 0.25],
  ['2026/10/03', 'SYNTHETIC_NAME', 'SYNTHETIC_ID', 'AC12345600', '', '', '', 3],
  ['2026/02/30', '', '', 'BC25072100', '', '', '', 5],
  ['2026/10/03', '', '', 'BC25072100', '', '', '', 0],
  ['2026/10/03', '', '', 'BC25072100', '', '', '', -1],
];
function buffer(rows, bookType) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'synthetic');
  return XLSX.write(workbook, { type: 'array', bookType });
}
for (const format of ['xlsx', 'xls', 'csv']) test(`consumption ${format}: ROC dates, aliases, range, invalid rows, privacy`, () => {
  const parsed = parseConsumptionFile(buffer(fixture, format));
  assert.equal(parsed.rows.length, 3);
  assert.equal(parsed.skipped, 3);
  assert.deepEqual(parsed.rows[0], { date: '2026-10-01', code: 'BC250721', quantity: 1200 });
  assert.deepEqual(summarizeConsumption(parsed.rows, '2026-10-01', '2026-10-02'), [{ code: 'BC250721', quantity: 1200.25 }]);
  assert.deepEqual(summarizeConsumption(parsed.rows, '2026-10-03', '2026-10-03'), [{ code: 'AC123456', quantity: 3 }]);
  assert.deepEqual(summarizeConsumption(parsed.rows, '2026-11-01', '2026-11-30'), []);
  assert.ok(!JSON.stringify(parsed).includes('SYNTHETIC_'), 'patient columns never enter retained rows');
});
test('Excel numeric dates and decimal totals', () => {
  const serial = (Date.UTC(2026, 9, 22) - Date.UTC(1899, 11, 30)) / 86400000;
  const { rows } = parseConsumptionFile(buffer([[serial, '', '', 'BC25072100', '', '', '', 0.1], [serial, '', '', 'BC250721G0', '', '', '', 0.2]], 'xlsx'));
  assert.equal(rows[0].date, '2026-10-22');
  assert.deepEqual(summarizeConsumption(rows, '2026-10-22', '2026-10-22'), [{ code: 'BC250721', quantity: 0.3 }]);
});
test('unreadable source rejects without leaving console overridden', () => {
  const original = console.error;
  assert.throws(() => parseConsumptionFile(buffer([['no usable columns']], 'xlsx')), /A 欄日期/);
  assert.equal(console.error, original);
});

test('consumption keeps cabinet placement when the same code is also non-stock', () => {
  const stock = { code: 'BC250721', kind: 'stock', track: '前滑軌', cabinet: 'A', layer: 1 };
  const rare = { ...stock, kind: 'non-stock', track: '', cabinet: '', layer: 0 };
  const unplaced = { ...stock, track: '', cabinet: '', layer: 0 };
  for (const records of [[stock, rare], [rare, stock], [stock, unplaced, rare], [rare, unplaced, stock]]) {
    const index = indexConsumptionDrugs(records);
    assert.equal(index.size, 1);
    assert.deepEqual(index.get(stock.code), stock);
  }
  assert.deepEqual(indexConsumptionDrugs([rare]).get(rare.code), rare, 'non-stock-only drugs remain classified as unplaced');
});
