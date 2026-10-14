"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { collection, deleteDoc, doc, getDoc, onSnapshot, setDoc, writeBatch } from "../../../lib/local-store";
import AdminGuard from "../../admin-guard";
import NhiDrugPicker from "../../nhi-drug-picker";
import { NhiDrug } from "../../../lib/nhi-catalog";
import { CabinetTrack, defaultLayout } from "../../../lib/cabinet-layout";
import { db } from "../../../lib/local-store";
import { getNhiCodeBase, getNhiCodeVariants, getNhiDisplayCode, getNhiSearchAliases } from "../../../lib/nhi-code";

type Drug = { id: string; chineseName: string; englishName: string; nhiCode: string; nhiCodeBase: string; internalCode: string; remark: string; track: string; cabinet: string; layer: number; inventoryLocation: string; inventoryLocationId: string };
type StockLocation = { id: string; name: string; active: boolean };
type FormData = Omit<Drug, "id" | "nhiCodeBase" | "inventoryLocation">;
const blankForm: FormData = { chineseName: "", englishName: "", nhiCode: "", internalCode: "", remark: "", track: "", cabinet: "", layer: 1, inventoryLocationId: "" };
const normalize = (value: string) => value.trim().toLowerCase();

export default function DrugManagementPage() { return <AdminGuard><DrugManagementContent /></AdminGuard>; }

function DrugManagementContent() {
  const [drugs, setDrugs] = useState<Drug[]>([]);
  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [layout, setLayout] = useState<CabinetTrack[]>(defaultLayout);
  const [term, setTerm] = useState("");
  const [filter, setFilter] = useState<"all" | "unassigned" | "placed">("all");
  const [editingId, setEditingId] = useState<string | null | undefined>(undefined);
  const [form, setForm] = useState<FormData>(blankForm);
  const [message, setMessage] = useState("");
  const [sourceDrug, setSourceDrug] = useState<(NhiDrug & { sourceSyncedAt: string }) | null>(null);

  useEffect(() => {
    if (!db) return;
    const stops = [
      onSnapshot(collection(db, "drugs"), (snapshot) => setDrugs(snapshot.docs.filter((item) => item.data().inventoryKind != "non-stock").map((item) => { const data = item.data(); const code = String(data.nhiCode ?? ""); const base = String(data.nhiCodeBase ?? getNhiCodeBase(code)); return { id: item.id, chineseName: String(data.chineseName ?? ""), englishName: String(data.englishName ?? ""), nhiCode: getNhiDisplayCode(code, base, Array.isArray(data.nhiCodeVariants) ? data.nhiCodeVariants.map(String) : []), nhiCodeBase: base, internalCode: String(data.internalCode ?? ""), remark: String(data.remark ?? ""), track: String(data.track ?? ""), cabinet: String(data.cabinet ?? ""), layer: Number(data.layer ?? 0), inventoryLocation: String(data.inventoryLocation ?? ""), inventoryLocationId: String(data.inventoryLocationId ?? "") }; }))),
      onSnapshot(collection(db, "stock_locations"), (snapshot) => setLocations(snapshot.docs.map((item) => ({ id: item.id, name: String(item.data().name ?? ""), active: item.data().active !== false })))),
      onSnapshot(doc(db, "settings", "cabinetLayout"), (snapshot) => { const tracks = snapshot.data()?.tracks; if (Array.isArray(tracks) && tracks.length) setLayout(tracks); }),
    ];
    return () => stops.forEach((stop) => stop());
  }, []);

  const visible = useMemo(() => drugs.filter((drug) => { const q = normalize(term); const placed = Boolean(drug.track && drug.cabinet && drug.layer); return (!q || [drug.chineseName, drug.englishName, drug.nhiCode, drug.nhiCodeBase, ...getNhiSearchAliases([drug.nhiCode]), drug.internalCode].some((value) => normalize(value).includes(q))) && (filter === "all" || (filter === "placed" ? placed : !placed)); }), [drugs, filter, term]);
  const placedCount = drugs.filter((drug) => drug.track && drug.cabinet && drug.layer).length;
  const activeTrack = layout.find((item) => item.name === form.track) ?? layout[0];
  function openCreate() { setEditingId(null); setSourceDrug(null); setForm({ ...blankForm }); setMessage(""); }
  function openEdit(drug: Drug) { setSourceDrug(null); setEditingId(drug.id); setForm({ chineseName: drug.chineseName, englishName: drug.englishName, nhiCode: drug.nhiCode, internalCode: drug.internalCode, remark: drug.remark, track: drug.track, cabinet: drug.cabinet, layer: drug.layer || 1, inventoryLocationId: drug.inventoryLocationId }); setMessage(""); }

  async function save(event: FormEvent) {
    event.preventDefault(); if (!db) return;
    const base = getNhiCodeBase(form.nhiCode); const targetId = `nhi-${base}`;
    if (!base || !form.chineseName.trim()) { setMessage("健保代碼與藥品名稱為必填。"); return; }
    if (editingId !== targetId && (await getDoc(doc(db, "drugs", targetId))).exists()) { setMessage("此健保主碼已存在，請直接編輯既有藥品。"); return; }
    if (form.internalCode.trim() && drugs.some((drug) => drug.id !== editingId && normalize(drug.internalCode) === normalize(form.internalCode)) && !window.confirm("此內碼已被其他藥品使用，仍要儲存嗎？")) return;
    const location = locations.find((item) => item.id === form.inventoryLocationId);
    const variants = getNhiCodeVariants([form.nhiCode]);
    const displayCode = getNhiDisplayCode(form.nhiCode, base, variants);
    const data = { ...(sourceDrug && sourceDrug.nhiCode === form.nhiCode.trim().toUpperCase() ? { ...sourceDrug, source: "https://data.gov.tw/dataset/23715" } : {}), ...form, nhiCode: displayCode, nhiCodeBase: base, nhiCodeVariants: variants, inventoryLocation: location?.name ?? "", searchKeywords: [form.chineseName, form.englishName, displayCode, base, ...getNhiSearchAliases(variants), form.internalCode].map(normalize).filter(Boolean), placementStatus: form.track && form.cabinet && form.layer ? "placed" : "unassigned", updatedAt: new Date() };
    try {
      if (editingId && editingId !== targetId) { const batch = writeBatch(db); batch.set(doc(db, "drugs", targetId), data); batch.delete(doc(db, "drugs", editingId)); await batch.commit(); }
      else await setDoc(doc(db, "drugs", targetId), { ...data, ...(editingId === null ? { createdAt: new Date() } : {}) }, { merge: editingId !== null });
      setEditingId(undefined); setMessage(editingId === null ? "藥品已新增。" : "藥品資料已更新。");
    } catch { setMessage("無法儲存，請確認資料與本機服務狀態。"); }
  }
  async function remove(drug: Drug) { if (!db || !window.confirm(`確定刪除「${drug.chineseName}」？此動作無法復原。`)) return; try { await deleteDoc(doc(db, "drugs", drug.id)); setMessage("藥品已刪除。"); } catch { setMessage("無法刪除，請確認本機服務仍在執行。"); } }
  async function unplace(drug: Drug) { if (!db) return; await setDoc(doc(db, "drugs", drug.id), { track: "", cabinet: "", layer: 0, inventoryLocation: "", inventoryLocationId: "", placementStatus: "unassigned", updatedAt: new Date() }, { merge: true }); }

  return <main className="min-h-screen bg-slate-50 text-slate-900"><header className="border-b border-slate-200 bg-white px-4 py-4 sm:px-6"><div className="mx-auto flex max-w-6xl items-center justify-between"><div><p className="text-sm font-semibold text-slate-600">管理端</p><h1 className="text-xl font-bold">藥品管理</h1><Link href="/manage/non-stock" className="inline-flex min-h-11 items-center text-sm underline">管理少用藥品</Link></div><Link href="/" className="min-h-11 rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold">返回查詢</Link></div></header><div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6"><section className="grid gap-3 sm:grid-cols-3"><Summary label="全部藥品" value={drugs.length}/><Summary label="已上架" value={placedCount}/><Summary label="待上架" value={drugs.length - placedCount}/></section><section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5"><div className="flex flex-col gap-3 sm:flex-row"><input value={term} onChange={(event) => setTerm(event.target.value)} placeholder="搜尋名稱、健保代碼或內碼" aria-label="搜尋藥品" className="min-h-12 flex-1 rounded-xl border border-slate-300 px-3 outline-none focus:border-slate-700 focus:ring-4 focus:ring-slate-200"/><select aria-label="上架狀態" value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)} className="min-h-12 rounded-xl border border-slate-300 bg-white px-3"><option value="all">全部狀態</option><option value="unassigned">待上架</option><option value="placed">已上架</option></select><button onClick={openCreate} className="min-h-12 rounded-xl bg-slate-900 px-4 font-semibold text-white">新增藥品</button></div>{message && <p className="mt-3 rounded-xl bg-slate-100 p-3 text-sm" role="status">{message}</p>}</section>{editingId === null && <NhiDrugPicker existingBases={new Set(drugs.map(drug => drug.nhiCodeBase))} onSelect={(drug, syncedAt) => { setSourceDrug({ ...drug, sourceSyncedAt: syncedAt }); setForm(current => ({ ...current, nhiCode: drug.nhiCode, chineseName: drug.chineseName, englishName: drug.englishName })); setMessage("已帶入藥品資料，請確認下方欄位後儲存。"); }} />}{editingId === null && sourceDrug && sourceDrug.nhiCode === form.nhiCode.trim().toUpperCase() && <section className="rounded-2xl border border-slate-200 bg-white p-4 text-sm"><h2 className="font-semibold">已選取的官方資料</h2><p className="mt-2">成分：{sourceDrug.ingredient || "未提供"}</p><p>規格：{[sourceDrug.strength, sourceDrug.unit].filter(Boolean).join(" ") || "未提供"}</p><p>劑型：{sourceDrug.dosageForm || "未提供"}</p><p>製造廠：{sourceDrug.manufacturer || "未提供"}</p><p>有效期間：{sourceDrug.startDate || "未提供"} ～ {sourceDrug.endDate || "未提供"}（民國年月日；資料可能包含歷史品項）</p></section>}{editingId !== undefined && <DrugForm form={form} setForm={setForm} activeTrack={activeTrack} layout={layout} locations={locations} onSubmit={save} onCancel={() => setEditingId(undefined)} title={editingId === null ? "新增藥品" : "編輯藥品"}/>}<section className="space-y-3">{visible.map((drug) => { const placed = Boolean(drug.track && drug.cabinet && drug.layer); return <article key={drug.id} className="rounded-2xl border border-slate-200 bg-white p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-bold">{drug.chineseName}<span className="ml-2 text-sm font-normal text-slate-600">{drug.englishName}</span></h2><p className="mt-1 text-sm text-slate-600">健保代碼：{drug.nhiCode || drug.nhiCodeBase}{drug.internalCode && `　內碼：${drug.internalCode}`}</p><p className="mt-1 text-sm text-slate-700">{placed ? `調劑：${drug.track} ${drug.cabinet}櫃 第 ${drug.layer} 層　庫存：${drug.inventoryLocation || "未設定"}` : "待上架"}</p>{drug.remark && <p className="mt-1 text-sm text-slate-600">備註：{drug.remark}</p>}</div><div className="flex flex-wrap gap-2"><button onClick={() => openEdit(drug)} className="min-h-11 rounded-xl border border-slate-300 px-3 text-sm font-semibold">編輯</button>{placed && <button onClick={() => unplace(drug)} className="min-h-11 rounded-xl border border-slate-300 px-3 text-sm font-semibold">解除位置</button>}<button onClick={() => remove(drug)} className="min-h-11 rounded-xl border border-slate-400 px-3 text-sm font-semibold">刪除</button></div></div></article>; })}{!visible.length && <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-600">沒有符合條件的藥品。</p>}</section></div></main>;
}

function Summary({ label, value }: { label: string; value: number }) { return <div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-sm text-slate-600">{label}</p><p className="mt-1 text-2xl font-bold">{value}</p></div>; }

function DrugForm({ form, setForm, activeTrack, layout, locations, onSubmit, onCancel, title }: { form: FormData; setForm: (value: FormData) => void; activeTrack: CabinetTrack; layout: CabinetTrack[]; locations: StockLocation[]; onSubmit: (event: FormEvent) => void; onCancel: () => void; title: string }) {
  const field = (key: keyof FormData, value: string | number) => setForm({ ...form, [key]: value });
  return <section className="rounded-2xl border-2 border-slate-800 bg-white p-5"><h2 className="text-xl font-bold">{title}</h2><form onSubmit={onSubmit} className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><Field label="藥品名稱（必填）"><input required value={form.chineseName} onChange={(event) => field("chineseName", event.target.value)} className="control"/></Field><Field label="英文名稱"><input value={form.englishName} onChange={(event) => field("englishName", event.target.value)} className="control"/></Field><Field label="健保代碼（必填）"><input required value={form.nhiCode} onChange={(event) => field("nhiCode", event.target.value)} className="control"/></Field><Field label="內碼"><input value={form.internalCode} onChange={(event) => field("internalCode", event.target.value)} className="control"/></Field><Field label="庫存位置"><select value={form.inventoryLocationId} onChange={(event) => field("inventoryLocationId", event.target.value)} className="control"><option value="">未設定</option>{locations.filter((item) => item.active || item.id === form.inventoryLocationId).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></Field><Field label="區域"><select value={form.track} onChange={(event) => { const track = layout.find((item) => item.name === event.target.value); setForm({ ...form, track: event.target.value, cabinet: track?.cabinets[0] ?? "", layer: 1 }); }} className="control"><option value="">未設定</option>{layout.map((item) => <option key={item.name}>{item.name}</option>)}</select></Field><Field label="藥櫃"><select value={form.cabinet} onChange={(event) => field("cabinet", event.target.value)} className="control"><option value="">未設定</option>{activeTrack?.cabinets.map((item) => <option key={item}>{item}</option>)}</select></Field><Field label="層數"><input min="1" max={activeTrack?.layers ?? 99} type="number" value={form.layer} onChange={(event) => field("layer", Number(event.target.value))} className="control"/></Field><Field label="備註"><input value={form.remark} onChange={(event) => field("remark", event.target.value)} className="control"/></Field><div className="flex items-end gap-2"><button className="min-h-11 rounded-xl bg-slate-900 px-4 font-semibold text-white">儲存</button><button type="button" onClick={onCancel} className="min-h-11 rounded-xl border border-slate-300 px-4 font-semibold">取消</button></div></form></section>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="text-sm font-semibold">{label}{children}</label>; }
