"use client";

import Link from "next/link";
import { ChangeEvent, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { collection, doc, getDocs, writeBatch } from "../../../lib/local-store";
import { db } from "../../../lib/local-store";
import { getNhiCodeBase, getNhiCodeVariants, getNhiDisplayCode, getNhiSearchAliases } from "../../../lib/nhi-code";
import AdminGuard from "../../admin-guard";

type Field = "chineseName" | "nhiCode";
type Row = Record<string, string>;
type ImportAction = "add" | "update" | "skip";

const fields: { key: Field; label: string; required?: boolean; candidates: string[] }[] = [
  { key: "nhiCode", label: "健保代碼", required: true, candidates: ["健保代碼", "健保碼", "健保編號", "藥品代碼", "nhiCode", "NHI Code"] },
  { key: "chineseName", label: "藥品名稱", required: true, candidates: ["藥品名稱", "中文名稱", "中文名", "chineseName", "Chinese Name"] },
];

const emptyMapping = Object.fromEntries(fields.map((field) => [field.key, ""])) as Record<Field, string>;
const normal = (value: string) => value.trim().toLowerCase();
export default function InitialImportPage() { return <AdminGuard><InitialImportContent /></AdminGuard>; }

function InitialImportContent() {
  const [rows, setRows] = useState<Row[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<Field, string>>(emptyMapping);
  const [fileName, setFileName] = useState("");
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [nameOverrides, setNameOverrides] = useState<Record<string, string>>({});
  const [actionOverrides, setActionOverrides] = useState<Record<string, ImportAction>>({});
  const [existingBases, setExistingBases] = useState<Set<string>>(new Set());

  const sourceItems = useMemo(() => rows.map((row, index) => {
    const value = (field: Field) => (row[mapping[field]] ?? "").trim();
    const item = { index, sourceRow: Number(row.__sourceRow || index + 2), chineseName: value("chineseName"), nhiCode: value("nhiCode") };
    const errors = [!item.chineseName && "缺藥品名稱", !item.nhiCode && "缺健保代碼"].filter(Boolean) as string[];
    return { ...item, errors };
  }), [mapping, rows]);
  const prepared = useMemo(() => {
    const grouped = new Map<string, typeof sourceItems>();
    sourceItems.forEach((item) => {
      const key = item.errors.length ? `invalid-${item.index}` : getNhiCodeBase(item.nhiCode);
      grouped.set(key, [...(grouped.get(key) ?? []), item]);
    });
    return [...grouped.entries()].map(([key, items]) => {
      const first = items[0];
      if (first.errors.length) return { ...first, nhiCodeBase: "", variants: [], nameVariants: [], action: "skip" as ImportAction, exists: false };
      const names = new Map<string, number>();
      items.forEach((item) => names.set(item.chineseName, (names.get(item.chineseName) ?? 0) + 1));
      const nameVariants = [...names.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
      const exists = existingBases.has(key);
      const variants = getNhiCodeVariants(items.map((item) => item.nhiCode));
      return { ...first, chineseName: nameOverrides[key] ?? nameVariants[0], nhiCode: getNhiDisplayCode(first.nhiCode, key, variants), nhiCodeBase: key, variants, nameVariants, errors: [] as string[], exists, action: actionOverrides[key] ?? (exists ? "update" : "add") as ImportAction };
    });
  }, [actionOverrides, existingBases, nameOverrides, sourceItems]);
  const validItems = prepared.filter((item) => !item.errors.length);
  const invalidItems = prepared.filter((item) => item.errors.length);
  const importItems = validItems.filter((item) => item.action !== "skip");

  async function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setMessage("");
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false });
    const headerRowIndex = rawRows.findIndex((row) => fields.every((field) => row.some((cell) => field.candidates.some((candidate) => normal(candidate) === normal(String(cell))))));
    if (headerRowIndex < 0) { setRows([]); setHeaders([]); setMessage("找不到健保代碼與藥品名稱的標題列，請確認檔案內容。"); return; }
    const headerCells = rawRows[headerRowIndex].map((cell) => String(cell).trim());
    const importedHeaders = headerCells.filter(Boolean);
    const imported = rawRows.slice(headerRowIndex + 1).map((row, rowIndex) => Object.fromEntries([...headerCells.map((header, columnIndex) => [header, String(row[columnIndex] ?? "")]), ["__sourceRow", String(headerRowIndex + rowIndex + 2)]])).filter((row) => importedHeaders.some((header) => row[header].trim()));
    const autoMapping = Object.fromEntries(fields.map((field) => [field.key, importedHeaders.find((header) => field.candidates.some((candidate) => normal(candidate) === normal(header))) ?? ""])) as Record<Field, string>;
    setRows(imported); setHeaders(importedHeaders); setMapping(autoMapping); setFileName(file.name); setNameOverrides({}); setActionOverrides({});
    if (db) {
      const snapshot = await getDocs(collection(db, "drugs"));
      setExistingBases(new Set(snapshot.docs.map((item) => String(item.data().nhiCodeBase ?? getNhiCodeBase(String(item.data().nhiCode ?? "")))).filter(Boolean)));
    }
  }

  async function save() {
    if (!db || !importItems.length) return;
    const firestore = db;
    setSaving(true); setProgress(0); setMessage("");
    let completed = 0;
    try {
      const batchSize = 400;
      for (let offset = 0; offset < importItems.length; offset += batchSize) {
        const batch = writeBatch(firestore);
        const items = importItems.slice(offset, offset + batchSize);
        items.forEach((item) => {
          const keywords = [item.chineseName, item.nhiCodeBase, ...getNhiSearchAliases(item.variants)].map(normal).filter(Boolean);
          batch.set(doc(firestore, "drugs", `nhi-${item.nhiCodeBase}`), { englishName: "", chineseName: item.chineseName, nhiCode: item.nhiCode, nhiCodeBase: item.nhiCodeBase, nhiCodeVariants: item.variants, internalCode: "", searchKeywords: keywords, updatedAt: new Date() }, { merge: true });
        });
        await batch.commit();
        completed += items.length;
        setProgress(Math.round((completed / importItems.length) * 100));
      }
      setMessage(`已處理 ${importItems.length} 筆藥品，略過 ${validItems.length - importItems.length} 筆。下一步可進入「上架模式」。`);
    } catch {
      setMessage(completed ? `已寫入 ${completed} 筆，後續批次失敗。可修正連線後再次匯入，已完成資料不會重複。` : "無法寫入本機資料，請確認啟動視窗仍在執行且資料夾可寫入。 ");
    } finally { setSaving(false); }
  }

  function downloadErrors() {
    const escape = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
    const csv = ["來源列,健保代碼,藥品名稱,錯誤", ...invalidItems.map((item) => [item.sourceRow, item.nhiCode, item.chineseName, item.errors.join("、")].map(escape).join(","))].join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "藥品匯入錯誤清單.csv"; link.click(); URL.revokeObjectURL(url);
  }

  return <main className="min-h-screen bg-slate-50 text-slate-900"><header className="border-b border-slate-200 bg-white px-4 py-4 sm:px-6"><div className="mx-auto flex max-w-6xl items-center justify-between"><div><p className="text-sm font-semibold text-slate-600">離線單機版</p><h1 className="text-xl font-bold">首次藥品建檔</h1></div><Link className="min-h-11 rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold" href="/">返回查詢</Link></div></header><div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6"><section className="rounded-2xl border border-slate-200 bg-white p-5"><p className="text-sm font-semibold text-slate-600">步驟 1／3</p><h2 className="mt-1 text-xl font-bold">上傳常用藥 Excel</h2><p className="mt-2 text-sm leading-6 text-slate-600">首次資料只需「健保代碼」與「藥品名稱」。支援第一個工作表，欄名可自動辨識或手動調整。</p><label className="mt-4 flex min-h-28 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-4 text-center transition hover:border-slate-500"><span><b>選擇 Excel 檔案</b><br/><span className="text-sm text-slate-600">{fileName || "支援 .xlsx、.xls、.csv"}</span></span><input className="sr-only" type="file" accept=".xlsx,.xls,.csv" onChange={selectFile}/></label></section>
  {headers.length > 0 && <><section className="rounded-2xl border border-slate-200 bg-white p-5"><p className="text-sm font-semibold text-slate-600">步驟 2／3</p><h2 className="mt-1 text-xl font-bold">確認兩個欄位</h2><div className="mt-4 grid gap-3 sm:grid-cols-2">{fields.map((field) => <label key={field.key} className="text-sm font-semibold">{field.label}<span className="ml-1 text-slate-500">必填</span><select value={mapping[field.key]} onChange={(event) => setMapping({ ...mapping, [field.key]: event.target.value })} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 font-normal"><option value="">未對應</option>{headers.map((header) => <option key={header} value={header}>{header}</option>)}</select></label>)}</div><p className="mt-4 rounded-xl bg-slate-100 p-3 text-sm text-slate-700">系統會將尾碼僅差 00／G0 的健保代碼合併成同一藥品，並統一以 G0 顯示；位置、內碼與備註則在「上架模式」或藥品管理內維護。</p></section><section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm font-semibold text-slate-600">步驟 3／3</p><h2 className="mt-1 text-xl font-bold">驗證與寫入</h2></div><div className="text-sm">來源 <b>{sourceItems.length}</b> 列，新增 <b>{validItems.filter((item) => item.action === "add").length}</b> 筆／更新 <b>{validItems.filter((item) => item.action === "update").length}</b> 筆／略過 <b>{validItems.filter((item) => item.action === "skip").length}</b> 筆／錯誤 <b>{invalidItems.length}</b> 筆</div></div>{validItems.length > 0 && <div className="mt-4 rounded-xl border border-slate-300 bg-slate-50 p-4"><h3 className="font-bold">逐筆處理方式</h3><p className="mt-1 text-sm text-slate-600">新藥預設新增，既有藥預設更新名稱與搜尋資料；每一筆都可改為略過，且不會覆蓋已設定的位置。</p><div className="mt-3 max-h-80 space-y-2 overflow-y-auto">{validItems.map((item) => <label className="grid items-center gap-2 rounded-lg bg-white p-3 text-sm sm:grid-cols-[140px_1fr_120px]" key={item.nhiCodeBase}><b>{item.nhiCode}</b><span className="truncate" title={item.chineseName}>{item.chineseName}</span><select value={item.action} onChange={(event) => setActionOverrides({ ...actionOverrides, [item.nhiCodeBase]: event.target.value as ImportAction })} className="min-h-11 rounded-lg border border-slate-300 bg-white px-3">{item.exists ? <option value="update">更新</option> : <option value="add">新增</option>}<option value="skip">略過</option></select></label>)}</div></div>}{prepared.filter((item) => item.nameVariants.length > 1).length > 0 && <div className="mt-4 rounded-xl border border-slate-300 bg-slate-50 p-4"><h3 className="font-bold">名稱寫法待確認</h3><p className="mt-1 text-sm text-slate-600">同一健保主碼出現不同名稱時，預設採用最常見的寫法；可在此改選正式名稱。</p><div className="mt-3 space-y-2">{prepared.filter((item) => item.nameVariants.length > 1).map((item) => <label className="grid gap-2 rounded-lg bg-white p-3 text-sm sm:grid-cols-[140px_1fr]" key={item.nhiCodeBase}><span className="font-semibold">{item.nhiCode}</span><select value={item.chineseName} onChange={(event) => setNameOverrides({ ...nameOverrides, [item.nhiCodeBase]: event.target.value })} className="min-h-11 rounded-lg border border-slate-300 bg-white px-3">{item.nameVariants.map((name) => <option key={name}>{name}</option>)}</select></label>)}</div></div>}<div className="mt-4 overflow-x-auto"><table className="min-w-[720px] w-full text-left text-sm"><thead className="border-b border-slate-200 text-slate-600"><tr><th className="p-2">顯示健保碼</th><th className="p-2">藥品名稱</th><th className="p-2">可搜尋版本</th><th className="p-2">處理方式</th></tr></thead><tbody>{prepared.slice(0, 20).map((item) => <tr className="border-b border-slate-100" key={item.index}><td className="p-2">{item.nhiCode || "—"}</td><td className="p-2">{item.chineseName || "—"}</td><td className="p-2">{item.variants.length || 0} 個</td><td className="p-2">{item.errors.length ? <span className="text-slate-600">{item.errors.join("、")}</span> : <span className="font-semibold text-slate-900">{item.action === "add" ? "新增" : item.action === "update" ? "更新" : "略過"}</span>}</td></tr>)}</tbody></table></div>{prepared.length > 20 && <p className="mt-3 text-sm text-slate-600">僅預覽前 20 筆，共 {prepared.length} 筆。</p>}{invalidItems.length > 0 && <button onClick={downloadErrors} className="mt-4 min-h-11 rounded-xl border border-slate-300 px-4 font-semibold">下載錯誤清單 CSV</button>}{saving && <div className="mt-5" aria-live="polite"><div className="mb-2 flex justify-between text-sm"><span>正在分批寫入資料</span><b>{progress}%</b></div><div className="h-2 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><div className="h-full bg-slate-900 transition-[width]" style={{ width: `${progress}%` }}/></div></div>}<button disabled={!db || !importItems.length || saving} onClick={save} className="mt-5 min-h-11 rounded-xl bg-slate-900 px-5 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">{saving ? `寫入中 ${progress}%` : `處理 ${importItems.length} 筆藥品`}</button>{message && <p className="mt-3 rounded-xl bg-slate-100 p-3 text-sm" role="status">{message}</p>}</section></>}</div></main>;
}
