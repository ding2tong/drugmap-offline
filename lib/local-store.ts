// Local HTTP adapter: all records are persisted by the loopback-only Node server.
type Data = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Ref = { collection: string; id?: string; filters?: Filter[] };
type Filter = { field: string; value?: unknown; order?: boolean };
type State = { revision: string; collections: Record<string, Record<string, Data>> };
type Operation = Ref & { type: string; data?: Data; merge?: boolean };
export const db = {};
export const collection = (_db: object, name: string): Ref => ({ collection: name });
export function doc(parent: object | Ref, name?: string, id?: string): Ref {
  return 'collection' in parent ? { collection: (parent as Ref).collection, id: name || crypto.randomUUID() } : { collection: name!, id: id! };
}
export const where = (field: string, operator: string, value: unknown): Filter => { if (operator !== '==') throw Error('不支援的條件'); return { field, value }; };
export const orderBy = (field: string): Filter => ({ field, order: true });
export const query = (ref: Ref, ...filters: Filter[]): Ref => ({ ...ref, filters });
async function request(path: string, body?: unknown) {
  const response = await fetch(`/api/${path}`, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw Object.assign(Error(value.error || '本機資料存取失敗'), { status: response.status });
  return value;
}
function snapshot(ref: Ref, state: State) {
  const records = state.collections[ref.collection] || {};
  const item = (id: string) => ({ id, ref: { collection: ref.collection, id }, data: (): Data => records[id], exists: () => Object.hasOwn(records, id) });
  let docs = Object.keys(records).map(item);
  for (const filter of ref.filters || []) {
    if (filter.order) docs = docs.sort((a, b) => a.data()[filter.field] > b.data()[filter.field] ? 1 : a.data()[filter.field] < b.data()[filter.field] ? -1 : 0);
    else docs = docs.filter(d => d.data()[filter.field] === filter.value);
  }
  return { ...item(ref.id || ''), docs, size: docs.length, empty: docs.length === 0 };
}
const listeners = new Set<() => void>();
export function onSnapshot(ref: Ref, next: (value: ReturnType<typeof snapshot>) => void, error?: (error: Error) => void) {
  let active = true; let running = false;
  const refresh = async () => { if (running) return; running = true; try { const state = await request('state'); if (active) next(snapshot(ref, state)); } catch (e) { if (active) error?.(e as Error); } finally { running = false; } };
  listeners.add(refresh); void refresh(); const timer = setInterval(refresh, 2000);
  return () => { active = false; listeners.delete(refresh); clearInterval(timer); };
}
export const getDoc = async (ref: Ref) => snapshot(ref, await request('state'));
export const getDocs = getDoc;
async function commit(operations: Operation[], revision?: string) { await request('commit', { operations, revision }); listeners.forEach(refresh => refresh()); }
export const setDoc = (ref: Ref, data: Data, options?: { merge?: boolean }) => commit([{ ...ref, type: 'set', data, merge: options?.merge }]);
export const updateDoc = (ref: Ref, data: Data) => commit([{ ...ref, type: 'update', data }]);
export const deleteDoc = (ref: Ref) => commit([{ ...ref, type: 'delete' }]);
export async function addDoc(ref: Ref, data: Data) { const target = doc(ref); await setDoc(target, data); return target; }
export function writeBatch(_db: object) { // eslint-disable-line @typescript-eslint/no-unused-vars
  const operations: Operation[] = [];
  return { set: (ref: Ref, data: Data, options?: { merge?: boolean }) => { operations.push({ ...ref, type: 'set', data, merge: options?.merge }); }, update: (ref: Ref, data: Data) => { operations.push({ ...ref, type: 'update', data }); }, delete: (ref: Ref) => { operations.push({ ...ref, type: 'delete' }); }, commit: () => commit(operations) };
}
export async function runTransaction(_db: object, work: (transaction: { get: typeof getDoc; set: (ref: Ref, data: Data) => void }) => Promise<void>) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const state = await request('state'); const operations: Operation[] = [];
    await work({ get: async ref => snapshot(ref, state), set: (ref, data) => { operations.push({ ...ref, type: 'set', data }); } });
    try { await commit(operations, state.revision); return; } catch (error) { if ((error as { status?: number }).status !== 409 || attempt === 4) throw error; }
  }
}
