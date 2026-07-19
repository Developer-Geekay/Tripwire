// Script library storage. IndexedDB (not chrome.storage) per the plan:
// scripts, and later runs + screenshots, with JSON export/import for
// git-ability.

export interface ScriptRecord {
  id: string;
  name: string;
  code: string;
  createdAt: number;
  updatedAt: number;
}

export interface ScriptExport {
  version: 1;
  scripts: Array<{ name: string; code: string }>;
}

const DB_NAME = "tripwire";
const DB_VERSION = 1;
const STORE = "scripts";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function store(mode: IDBTransactionMode): Promise<IDBObjectStore> {
  const db = await openDb();
  return db.transaction(STORE, mode).objectStore(STORE);
}

export async function listScripts(): Promise<ScriptRecord[]> {
  const all = await requestToPromise((await store("readonly")).getAll() as IDBRequest<ScriptRecord[]>);
  return all.sort((a, b) => a.name.localeCompare(b.name));
}

export async function putScript(record: ScriptRecord): Promise<void> {
  await requestToPromise((await store("readwrite")).put(record));
}

export async function deleteScript(id: string): Promise<void> {
  await requestToPromise((await store("readwrite")).delete(id));
}

export function createScript(name: string, code: string): ScriptRecord {
  const now = Date.now();
  return { id: crypto.randomUUID(), name, code, createdAt: now, updatedAt: now };
}

export function uniqueName(base: string, taken: Iterable<string>): string {
  const names = new Set(taken);
  if (!names.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base} (${i})`;
    if (!names.has(candidate)) return candidate;
  }
}

export function exportScripts(scripts: ScriptRecord[]): ScriptExport {
  return { version: 1, scripts: scripts.map(({ name, code }) => ({ name, code })) };
}

export function parseImport(json: string): Array<{ name: string; code: string }> {
  const data = JSON.parse(json) as Partial<ScriptExport>;
  if (data.version !== 1 || !Array.isArray(data.scripts)) {
    throw new Error("Not a Tripwire script export (expected { version: 1, scripts: [...] })");
  }
  return data.scripts.map((s, i) => {
    if (typeof s?.name !== "string" || typeof s?.code !== "string") {
      throw new Error(`Malformed script entry at index ${i}`);
    }
    return { name: s.name, code: s.code };
  });
}
