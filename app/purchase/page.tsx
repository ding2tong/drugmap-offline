"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AdminGuard from "../admin-guard";
import { addSupplierCart, checkPurchaseBridge, requestSupplierSearch, requestCartTotal, type CartTotalResult, type SearchResult, type SupplierKey, type SupplierOffer } from "../../lib/purchase-search";
import { lineTotal, mergePurchaseCodes, parseAmount, purchaseTotals, sameSearchCode, selectPurchaseOffer, validCode, type Line, type Supplier } from "../../lib/purchase-draft";

const storageKey = "drugmap-purchase-draft-v1";
const money = (n: number) => new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 2 }).format(n);
const input = "min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 focus:outline-none focus:ring-4 focus:ring-slate-200";
const button = "inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold hover:bg-slate-100 focus:outline-none focus:ring-4 focus:ring-slate-200";
const newLine = (code: string): Line => ({ id: crypto.randomUUID(), code, supplier: "藥典", unit: "", quantity: "", price: "" });

export default function PurchasePage() { return <AdminGuard><Content /></AdminGuard>; }

function Content() {
  const [lines, setLines] = useState<Line[]>([]);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [ready, setReady] = useState(false);
  const initialized = useRef(false);
  const [bridge, setBridge] = useState(false);
  const [searching, setSearching] = useState(false);
  const [pendingCodes, setPendingCodes] = useState<string[]>([]);
  const searchLock = useRef(false);
  const cancelSearch = useRef(false);
  const [results, setResults] = useState<Record<string, Partial<Record<SupplierKey, SearchResult>>>>({});
  const [searchProgress, setSearchProgress] = useState("");
  const [staging, setStaging] = useState<string | null>(null);
  const [showAdded, setShowAdded] = useState(false);
  const cartLock = useRef(false);
  const [cartTotals, setCartTotals] = useState<Partial<Record<SupplierKey, CartTotalResult>>>({});
  const [syncing, setSyncing] = useState<Partial<Record<SupplierKey, boolean>>>({});
  const syncRevision = useRef<Record<SupplierKey, number>>({ yudan: 0, gaoi: 0 });
  const syncCart = useCallback(async (supplier: SupplierKey) => {
    const revision = ++syncRevision.current[supplier];
    setSyncing((old) => ({ ...old, [supplier]: true }));
    const result = await requestCartTotal(supplier);
    if (revision !== syncRevision.current[supplier]) return;
    setCartTotals((old) => ({ ...old, [supplier]: result }));
    setSyncing((old) => ({ ...old, [supplier]: false }));
  }, []);
  useEffect(() => { void checkPurchaseBridge().then((connected) => { setBridge(connected); if (connected) { void syncCart("yudan"); void syncCart("gaoi"); } }); }, [syncCart]);
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    let saved: Line[] = [];
    try {
      const raw: unknown = JSON.parse(localStorage.getItem(storageKey) || "[]");
      if (Array.isArray(raw)) saved = raw.filter((line): line is Line => line && typeof line.id === "string" && validCode(line.code) && (line.supplier === "藥典" || line.supplier === "高一") && [line.unit, line.quantity, line.price].every((value: unknown) => typeof value === "string")).map((line) => line.cartState === "pending" ? { ...line, cartState: "uncertain" } : line);
    } catch { setMessage("無法讀取先前的採購草稿，請重新建立。"); }
    if (new URLSearchParams(window.location.search).get("source") === "consumption") {
      window.history.replaceState(null, "", window.location.pathname);
      try {
        const raw: unknown = JSON.parse(sessionStorage.getItem("drugmap-consumption-purchase-codes-v1") || "null");
        if (!Array.isArray(raw) || !raw.every((value) => typeof value === "string")) throw new Error("missing transfer");
        const merged = mergePurchaseCodes(saved, raw, newLine);
        saved = merged.lines;
        const transferred = raw.map((code: string) => code.trim().toUpperCase()).filter(validCode);
        setPendingCodes([...new Set(saved.filter((line) => transferred.some((code: string) => sameSearchCode(line.code, code))).map((line) => line.code))]);
        sessionStorage.removeItem("drugmap-consumption-purchase-codes-v1");
        setMessage(`本批共有 ${merged.validCount} 個有效健保碼；已存在的品項不重複加入。${merged.invalidCount ? ` ${merged.invalidCount} 個代碼格式不符，請回原清單確認。` : ""}`);
      } catch { setMessage("無法帶入區間消耗清單，請回到原頁重新帶入。"); }
    }
    setLines(saved); setReady(true);
  }, []);
  useEffect(() => { if (ready) { try { localStorage.setItem(storageKey, JSON.stringify(lines)); } catch { setMessage("草稿無法儲存於此瀏覽器，請確認瀏覽器儲存空間。"); } } }, [lines, ready]);
  const totals = useMemo(() => purchaseTotals(lines), [lines]);
  function update(id: string, change: Partial<Line>) { setLines((previous) => previous.map((line) => line.id === id ? { ...line, ...change } : line)); }
  const searchCodes = useCallback(async (codes: string[]) => {
    const unique = [...new Set(codes)];
    if (!unique.length || searchLock.current) return;
    searchLock.current = true; cancelSearch.current = false; setSearching(true);
    let done = 0;
    const unavailable: Partial<Record<SupplierKey, SearchResult>> = {};
    try {
      if (!await checkPurchaseBridge()) { setBridge(false); setMessage("尚未連接新版採購查詢工具，請在瀏覽器擴充功能頁重新載入工具，再重新整理中盤與採購頁。"); return; }
      if (cancelSearch.current) return;
      setBridge(true);
      setResults((old) => { const next = { ...old }; for (const code of unique) delete next[code]; return next; });
      for (const code of unique) {
        for (const supplier of ["yudan", "gaoi"] as const) {
          if (cancelSearch.current) { setMessage("已停止後續查詢；尚未完成的品項可再次查詢。"); return; }
          setSearchProgress(`查詢 ${code} · ${supplier === "yudan" ? "藥典" : "高一"}（${done + 1}／${unique.length * 2}）`);
          const result = unavailable[supplier] ?? await requestSupplierSearch(code, supplier);
          if (result.status === "login" || result.status === "unavailable") unavailable[supplier] = result;
          setResults((old) => ({ ...old, [code]: { ...old[code], [supplier]: result } }));
          done++;
          if (!unavailable[supplier]) await new Promise((resolve) => window.setTimeout(resolve, 300));
        }
      }
    } finally { searchLock.current = false; setSearching(false); setSearchProgress(""); }
  }, []);
  useEffect(() => {
    if (!ready || searching || !pendingCodes.length) return;
    const codes = pendingCodes;
    setPendingCodes([]);
    void searchCodes(codes);
  }, [ready, searching, pendingCodes, searchCodes]);
  function selectOffer(id: string, supplier: SupplierKey, offer: SupplierOffer, checkedAt: string) {
    const label = supplier === "yudan" ? "藥典" : "高一";
    setLines((old) => old.map((line) => line.id === id ? selectPurchaseOffer(line, label, offer, checkedAt) : line));
    setMessage(`已選擇 ${offer.code} ${offer.unit}裝；更換品項或包裝時請重新填寫數量。`);
  }
  async function addToCart(line: Line) {
    const quantity = parseAmount(line.quantity), price = parseAmount(line.price);
    if (cartLock.current || staging || line.cartState || line.markedInCart || lineTotal(line) === null || !line.selectedCode || !line.selectedName || !line.quotedAt || quantity === null || !Number.isSafeInteger(quantity) || quantity <= 0 || price === null || !Number.isFinite(price) || price < 0) return;
    cartLock.current = true;
    const snapshot = lines.map((item) => item.id === line.id ? { ...item, cartState: "pending" as const } : item);
    try { localStorage.setItem(storageKey, JSON.stringify(snapshot)); } catch { cartLock.current = false; setMessage("無法保存購物車狀態，未送出加入請求。"); return; }
    setLines(snapshot);
    setStaging(line.id);
    try {
      const result = await addSupplierCart(line.supplier === "藥典" ? "yudan" : "gaoi", { code: line.selectedCode, name: line.selectedName, unit: line.unit, price, stock: line.stock ?? "" }, quantity);
      setLines((old) => old.map((item) => {
        if (item.id !== line.id) return item;
        const unchanged = item.supplier === line.supplier && item.selectedCode === line.selectedCode && item.selectedName === line.selectedName && item.unit === line.unit && item.quantity === line.quantity && item.price === line.price;
        return { ...item, cartState: result.status === "uncertain" || (result.status === "ok" && !unchanged) ? "uncertain" : undefined, markedInCart: result.status === "ok" && unchanged };
      }));
      setMessage(result.message);
      void syncCart(line.supplier === "藥典" ? "yudan" : "gaoi");
    } finally { cartLock.current = false; setStaging(null); }
  }
  function add() {
    const code = query.trim().toUpperCase();
    if (!validCode(code)) { setMessage("請輸入 5 至 10 碼英文字母或數字。"); return; }
    const existing = lines.find((line) => sameSearchCode(line.code, code));
    if (existing) {
      setLines((previous) => [existing, ...previous.filter((line) => line.id !== existing.id)]);
      if (existing.markedInCart) setShowAdded(true);
      setPendingCodes((previous) => [...new Set([...previous, existing.code])]);
      setQuery(""); setMessage("已將清單中的品項移到最前面並重新查詢。若要新增不同包裝，請使用該品項的新增一列按鈕。");
      return;
    }
    setLines((previous) => [newLine(code), ...previous]); setPendingCodes((previous) => [...new Set([...previous, code])]); setQuery(""); setMessage(`已加入 ${code}，正在安排查詢兩家中盤。`);
  }
  function clearPurchaseList() {
    if (!lines.length || searchLock.current || cartLock.current || pendingCodes.length) return;
    if (!window.confirm("確定清除整份採購清單？清除後無法復原，但不會刪除藥典或高一網站購物車的內容。")) return;
    try { localStorage.setItem(storageKey, "[]"); } catch { setMessage("無法儲存清除結果，採購清單尚未清除。"); return; }
    setLines([]); setResults({}); setPendingCodes([]); setShowAdded(false); setMessage("已清除採購清單；中盤網站的購物車不受影響。");
  }
  const hiddenCount = lines.filter((line) => line.markedInCart === true).length;
  useEffect(() => { if (hiddenCount === 0) setShowAdded(false); }, [hiddenCount]);
  const visibleLines = showAdded ? lines : lines.filter((line) => line.markedInCart !== true);
  return <main className="min-h-screen bg-slate-50 text-slate-900">
    <header className="border-b border-slate-200 bg-white px-4 py-4 sm:px-6"><div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-semibold text-slate-600">離線單機版 · 藥品地圖</p><h1 className="text-xl font-bold">採購作業</h1></div><div className="flex flex-wrap gap-2"><Link className={button} href="/purchase/setup">中盤帳號與工具設定</Link><Link className={button} href="/consumption">區間消耗</Link><Link className={button} href="/">返回地圖</Link></div></div></header>
    <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-700">{bridge ? "採購查詢工具已連接。請在同一瀏覽器開啟並登入兩家中盤，再查詢品項。" : "尚未連接單機版採購工具。請先到「中盤帳號與工具設定」依步驟安裝，並在同一個 Chrome 或 Edge 登入兩家中盤。"} 此處小計僅供規劃；中盤可能依商品種類及配送方式另行計算出貨門檻，請核對實際庫存、價格和出貨條件。</div>
      <section className="grid gap-3 sm:grid-cols-2" aria-label="採購金額"><Summary supplier="藥典" total={totals.藥典.planned} minimum={6000} cart={cartTotals.yudan} syncing={!!syncing.yudan} connected={bridge} onSync={() => void syncCart("yudan")}/><Summary supplier="高一" total={totals.高一.planned} minimum={5000} cart={cartTotals.gaoi} syncing={!!syncing.gaoi} connected={bridge} onSync={() => void syncCart("gaoi")}/></section>
      <section className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="text-lg font-bold">新增單品</h2><form onSubmit={(event) => { event.preventDefault(); add(); }} className="mt-3 flex flex-wrap items-end gap-3"><label className="min-w-56 flex-1 text-sm font-semibold">健保碼或片段（至少 5 碼）<input className={`${input} mt-1`} value={query} onChange={(event) => setQuery(event.target.value)} autoCapitalize="characters" placeholder="例如 15078" /></label><button className="min-h-11 rounded-xl bg-slate-900 px-5 font-semibold text-white hover:bg-slate-700">加入並查詢</button></form>{message && <p role="status" className="mt-3 text-sm text-slate-700">{message}</p>}</section>
      <section className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-bold">採購清單</h2><p className="text-sm text-slate-600">共 {lines.length} 列 · 已加入 {hiddenCount} 列 · 草稿保存在目前瀏覽器</p></div><div className="flex flex-wrap gap-2">{searching ? <button type="button" className={button} onClick={() => { cancelSearch.current = true; setSearchProgress("正在停止，請稍候目前的查詢完成…"); }}>停止查詢</button> : <button type="button" className={button} disabled={!lines.length} onClick={() => void searchCodes(lines.map((line) => line.code))}>查詢清單中全部品項</button>}<button type="button" className={button} aria-pressed={showAdded} disabled={!hiddenCount} onClick={() => setShowAdded((value) => !value)}>{showAdded ? "隱藏已加入品項" : `顯示已加入品項（${hiddenCount}）`}</button><button type="button" className={`${button} text-red-700 disabled:cursor-not-allowed disabled:opacity-40`} disabled={!lines.length || searching || !!staging || pendingCodes.length > 0} onClick={clearPurchaseList}>清除整份清單</button></div></div>{searchProgress && <p role="status" className="text-sm text-slate-700">{searchProgress}</p>}
        {lines.length === 0 ? <p className="rounded-2xl border border-slate-200 bg-white p-6 text-slate-600">輸入健保碼，或從區間消耗頁帶入清單。</p> : visibleLines.length === 0 ? <p className="rounded-2xl border border-slate-200 bg-white p-6 text-slate-600">品項都已標記加入購物車；可按「顯示已加入品項」查看。</p> : visibleLines.map((line) => {
          const quantity = parseAmount(line.quantity), subtotal = lineTotal(line);
          const valid = subtotal !== null;
          const yudan = `http://www.yudan.com.tw/yudan_web_wt/index.php?prog=prod_list&get_prod_name=&get_prod_medicine=${encodeURIComponent(line.code)}&get_prod_content=&get_prod_barcode=`;
          const gaoi = `https://www.gaoipharma.com.tw/product.html?keys=${encodeURIComponent(line.code)}`;
          return <article key={line.id} className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-lg font-bold">{line.code}</h3><div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={searching} onClick={() => void searchCodes([line.code])}>查詢兩家</button><a className={button} href={yudan} target="_blank" rel="noopener noreferrer">開啟藥典 ↗</a><a className={button} href={gaoi} target="_blank" rel="noopener noreferrer">開啟高一 ↗</a></div></div>
            {results[line.code] && <div className="mt-4 grid gap-3 md:grid-cols-2">{(["yudan", "gaoi"] as const).map((key) => <Offers key={key} supplier={key} result={results[line.code]?.[key]} onSelect={(offer, checkedAt) => selectOffer(line.id, key, offer, checkedAt)} />)}</div>}
            {line.selectedCode && <p className="mt-3 text-sm text-slate-700">已選：{line.selectedCode} · {line.selectedName}{line.stock ? ` · ${line.stock}` : ""}{line.quotedAt ? ` · 查詢時間 ${new Date(line.quotedAt).toLocaleString("zh-TW")}` : " · 價格已手動修改"}</p>}
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><label className="text-sm font-semibold">中盤<select className={`${input} mt-1`} value={line.supplier} onChange={(e) => update(line.id, { supplier: e.target.value as Supplier, selectedCode: undefined, selectedName: undefined, quotedAt: undefined, stock: undefined, markedInCart: false, quantity: "", price: "", unit: "" })}><option>藥典</option><option>高一</option></select></label><label className="text-sm font-semibold">包裝單位<input className={`${input} mt-1`} value={line.unit} onChange={(e) => update(line.id, { unit: e.target.value, selectedCode: undefined, selectedName: undefined, quotedAt: undefined, stock: undefined, markedInCart: false, quantity: "", price: "" })} placeholder="盒、排或包" /></label><label className="text-sm font-semibold">訂購數量<input className={`${input} mt-1`} type="number" min="1" step="1" value={line.quantity} onChange={(e) => update(line.id, { quantity: e.target.value, markedInCart: false })} /></label><label className="text-sm font-semibold">每單位價格（元）<input className={`${input} mt-1`} type="number" min="0" step="0.01" value={line.price} onChange={(e) => update(line.id, { price: e.target.value, quotedAt: undefined, markedInCart: false })} /></label></div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold">{valid ? `小計 ${money(subtotal)} 元` : "填妥包裝、數量及價格後計入小計"}</p><div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={!bridge || !line.selectedCode || !line.selectedName || !line.quotedAt || !valid || !Number.isSafeInteger(quantity) || !!staging || !!line.cartState || !!line.markedInCart} onClick={() => void addToCart(line)}>{staging === line.id ? "正在加入…" : "加入中盤購物車"}</button><button type="button" className={button} onClick={() => setLines((old) => [...old, newLine(line.code)])}>新增同品項一列</button><button type="button" className={`${button} text-red-700`} disabled={!!staging} onClick={() => setLines((old) => old.filter((item) => item.id !== line.id))} aria-label={`移除 ${line.code} 此列`}>移除</button></div></div>
            {line.cartState === "uncertain" && <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-950"><p>加入結果未確認。請先到中盤購物車核對，避免重複加入。</p><button type="button" className={`${button} mt-2`} onClick={() => update(line.id, { cartState: undefined })}>已核對尚未加入，可重試</button></div>}
            <label className="mt-3 flex min-h-11 items-center gap-2 text-sm font-semibold"><input type="checkbox" className="h-5 w-5" checked={!!line.markedInCart} disabled={!valid || !!staging} onChange={(event) => update(line.id, { markedInCart: event.target.checked, cartState: undefined })} />我已在中盤網站將此列加入購物車</label><p className="text-xs text-slate-600">標記及金額不會自動與中盤購物車同步；送單前請至中盤網站核對。數量須為正整數，價格最多兩位小數。</p>
          </article>;
        })}</section>
    </div>
  </main>;
}

function Summary({ supplier, total, minimum, cart, syncing, connected, onSync }: { supplier: Supplier; total: number; minimum: number; cart?: CartTotalResult; syncing: boolean; connected: boolean; onSync: () => void }) {
  const remaining = cart?.status === "ok" ? Math.max(0, minimum - cart.total) : null;
  return <div className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-bold">{supplier}</h2><button type="button" className={button} disabled={!connected || syncing} onClick={onSync}>{syncing ? "同步中…" : "同步購物車"}</button></div><div aria-live="polite"><p className="mt-2 text-sm text-slate-600">中盤購物車金額</p>{syncing ? <p>正在讀取…</p> : cart?.status === "ok" ? <><p className="text-2xl font-bold">{money(cart.total)} <span className="text-sm font-normal text-slate-600">／ {money(minimum)} 元</span></p><p className="mt-1 text-sm font-semibold">{remaining ? `距離設定金額尚差 ${money(remaining)} 元` : "已達設定金額"}</p><p className="mt-1 text-xs text-slate-600">同步時間 {new Date(cart.checkedAt).toLocaleString("zh-TW")}</p></> : <p className="text-sm text-amber-800">{cart?.message || "尚未同步，請確認工具已連接。"}</p>}</div><p className="mt-3 border-t pt-3 text-sm text-slate-600">採購清單預估金額：{money(total)} 元</p><p className="mt-1 text-xs text-slate-600">在中盤網站修改購物車後，請重新同步；實際訂購條件以中盤為準。</p></div>;
}

function Offers({ supplier, result, onSelect }: { supplier: SupplierKey; result?: SearchResult; onSelect: (offer: SupplierOffer, checkedAt: string) => void }) {
  return <div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><h4 className="font-bold">{supplier === "yudan" ? "藥典" : "高一"}</h4>
    {!result ? <p className="mt-2 text-sm text-slate-600">尚未查詢</p> : result.status !== "ok" ? <p className="mt-2 text-sm text-red-700">{result.message}</p> : <><p className="mt-1 text-xs text-slate-600">查詢時間 {new Date(result.checkedAt).toLocaleString("zh-TW")}</p>{result.paginated && <p className="mt-2 text-sm text-amber-800">結果有多頁，請至中盤網站查看完整結果。</p>}{result.offers.length === 0 ? <p className="mt-2 text-sm text-slate-600">未找到符合代碼的可辨識品項；請至中盤網站確認。</p> : <ul className="mt-2 space-y-2">{result.offers.map((offer, index) => <li key={`${offer.code}-${offer.unit}-${index}`} className="rounded-lg border border-slate-200 bg-white p-3 text-sm"><p className="font-semibold">{offer.name}</p><p className="mt-1 text-slate-600">{offer.code} · {offer.stock || "庫存狀態未標示"}</p><div className="mt-2 flex flex-wrap items-center justify-between gap-2"><b>{money(offer.price)} 元／{offer.unit}</b><button type="button" className={button} onClick={() => onSelect(offer, result.checkedAt)}>選擇此包裝</button></div></li>)}</ul>}</>}
  </div>;
}
