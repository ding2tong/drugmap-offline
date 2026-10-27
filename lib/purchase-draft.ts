import type { SupplierOffer } from "./purchase-search";

export type Supplier = "藥典" | "高一";
export type Line = { id: string; code: string; supplier: Supplier; unit: string; quantity: string; price: string; selectedCode?: string; selectedName?: string; quotedAt?: string; stock?: string; markedInCart?: boolean; cartState?: "pending" | "uncertain" };
export const parseAmount = (value: string) => value.trim() === "" ? null : Number(value);
export const validCode = (code: string) => /^[A-Z0-9]{5,10}$/.test(code);
export const sameSearchCode = (first: string, second: string) => first === second || (first.length === 8 && second.length === 10 && second.startsWith(first)) || (second.length === 8 && first.length === 10 && first.startsWith(second));
export function lineTotal(line: Line): number | null {
  const quantity = parseAmount(line.quantity), price = parseAmount(line.price);
  if (!line.unit.trim() || quantity === null || !Number.isSafeInteger(quantity) || quantity <= 0 || price === null || !Number.isFinite(price) || price < 0 || !/^\d+(?:\.\d{1,2})?$/.test(line.price.trim())) return null;
  const cents = Math.round(price * 100) * quantity;
  return Number.isSafeInteger(cents) ? cents / 100 : null;
}
export function purchaseTotals(lines: Line[]): Record<Supplier, { planned: number; marked: number }> {
  const result: Record<Supplier, { planned: number; marked: number }> = { 藥典: { planned: 0, marked: 0 }, 高一: { planned: 0, marked: 0 } };
  for (const line of lines) {
    const total = lineTotal(line);
    if (total !== null) { result[line.supplier].planned += Math.round(total * 100); if (line.markedInCart === true) result[line.supplier].marked += Math.round(total * 100); }
  }
  for (const supplier of ["藥典", "高一"] as const) { result[supplier].planned /= 100; result[supplier].marked /= 100; }
  return result;
}
export function selectPurchaseOffer(line: Line, supplier: Supplier, offer: SupplierOffer, checkedAt: string): Line {
  const same = line.selectedCode === offer.code && line.selectedName === offer.name && line.supplier === supplier && line.unit === offer.unit;
  return { ...line, supplier, unit: offer.unit, price: String(offer.price), selectedCode: offer.code, selectedName: offer.name, quotedAt: checkedAt, stock: offer.stock, markedInCart: same && Number(line.price) === offer.price ? line.markedInCart : false, quantity: same ? line.quantity : "" };
}
export function mergePurchaseCodes(saved: Line[], raw: string[], createLine: (code: string) => Line) {
  const codes = [...new Set(raw.map((code) => code.trim().toUpperCase()))];
  const valid = codes.filter(validCode);
  const added: Line[] = [];
  for (const code of valid) if (![...added, ...saved].some((line) => sameSearchCode(line.code, code))) added.push(createLine(code));
  return { lines: [...added, ...saved], validCount: valid.length, invalidCount: codes.length - valid.length };
}
