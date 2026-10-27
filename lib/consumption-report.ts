import * as XLSX from "xlsx";
import { getNhiCodeBase } from "./nhi-code";

export type ConsumptionRow = { date: string; code: string; quantity: number };
export type ConsumptionItem = { code: string; quantity: number };
export type ConsumptionReport = { fileName: string; startDate: string; endDate: string; rowCount: number; items: ConsumptionItem[]; currentQuantities?: Record<string, number>; updatedAt: string };

function dateValue(value: unknown): string {
  let year: number, month: number, day: number;
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return "";
    ({ y: year, m: month, d: day } = parsed);
  } else {
    const match = String(value ?? "").trim().match(/^(\d{2,4})[\/-](\d{1,2})[\/-](\d{1,2})/);
    if (!match) return "";
    year = Number(match[1]); month = Number(match[2]); day = Number(match[3]);
    if (year < 1911) year += 1911;
  }
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseConsumptionFile(buffer: ArrayBuffer): { rows: ConsumptionRow[]; skipped: number } {
  // SheetJS logs this warning for an optional record in the pharmacy's legacy XLS export.
  // The sheet data is still readable; keep every other parser error visible.
  const originalError = console.error;
  let workbook: XLSX.WorkBook;
  try {
    console.error = (...args: unknown[]) => {
      if (args.length === 1 && args[0] === "Missing Info for XLS Record 0x27d") return;
      originalError(...args);
    };
    // Keep CSV dates as entered so invalid dates cannot be normalized silently.
    workbook = XLSX.read(buffer, { type: "array", raw: true });
  } finally {
    console.error = originalError;
  }
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("檔案沒有可讀取的工作表。");
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", blankrows: false });
  // The export's stable layout uses A for date, D for NHI drug code, and H for
  // quantity. Chinese headings in legacy XLS files can decode incorrectly.
  const [dateColumn, codeColumn, quantityColumn] = [0, 3, 7];
  const firstDataIndex = grid.findIndex((row) => dateValue(row[dateColumn]) && getNhiCodeBase(String(row[codeColumn] ?? "")) && Number(String(row[quantityColumn] ?? "").replace(/,/g, "")) > 0);
  if (firstDataIndex < 0) throw new Error("A 欄日期、D 欄藥品代碼或 H 欄總量沒有可讀取的資料，請確認檔案格式。");
  let skipped = 0;
  const rows: ConsumptionRow[] = [];
  for (const row of grid.slice(firstDataIndex)) {
    if (row.every((cell) => String(cell ?? "").trim() === "")) continue;
    const date = dateValue(row[dateColumn]);
    const code = getNhiCodeBase(String(row[codeColumn] ?? ""));
    const quantity = Number(String(row[quantityColumn] ?? "").replace(/,/g, ""));
    if (!date || !code || !Number.isFinite(quantity) || quantity <= 0) { skipped++; continue; }
    rows.push({ date, code, quantity });
  }
  if (!rows.length) throw new Error("沒有可統計的明細，請確認日期、藥品代碼和總量。");
  return { rows, skipped };
}

export function summarizeConsumption(rows: ConsumptionRow[], startDate: string, endDate: string): ConsumptionItem[] {
  const totals = new Map<string, number>();
  for (const row of rows) if (row.date >= startDate && row.date <= endDate) totals.set(row.code, (totals.get(row.code) ?? 0) + row.quantity);
  return [...totals].map(([code, quantity]) => ({ code, quantity: Math.round(quantity * 10000) / 10000 })).sort((a, b) => a.code.localeCompare(b.code));
}

// A code may exist in both the dispensing cabinet and non-stock storage.
// Prefer the placed stock record, independently of collection ordering.
export function indexConsumptionDrugs<T extends { code: string; kind: string; track: string; cabinet: string; layer: number }>(drugs: T[]): Map<string, T> {
  const index = new Map<string, T>();
  const priority = (drug: T) => drug.kind === "non-stock" ? 0 : drug.track && drug.cabinet && drug.layer > 0 ? 2 : 1;
  for (const drug of drugs) {
    const previous = index.get(drug.code);
    if (!previous || priority(drug) > priority(previous)) index.set(drug.code, drug);
  }
  return index;
}
