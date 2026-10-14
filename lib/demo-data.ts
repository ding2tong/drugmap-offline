export type Drug = { inventoryKind?: string; inventoryLocationId?: string; quantity?: number; quantityUnit?: string; id: string; englishName: string; chineseName: string; nhiCode: string; internalCode: string; inventoryLocation: string; track: string; cabinet: string; layer: number; searchKeywords: string[] };

export const drugs: Drug[] = [
  { id: "drug-001", englishName: "Aspirin", chineseName: "阿斯匹靈", nhiCode: "A123456789", internalCode: "0012345", inventoryLocation: "冷藏庫", track: "前滑軌", cabinet: "A", layer: 3, searchKeywords: ["aspirin", "阿斯匹靈", "a123456789", "0012345"] },
  { id: "drug-002", englishName: "Acetaminophen", chineseName: "普拿疼", nhiCode: "B234567890", internalCode: "0012346", inventoryLocation: "大庫", track: "前滑軌", cabinet: "C", layer: 7, searchKeywords: ["acetaminophen", "普拿疼", "b234567890", "0012346"] },
  { id: "drug-003", englishName: "Amoxicillin", chineseName: "阿莫西林", nhiCode: "C345678901", internalCode: "0012347", inventoryLocation: "管制藥品櫃", track: "後滑軌", cabinet: "B", layer: 2, searchKeywords: ["amoxicillin", "阿莫西林", "c345678901", "0012347"] }
];
