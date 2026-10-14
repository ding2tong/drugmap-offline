"use client";

import { FormEvent, useEffect, useState } from "react";
import { collection, doc, onSnapshot, updateDoc } from "../lib/local-store";
import { db } from "../lib/local-store";
import { Drug } from "../lib/demo-data";
import { CabinetTrack } from "../lib/cabinet-layout";

type Location = { id: string; name: string; active: boolean };
const button = "min-h-11 rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold hover:bg-slate-100 disabled:opacity-50";
export default function LocationEditor({ drug, layout, onSaved }: { drug: Drug; layout: CabinetTrack[]; onSaved: (message: string) => void }) {
 const [mode, setMode] = useState<"inventory" | "dispensing" | null>(null);
 const [locations, setLocations] = useState<Location[]>([]);
 const [locationId, setLocationId] = useState("");
 const [track, setTrack] = useState(drug.track);
 const [cabinet, setCabinet] = useState(drug.cabinet);
 const [layer, setLayer] = useState(String(drug.layer));
 const [busy, setBusy] = useState(false);
 const [error, setError] = useState("");
 const [loaded, setLoaded] = useState(false);
 useEffect(() => {
  if (mode !== "inventory" || !db) return;
  return onSnapshot(collection(db, "stock_locations"), snapshot => {
   setLocations(snapshot.docs.map(item => ({ id: item.id, name: String(item.data().name ?? ""), active: item.data().active !== false })));
   setLoaded(true);
  }, () => { setLoaded(false); setError("無法讀取庫存位置，請稍後重試。"); });
 }, [mode]);
 function open(next: "inventory" | "dispensing") {
  setError(""); setMode(next);
  setLocationId(drug.inventoryLocationId ?? "");
  setTrack(drug.track); setCabinet(drug.cabinet); setLayer(String(drug.layer));
 }
 async function save(event: FormEvent) {
  event.preventDefault();
  if (!db || busy || !mode) return;
  const location = locations.find(item => item.id === locationId && item.active);
  const selectedTrack = layout.find(item => item.name === track);
  if (mode === "inventory" && (!loaded || !location)) { setError("請選擇啟用中的庫存位置。"); return; }
  if (mode === "dispensing" && (!selectedTrack?.cabinets.includes(cabinet) || !Number.isInteger(Number(layer)) || Number(layer) < 1 || Number(layer) > selectedTrack.layers)) { setError("請選擇完整的調劑位置。"); return; }
  setBusy(true); setError("");
  try {
   const fields = mode === "inventory" ? { inventoryLocationId: location!.id, inventoryLocation: location!.name } : { track, cabinet, layer: Number(layer), placementStatus: "placed" };
   await updateDoc(doc(db, "drugs", drug.id), { ...fields, updatedAt: new Date() });
   onSaved(`${drug.chineseName || drug.nhiCode} 已儲存${mode === "inventory" ? `庫存位置：${location!.name}` : `調劑位置：${track} ${cabinet}櫃 第 ${layer} 層`}。`);
   setMode(null);
  } catch { setError("儲存失敗，請確認本機服務仍在執行後重試。"); }
  finally { setBusy(false); }
 }
 const activeTrack = layout.find(item => item.name === track);
 return <div className="mt-3">
  <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy} aria-expanded={mode === "inventory"} onClick={() => open("inventory")}>修改庫存位置</button><button type="button" className={button} disabled={busy} aria-expanded={mode === "dispensing"} onClick={() => open("dispensing")}>修改調劑位置</button></div>
  {mode && <form onSubmit={save} className="mt-3 space-y-3 rounded-xl bg-slate-50 p-3">
   <fieldset disabled={busy} className="space-y-3"><legend className="mb-2 font-semibold">{mode === "inventory" ? "修改庫存位置" : "修改調劑位置"}</legend>
   {mode === "inventory" ? <label className="block text-sm font-semibold">庫存位置<select required className="control" value={locationId} onChange={e => setLocationId(e.target.value)}><option value="">請選擇</option>{locationId && !locations.some(item => item.id === locationId && item.active) && <option disabled value={locationId}>{drug.inventoryLocation}（請重新選擇）</option>}{locations.filter(item => item.active).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>{!loaded && <span role="status">正在載入位置…</span>}</label> : <>
    <label className="block text-sm font-semibold">區域<select required className="control" value={track} onChange={e => { setTrack(e.target.value); setCabinet(layout.find(item => item.name === e.target.value)?.cabinets[0] ?? ""); setLayer("1"); }}><option value="">請選擇</option>{layout.map(item => <option key={item.name}>{item.name}</option>)}</select></label>
    <label className="block text-sm font-semibold">藥櫃<select required className="control" value={cabinet} onChange={e => setCabinet(e.target.value)}><option value="">請選擇</option>{activeTrack?.cabinets.map(item => <option key={item}>{item}</option>)}</select></label>
    <label className="block text-sm font-semibold">層數<select required className="control" value={layer} onChange={e => setLayer(e.target.value)}><option value="">請選擇</option>{Array.from({ length: activeTrack?.layers ?? 0 }, (_, i) => i + 1).map(item => <option key={item}>{item}</option>)}</select></label>
   </>}
   <div className="flex gap-2"><button type="submit" disabled={mode === "inventory" && !loaded} className={button}>{busy ? "儲存中…" : "儲存位置"}</button><button type="button" className={button} onClick={() => { setMode(null); setError(""); }}>取消</button></div></fieldset>
   {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </form>}
 </div>;
}
