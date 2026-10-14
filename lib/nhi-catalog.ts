export type NhiDrug = { nhiCode: string; chineseName: string; englishName: string; ingredient: string; strength: string; unit: string; manufacturer: string; dosageForm: string; startDate: string; endDate: string };
export type NhiCatalog = { syncedAt: string; drugs: NhiDrug[] };
const normalize = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
export function searchNhi(drugs: NhiDrug[], query: string) {
 const q = normalize(query);
 if (q.length < 2) return [];
 return drugs.filter(d => [d.nhiCode, d.chineseName, d.englishName].some(v => normalize(v).includes(q)))
  .sort((a, b) => Number(normalize(b.nhiCode) === q) - Number(normalize(a.nhiCode) === q) || a.nhiCode.localeCompare(b.nhiCode));
}
