"use client";

import { useEffect, useMemo, useState } from "react";
import { NhiCatalog, NhiDrug, searchNhi } from "../lib/nhi-catalog";
import { getNhiCodeBase } from "../lib/nhi-code";

export default function NhiDrugPicker({ onSelect, existingBases }: { onSelect: (drug: NhiDrug, syncedAt: string) => void; existingBases: Set<string> }) {
 const [catalog, setCatalog] = useState<NhiCatalog | null>(null);
 const [query, setQuery] = useState("");
 const [error, setError] = useState("");
 const [retry, setRetry] = useState(0);
 const [selectedCode, setSelectedCode] = useState("");
 useEffect(() => {
  const controller = new AbortController();
  setError("");
  fetch('/data/nhi-drugs.json', { signal: controller.signal }).then(async response => {
   if (!response.ok) throw Error();
   const data = await response.json();
   if (!Array.isArray(data.drugs) || !data.drugs.length) throw Error();
   setCatalog(data);
  }).catch(error => { if (error.name !== 'AbortError') setError('無法載入官方藥品資料，請重試或手動填寫下方欄位。'); });
  return () => controller.abort();
 }, [retry]);
 const results = useMemo(() => searchNhi(catalog?.drugs ?? [], query), [catalog, query]);
 return <section className="rounded-2xl border border-slate-200 bg-white p-5">
  <h2 className="text-lg font-bold">搜尋健保藥品並帶入資料</h2>
  <label className="mt-3 block text-sm font-semibold">健保碼或中英文藥名<input className="control" value={query} onChange={e => setQuery(e.target.value)} placeholder="輸入至少 2 個字元" /></label>
  <div className="mt-2 text-sm text-slate-600" role="status">{error ? <>{error}<button type="button" className="ml-2 min-h-11 rounded-lg border px-3" onClick={() => setRetry(n => n + 1)}>重試</button></> : catalog ? <>資料來源：<a className="underline" href="https://data.gov.tw/dataset/23715" target="_blank" rel="noreferrer">健保署開放資料</a> · 同步於 {new Date(catalog.syncedAt).toLocaleDateString('zh-TW')}</> : '正在載入官方藥品資料…'}</div>
  {catalog && query.trim().length >= 2 && <><p className="mt-3 text-sm text-slate-600">找到 {results.length} 筆{results.length > 40 && '，顯示前 40 筆，請增加關鍵字縮小範圍'}。{results.length > 3 && '可向下捲動查看其他品項。'}</p><div key={query} role="region" aria-label="官方藥品搜尋結果" tabIndex={0} className="mt-2 max-h-[31rem] space-y-2 overflow-y-auto overscroll-contain rounded-xl focus-visible:outline-2 focus-visible:outline-slate-700">{results.slice(0, 40).map(drug => {
   const exists = existingBases.has(getNhiCodeBase(drug.nhiCode));
   return <article key={drug.nhiCode} className="flex h-40 items-center gap-3 rounded-xl border border-slate-200 p-3"><div className="min-w-0 flex-1"><p className="font-bold">{drug.nhiCode}</p><h3 className="line-clamp-2 font-semibold" title={drug.chineseName}>{drug.chineseName || drug.englishName}</h3><p className="truncate text-sm text-slate-600" title={drug.englishName}>{drug.englishName}</p><p className="truncate text-sm text-slate-600" title={drug.manufacturer}>{drug.dosageForm} · {drug.manufacturer}</p></div><button type="button" disabled={exists} onClick={() => { onSelect(drug, catalog.syncedAt); setSelectedCode(drug.nhiCode); }} className="min-h-11 shrink-0 rounded-xl border border-slate-300 px-3 text-sm font-semibold hover:bg-slate-100 disabled:opacity-50">{exists ? '已建檔' : selectedCode === drug.nhiCode ? '已帶入' : '帶入資料'}</button></article>;
  })}</div>{!results.length && <p className="mt-3 text-sm text-slate-600">查無資料，請更換關鍵字或手動填寫。</p>}</>}
 </section>;
}
