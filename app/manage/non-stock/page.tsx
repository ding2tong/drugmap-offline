"use client";

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { collection, deleteDoc, doc, onSnapshot, runTransaction, setDoc, updateDoc } from '../../../lib/local-store';
import AdminGuard from '../../admin-guard';
import ExportPanel from './export-panel';
import BatchEditPanel from './batch-edit-panel';
import StockRow from './stock-row';
import { db } from '../../../lib/local-store';
import { getNhiCodeBase, getNhiSearchAliases } from '../../../lib/nhi-code';
import { NhiCatalog, NhiDrug, searchNhi } from '../../../lib/nhi-catalog';

type Location = { id: string; name: string; active: boolean };
type SavedDrug = NhiDrug & { id: string; inventoryLocationId: string; inventoryLocation: string; remark: string; inventoryKind: string; quantity?: number; quantityUnit?: string; inventoryCheckedCycle?: string };
type DialogMode = 'search' | 'edit' | null;
const quantityUnits = ['顆', '盒', '罐', '包'];
const button = 'inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-slate-700 disabled:opacity-50';
const primaryButton = 'inline-flex min-h-11 items-center justify-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:opacity-50';

export default function Page() { return <AdminGuard><NonStock /></AdminGuard>; }

function NonStock() {
 const [catalog, setCatalog] = useState<NhiCatalog | null>(null);
 const [catalogError, setCatalogError] = useState('');
 const [retry, setRetry] = useState(0);
 const [drugs, setDrugs] = useState<SavedDrug[]>([]);
 const [locations, setLocations] = useState<Location[]>([]);
 const [loaded, setLoaded] = useState(false);
 const [cycleId, setCycleId] = useState('initial');
 const [cycleLoaded, setCycleLoaded] = useState(false);
 const [query, setQuery] = useState('');
 const [filter, setFilter] = useState('');
 const [selected, setSelected] = useState<NhiDrug | null>(null);
 const [editing, setEditing] = useState<string | null>(null);
 const [dialogMode, setDialogMode] = useState<DialogMode>(null);
 const [locationId, setLocationId] = useState('');
 const [remark, setRemark] = useState('');
 const [quantity, setQuantity] = useState('0');
 const [quantityUnit, setQuantityUnit] = useState('顆');
 const [busy, setBusy] = useState(false);
 const [message, setMessage] = useState('');
 const dialogRef = useRef<HTMLDialogElement>(null);
 const addButtonRef = useRef<HTMLButtonElement>(null);
 const editButtonRef = useRef<HTMLButtonElement | null>(null);

 useEffect(() => { if (dialogMode && dialogRef.current && !dialogRef.current.open) dialogRef.current.showModal(); }, [dialogMode]);
 useEffect(() => {
  if (!dialogMode) return;
  const old = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  return () => { document.body.style.overflow = old; };
 }, [dialogMode]);
 useEffect(() => {
  if (dialogMode !== 'search' || catalog) return;
  const controller = new AbortController();
  setCatalogError('');
  fetch('/data/nhi-drugs.json', { signal: controller.signal }).then(async response => {
   if (!response.ok) throw Error();
   const data = await response.json();
   if (!Array.isArray(data.drugs) || !data.drugs.length) throw Error();
   setCatalog(data);
  }).catch(error => { if (error.name !== 'AbortError') setCatalogError('無法載入官方藥品索引，請重試。'); });
  return () => controller.abort();
 }, [dialogMode, catalog, retry]);
 useEffect(() => {
  if (!db) return;
  const fail = () => setMessage('無法讀取資料，請確認本機服務仍在執行。');
  const stops = [
   onSnapshot(collection(db, 'drugs'), snapshot => { setDrugs(snapshot.docs.map(item => ({ ...item.data(), id: item.id } as SavedDrug))); setLoaded(true); }, fail),
   onSnapshot(collection(db, 'stock_locations'), snapshot => setLocations(snapshot.docs.map(item => ({ id: item.id, name: String(item.data().name), active: item.data().active !== false }))), fail),
   onSnapshot(doc(db, 'settings', 'non-stock-inventory'), snapshot => { setCycleId(String(snapshot.data()?.cycleId || 'initial')); setCycleLoaded(true); }, fail),
  ];
  return () => stops.forEach(stop => stop());
 }, []);

 const saved = useMemo(() => drugs.filter(drug => drug.inventoryKind === 'non-stock').sort((a, b) => (a.inventoryLocation || '').localeCompare(b.inventoryLocation || '', 'zh-TW') || (a.chineseName || a.englishName).localeCompare(b.chineseName || b.englishName, 'zh-TW')), [drugs]);
 const visible = saved.filter(drug => [drug.nhiCode, drug.chineseName, drug.englishName, drug.inventoryLocation, drug.remark].some(value => (value ?? '').toLowerCase().includes(filter.trim().toLowerCase())));
 const checkedCount = saved.filter(drug => drug.inventoryCheckedCycle === cycleId).length;
 const results = useMemo(() => {
  if (query.trim().length < 2) return [];
  const local = drugs.map(drug => ({ nhiCode: drug.nhiCode ?? '', chineseName: drug.chineseName ?? '', englishName: drug.englishName ?? '', ingredient: drug.ingredient ?? '', strength: drug.strength ?? '', unit: drug.unit ?? '', manufacturer: drug.manufacturer ?? '', dosageForm: drug.dosageForm ?? '', startDate: drug.startDate ?? '', endDate: drug.endDate ?? '' }));
  return [...new Map([...searchNhi(local, query), ...searchNhi(catalog?.drugs ?? [], query)].map(drug => [drug.nhiCode, drug])).values()];
 }, [catalog, drugs, query]);

 function choose(drug: NhiDrug, id: string | null = null) {
  const existing = id ? drugs.find(item => item.id === id) : undefined;
  setSelected(drug); setEditing(id); setQuantity(String(existing?.quantity ?? 0));
  setQuantityUnit(existing?.quantityUnit?.trim() || '顆'); setRemark(existing?.remark ?? '');
  setLocationId(existing?.inventoryLocationId ?? (locations.filter(location => location.active).length === 1 ? locations.find(location => location.active)?.id ?? '' : ''));
  setDialogMode('edit'); setMessage('');
 }
 function closeDialog() {
  dialogRef.current?.close(); setDialogMode(null); setSelected(null); setEditing(null); setQuery('');
  requestAnimationFrame(() => (editButtonRef.current ?? addButtonRef.current)?.focus());
 }
 async function save(event: FormEvent) {
  event.preventDefault();
  if (!db || !selected || busy) return;
  const location = locations.find(item => item.id === locationId && item.active);
  if (!location) { setMessage('請選擇啟用中的收納位置。'); return; }
  const amount = Number(quantity);
  if (!quantity.trim() || !Number.isSafeInteger(amount) || amount < 0 || !quantityUnit.trim()) { setMessage('請填寫 0 或以上的整數數量及數量單位。'); return; }
  setBusy(true); setMessage('');
  try {
   if (editing) await updateDoc(doc(db, 'drugs', editing), { inventoryLocationId: location.id, inventoryLocation: location.name, remark: remark.trim(), quantity: amount, quantityUnit: quantityUnit.trim(), updatedAt: new Date() });
   else {
    const firestore = db;
    await runTransaction(firestore, async transaction => {
     const base = getNhiCodeBase(selected.nhiCode);
     const ref = doc(firestore, 'drugs', `rare-nhi-${base}`);
     if ((await transaction.get(ref)).exists() || drugs.some(drug => drug.inventoryKind === 'non-stock' && getNhiCodeBase(drug.nhiCode ?? '') === base)) throw Error('此藥品已收納為少用藥品，請編輯收納資料。');
     transaction.set(ref, { ...selected, inventoryKind: 'non-stock', nhiCodeBase: base, nhiCodeVariants: [selected.nhiCode], internalCode: '', track: '', cabinet: '', layer: 0, placementStatus: 'non-stock', inventoryLocationId: location.id, inventoryLocation: location.name, remark: remark.trim(), quantity: amount, quantityUnit: quantityUnit.trim(), searchKeywords: [selected.chineseName, selected.englishName, ...getNhiSearchAliases([selected.nhiCode])].map(value => value.toLowerCase()), source: 'https://data.gov.tw/dataset/23715', sourceSyncedAt: catalog?.syncedAt ?? '', createdAt: new Date(), updatedAt: new Date() });
    });
   }
   closeDialog(); setMessage(editing ? '收納資料已更新。' : '藥品已加入下方清單。');
  } catch (error) { setMessage(error instanceof Error && error.message.startsWith('此藥品') ? error.message : '儲存失敗，請確認本機服務仍在執行。'); }
  finally { setBusy(false); }
 }
 async function remove(drug: SavedDrug) {
  if (!db || busy || !window.confirm(`確定移除「${drug.chineseName || drug.englishName}」的少用藥品收納紀錄？原本另行建檔的藥品資料會保留。`)) return;
  setBusy(true);
  try { await deleteDoc(doc(db, 'drugs', drug.id)); setMessage('已移除少用藥品。'); }
  catch { setMessage('移除失敗，請稍後重試。'); }
  finally { setBusy(false); }
 }
 async function startNewCycle() {
  if (!db || busy || !window.confirm('開始新一輪盤點？目前的勾選紀錄將清空，藥品與數量會保留。')) return;
  setBusy(true); setMessage('');
  try { await setDoc(doc(db, 'settings', 'non-stock-inventory'), { cycleId: new Date().toISOString(), updatedAt: new Date() }); setMessage('已開始新一輪盤點。'); }
  catch { setMessage('無法開始新一輪盤點，請重試。'); }
  finally { setBusy(false); }
 }

 return <main className="min-h-screen bg-slate-50 text-slate-900">
  <header className="border-b border-slate-200 bg-white p-4 sm:p-6"><div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3"><div><p className="text-sm text-slate-600">管理端</p><h1 className="text-xl font-bold">少用藥品</h1></div><div className="flex flex-wrap gap-2"><Link className={button} href="/setup/stock-locations">管理收納位置</Link><Link className={button} href="/">返回查詢</Link></div></div></header>
  <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
   {message && !dialogMode && <p role="status" className="rounded-xl border border-slate-300 bg-white p-4">{message}</p>}
   <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-bold">籃內藥品盤點</h2><p className="mt-1 text-sm text-slate-600">逐筆確認仍有的藥品，直接更新數量。勾選狀態會保留到下一輪盤點。</p></div><div className="flex flex-wrap gap-2"><button ref={addButtonRef} type="button" className={primaryButton} disabled={!loaded || busy} onClick={() => { editButtonRef.current = null; setDialogMode('search'); setMessage(''); }}>新增藥品</button><button type="button" className={button} disabled={!loaded || !cycleLoaded || busy || !saved.length} onClick={startNewCycle}>開始新一輪盤點</button></div></div>
    <p className="mt-3 text-sm font-semibold" role="status">已確認 {checkedCount} / {saved.length} 筆</p>
    <label className="mt-3 block text-sm font-semibold">搜尋已收納品項<input className="control" value={filter} onChange={event => setFilter(event.target.value)} placeholder="健保碼、藥名或收納位置" /></label>
    {!loaded || !cycleLoaded ? <p role="status" className="mt-4 text-sm text-slate-600">正在讀取已收納藥品…</p> : !visible.length ? <p className="mt-4 rounded-xl border border-dashed border-slate-300 p-6 text-center text-slate-600">{saved.length ? '沒有符合搜尋條件的藥品。' : '尚無少用藥品，請點選「新增藥品」。'}</p> : <ul className="mt-3 space-y-2">{visible.map(drug => <StockRow key={drug.id} drug={drug} cycleId={cycleId} onEdit={() => { editButtonRef.current = document.activeElement as HTMLButtonElement; choose(drug, drug.id); }} onRemove={() => remove(drug)} />)}</ul>}
   </section>
   <BatchEditPanel drugs={saved} locations={locations} loaded={loaded} />
   <ExportPanel drugs={saved} loaded={loaded} />
  </div>

  {dialogMode && <dialog ref={dialogRef} onClose={() => { setDialogMode(null); setSelected(null); setEditing(null); setQuery(''); requestAnimationFrame(() => (editButtonRef.current ?? addButtonRef.current)?.focus()); }} onCancel={event => { if (busy) event.preventDefault(); }} className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[min(48rem,calc(100vw-2rem))] max-w-none overflow-y-auto rounded-2xl border border-slate-300 bg-white p-4 text-slate-900 shadow-2xl backdrop:bg-slate-900/60 sm:p-6" aria-labelledby="non-stock-dialog-title">
   <div className="flex items-start justify-between gap-3"><h2 id="non-stock-dialog-title" className="text-xl font-bold">{dialogMode === 'search' ? '新增少用藥品' : editing ? '編輯收納資料' : '確認新增藥品'}</h2><button type="button" className={button} disabled={busy} onClick={closeDialog}>關閉</button></div>
   {message && <p role="alert" className="mt-4 rounded-xl bg-slate-100 p-3 text-sm">{message}</p>}
   {dialogMode === 'search' && <div className="mt-4 space-y-3">
    <p className="text-sm text-slate-600">輸入至少 2 個字元，搜尋健保碼、中文或英文藥名，選取後再填寫收納資料。</p>
    <label className="block text-sm font-semibold">健保碼或藥名<input autoFocus className="control" value={query} onChange={event => setQuery(event.target.value)} placeholder="例如：普拿疼、Aspirin、AC48" /></label>
    <div className="text-sm text-slate-600" aria-live="polite">{catalogError ? <>{catalogError} <button type="button" className={button} onClick={() => setRetry(value => value + 1)}>重試</button></> : !catalog ? '正在載入官方藥品索引…' : <><a className="underline" href="https://data.gov.tw/dataset/23715" target="_blank" rel="noreferrer">健保署開放資料</a> · 同步於 {new Date(catalog.syncedAt).toLocaleDateString('zh-TW')}</>}</div>
    {query.trim().length >= 2 && <div><p className="text-sm text-slate-600">找到 {results.length} 筆{results.length > 40 && '，顯示前 40 筆，請增加關鍵字縮小範圍'}。</p><div key={query} role="region" aria-label="藥品搜尋結果" tabIndex={0} className="mt-2 max-h-[45vh] space-y-2 overflow-y-auto rounded-xl pr-1 focus-visible:outline-2 focus-visible:outline-slate-700">{results.slice(0, 40).map(drug => { const stored = saved.find(item => getNhiCodeBase(item.nhiCode ?? '') === getNhiCodeBase(drug.nhiCode)); const exists = drugs.some(item => getNhiCodeBase(item.nhiCode ?? '') === getNhiCodeBase(drug.nhiCode)); return <article key={drug.nhiCode} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-3"><div className="min-w-0 flex-1"><h3 className="font-semibold">{drug.chineseName || drug.englishName}</h3><p className="break-words text-sm text-slate-600">{drug.englishName} · {drug.nhiCode}</p><p className="truncate text-sm text-slate-600" title={`${drug.dosageForm} · ${drug.manufacturer}`}>{drug.dosageForm} · {drug.manufacturer}</p></div><button type="button" className={button} disabled={!loaded || busy} onClick={() => choose(stored ?? drug, stored?.id ?? null)}>{stored ? '編輯收納' : exists ? '已建檔・加入收納' : '選取'}</button></article>; })}{!results.length && <p className="p-4 text-sm text-slate-600">查無符合資料，請改用部分藥名或健保碼。</p>}</div></div>}
   </div>}
   {dialogMode === 'edit' && selected && <div className="mt-4"><p className="font-semibold">{selected.chineseName || selected.englishName}</p><p className="break-words text-sm text-slate-600">{selected.englishName} · {selected.nhiCode}</p><p className="mt-2 text-sm text-slate-600">成分：{selected.ingredient || '未提供'} · 劑型：{selected.dosageForm || '未提供'} · 製造廠：{selected.manufacturer || '未提供'}</p>
    <form onSubmit={save} className="mt-4 space-y-4"><label className="block text-sm font-semibold">收納位置（必填）<select autoFocus className="control" required value={locationId} onChange={event => setLocationId(event.target.value)}><option value="">請選擇籃子位置</option>{locations.filter(location => location.active).map(location => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>{!locations.some(location => location.active) && <p className="text-sm">請先到「管理收納位置」建立籃子位置。</p>}<div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-semibold">庫存數量（必填）<input className="control" type="number" min="0" step="1" required value={quantity} onChange={event => setQuantity(event.target.value)} /></label><label className="block text-sm font-semibold">數量單位（必填）<select className="control" required value={quantityUnit} onChange={event => setQuantityUnit(event.target.value)}>{quantityUnits.map(unit => <option key={unit} value={unit}>{unit}</option>)}{!quantityUnits.includes(quantityUnit) && <option value={quantityUnit}>{quantityUnit}（原登記單位）</option>}</select></label></div><label className="block text-sm font-semibold">備註<input className="control" value={remark} onChange={event => setRemark(event.target.value)} /></label><div className="flex flex-wrap gap-2"><button type="submit" disabled={busy || !loaded} className={primaryButton}>{busy ? '儲存中…' : editing ? '儲存變更' : '儲存並加入清單'}</button>{!editing && <button type="button" disabled={busy} className={button} onClick={() => { setDialogMode('search'); setMessage(''); }}>返回搜尋</button>}<button type="button" disabled={busy} className={button} onClick={closeDialog}>取消</button></div></form>
   </div>}
  </dialog>}
 </main>;
}
