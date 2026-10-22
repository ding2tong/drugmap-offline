"use client";

import Link from "next/link";
import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { collection, deleteDoc, doc, onSnapshot, setDoc } from "../../lib/local-store";
import AdminGuard from "../admin-guard";
import { db } from "../../lib/local-store";
import { CabinetTrack, defaultLayout } from "../../lib/cabinet-layout";
import { getNhiCodeBase } from "../../lib/nhi-code";
import { ConsumptionReport, ConsumptionRow, parseConsumptionFile, summarizeConsumption, indexConsumptionDrugs } from "../../lib/consumption-report";

type PlacedDrug = { code: string; name: string; track: string; cabinet: string; layer: number; unit: string; kind: string };
const format = (value: number) => new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 4 }).format(value);
const card = "rounded-2xl border border-slate-200 bg-white p-5";

export default function ConsumptionPage() { return <AdminGuard><Content /></AdminGuard>; }

function Content() {
  const [report, setReport] = useState<ConsumptionReport | null>(null);
  const [rows, setRows] = useState<ConsumptionRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [skipped, setSkipped] = useState(0);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [drugs, setDrugs] = useState<PlacedDrug[]>([]);
  const [layout, setLayout] = useState<CabinetTrack[]>(defaultLayout);
  const [track, setTrack] = useState("");
  const [cabinet, setCabinet] = useState("");
  const [layer, setLayer] = useState(1);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!db) return;
    const stopReport = onSnapshot(doc(db, "settings", "consumptionReport"), (snapshot) => setReport(snapshot.exists() ? snapshot.data() as ConsumptionReport : null));
    const stopDrugs = onSnapshot(collection(db, "drugs"), (snapshot) => setDrugs(snapshot.docs.map((entry) => {
      const data = entry.data();
      return { code: getNhiCodeBase(String(data.nhiCodeBase || data.nhiCode || "")), name: String(data.chineseName || data.englishName || ""), track: String(data.track || ""), cabinet: String(data.cabinet || ""), layer: Number(data.layer || 0), unit: String(data.quantityUnit || ""), kind: String(data.inventoryKind || "stock") };
    })));
    const stopLayout = onSnapshot(doc(db, "settings", "cabinetLayout"), (snapshot) => {
      const tracks = snapshot.data()?.tracks;
      if (Array.isArray(tracks) && tracks.length) setLayout(tracks.map((item) => ({ name: String(item.name), cabinets: Array.isArray(item.cabinets) ? item.cabinets.map(String) : [], layers: Number(item.layers) || 10 })));
    });
    return () => { stopReport(); stopDrugs(); stopLayout(); };
  }, []);

  const preview = useMemo(() => rows.length && start && end ? summarizeConsumption(rows, start, end) : [], [rows, start, end]);
  const previewCount = useMemo(() => rows.filter((row) => row.date >= start && row.date <= end).length, [rows, start, end]);
  const drugMap = useMemo(() => indexConsumptionDrugs(drugs), [drugs]);
  const selectedTrack = layout.find((item) => item.name === track) ?? layout[0];
  const selectedCabinet = selectedTrack?.cabinets.includes(cabinet) ? cabinet : selectedTrack?.cabinets[0] ?? "";
  const selectedLayer = layer <= (selectedTrack?.layers ?? 0) ? layer : 1;
  const located = (report?.items ?? []).map((item) => ({ ...item, drug: drugMap.get(item.code) })).filter((item) => item.drug && item.drug.kind !== "non-stock" && item.drug.track && item.drug.cabinet && item.drug.layer > 0);
  const unmatched = (report?.items ?? []).filter((item) => !drugMap.has(item.code));
  const unplaced = (report?.items ?? []).filter((item) => { const drug = drugMap.get(item.code); return drug && (drug.kind === "non-stock" || !drug.track || !drug.cabinet || drug.layer <= 0); });
  const cabinetItems = located.filter((item) => item.drug?.track === selectedTrack?.name && item.drug.cabinet === selectedCabinet);
  const layerItems = cabinetItems.filter((item) => item.drug?.layer === selectedLayer);

  async function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file) return;
    setRows([]); setFileName(""); setMessage("");
    try {
      const result = parseConsumptionFile(await file.arrayBuffer());
      const dates = result.rows.map((row) => row.date).sort();
      setRows(result.rows); setFileName(file.name); setSkipped(result.skipped);
      setStart(dates[0]); setEnd(dates[dates.length - 1]);
    } catch (error) { setMessage(error instanceof Error ? error.message : "無法讀取檔案。"); }
  }

  async function save() {
    if (!db || !preview.length || start > end) return;
    setBusy(true); setMessage("");
    try {
      await setDoc(doc(db, "settings", "consumptionReport"), { fileName, startDate: start, endDate: end, rowCount: previewCount, items: preview, updatedAt: new Date().toISOString() } satisfies ConsumptionReport);
      setRows([]); setFileName(""); setMessage("已取代前次統計資料。");
    } catch { setMessage("儲存失敗，前次統計資料仍保留。請確認本機服務仍在執行且資料夾可寫入。"); }
    finally { setBusy(false); }
  }

  async function clear() {
    if (!db || !window.confirm("確定刪除目前的用藥消耗統計？")) return;
    setBusy(true); setMessage("");
    try { await deleteDoc(doc(db, "settings", "consumptionReport")); setMessage("已刪除統計資料。"); }
    catch { setMessage("刪除失敗，請確認本機服務仍在執行且資料夾可寫入。"); }
    finally { setBusy(false); }
  }

  return <main className="min-h-screen bg-slate-50 text-slate-900">
    <header className="border-b border-slate-200 bg-white px-4 py-4 sm:px-6"><div className="mx-auto flex max-w-7xl items-center justify-between gap-3"><div><p className="text-sm font-semibold text-slate-600">離線單機版 · 藥品地圖</p><h1 className="text-xl font-bold">區間用藥消耗</h1></div><Link href="/" className="min-h-11 rounded-xl border border-slate-300 px-4 py-2 font-semibold">返回地圖</Link></div></header>
    <div className="mx-auto grid max-w-7xl gap-5 p-4 sm:p-6 lg:grid-cols-[340px_minmax(0,1fr)]">
      <section className="hidden space-y-5 lg:block" aria-label="匯入明細">
        <div className={card}><h2 className="text-lg font-bold">上傳調劑明細</h2><p className="mt-2 text-sm leading-6 text-slate-600">選擇系統匯出的 Excel 或 CSV。僅按藥品代碼彙總數量；身分證號和姓名不會儲存。</p><label className="mt-4 flex min-h-24 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-4 text-center font-semibold hover:border-slate-500 focus-within:ring-4 focus-within:ring-slate-200">選擇明細檔案<input type="file" accept=".xls,.xlsx,.csv" onChange={selectFile} className="sr-only" /></label>
          {rows.length > 0 && <div className="mt-4 space-y-3"><p className="break-all text-sm font-semibold">{fileName}</p><p className="text-sm text-slate-600">可讀取 {rows.length} 列；略過 {skipped} 列。</p><div className="grid grid-cols-2 gap-3"><label className="text-sm font-semibold">起日<input type="date" value={start} onChange={(event) => setStart(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-2" /></label><label className="text-sm font-semibold">迄日<input type="date" value={end} onChange={(event) => setEnd(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-2" /></label></div><p className="text-sm">區間內 <b>{previewCount}</b> 列，<b>{preview.length}</b> 種藥品。</p><button onClick={save} disabled={busy || !preview.length || start > end} className="min-h-11 w-full rounded-xl bg-slate-900 px-4 font-semibold text-white disabled:opacity-40">{busy ? "儲存中…" : "取代前次統計"}</button><p className="text-xs leading-5 text-slate-600">儲存後，這份統計會取代前一次上傳的資料。</p></div>}
        </div>
        <div className={card}><h2 className="text-lg font-bold">目前統計</h2>{report ? <><p className="mt-2 break-all text-sm">{report.fileName}</p><p className="mt-2 text-sm text-slate-600">{report.startDate} 至 {report.endDate} · {format(report.rowCount)} 列 · {report.items.length} 種藥品</p><button onClick={clear} disabled={busy} className="mt-4 min-h-11 rounded-xl border border-red-300 px-4 font-semibold text-red-700 hover:bg-red-50 disabled:opacity-40">刪除目前資料</button></> : <p className="mt-2 text-sm text-slate-600">尚未上傳統計資料。</p>}</div>
        {message && <p role="status" className="rounded-xl border border-slate-300 bg-white p-4 text-sm">{message}</p>}
      </section>
      <section className="space-y-5" aria-label="藥櫃消耗檢視">
        <div className={card}><h2 className="text-lg font-bold">單一藥櫃逐層檢視</h2><p className="mt-1 text-sm text-slate-600">先選軌道和藥櫃，再選層數查看藥品用量。</p><div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-sm font-semibold">軌道<select value={selectedTrack?.name ?? ""} onChange={(event) => { setTrack(event.target.value); setCabinet(""); setLayer(1); }} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3">{layout.map((item) => <option key={item.name}>{item.name}</option>)}</select></label><label className="text-sm font-semibold">藥櫃<select value={selectedCabinet} onChange={(event) => { setCabinet(event.target.value); setLayer(1); }} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3">{selectedTrack?.cabinets.map((item) => <option key={item}>{item}</option>)}</select></label></div><div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">{Array.from({ length: selectedTrack?.layers ?? 0 }, (_, index) => index + 1).map((number) => { const count = cabinetItems.filter((item) => item.drug?.layer === number).length; return <button key={number} onClick={() => setLayer(number)} aria-pressed={selectedLayer === number} className={`min-h-14 rounded-xl border px-2 py-2 text-sm font-semibold focus:outline-none focus:ring-4 focus:ring-slate-300 ${selectedLayer === number ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white hover:bg-slate-100"}`}>第 {number} 層<span className="block text-xs font-normal">{count} 種藥品</span></button>; })}</div></div>
        <div className={card}><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm font-semibold text-slate-600">{selectedTrack?.name} · {selectedCabinet} 櫃</p><h2 className="text-xl font-bold">第 {selectedLayer} 層</h2></div><p className="text-sm text-slate-600">{layerItems.length} 種藥品</p></div>{layerItems.length ? <ul className="mt-4 divide-y divide-slate-200">{layerItems.sort((a, b) => b.quantity - a.quantity).map((item) => <li key={item.code} className="flex justify-between gap-4 py-3"><div className="min-w-0"><p className="font-semibold">{item.drug?.name || item.code}</p><p className="text-sm text-slate-600">{item.code}</p></div><b className="shrink-0 text-lg">{format(item.quantity)} {item.drug?.unit}</b></li>)}</ul> : <p className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">{report ? "此層在本次區間沒有消耗明細。" : "上傳明細後即可查看各層消耗量。"}</p>}</div>
        {report && <div className={`${card} hidden lg:block`}><h2 className="text-lg font-bold">對應狀態</h2><p className="mt-2 text-sm text-slate-600">已定位 {located.length} 種 · 未上架或少用藥品 {unplaced.length} 種 · 找不到健保碼 {unmatched.length} 種</p>{unmatched.length > 0 && <details className="mt-3"><summary className="cursor-pointer font-semibold">查看找不到的健保碼</summary><ul className="mt-2 max-h-48 overflow-y-auto text-sm">{unmatched.map((item) => <li key={item.code} className="border-b border-slate-100 py-2">{item.code} · {format(item.quantity)}</li>)}</ul></details>}</div>}
      </section>
    </div>
  </main>;
}

