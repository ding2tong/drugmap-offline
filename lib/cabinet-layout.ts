export type CabinetTrack = { name: string; cabinets: string[]; layers: number };

export const defaultLayout: CabinetTrack[] = [
  { name: "前滑軌", cabinets: ["A", "B", "C", "D"], layers: 10 },
  { name: "後滑軌", cabinets: ["A", "B", "C", "D"], layers: 10 },
];
