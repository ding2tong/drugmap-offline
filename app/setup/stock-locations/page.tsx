"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { addDoc, collection, deleteDoc, doc, getDocs, onSnapshot, orderBy, query, updateDoc, where, writeBatch } from "../../../lib/local-store";
import { db } from "../../../lib/local-store";
import AdminGuard from "../../admin-guard";

type StockLocation = { id: string; name: string; active: boolean; sortOrder: number };
const defaults = ["大庫", "冷藏庫", "管制藥品櫃", "備品區", "退貨區"];

export default function StockLocationsPage() { return <AdminGuard><StockLocationsContent /></AdminGuard>; }

function StockLocationsContent() {
  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!db) return;
    return onSnapshot(query(collection(db, "stock_locations"), orderBy("sortOrder")), (snapshot) => {
      setLocations(snapshot.docs.map((item) => ({ id: item.id, name: String(item.data().name ?? "未命名位置"), active: item.data().active !== false, sortOrder: Number(item.data().sortOrder ?? 0) })));
    }, () => setMessage("無法讀取庫存位置，請確認本機服務仍在執行。"));
  }, []);

  async function add(event: FormEvent) {
    event.preventDefault();
    const cleanName = name.trim();
    if (!db || !cleanName) return;
    if (locations.some((item) => item.name === cleanName)) { setMessage("已有相同名稱的庫存位置。"); return; }
    try {
      await addDoc(collection(db, "stock_locations"), { name: cleanName, sortOrder: locations.length + 1, active: true, createdAt: new Date(), updatedAt: new Date() });
      setName(""); setMessage(`已新增「${cleanName}」。`);
    } catch { setMessage("無法儲存，請確認本機服務仍在執行。"); }
  }

  async function seedDefaults() {
    if (!db || locations.length) return;
    const firestore = db;
    const batch = writeBatch(firestore);
    defaults.forEach((item, index) => batch.set(doc(collection(firestore, "stock_locations")), { name: item, sortOrder: index + 1, active: true, createdAt: new Date(), updatedAt: new Date() }));
    try { await batch.commit(); setMessage("已建立 5 個預設庫存位置。"); }
    catch { setMessage("無法建立預設位置，請確認本機服務仍在執行。"); }
  }

  async function saveName(location: StockLocation) {
    const cleanName = editingName.trim();
    if (!db || !cleanName) return;
    if (locations.some((item) => item.id !== location.id && item.name === cleanName)) { setMessage("已有相同名稱的庫存位置。"); return; }
    setBusyId(location.id);
    try {
      await updateDoc(doc(db, "stock_locations", location.id), { name: cleanName, updatedAt: new Date() });
      const linked = await getDocs(query(collection(db, "drugs"), where("inventoryLocationId", "==", location.id)));
      for (let offset = 0; offset < linked.docs.length; offset += 450) {
        const batch = writeBatch(db);
        linked.docs.slice(offset, offset + 450).forEach((item) => batch.update(item.ref, { inventoryLocation: cleanName, updatedAt: new Date() }));
        await batch.commit();
      }
      setEditingId(null); setMessage(`已改名為「${cleanName}」，並同步 ${linked.size} 筆藥品。`);
    } catch { setMessage("改名失敗，請稍後再試。"); }
    finally { setBusyId(null); }
  }

  async function toggle(location: StockLocation) {
    if (!db) return;
    setBusyId(location.id);
    try { await updateDoc(doc(db, "stock_locations", location.id), { active: !location.active, updatedAt: new Date() }); setMessage(location.active ? "位置已停用；既有藥品資料仍會保留。" : "位置已重新啟用。"); }
    catch { setMessage("狀態更新失敗，請稍後再試。"); }
    finally { setBusyId(null); }
  }

  async function move(index: number, direction: -1 | 1) {
    if (!db) return;
    const target = index + direction;
    if (target < 0 || target >= locations.length) return;
    const current = locations[index]; const other = locations[target];
    const batch = writeBatch(db);
    batch.update(doc(db, "stock_locations", current.id), { sortOrder: other.sortOrder, updatedAt: new Date() });
    batch.update(doc(db, "stock_locations", other.id), { sortOrder: current.sortOrder, updatedAt: new Date() });
    try { await batch.commit(); setMessage("排序已更新。"); }
    catch { setMessage("排序更新失敗，請稍後再試。"); }
  }

  async function remove(location: StockLocation) {
    if (!db) return;
    setBusyId(location.id);
    try {
      const [current, legacy] = await Promise.all([
        getDocs(query(collection(db, "drugs"), where("inventoryLocationId", "==", location.id))),
        getDocs(query(collection(db, "drugs"), where("stockLocationId", "==", location.id))),
      ]);
      const count = new Set([...current.docs, ...legacy.docs].map((item) => item.id)).size;
      const detail = count ? `目前有 ${count} 個藥品使用此庫存位置。刪除後藥品仍保留原位置文字，但無法再選用此位置。` : "目前沒有藥品使用此位置。";
      if (!window.confirm(`${detail}\n\n確定刪除「${location.name}」？此動作無法復原。`)) return;
      await deleteDoc(doc(db, "stock_locations", location.id));
      setMessage(`已刪除「${location.name}」。`);
    } catch { setMessage("刪除失敗，請稍後再試。"); }
    finally { setBusyId(null); }
  }

  return <main className="min-h-screen bg-slate-50 text-slate-900"><header className="border-b border-slate-200 bg-white px-4 py-4 sm:px-6"><div className="mx-auto flex max-w-4xl items-center justify-between gap-3"><div><p className="text-sm font-semibold text-slate-600">管理設定</p><h1 className="text-xl font-bold">庫存位置</h1></div><Link href="/setup/placement" className="min-h-11 rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold">前往上架</Link></div></header><div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
    <section className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="text-lg font-bold">新增庫存位置</h2><p className="mt-1 text-sm leading-6 text-slate-600">例如：大庫、冷藏庫、管制藥品櫃、備品區。已使用的位置建議停用，避免既有資料失去對應。</p><form onSubmit={add} className="mt-4 flex flex-col gap-3 sm:flex-row"><label className="sr-only" htmlFor="location-name">庫存位置名稱</label><input id="location-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="輸入位置名稱" className="min-h-12 min-w-0 flex-1 rounded-xl border border-slate-300 px-3 outline-none focus:border-slate-700 focus:ring-4 focus:ring-slate-200"/><button className="min-h-12 rounded-xl bg-slate-900 px-5 font-semibold text-white">新增</button></form>{!locations.length && <button onClick={seedDefaults} className="mt-3 min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-semibold">建立建議的 5 個位置</button>}{message && <p className="mt-3 rounded-xl bg-slate-100 p-3 text-sm" role="status">{message}</p>}</section>
    <section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-end justify-between gap-3"><div><h2 className="text-lg font-bold">現有位置</h2><p className="mt-1 text-sm text-slate-600">排序會套用到上架時的選單；停用的位置不再提供新上架使用。</p></div><span className="shrink-0 text-sm text-slate-600">共 {locations.length} 個</span></div>{locations.length ? <ol className="mt-4 space-y-3">{locations.map((location, index) => <li className="rounded-xl border border-slate-200 p-4" key={location.id}><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0 flex-1">{editingId === location.id ? <div className="flex flex-col gap-2 sm:flex-row"><label className="sr-only" htmlFor={`edit-${location.id}`}>位置名稱</label><input id={`edit-${location.id}`} autoFocus value={editingName} onChange={(event) => setEditingName(event.target.value)} className="control"/><button disabled={busyId === location.id} onClick={() => saveName(location)} className="min-h-11 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white disabled:opacity-40">儲存</button><button onClick={() => setEditingId(null)} className="min-h-11 rounded-xl border border-slate-300 px-3 text-sm font-semibold">取消</button></div> : <div><b>{index + 1}. {location.name}</b><span className="ml-2 text-sm text-slate-600">{location.active ? "啟用中" : "已停用"}</span></div>}</div>{editingId !== location.id && <div className="grid grid-cols-2 gap-2 sm:flex"><button aria-label={`${location.name}向上移`} disabled={index === 0} onClick={() => move(index, -1)} className="min-h-11 rounded-xl border border-slate-300 px-3 text-sm font-semibold disabled:opacity-30">上移</button><button aria-label={`${location.name}向下移`} disabled={index === locations.length - 1} onClick={() => move(index, 1)} className="min-h-11 rounded-xl border border-slate-300 px-3 text-sm font-semibold disabled:opacity-30">下移</button><button onClick={() => { setEditingId(location.id); setEditingName(location.name); }} className="min-h-11 rounded-xl border border-slate-300 px-3 text-sm font-semibold">改名</button><button disabled={busyId === location.id} onClick={() => toggle(location)} className="min-h-11 rounded-xl border border-slate-300 px-3 text-sm font-semibold disabled:opacity-40">{location.active ? "停用" : "重新啟用"}</button><button disabled={busyId === location.id} onClick={() => remove(location)} className="min-h-11 rounded-xl border border-slate-400 px-3 text-sm font-semibold disabled:opacity-40">刪除</button></div>}</div></li>)}</ol> : <p className="mt-4 text-sm text-slate-600">尚未建立庫存位置。</p>}</section>
  </div></main>;
}
