"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { collection, deleteDoc, doc, onSnapshot, setDoc, runTransaction } from "../../lib/local-store";
import AdminGuard from "../admin-guard";
import { db } from "../../lib/local-store";
import { CabinetTrack, defaultLayout } from "../../lib/cabinet-layout";
import { getNhiCodeBase } from "../../lib/nhi-code";
import { ConsumptionItem, ConsumptionReport, ConsumptionRow, parseConsumptionFile, summarizeConsumption, indexConsumptionDrugs } from "../../lib/consumption-report";

type PlacedDrug = { code: string; name: string; track: string; cabinet: string; layer: number; unit: string; kind: string };
const format = (value: number) => new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 4 }).format(value);
const card = "rounded-2xl border border-slate-200 bg-white p-5";

function QuantityButton({ item, name, unit, current, onClick }: { item: ConsumptionItem; name: string; unit: string; current?: number; onClick: () => void }) {
  const short = current !== undefined && current < item.quantity;
  return <button type="button" onClick={onClick} className="flex min-h-16 w-full items-center justify-between gap-4 py-3 text-left hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-slate-200">
    <span className="min-w-0"><span className="block font-semibold">{name || item.code}</span><span className="block text-sm text-slate-600">健保碼 {item.code}</span><span className={`mt-1 block text-sm ${short ? "font-semibold text-red-700" : "text-slate-600"}`}>現場量：{current === undefined ? "待輸入" : format(current)}{short ? " · 需採購" : ""}</span></span>
    <span className="shrink-0 text-right"><span className="block text-sm text-slate-600">需要量</span><b className="text-lg">{format(item.quantity)} {unit}</b></span>
  </button>;
}

function PurchaseList({ items, drugMap, currentQuantities, pendingCount, onOpen }: { items: ConsumptionItem[]; drugMap: Map<string, PlacedDrug>; currentQuantities: Record<string, number>; pendingCount: number; onOpen: (code: string) => void }) {
  const router = useRouter();
  const [transferError, setTransferError] = useState("");
  function transfer() {
    try {
      sessionStorage.setItem("drugmap-consumption-purchase-codes-v1", JSON.stringify(items.map((item) => item.code)));
      router.push("/purchase?source=consumption");
    } catch { setTransferError("無法帶入清單，請確認瀏覽器允許暫存資料後重試。"); }
  }
  return <div className={card}><div className="flex flex-wrap items-end justify-between gap-2"><h2 className="text-lg font-bold">本批採購清單</h2><span className="text-sm text-slate-600">{items.length} 種需採購 · {pendingCount} 種待盤點</span></div>
    {items.length > 0 && <button type="button" onClick={transfer} className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-slate-900 px-4 font-semibold text-white hover:bg-slate-700 focus:outline-none focus:ring-4 focus:ring-slate-300">帶入採購作業</button>}
    {transferError && <p role="alert" className="mt-2 text-sm text-red-700">{transferError}</p>}
    {items.length ? <div className="mt-4 overflow-x-auto"><table className="w-full table-fixed text-left text-xs sm:text-sm"><thead className="border-b border-slate-200 text-slate-600"><tr><th className="w-1/2 p-1 sm:p-2">健保碼／藥品</th><th className="w-1/4 p-1 text-right sm:p-2">現場量</th><th className="w-1/4 p-1 text-right sm:p-2">需要量</th></tr></thead><tbody>{items.map((item) => <tr key={item.code} className="border-b border-slate-100"><td className="break-all p-1 sm:p-2"><button type="button" onClick={() => onOpen(item.code)} className="min-h-11 text-left hover:underline focus:outline-none focus:ring-4 focus:ring-slate-200"><b>{item.code}</b><span className="block text-slate-600">{drugMap.get(item.code)?.name || ""}</span></button></td><td className="p-1 text-right sm:p-2">{format(currentQuantities[item.code])}</td><td className="p-1 text-right font-semibold sm:p-2">{format(item.quantity)}</td></tr>)}</tbody></table></div> : <p className="mt-3 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">{pendingCount ? "目前沒有確認缺貨的藥品；尚有藥品待輸入現場量。" : "目前沒有需要採購的藥品。"}</p>}
  </div>;
}

function AllDrugs({ items, drugMap, currentQuantities, query, setQuery, expanded, onToggle, onOpen }: { items: ConsumptionItem[]; drugMap: Map<string, PlacedDrug>; currentQuantities: Record<string, number>; query: string; setQuery: (value: string) => void; expanded: boolean; onToggle: () => void; onOpen: (code: string) => void }) {
  return <div className={card}><button type="button" onClick={onToggle} aria-expanded={expanded} className="flex min-h-11 w-full items-center justify-between text-left text-lg font-bold focus:outline-none focus:ring-4 focus:ring-slate-200">全部藥品盤點<span aria-hidden="true">{expanded ? "收起" : "展開"}</span></button>{expanded && <><p className="mt-1 text-sm text-slate-600">未在目前藥櫃的藥品，也可以在這裡輸入現場量。</p><label className="mt-4 block text-sm font-semibold">搜尋健保碼或藥品名稱<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3" /></label><p className="mt-3 text-sm text-slate-600">顯示 {items.length} 種藥品</p><ul className="mt-2 max-h-80 divide-y divide-slate-200 overflow-y-auto">{items.map((item) => <li key={item.code}><QuantityButton item={item} name={drugMap.get(item.code)?.name || ""} unit={drugMap.get(item.code)?.unit || ""} current={Object.prototype.hasOwnProperty.call(currentQuantities, item.code) ? currentQuantities[item.code] : undefined} onClick={() => onOpen(item.code)} /></li>)}</ul></>}</div>;
}

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
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [quantityInput, setQuantityInput] = useState("");
  const [quantityError, setQuantityError] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [drugQuery, setDrugQuery] = useState("");
  const quantityDialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (selectedCode && !quantityDialog.current?.open) quantityDialog.current?.showModal();
    if (!selectedCode && quantityDialog.current?.open) quantityDialog.current.close();
  }, [selectedCode]);

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
  const currentQuantities = report?.currentQuantities ?? {};
  const hasCurrent = (code: string) => Object.prototype.hasOwnProperty.call(currentQuantities, code);
  const purchaseItems = (report?.items ?? []).filter((item) => hasCurrent(item.code) && currentQuantities[item.code] < item.quantity);
  const pendingCount = (report?.items ?? []).filter((item) => !hasCurrent(item.code)).length;
  const selectedItem = report?.items.find((item) => item.code === selectedCode);
  const visibleDrugs = (report?.items ?? []).filter((item) => {
    const drug = drugMap.get(item.code);
    const query = drugQuery.trim().toLowerCase();
    return !query || item.code.toLowerCase().includes(query) || drug?.name.toLowerCase().includes(query);
  });

  function openQuantity(code: string) {
    setSelectedCode(code);
    setQuantityInput(hasCurrent(code) ? String(currentQuantities[code]) : "");
    setQuantityError("");
  }

  async function saveQuantity() {
    if (!db || !selectedCode || !selectedItem) return;
    const quantity = Number(quantityInput);
    if (!quantityInput.trim() || !Number.isFinite(quantity) || quantity < 0) {
      setQuantityError("請輸入 0 或正數作為現場量。");
      return;
    }
    setBusy(true); setQuantityError("");
    try {
      await runTransaction(db, async (transaction) => {
        const ref = doc(db, "settings", "consumptionReport");
        const latest = await transaction.get(ref);
        const data = latest.data() as ConsumptionReport | undefined;
        if (!data || data.updatedAt !== report?.updatedAt || !data.items.some(item => item.code === selectedCode)) throw Error("統計已更新，請重新選取藥品。");
        transaction.set(ref, { ...data, currentQuantities: { ...data.currentQuantities, [selectedCode]: quantity } });
      });
      quantityDialog.current?.close(); setSelectedCode(null);
      setMessage(quantity < selectedItem.quantity ? "現場量不足，已加入採購清單。" : "現場量已儲存。" );
    } catch (error) { setQuantityError(error instanceof Error && error.message.startsWith("統計已更新") ? error.message : "儲存失敗，請確認本機服務仍在執行後重試。"); }
    finally { setBusy(false); }
  }

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
      await setDoc(doc(db, "settings", "consumptionReport"), { fileName, startDate: start, endDate: end, rowCount: previewCount, items: preview, currentQuantities: {}, updatedAt: new Date().toISOString() } satisfies ConsumptionReport);
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
        <div className={card}><h2 className="text-lg font-bold">單一藥櫃逐層檢視</h2><p className="mt-1 text-sm text-slate-600">先選軌道和藥櫃，再用左右按鈕逐層查看藥品用量。</p><div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-sm font-semibold">軌道<select value={selectedTrack?.name ?? ""} onChange={(event) => { setTrack(event.target.value); setCabinet(""); setLayer(1); }} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3">{layout.map((item) => <option key={item.name}>{item.name}</option>)}</select></label><label className="text-sm font-semibold">藥櫃<select value={selectedCabinet} onChange={(event) => { setCabinet(event.target.value); setLayer(1); }} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3">{selectedTrack?.cabinets.map((item) => <option key={item}>{item}</option>)}</select></label></div><div className="mt-4 flex items-center gap-3"><button type="button" onClick={() => setLayer(selectedLayer - 1)} disabled={selectedLayer <= 1} aria-label="上一層" className="min-h-12 min-w-12 rounded-xl border border-slate-300 bg-white px-3 text-xl font-bold hover:bg-slate-100 focus:outline-none focus:ring-4 focus:ring-slate-300 disabled:cursor-not-allowed disabled:opacity-40">←</button><div aria-live="polite" className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-center"><p className="text-lg font-bold">第 {selectedLayer} 層 <span className="text-sm font-normal text-slate-600">／ 共 {selectedTrack?.layers ?? 0} 層</span></p><p className="text-sm text-slate-600">{layerItems.length} 種藥品</p></div><button type="button" onClick={() => setLayer(selectedLayer + 1)} disabled={selectedLayer >= (selectedTrack?.layers ?? 0)} aria-label="下一層" className="min-h-12 min-w-12 rounded-xl border border-slate-300 bg-white px-3 text-xl font-bold hover:bg-slate-100 focus:outline-none focus:ring-4 focus:ring-slate-300 disabled:cursor-not-allowed disabled:opacity-40">→</button></div></div>
        <div className={card}><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm font-semibold text-slate-600">{selectedTrack?.name} · {selectedCabinet} 櫃</p><h2 className="text-xl font-bold">第 {selectedLayer} 層</h2></div><p className="text-sm text-slate-600">{layerItems.length} 種藥品</p></div>{layerItems.length ? <ul className="mt-4 divide-y divide-slate-200">{layerItems.sort((a, b) => b.quantity - a.quantity).map((item) => <li key={item.code}><QuantityButton item={item} name={item.drug?.name || ""} unit={item.drug?.unit || ""} current={hasCurrent(item.code) ? currentQuantities[item.code] : undefined} onClick={() => openQuantity(item.code)} /></li>)}</ul> : <p className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">{report ? "此層在本次區間沒有消耗明細。" : "上傳明細後即可查看各層消耗量。"}</p>}</div>
        {report && <><PurchaseList items={purchaseItems} drugMap={drugMap} currentQuantities={currentQuantities} pendingCount={pendingCount} onOpen={openQuantity} /><AllDrugs items={visibleDrugs} drugMap={drugMap} currentQuantities={currentQuantities} query={drugQuery} setQuery={setDrugQuery} expanded={showAll} onToggle={() => setShowAll(!showAll)} onOpen={openQuantity} /></>}
        {report && <div className={`${card} hidden lg:block`}><h2 className="text-lg font-bold">對應狀態</h2><p className="mt-2 text-sm text-slate-600">已定位 {located.length} 種 · 未上架或少用藥品 {unplaced.length} 種 · 找不到健保碼 {unmatched.length} 種</p>{unmatched.length > 0 && <details className="mt-3"><summary className="cursor-pointer font-semibold">查看找不到的健保碼</summary><ul className="mt-2 max-h-48 overflow-y-auto text-sm">{unmatched.map((item) => <li key={item.code} className="border-b border-slate-100 py-2">{item.code} · {format(item.quantity)}</li>)}</ul></details>}</div>}
      </section>
    </div>
    <dialog ref={quantityDialog} onClose={() => setSelectedCode(null)} className="w-[min(92vw,440px)] rounded-2xl border border-slate-200 p-0 shadow-xl backdrop:bg-slate-900/50">
      {selectedItem && <form onSubmit={(event) => { event.preventDefault(); saveQuantity(); }} className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-slate-600">健保碼 {selectedItem.code}</p><h2 className="mt-1 text-xl font-bold">{drugMap.get(selectedItem.code)?.name || "藥品現場量"}</h2></div><button type="button" onClick={() => quantityDialog.current?.close()} aria-label="關閉" className="min-h-11 min-w-11 rounded-lg border border-slate-300 text-lg">×</button></div>
        <p className="mt-4 rounded-xl bg-slate-100 p-3 text-sm">本批需要量：<b>{format(selectedItem.quantity)} {drugMap.get(selectedItem.code)?.unit}</b></p>
        <label className="mt-4 block font-semibold">現場量<input autoFocus type="number" min="0" step="any" inputMode="decimal" value={quantityInput} onChange={(event) => setQuantityInput(event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 px-3 text-lg outline-none focus:ring-4 focus:ring-slate-200" /></label>
        {quantityError && <p role="alert" className="mt-2 text-sm font-semibold text-red-700">{quantityError}</p>}
        <p className="mt-3 text-sm text-slate-600">現場量低於需要量時，會自動列入本批採購清單。</p>
        <button type="submit" disabled={busy} className="mt-5 min-h-12 w-full rounded-xl bg-slate-900 px-4 font-semibold text-white disabled:opacity-40">{busy ? "儲存中…" : "儲存現場量"}</button>
      </form>}
    </dialog>
  </main>;
}
