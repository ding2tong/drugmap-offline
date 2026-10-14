"use client";

import { useRef, useState } from 'react';
import { doc, writeBatch } from '../../../lib/local-store';
import { db } from '../../../lib/local-store';

type Drug = { id: string; nhiCode: string; chineseName: string; englishName: string; inventoryLocationId: string; inventoryLocation: string; quantity?: number; quantityUnit?: string; remark: string };
type Location = { id: string; name: string; active: boolean };
type Row = { id: string; nhiCode: string; chineseName: string; englishName: string; locationId: string; quantity: string; quantityUnit: string; remark: string; selected: boolean };
type Field = 'locationId' | 'quantity' | 'quantityUnit' | 'remark';

const button = 'min-h-11 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-slate-700 disabled:opacity-50';
const control = 'min-h-11 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm focus-visible:outline-2 focus-visible:outline-slate-700 disabled:opacity-50';

export default function BatchEditPanel({ drugs, locations, loaded }: { drugs: Drug[]; locations: Location[]; loaded: boolean }) {
 const [rows, setRows] = useState<Row[] | null>(null);
 const [source, setSource] = useState<Map<string, Drug>>(new Map());
 const [filter, setFilter] = useState('');
 const [commonLocation, setCommonLocation] = useState('');
 const [commonQuantity, setCommonQuantity] = useState('');
 const [commonUnit, setCommonUnit] = useState('');
 const [commonRemark, setCommonRemark] = useState('');
 const [busy, setBusy] = useState(false);
 const [message, setMessage] = useState('');
 const [lastResult, setLastResult] = useState('');
 const trigger = useRef<HTMLButtonElement>(null);
 const selected = rows?.filter(row => row.selected) ?? [];
 const visible = rows?.filter(row => [row.nhiCode, row.chineseName, row.englishName, locations.find(location => location.id === row.locationId)?.name ?? ''].some(value => value.toLowerCase().includes(filter.trim().toLowerCase()))) ?? [];
 const allVisible = visible.length > 0 && visible.every(row => row.selected);

 function open() {
  setSource(new Map(drugs.map(drug => [drug.id, drug])));
  setRows(drugs.map(drug => ({ id: drug.id, nhiCode: drug.nhiCode ?? '', chineseName: drug.chineseName ?? '', englishName: drug.englishName ?? '', locationId: drug.inventoryLocationId ?? '', quantity: drug.quantity === undefined ? '' : String(drug.quantity), quantityUnit: drug.quantityUnit || '顆', remark: drug.remark ?? '', selected: false })));
  setFilter(''); setCommonLocation(''); setCommonQuantity(''); setCommonUnit(''); setCommonRemark(''); setMessage(''); setLastResult('');
 }
 function close() { setRows(null); setMessage(''); requestAnimationFrame(() => trigger.current?.focus()); }
 function change(id: string, patch: Partial<Row>) { setRows(current => current?.map(row => row.id === id ? { ...row, ...patch } : row) ?? null); setMessage(''); }
 function apply(field: Field, value: string) {
  setRows(current => current?.map(row => row.selected ? { ...row, [field]: value } : row) ?? null);
  setMessage(`已將欄位套用至 ${selected.length} 筆，請確認後儲存。`);
 }
 async function save() {
  if (!db || busy || !selected.length) return;
  const changes = selected.map(row => {
   const original = source.get(row.id);
   if (!original) return null;
   const patch: Record<string, string | number | Date> = {};
   if (row.locationId !== (original.inventoryLocationId ?? '')) {
    const location = locations.find(item => item.id === row.locationId && item.active);
    if (!location) throw Error(`「${row.chineseName || row.englishName}」請選擇啟用中的收納位置。`);
    patch.inventoryLocationId = location.id;
    patch.inventoryLocation = location.name;
   }
   const originalQuantity = original.quantity === undefined ? '' : String(original.quantity);
   if (row.quantity !== originalQuantity) {
    const amount = Number(row.quantity);
    if (!row.quantity.trim() || !Number.isSafeInteger(amount) || amount < 0) throw Error(`「${row.chineseName || row.englishName}」數量請填 0 或以上的整數。`);
    patch.quantity = amount;
   }
   if (row.quantityUnit !== (original.quantityUnit || '顆')) {
    if (!row.quantityUnit.trim()) throw Error(`「${row.chineseName || row.englishName}」請填數量單位。`);
    patch.quantityUnit = row.quantityUnit.trim();
   }
   if (row.remark !== (original.remark ?? '')) patch.remark = row.remark.trim();
   return Object.keys(patch).length ? { row, patch } : null;
  });
  const pending = changes.filter((item): item is { row: Row; patch: Record<string, string | number | Date> } => item !== null);
  if (!pending.length) { setMessage('勾選的藥品沒有修改內容。'); return; }
  setBusy(true); setMessage('');
  let savedCount = 0;
  try {
   for (let start = 0; start < pending.length; start += 400) {
    const batch = writeBatch(db);
    for (const { row, patch } of pending.slice(start, start + 400)) batch.update(doc(db, 'drugs', row.id), { ...patch, updatedAt: new Date() });
    await batch.commit();
    savedCount += Math.min(400, pending.length - start);
   }
   close(); setLastResult(`已批次更新 ${savedCount} 筆藥品。`);
   // The parent list receives the updated data from its Firestore listener.
  } catch {
   setMessage(savedCount ? `已儲存 ${savedCount} 筆，其餘儲存失敗。請重新開啟批次修改並確認。` : '批次儲存失敗，請確認本機服務仍在執行後重試。');
  } finally { setBusy(false); }
 }

 return <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
  <button ref={trigger} type="button" className={button} disabled={!loaded || !drugs.length || rows !== null} onClick={open}>批次修改已收納藥品</button>
  {lastResult && <p role="status" className="mt-3 text-sm text-slate-700">{lastResult}</p>}
  {rows && <div className="mt-4 space-y-4" aria-label="批次修改藥品">
   <div><h3 className="text-lg font-bold">勾選要修改的藥品</h3><p className="mt-1 text-sm text-slate-600">可逐筆編輯，也可將同一欄位套用至所有勾選品項。只有勾選且修改過的欄位會儲存。</p></div>
   <label className="block text-sm font-semibold">搜尋品項<input autoFocus className="control" value={filter} disabled={busy} onChange={event => setFilter(event.target.value)} placeholder="健保碼或藥名" /></label>
   <div className="flex flex-wrap items-center gap-3"><button type="button" className={button} disabled={busy || !visible.length} onClick={() => setRows(current => { const ids = new Set(visible.map(row => row.id)); return current?.map(row => ids.has(row.id) ? { ...row, selected: !allVisible } : row) ?? null; })}>{allVisible ? '取消勾選搜尋結果' : '全選搜尋結果'}</button><span role="status" className="text-sm text-slate-600">已勾選 {selected.length} / {rows.length} 筆</span></div>
   <div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><h4 className="font-semibold">套用至勾選品項</h4><div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
    <label className="text-sm font-semibold">收納位置<select className={control} value={commonLocation} disabled={busy} onChange={event => setCommonLocation(event.target.value)}><option value="">請選擇</option>{locations.filter(location => location.active).map(location => <option key={location.id} value={location.id}>{location.name}</option>)}</select><button type="button" className={`${button} mt-2 w-full`} disabled={busy || !selected.length || !commonLocation} onClick={() => apply('locationId', commonLocation)}>套用位置</button></label>
    <label className="text-sm font-semibold">數量<input className={control} type="number" min="0" step="1" value={commonQuantity} disabled={busy} onChange={event => setCommonQuantity(event.target.value)} /><button type="button" className={`${button} mt-2 w-full`} disabled={busy || !selected.length || commonQuantity === ''} onClick={() => apply('quantity', commonQuantity)}>套用數量</button></label>
    <label className="text-sm font-semibold">數量單位<input className={control} value={commonUnit} disabled={busy} onChange={event => setCommonUnit(event.target.value)} /><button type="button" className={`${button} mt-2 w-full`} disabled={busy || !selected.length || !commonUnit.trim()} onClick={() => apply('quantityUnit', commonUnit)}>套用單位</button></label>
    <label className="text-sm font-semibold">備註<input className={control} value={commonRemark} disabled={busy} onChange={event => setCommonRemark(event.target.value)} /><button type="button" className={`${button} mt-2 w-full`} disabled={busy || !selected.length} onClick={() => apply('remark', commonRemark)}>套用備註（可清空）</button></label>
   </div></div>
   <div className="max-h-[34rem] space-y-2 overflow-y-auto rounded-xl p-1">{visible.map(row => <fieldset key={row.id} disabled={busy} className="rounded-xl border border-slate-300 p-3"><legend className="sr-only">{row.nhiCode} {row.chineseName || row.englishName}</legend><label className="flex min-h-11 items-center gap-2 font-semibold"><input type="checkbox" className="h-5 w-5 accent-slate-900" checked={row.selected} onChange={event => change(row.id, { selected: event.target.checked })} />{row.chineseName || row.englishName} <span className="text-sm font-normal text-slate-600">{row.nhiCode} · {row.englishName}</span></label><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4"><label className="text-sm font-semibold">收納位置<select className={control} value={row.locationId} onChange={event => change(row.id, { locationId: event.target.value })}><option value="">未設定</option>{locations.filter(location => location.active || location.id === row.locationId).map(location => <option key={location.id} value={location.id}>{location.name}{location.active ? '' : '（已停用）'}</option>)}</select></label><label className="text-sm font-semibold">數量<input className={control} type="number" min="0" step="1" value={row.quantity} onChange={event => change(row.id, { quantity: event.target.value })} /></label><label className="text-sm font-semibold">單位<input className={control} value={row.quantityUnit} onChange={event => change(row.id, { quantityUnit: event.target.value })} /></label><label className="text-sm font-semibold">備註<input className={control} value={row.remark} onChange={event => change(row.id, { remark: event.target.value })} /></label></div></fieldset>)}{!visible.length && <p className="p-4 text-center text-slate-600">沒有符合搜尋條件的品項。</p>}</div>
   {message && <p role="status" className="rounded-xl bg-slate-100 p-3 text-sm">{message}</p>}
   <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy || !selected.length} onClick={async () => { try { await save(); } catch (error) { setMessage(error instanceof Error ? error.message : '請確認修改內容。'); } }}>{busy ? '儲存中…' : `儲存勾選品項（${selected.length}）`}</button><button type="button" className={button} disabled={busy} onClick={close}>取消</button></div>
  </div>}
 </section>;
}
