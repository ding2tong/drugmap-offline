import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import XLSX from 'xlsx';
const source = 'https://info.nhi.gov.tw/api/iode0000s01/Dataset?rId=A21030000I-E41001-001';
const buffer = process.argv[2] ? await readFile(process.argv[2]) : Buffer.from(await (async () => { const r = await fetch(source, { signal: AbortSignal.timeout(120000) }); if (!r.ok) throw new Error(`NHI HTTP ${r.status}`); return r.arrayBuffer(); })());
const workbook = XLSX.read(buffer.toString('utf8').replace(/^\uFEFF/, ''), { type: 'string', raw: true });
const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' });
if (!rows.length || !('藥品代號' in rows[0]) || !('藥品中文名稱' in rows[0])) throw new Error('官方資料欄位異常');
const mapping = { nhiCode: '藥品代號', chineseName: '藥品中文名稱', englishName: '藥品英文名稱', ingredient: '成分', strength: '規格量', unit: '規格單位', manufacturer: '製造廠名稱', dosageForm: '劑型', startDate: '有效起日', endDate: '有效迄日' };
const grouped = new Map();
for (const row of rows) {
 const item = Object.fromEntries(Object.entries(mapping).map(([key, field]) => [key, String(row[field]).trim()]));
 if (!/^[A-Z0-9]{10}$/.test(item.nhiCode)) continue;
 // Keep the most recent published version for each complete reimbursement code.
 const old = grouped.get(item.nhiCode);
 if (!old || Number(item.startDate) > Number(old.startDate)) grouped.set(item.nhiCode, item);
}
if (grouped.size < 1000) throw new Error('藥品資料量異常，保留原索引');
await mkdir('public/data', { recursive: true });
await writeFile('public/data/nhi-drugs.json.tmp', JSON.stringify({ source, dataset: 'https://data.gov.tw/dataset/23715', syncedAt: new Date().toISOString(), drugs: [...grouped.values()] }));
await rename('public/data/nhi-drugs.json.tmp', 'public/data/nhi-drugs.json');
console.log(`已同步 ${grouped.size} 個健保碼（${rows.length} 筆歷史資料）`);
