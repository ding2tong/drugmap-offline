"use client";

import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type ExportDrug = { id: string; nhiCode: string; englishName: string; chineseName: string };
type Draft = ExportDrug & { checked: boolean };
const button = 'min-h-11 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-slate-700 disabled:opacity-50';
const fields = [{ key: 'nhiCode', label: '健保碼' }, { key: 'englishName', label: '英文名' }, { key: 'chineseName', label: '中文名' }] as const;

export default function ExportPanel({ drugs, loaded, toolbar }: { drugs: ExportDrug[]; loaded: boolean; toolbar: HTMLElement | null }) {
 const [rows, setRows] = useState<Draft[] | null>(null);
 const [query, setQuery] = useState('');
 const [busy, setBusy] = useState(false);
 const [message, setMessage] = useState('');
 const trigger = useRef<HTMLButtonElement>(null);
 const selected = rows?.filter(row => row.checked) ?? [];
 const visible = rows?.filter(row => fields.some(({ key }) => row[key].toLowerCase().includes(query.trim().toLowerCase()))) ?? [];
 const allVisible = visible.length > 0 && visible.every(row => row.checked);

 function open() {
  setRows(drugs.map(drug => ({ id: drug.id, nhiCode: drug.nhiCode ?? '', englishName: drug.englishName ?? '', chineseName: drug.chineseName ?? '', checked: false })));
  setQuery(''); setMessage('');
 }
 function close() { setRows(null); setMessage(''); trigger.current?.focus(); }
 function update(id: string, patch: Partial<Draft>) {
  setRows(current => current?.map(row => row.id === id ? { ...row, ...patch } : row) ?? null);
  setMessage('');
 }
 async function download() {
  if (busy || !selected.length) return;
  setBusy(true); setMessage('');
  try {
   const XLSX = await import('xlsx');
   // String cells preserve leading zeroes and do not interpret names as formulas.
   const sheet = XLSX.utils.aoa_to_sheet([
    fields.map(field => field.label),
    ...selected.map(row => fields.map(field => row[field.key])),
   ]);
   sheet['!cols'] = [{ wch: 18 }, { wch: 55 }, { wch: 35 }];
   const book = XLSX.utils.book_new();
   XLSX.utils.book_append_sheet(book, sheet, '少用藥品');
   const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(new Date());
   XLSX.writeFile(book, `少用藥品_${date}.xlsx`);
   setMessage(`已產生 ${selected.length} 筆藥品的 Excel 檔案。`);
  } catch { setMessage('匯出失敗，請稍後重試。'); }
  finally { setBusy(false); }
 }

 return <>{toolbar && createPortal(<button ref={trigger} type="button" className={button} disabled={!loaded || !drugs.length || rows !== null} onClick={open}>匯出</button>, toolbar)}
  {rows !== null && <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
  {rows !== null && <section aria-label="編輯匯出內容" className="mt-4 space-y-4">
   <h3 className="text-lg font-bold">勾選並編輯匯出內容</h3>
   <p className="text-sm text-slate-600">匯出欄位：健保碼、英文名、中文名。下方修改只用於本次匯出，不會修改藥品資料；關閉後不保留草稿。</p>
   <label className="block text-sm font-semibold">搜尋匯出品項<input autoFocus className="control" disabled={busy} value={query} onChange={event => setQuery(event.target.value)} placeholder="健保碼、英文名或中文名" /></label>
   <div className="flex flex-wrap items-center gap-3">
    <button type="button" className={button} disabled={busy || !visible.length} onClick={() => { const ids = new Set(visible.map(row => row.id)); setRows(current => current?.map(row => ids.has(row.id) ? { ...row, checked: !allVisible } : row) ?? null); setMessage(''); }}>{allVisible ? '取消勾選搜尋結果' : '全選搜尋結果'}</button>
    <button type="button" className={button} disabled={busy || !selected.length} onClick={() => { setRows(current => current?.map(row => ({ ...row, checked: false })) ?? null); setMessage(''); }}>清除全部勾選</button>
    <p role="status" className="text-sm text-slate-600">已勾選 {selected.length} / {rows.length} 筆（搜尋顯示 {visible.length} 筆）</p>
   </div>
   <p className="text-sm text-slate-600">搜尋不會清除勾選，匯出會包含所有已勾選品項。</p>
   <div className="max-h-[32rem] space-y-2 overflow-y-auto rounded-xl p-1">
    {visible.map(row => <fieldset key={row.id} disabled={busy} className="grid min-w-0 grid-cols-1 items-end gap-2 rounded-xl border border-slate-300 bg-white p-3 sm:grid-cols-2 lg:grid-cols-[5rem_minmax(9rem,1fr)_minmax(12rem,2fr)_minmax(10rem,1.5fr)]">
     <legend className="sr-only">{row.nhiCode} {row.chineseName || row.englishName}</legend>
     <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-semibold lg:self-end"><input className="h-5 w-5 shrink-0 accent-slate-900" type="checkbox" checked={row.checked} onChange={event => update(row.id, { checked: event.target.checked })} aria-label={`匯出 ${row.chineseName || row.englishName}`} />匯出</label>
     {fields.map(field => <label key={field.key} className="min-w-0 text-sm font-semibold">{field.label}<input className="control" value={row[field.key]} onChange={event => update(row.id, { [field.key]: event.target.value })} /></label>)}
    </fieldset>)}
    {!visible.length && <p className="p-4 text-center text-slate-600">沒有符合搜尋條件的品項。</p>}
   </div>
   {message && <p role="status" className="rounded-xl bg-slate-100 p-3 text-sm">{message}</p>}
   <div className="flex flex-wrap gap-3">
    <button type="button" className={button} disabled={busy || !selected.length} onClick={download}>{busy ? '匯出中…' : `下載 Excel（${selected.length} 筆）`}</button>
    <button type="button" className={button} disabled={busy} onClick={close}>關閉匯出</button>
   </div>
  </section>}
 </div>}</>;
}
