"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { doc, onSnapshot, setDoc } from "../../../lib/local-store";
import { CabinetTrack, defaultLayout } from "../../../lib/cabinet-layout";
import { db } from "../../../lib/local-store";
import AdminGuard from "../../admin-guard";

export default function LayoutPage() { return <AdminGuard><LayoutContent /></AdminGuard>; }

function LayoutContent() {
  const [tracks, setTracks] = useState<CabinetTrack[]>(defaultLayout);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!db) return;
    return onSnapshot(doc(db, "settings", "cabinetLayout"), (snapshot) => {
      const value = snapshot.data()?.tracks;
      if (Array.isArray(value) && value.length) setTracks(value.map((track) => ({ name: String(track.name), cabinets: Array.isArray(track.cabinets) ? track.cabinets.map(String) : [], layers: Number(track.layers) || 10 })));
    });
  }, []);
  function update(index: number, patch: Partial<CabinetTrack>) { setTracks((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item)); }
  async function save() {
    if (!db) return; setSaving(true); setMessage("");
    try { await setDoc(doc(db, "settings", "cabinetLayout"), { tracks, updatedAt: new Date() }); setMessage("藥櫃結構已儲存，上架模式會自動更新。"); }
    catch { setMessage("無法儲存，請確認本機服務仍在執行。"); }
    finally { setSaving(false); }
  }
  return <main className="min-h-screen bg-slate-50 text-slate-900"><header className="border-b border-slate-200 bg-white px-4 py-4 sm:px-6"><div className="mx-auto flex max-w-4xl items-center justify-between"><div><p className="text-sm font-semibold text-slate-600">管理設定</p><h1 className="text-xl font-bold">藥櫃結構</h1></div><Link href="/setup/placement" className="min-h-11 rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold">前往上架</Link></div></header><div className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6"><p className="rounded-xl border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-700">每一列是一個區域。櫃位請以逗號分隔，例如 A, B, C, D。已有藥品使用的位置若要移除或減少層數，請先完成藥品搬移。</p>{tracks.map((track, index) => <section key={index} className="rounded-2xl border border-slate-200 bg-white p-5"><div className="grid gap-3 sm:grid-cols-[1fr_1.5fr_120px]"><label className="text-sm font-semibold">區域名稱<input value={track.name} onChange={(event) => update(index, { name: event.target.value })} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3"/></label><label className="text-sm font-semibold">藥櫃名稱<input value={track.cabinets.join(", ")} onChange={(event) => update(index, { cabinets: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3"/></label><label className="text-sm font-semibold">層數<input value={track.layers} min="1" type="number" onChange={(event) => update(index, { layers: Math.max(1, Number(event.target.value)) })} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3"/></label></div><button onClick={() => setTracks((items) => items.filter((_, itemIndex) => itemIndex !== index))} className="mt-4 min-h-11 rounded-xl border border-slate-300 px-3 text-sm font-semibold">移除此區域</button></section>)}<button onClick={() => setTracks((items) => [...items, { name: "新區域", cabinets: ["A"], layers: 10 }])} className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 font-semibold">新增區域</button><div><button disabled={saving || !tracks.length} onClick={save} className="min-h-12 rounded-xl bg-slate-900 px-5 font-semibold text-white disabled:opacity-50">{saving ? "儲存中…" : "儲存藥櫃結構"}</button>{message && <p className="mt-3 rounded-xl bg-slate-100 p-3 text-sm" role="status">{message}</p>}</div></div></main>;
}
