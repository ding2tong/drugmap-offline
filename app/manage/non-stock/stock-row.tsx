"use client";

import { useEffect, useState } from 'react';
import { doc, updateDoc } from '../../../lib/local-store';
import { db } from '../../../lib/local-store';

export type StockDrug = {
 id: string; nhiCode: string; chineseName: string; englishName: string;
 inventoryLocation: string; remark: string; quantity?: number; quantityUnit?: string;
 inventoryCheckedCycle?: string;
};

const action = 'min-h-11 rounded-xl border border-slate-300 px-3 text-sm font-semibold hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-slate-700 disabled:opacity-50';

export default function StockRow({ drug, cycleId, onEdit, onRemove }: {
 drug: StockDrug; cycleId: string; onEdit: () => void; onRemove: () => void;
}) {
 const [amount, setAmount] = useState(String(drug.quantity ?? ''));
 const [saving, setSaving] = useState(false);
 const [message, setMessage] = useState('');
 const checked = drug.inventoryCheckedCycle === cycleId;
 const changed = amount !== String(drug.quantity ?? '');
 useEffect(() => { setAmount(String(drug.quantity ?? '')); }, [drug.quantity]);

 async function setChecked(value: boolean) {
  if (!db || saving) return;
  setSaving(true); setMessage('');
  try {
   await updateDoc(doc(db, 'drugs', drug.id), { inventoryCheckedCycle: value ? cycleId : '', updatedAt: new Date() });
  } catch { setMessage('盤點狀態儲存失敗，請重試。'); }
  finally { setSaving(false); }
 }
 async function saveAmount() {
  if (!db || saving || !changed) return;
  const parsed = Number(amount);
  if (!amount.trim() || !Number.isSafeInteger(parsed) || parsed < 0) { setMessage('數量請填 0 或以上的整數。'); return; }
  setSaving(true); setMessage('');
  try {
   await updateDoc(doc(db, 'drugs', drug.id), { quantity: parsed, inventoryCheckedCycle: cycleId, updatedAt: new Date() });
   setMessage('數量已儲存，並標記為本輪已確認。');
  } catch { setMessage('數量及盤點狀態儲存失敗，請重試。'); }
  finally { setSaving(false); }
 }

 return <li className={`rounded-xl border bg-white px-3 py-2 ${checked ? 'border-slate-400' : 'border-slate-200'}`}>
  <div className="flex flex-wrap items-center gap-x-3 gap-y-2 lg:flex-nowrap">
   <label className="flex min-h-11 shrink-0 cursor-pointer items-center gap-2 text-sm font-semibold">
    <input type="checkbox" className="h-5 w-5 accent-slate-900" checked={checked} disabled={saving} onChange={event => setChecked(event.target.checked)} aria-label={`確認仍有 ${drug.chineseName || drug.englishName}`} />
    <span>{checked ? '已確認' : '待確認'}</span>
   </label>
   <div className="min-w-0 flex-1 text-sm leading-relaxed lg:truncate" title={[drug.nhiCode, drug.chineseName, drug.englishName, drug.inventoryLocation, drug.remark].filter(Boolean).join(' · ')}>
    <span className="font-mono text-slate-600">{drug.nhiCode}</span>
    <span className="ml-2 font-semibold text-slate-900">{drug.chineseName || drug.englishName}</span>
    {drug.englishName && drug.chineseName && <span className="ml-2 text-slate-600">{drug.englishName}</span>}
    <span className="ml-2 text-slate-600">· {drug.inventoryLocation || '未設定位置'}</span>
    {drug.remark && <span className="ml-2 text-slate-600">· {drug.remark}</span>}
   </div>
   <div className="flex shrink-0 items-center gap-2">
    <label className="flex items-center gap-1 text-sm font-semibold">數量
     <input className="min-h-11 w-20 rounded-lg border border-slate-300 bg-white px-2 text-base font-normal focus-visible:outline-2 focus-visible:outline-slate-700" type="number" min="0" step="1" inputMode="numeric" value={amount} disabled={saving} onChange={event => { setAmount(event.target.value); setMessage(''); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void saveAmount(); } }} aria-label={`${drug.chineseName || drug.englishName}的庫存數量`} />
    </label>
    <span className="text-sm text-slate-600">{drug.quantityUnit || '顆'}</span>
    {changed && <button type="button" className={action} disabled={saving} onClick={saveAmount}>儲存數量</button>}
   </div>
   <div className="flex shrink-0 gap-2"><button type="button" className={action} disabled={saving} onClick={onEdit}>編輯</button><button type="button" className={action} disabled={saving} onClick={onRemove}>移除</button></div>
  </div>
  {message && <p role="status" className="mt-1 text-sm text-slate-700">{message}</p>}
 </li>;
}
