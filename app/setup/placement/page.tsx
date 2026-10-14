"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { collection, updateDoc, doc, onSnapshot } from "../../../lib/local-store";
import { db } from "../../../lib/local-store";
import { CabinetTrack, defaultLayout } from "../../../lib/cabinet-layout";
import AdminGuard from "../../admin-guard";
import { getNhiCodeBase, getNhiDisplayCode, getNhiSearchAliases } from "../../../lib/nhi-code";

type MatchedDrug = {
  id: string;
  chineseName: string;
  englishName: string;
  nhiCode: string;
  nhiCodeBase: string;
  internalCode: string;
  searchKeywords: string[];
};
type StockLocation = { id: string; name: string; active: boolean };

function normalizeSearch(value: string) {
  return value.trim().toLocaleLowerCase("zh-TW");
}

function getSearchValues(drug: MatchedDrug) {
  return [
    drug.chineseName,
    drug.englishName,
    drug.nhiCode,
    drug.nhiCodeBase,
    drug.internalCode,
    ...getNhiSearchAliases([drug.nhiCode]),
    ...drug.searchKeywords,
  ].map(normalizeSearch).filter(Boolean);
}

export default function PlacementPage() { return <AdminGuard><PlacementContent /></AdminGuard>; }

function PlacementContent() {
  const [mode, setMode] = useState<"inventory" | "dispensing">("dispensing");
  const [saving, setSaving] = useState(false);
  const [track, setTrack] = useState("");
  const [cabinet, setCabinet] = useState("");
  const [layer, setLayer] = useState("1");
  const [code, setCode] = useState("");
  const [drugs, setDrugs] = useState<MatchedDrug[]>([]);
  const [drugsLoaded, setDrugsLoaded] = useState(false);
  const [placed, setPlaced] = useState<{ drug: MatchedDrug; position: string; mode: string }[]>([]);
  const [message, setMessage] = useState("");
  const [layout, setLayout] = useState<CabinetTrack[]>([]);
  const [layoutLoaded, setLayoutLoaded] = useState(false);
  const [stockLocations, setStockLocations] = useState<StockLocation[]>([]);
  const [inventoryLocationId, setInventoryLocationId] = useState("");

  useEffect(() => {
    if (!db) return;
    return onSnapshot(doc(db, "settings", "cabinetLayout"), (snapshot) => {
      const tracks = snapshot.data()?.tracks;
      setLayout(Array.isArray(tracks) ? tracks.map((item) => ({ name: String(item.name), cabinets: Array.isArray(item.cabinets) ? item.cabinets.map(String) : [], layers: Number(item.layers) || 10 })) : defaultLayout);
      setLayoutLoaded(true);
    });
  }, []);
  useEffect(() => {
    if (!db) return;
    return onSnapshot(collection(db, "drugs"), (snapshot) => {
      const items = snapshot.docs.filter((item) => item.data().inventoryKind !== "non-stock").map((item) => {
        const data = item.data();
        const rawNhiCode = String(data.nhiCode ?? "");
        const nhiCodeBase = String(data.nhiCodeBase ?? getNhiCodeBase(rawNhiCode));
        return {
          id: item.id,
          chineseName: String(data.chineseName ?? "未命名藥品"),
          englishName: String(data.englishName ?? ""),
          nhiCode: getNhiDisplayCode(rawNhiCode, nhiCodeBase, Array.isArray(data.nhiCodeVariants) ? data.nhiCodeVariants.map(String) : []),
          nhiCodeBase,
          internalCode: String(data.internalCode ?? ""),
          searchKeywords: Array.isArray(data.searchKeywords) ? data.searchKeywords.map(String) : [],
        };
      });
      setDrugs(items);
      setDrugsLoaded(true);
    });
  }, []);
  useEffect(() => {
    if (!db) return;
    return onSnapshot(collection(db, "stock_locations"), (snapshot) => {
      const locations = snapshot.docs.map((item) => ({ id: item.id, name: String(item.data().name ?? "未命名位置"), active: item.data().active !== false })).filter((item) => item.active);
      setStockLocations(locations); setInventoryLocationId((current) => current || locations[0]?.id || "");
    });
  }, []);
  useEffect(() => {
    const validTrack = layout.find(item => item.name === track) ?? layout[0];
    const nextTrack = validTrack?.name ?? "";
    const nextCabinet = validTrack?.cabinets.includes(cabinet) ? cabinet : validTrack?.cabinets[0] ?? "";
    const nextLayer = validTrack && Number.isInteger(Number(layer)) && Number(layer) >= 1 && Number(layer) <= validTrack.layers ? layer : "1";
    if (track !== nextTrack) setTrack(nextTrack);
    if (cabinet !== nextCabinet) setCabinet(nextCabinet);
    if (layer !== nextLayer) setLayer(nextLayer);
  }, [layout, track, cabinet, layer]);
  const activeTrack = layout.find((item) => item.name === track);

  const allMatches = useMemo(() => {
    const search = normalizeSearch(code);
    if (!search) return [];
    return drugs
      .map((drug) => {
        const values = getSearchValues(drug);
        const rank = values.some((value) => value === search)
          ? 0
          : values.some((value) => value.startsWith(search))
            ? 1
            : 2;
        return { drug, rank, matched: values.some((value) => value.includes(search)) };
      })
      .filter((item) => item.matched)
      .sort((a, b) => a.rank - b.rank || a.drug.chineseName.localeCompare(b.drug.chineseName, "zh-TW"))
      .map((item) => item.drug);
  }, [code, drugs]);
  const matches = allMatches.slice(0, 20);

  const position = mode === "inventory" ? stockLocations.find(item => item.id === inventoryLocationId)?.name ?? "請選擇庫存位置" : `${track} ${cabinet}櫃 第 ${layer} 層`;
  function lookup(event: FormEvent) {
    event.preventDefault();
    if (!code.trim()) return;
    setMessage(allMatches.length ? `找到 ${allMatches.length} 筆符合品項，請選擇要掛入的藥品。` : "找不到符合的品項，請調整關鍵字。 ");
  }
  async function place(drug: MatchedDrug) {
    if (!db || saving) return;
    if (mode === "dispensing" && !layoutLoaded) { setMessage("正在載入最新調劑位置，請稍候。"); return; }
    const inventoryLocation = stockLocations.find(item => item.id === inventoryLocationId);
    const selectedTrack = layout.find(item => item.name === track);
    if (mode === "inventory" && !inventoryLocation) { setMessage("請先選擇有效的庫存位置。"); return; }
    if (mode === "dispensing" && (!selectedTrack?.cabinets.includes(cabinet) || !Number.isInteger(Number(layer)) || Number(layer) < 1 || Number(layer) > selectedTrack.layers)) { setMessage("請先選擇有效的調劑位置。"); return; }
    setSaving(true);
    try {
      const fields = mode === "inventory"
        ? { inventoryLocationId: inventoryLocation!.id, inventoryLocation: inventoryLocation!.name }
        : { track, cabinet, layer: Number(layer), placementStatus: "placed" };
      await updateDoc(doc(db, "drugs", drug.id), { ...fields, updatedAt: new Date() });
      setPlaced(items => [{ drug, position, mode }, ...items].slice(0, 8));
      setCode(""); setMessage(`${drug.chineseName} 已儲存${mode === "inventory" ? "庫存" : "調劑"}位置：${position}。`);
    } catch { setMessage("上架失敗，請確認本機服務仍在執行後重試。"); }
    finally { setSaving(false); }
  }

  return <main className="min-h-screen bg-slate-50 text-slate-900"><header className="border-b border-slate-200 bg-white px-4 py-4 sm:px-6"><div className="mx-auto flex max-w-5xl items-center justify-between"><div><p className="text-sm font-semibold text-slate-600">位置優先作業</p><h1 className="text-xl font-bold">上架模式</h1></div><div className="flex gap-2"><Link href="/setup/stock-locations" className="min-h-11 rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold">庫存位置</Link><Link href="/setup/layout" className="min-h-11 rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold">藥櫃設定</Link><Link href="/" className="min-h-11 rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold">返回查詢</Link></div></div></header><div className="mx-auto grid max-w-5xl gap-5 p-4 sm:p-6 lg:grid-cols-[360px_1fr]"><section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="mb-4 grid grid-cols-2 gap-2" aria-label="上架類型">{([{ value: "dispensing", label: "調劑位置上架" }, { value: "inventory", label: "庫存位置上架" }] as const).map(item => <button key={item.value} type="button" disabled={saving} aria-pressed={mode === item.value} onClick={() => { setMode(item.value); setMessage(""); }} className={`min-h-11 rounded-xl border px-3 py-2 text-sm font-semibold disabled:opacity-50 ${mode === item.value ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-700"}`}>{item.label}</button>)}</div><p className="text-sm font-semibold text-slate-600">目前{mode === "inventory" ? "庫存" : "調劑"}上架位置</p><h2 className="mt-1 text-2xl font-bold">{position}</h2><div className="mt-5 grid gap-3">{mode === "inventory" ? <label className="text-sm font-semibold">庫存位置<select disabled={saving} value={inventoryLocationId} onChange={(event) => setInventoryLocationId(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3"><option value="">未設定</option>{stockLocations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label> : <><label className="text-sm font-semibold">區域<select value={track} onChange={(event) => { const name = event.target.value; setTrack(name); setCabinet((layout.find((item) => item.name === name)?.cabinets[0]) ?? ""); setLayer("1"); }} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3">{layout.map((item) => <option key={item.name}>{item.name}</option>)}</select></label><label className="text-sm font-semibold">藥櫃<select value={cabinet} onChange={(event) => setCabinet(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3">{activeTrack?.cabinets.map((item) => <option key={item}>{item}</option>)}</select></label><label className="text-sm font-semibold">層數<select value={layer} onChange={(event) => setLayer(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3">{Array.from({ length: activeTrack?.layers ?? 10 }, (_, index) => index + 1).map((item) => <option key={item}>{item}</option>)}</select></label></>}</div><p className="mt-5 rounded-xl bg-slate-100 p-3 text-sm leading-6 text-slate-700">選好上架類型與位置後，搜尋藥品並點選結果中的「儲存至庫存位置」或「儲存至調劑位置」，即可立即儲存。另一種位置會保留。</p></section><section className="space-y-4"><section className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="text-xl font-bold">搜尋要上架的藥品</h2><p className="mt-1 text-sm leading-6 text-slate-600">可輸入中文名、英文名、健保碼或內碼，輸入時會立即顯示符合品項。</p><form onSubmit={lookup} className="mt-4 flex items-stretch gap-2 sm:gap-3"><label className="sr-only" htmlFor="drug-search">藥品名稱、健保碼或內碼</label><input id="drug-search" autoFocus value={code} onChange={(event) => { setCode(event.target.value); setMessage(""); }} placeholder="輸入名稱、健保碼或內碼" autoComplete="off" className="min-h-12 min-w-0 flex-1 rounded-xl border border-slate-300 px-4 text-base outline-none focus:border-slate-700 focus:ring-4 focus:ring-slate-200"/><button className="min-h-12 shrink-0 whitespace-nowrap rounded-xl bg-slate-900 px-4 font-semibold text-white sm:px-5">搜尋</button></form>{message && <p className="mt-3 rounded-xl bg-slate-100 p-3 text-sm" role="status">{message}</p>}</section>{code.trim() && <section className="rounded-2xl border border-slate-200 bg-white p-5" aria-live="polite"><div className="flex items-center justify-between gap-3"><h2 className="text-lg font-bold">符合品項</h2><span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">{allMatches.length} 筆</span></div>{matches.length > 0 ? <><div className="mt-3 space-y-2">{matches.map((drug) => <button key={drug.id} type="button" disabled={saving} onClick={() => place(drug)} className="flex min-h-16 w-full items-center justify-between gap-4 rounded-xl border border-slate-300 px-4 py-3 text-left transition hover:border-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-slate-200"><span className="min-w-0"><b className="block truncate">{drug.chineseName}</b>{drug.englishName && <span className="mt-0.5 block truncate text-sm text-slate-600">{drug.englishName}</span>}<span className="mt-1 block text-sm text-slate-600">健保碼 {drug.nhiCode || "—"}{drug.internalCode && ` · 內碼 ${drug.internalCode}`}</span></span><span className="w-20 shrink-0 text-center text-sm font-semibold sm:w-auto">{saving ? "儲存中…" : `儲存至${mode === "inventory" ? "庫存" : "調劑"}位置`}</span></button>)}</div>{allMatches.length > 20 && <p className="mt-3 text-sm text-slate-600">符合結果較多，目前顯示前 20 筆，請輸入更多文字縮小範圍。</p>}</> : <p className="mt-3 rounded-xl bg-slate-100 p-4 text-sm text-slate-700">{drugsLoaded ? "找不到符合的品項，請嘗試其他名稱或代碼。" : "正在載入藥品資料…"}</p>}</section>}<section className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="text-lg font-bold">本次已掛入</h2>{placed.length ? <ul className="mt-3 space-y-2">{placed.map(({ drug, position: savedPosition, mode: savedMode }, index) => <li className="rounded-xl bg-slate-100 px-3 py-2 text-sm" key={`${drug.id}-${index}`}><b>{drug.chineseName}</b><span className="ml-2 text-slate-600">{drug.nhiCode}</span><p className="mt-1 text-slate-700">{savedMode === "inventory" ? "庫存" : "調劑"}：{savedPosition}</p></li>)}</ul> : <p className="mt-3 text-sm text-slate-600">尚未掛入藥品。</p>}</section></section></div></main>;
}
