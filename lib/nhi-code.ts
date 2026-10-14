export function normalizeNhiCode(code: string) {
  return code.trim().toUpperCase();
}

export function getNhiCodeBase(code: string) {
  const clean = normalizeNhiCode(code);
  return /(?:00|G0)$/.test(clean) ? clean.slice(0, -2) : clean;
}

export function getNhiCodeVariants(codes: string[]) {
  return [...new Set(codes.map(normalizeNhiCode).filter(Boolean))];
}

export function getNhiSearchAliases(codes: string[]) {
  const originals = getNhiCodeVariants(codes);
  const suffixed = originals.find((code) => /(?:00|G0)$/.test(code));
  if (!suffixed) return originals;
  const base = getNhiCodeBase(suffixed);
  return [...new Set([...originals, `${base}00`, `${base}G0`])];
}

export function getNhiDisplayCode(code: string, base?: string, variants: string[] = []) {
  const allCodes = getNhiCodeVariants([code, ...variants]);
  const g0Code = allCodes.find((item) => /G0$/.test(item));
  if (g0Code) return g0Code;
  const zeroCode = allCodes.find((item) => /00$/.test(item));
  if (zeroCode) return zeroCode;
  return normalizeNhiCode(code) || base?.trim().toUpperCase() || "";
}
