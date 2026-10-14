"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { collection, doc, onSnapshot } from "../lib/local-store";

import Link from "next/link";
import LocationEditor from "./location-editor";
import { Drug } from "../lib/demo-data";
import { db } from "../lib/local-store";
import { CabinetTrack, defaultLayout } from "../lib/cabinet-layout";
import { useUserRole } from "../lib/use-user-role";
import { getNhiCodeVariants, getNhiDisplayCode, getNhiSearchAliases } from "../lib/nhi-code";

const normalize = (value: string) => value.trim().toLowerCase();

function matches(drug: Drug, term: string) {
  const q = normalize(term);
  const track = drug.track.trim();
  const cabinet = drug.cabinet.trim();
  const hasDispensingLocation = Boolean(track && track !== "未設定" && cabinet && cabinet !== "未設定" && Number.isInteger(drug.layer) && drug.layer > 0);
  const storage = drug.inventoryLocation.trim();
  const hasSearchableLocation = drug.inventoryKind === "non-stock"
    ? Boolean(storage && storage !== "未設定")
    : hasDispensingLocation;
  return hasSearchableLocation && drug.searchKeywords.some((keyword) => keyword.includes(q));
}

export default function Home() {
  const [openLocation, setOpenLocation] = useState<{ track: string; cabinet: string; layer: number } | null>(null);
  const locationDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (openLocation && !locationDialog.current?.open) locationDialog.current?.showModal();
  }, [openLocation]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [drugs, setDrugs] = useState<Drug[]>([]);
  const [usingLiveData, setUsingLiveData] = useState(false);
  const [layout, setLayout] = useState<CabinetTrack[]>(defaultLayout);
  const { user, isAdmin, active } = useUserRole();

  useEffect(() => {
    if (!db || !user || !active) return;
    return onSnapshot(collection(db, "drugs"), (snapshot) => {
      const liveDrugs = snapshot.docs.map((document) => {
        const data = document.data();
        const englishName = String(data.englishName ?? "");
        const chineseName = String(data.chineseName ?? "");
        const storedNhiCode = String(data.nhiCode ?? "");
        const storedVariants = Array.isArray(data.nhiCodeVariants) ? data.nhiCodeVariants.map(String) : [];
        const nhiVariants = getNhiCodeVariants([storedNhiCode, ...storedVariants]);
        const nhiCode = getNhiDisplayCode(storedNhiCode, String(data.nhiCodeBase ?? ""), nhiVariants);
        const internalCode = String(data.internalCode ?? "");
        return {
          id: document.id,
          inventoryKind: String(data.inventoryKind ?? "stock"),
          inventoryLocationId: String(data.inventoryLocationId ?? ""),
          quantity: typeof data.quantity === "number" && Number.isFinite(data.quantity) && data.quantity >= 0 ? data.quantity : undefined,
          quantityUnit: String(data.quantityUnit ?? "").trim(),
          englishName,
          chineseName,
          nhiCode,
          internalCode,
          inventoryLocation: String(data.inventoryLocation ?? data.inventoryLocationId ?? "未設定"),
          track: String(data.track ?? "未設定"),
          cabinet: String(data.cabinet ?? ""),
          layer: Number(data.layer ?? 0),
          searchKeywords: [...new Set([...(Array.isArray(data.searchKeywords) ? data.searchKeywords.map(String) : []), englishName, chineseName, nhiCode, ...getNhiSearchAliases(nhiVariants), String(data.nhiCodeBase ?? ""), internalCode].map(normalize).filter(Boolean))],
        } satisfies Drug;
      });
      setDrugs(liveDrugs);
      setUsingLiveData(true);
    }, () => {
      setUsingLiveData(false);
    });
  }, [active, user]);
  useEffect(() => {
    if (!db || !user) return;
    return onSnapshot(doc(db, "settings", "cabinetLayout"), (snapshot) => {
      const tracks = snapshot.data()?.tracks;
      if (Array.isArray(tracks) && tracks.length) setLayout(tracks.map((item) => ({ name: String(item.name), cabinets: Array.isArray(item.cabinets) ? item.cabinets.map(String) : [], layers: Number(item.layers) || 10 })));
    });
  }, [user]);
  const terms = useMemo(() => query.split(/\r?\n/).map((item) => item.trim()).filter(Boolean), [query]);
  const results = useMemo(() => terms.map((term) => ({ term, items: drugs.filter((drug) => matches(drug, term)) })), [drugs, terms]);
  const foundItems = useMemo(() => results.flatMap((group) => group.items).filter((drug, index, all) => all.findIndex((item) => item.id === drug.id) === index), [results]);
  const selected = foundItems.find((drug) => drug.id === selectedId) ?? foundItems[0] ?? null;

  function search() {
    setSearched(true);
    if (!selectedId) setSelectedId(foundItems[0]?.id ?? null);
  }

  function removeTerm(index: number) {
    setQuery(terms.filter((_, itemIndex) => itemIndex !== index).join("\n"));
  }

  const occupied = useMemo(() => new Set(drugs.filter(drug => drug.track.trim() && drug.cabinet.trim() && Number.isInteger(drug.layer) && drug.layer > 0).map(drug => JSON.stringify([drug.track, drug.cabinet, drug.layer]))), [drugs]);
  const highlighted = new Set(results.flatMap((group) => group.items).map((drug) => `${drug.track}-${drug.cabinet}-${drug.layer}`));

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white px-4 py-4 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4">
          <div><p className="text-sm font-semibold text-slate-600">離線單機版</p><h1 className="text-xl font-bold tracking-tight">藥品地圖</h1></div>
          <div className="flex flex-wrap justify-end items-center gap-2">{isAdmin && <><Link href="/manage/non-stock" className="min-h-11 rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold">少用藥品</Link><Link href="/setup/import" className="min-h-11 rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 focus:outline-none focus:ring-4 focus:ring-slate-200">首次建檔</Link><Link href="/setup/placement" className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 focus:outline-none focus:ring-4 focus:ring-slate-200">上架模式</Link><Link href="/manage/drugs" className="min-h-11 rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700">藥品管理</Link><Link href="/backup" className="min-h-11 rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700">備份與還原</Link></>}<div className="hidden rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm font-medium text-slate-700 2xl:block">{usingLiveData ? "本機資料" : "連接本機中"}</div></div>
        </div>
      </header>
      <div className="mx-auto grid max-w-[1600px] gap-5 p-4 sm:p-6 lg:grid-cols-[minmax(320px,30fr)_minmax(0,70fr)] lg:p-8">
        <section className="space-y-5" aria-label="藥品查詢">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="mb-3"><h2 className="text-lg font-bold">一次查詢多筆藥品</h2><p className="mt-1 text-sm leading-6 text-slate-600">每行一筆，可輸入名稱、健保碼或內碼。</p></div>
            <label className="sr-only" htmlFor="drug-search">藥品清單</label>
            <textarea id="drug-search" value={query} onChange={(event) => { setQuery(event.target.value); setSearched(false); }} onKeyDown={(event) => {
              if (event.key !== "Enter" || event.nativeEvent.isComposing || event.keyCode === 229) return;
              event.preventDefault();
              const input = event.currentTarget;
              const start = input.selectionStart;
              const end = input.selectionEnd;
              const nextQuery = input.value.slice(0, start) + "\n" + input.value.slice(end);
              setQuery(nextQuery);
              setSearched(true);
              const nextTerms = nextQuery.split(/\r?\n/).map(term => term.trim()).filter(Boolean);
              setSelectedId(nextTerms.flatMap(term => drugs.filter(drug => matches(drug, term)))[0]?.id ?? null);
              requestAnimationFrame(() => input.setSelectionRange(start + 1, start + 1));
            }} placeholder="每行輸入一筆藥品資料" className="min-h-36 w-full rounded-xl border border-slate-300 bg-white p-3 text-base outline-none transition focus:border-slate-700 focus:ring-4 focus:ring-slate-200" />
            <div className="mt-3 flex gap-3"><button onClick={search} className="min-h-11 flex-1 rounded-xl bg-slate-900 px-4 font-semibold text-white transition hover:bg-slate-700 focus:outline-none focus:ring-4 focus:ring-slate-300">查詢位置</button><button onClick={() => { setQuery(""); setSelectedId(null); setSearched(false); }} className="min-h-11 rounded-xl border border-slate-300 px-4 font-semibold text-slate-700 transition hover:bg-slate-100 focus:outline-none focus:ring-4 focus:ring-slate-200">清除</button></div>
          </div>
          {searched && <div className="space-y-3" aria-live="polite">
            <div className="flex items-center justify-between px-1"><h2 className="text-lg font-bold">查詢結果</h2><span className="text-sm text-slate-500">{foundItems.length} 筆結果</span></div>
            {foundItems.map((drug) => <button key={drug.id} onClick={() => setSelectedId(drug.id)} className={`w-full rounded-2xl border p-4 text-left transition focus:outline-none focus:ring-4 focus:ring-slate-200 ${selected?.id === drug.id ? "border-slate-800 bg-slate-100" : "border-slate-200 bg-white hover:border-slate-400"}`}>
              <span className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] items-start gap-3">
                <span className="min-w-0 break-words"><span className="block font-bold">健保碼：{drug.nhiCode || "未設定"}</span><span className="mt-1 block font-semibold">{drug.chineseName}</span>{drug.englishName && <span className="mt-1 block text-sm font-normal text-slate-600">{drug.englishName}</span>}{drug.inventoryKind !== "non-stock" && <span className="mt-2 block text-sm text-slate-600">庫存位置：{drug.inventoryLocation.trim() || "未設定"}</span>}</span>
                <span className="min-w-0 break-words text-right"><span className="block text-xl font-bold leading-snug text-slate-900">{drug.inventoryKind === "non-stock" ? drug.inventoryLocation : <>{drug.track}<br/>{drug.cabinet}櫃 第 {drug.layer} 層</>}</span>{drug.inventoryKind === "non-stock" && <><span className="mt-1 block text-sm text-slate-600">少用藥品</span><span className="mt-1 block text-sm font-semibold text-slate-900">數量：{drug.quantity === undefined ? "尚未登記" : `${drug.quantity}${drug.quantityUnit ? ` ${drug.quantityUnit}` : ""}`}</span></>}</span>
              </span>
            </button>)}
            {results.map((group, index) => !group.items.length && <div key={`${group.term}-${index}`} className="rounded-xl border border-slate-300 bg-slate-100 p-3 text-sm text-slate-800"><div className="flex items-center justify-between gap-3"><span>查無資料：{group.term}</span><button onClick={() => removeTerm(index)} className="min-h-11 rounded-lg px-2 font-semibold underline focus:outline-none focus:ring-2 focus:ring-slate-700">移除此項</button></div></div>)}
            {terms.length === 0 && <p className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600">輸入一筆或多筆資料後，按下「查詢位置」。</p>}
          </div>}
        </section>
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6" aria-label="藥櫃地圖">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm font-semibold text-slate-600">即時定位</p><h2 className="text-xl font-bold">調劑位置地圖</h2></div>{selected && <div className="rounded-xl border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-900"><b>{selected.chineseName}</b>：{selected.inventoryKind === "non-stock" ? `少用藥品 · ${selected.inventoryLocation}` : `${selected.track} ${selected.cabinet}櫃 第 ${selected.layer} 層`}</div>}</div>
          <div className="space-y-6 overflow-x-auto pb-2">{layout.map((track) => <div key={track.name}><h3 className="mb-3 font-bold text-slate-800">{track.name}</h3><div className="grid min-w-[580px] gap-3" style={{ gridTemplateColumns: `repeat(${Math.max(track.cabinets.length, 1)}, minmax(132px, 1fr))` }}>{track.cabinets.map((cabinet) => <Cabinet key={cabinet} track={track.name} cabinet={cabinet} layers={track.layers} occupied={occupied} highlighted={highlighted} selected={selected} onOpen={(layer) => setOpenLocation({ track: track.name, cabinet, layer })} />)}</div></div>)}</div>
          <p className="mt-5 text-sm leading-6 text-slate-600">灰色標示代表本次查詢結果；深色框線為目前選取的藥品位置。可點選左側結果切換定位，或點選任一層查看該位置全部藥品。沒有上架藥品的層不顯示。</p>
        </section>
      </div>
      <dialog ref={locationDialog} onClose={() => setOpenLocation(null)} aria-labelledby="location-drugs-title" className="fixed inset-0 m-auto max-h-[85dvh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 shadow-xl backdrop:bg-slate-900/40">
        {openLocation && <>
          <div className="flex items-start justify-between gap-3"><h2 id="location-drugs-title" className="text-xl font-bold">{openLocation.track} {openLocation.cabinet}櫃 第 {openLocation.layer} 層</h2><button type="button" autoFocus onClick={() => locationDialog.current?.close()} className="min-h-11 shrink-0 rounded-xl border border-slate-300 px-3 text-sm font-semibold hover:bg-slate-100">關閉</button></div>
          {!usingLiveData && <p className="mt-2 text-sm text-slate-600">尚未讀取本機資料，請確認啟動視窗仍在執行。</p>}
          <LocationDrugs canEdit={isAdmin && usingLiveData} layout={layout} drugs={drugs.filter(drug => drug.track === openLocation.track && drug.cabinet === openLocation.cabinet && drug.layer === openLocation.layer)} />
        </>}
      </dialog>
    </main>
  );
}

function Cabinet({ track, cabinet, layers, occupied, highlighted, selected, onOpen }: { track: string; cabinet: string; layers: number; occupied: Set<string>; highlighted: Set<string>; selected: Drug | null; onOpen: (layer: number) => void }) {
  return <div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><h4 className="mb-3 text-center font-bold">{cabinet} 櫃</h4><div className="space-y-1">{Array.from({ length: layers }, (_, index) => layers - index).filter(layer => occupied.has(JSON.stringify([track, cabinet, layer]))).map((layer) => { const key = `${track}-${cabinet}-${layer}`; const active = highlighted.has(key); const current = selected && key === `${selected.track}-${selected.cabinet}-${selected.layer}`; return <button type="button" key={layer} onClick={() => onOpen(layer)} aria-label={`查看${track} ${cabinet}櫃第 ${layer} 層的藥品`} aria-haspopup="dialog" className={`flex w-full min-h-11 focus-visible:outline-2 focus-visible:outline-slate-700 hover:ring-2 hover:ring-slate-400 items-center justify-between rounded-lg px-3 text-sm font-medium ${current ? "bg-slate-900 text-white ring-2 ring-slate-300" : active ? "bg-slate-200 text-slate-950" : "bg-white text-slate-500"}`}><span>第 {layer} 層</span>{active && <span aria-label="查詢結果位置">●</span>}</button>; })}</div></div>;
}

function LocationDrugs({ drugs, canEdit, layout }: { drugs: Drug[]; canEdit: boolean; layout: CabinetTrack[] }) {
  const [message, setMessage] = useState("");
  return <div className="mt-4">{message && <p role="status" className="mb-3 rounded-xl bg-slate-100 p-3 text-sm">{message}</p>}<p className="text-sm text-slate-600">共 {drugs.length} 筆藥品</p>{drugs.length ? <ul className="mt-3 space-y-3">{[...drugs].sort((a, b) => a.nhiCode.localeCompare(b.nhiCode)).map(drug => <li key={drug.id} className="rounded-xl border border-slate-200 p-3"><p className="font-bold">健保碼：{drug.nhiCode || "未設定"}</p><p className="mt-1 font-semibold">{drug.chineseName}</p>{drug.englishName && <p className="break-words text-sm text-slate-600">{drug.englishName}</p>}<p className="mt-2 text-sm text-slate-600">庫存位置：{drug.inventoryLocation.trim() || "未設定"}</p>{drug.inventoryKind === "non-stock" && <p className="mt-1 text-sm">少用藥品 · 數量：{drug.quantity === undefined ? "尚未登記" : `${drug.quantity} ${drug.quantityUnit ?? ""}`}</p>}{canEdit && <LocationEditor drug={drug} layout={layout} onSaved={setMessage} />}</li>)}</ul> : <p className="mt-3 rounded-xl bg-slate-50 p-4 text-slate-600">這個位置目前沒有上架藥品。</p>}</div>;
}
