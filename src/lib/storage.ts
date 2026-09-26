// Local-only persistence in IndexedDB. Nothing here syncs across devices.
import { openDB, type IDBPDatabase } from "idb";
import { SCHEMA_VERSION, type Project } from "./types";
import type { MaskReserve } from "./history";

interface MaskRecord {
  auto: Uint8Array | null; current: Uint8Array | null; width: number; height: number;
  /** Optional because older locally saved projects predate non-destructive trimming. */
  maskReserve?: MaskReserve | null;
  /** Shadow brush edits in canvas space (older records omit these = no erasing). */
  shadowErase?: Uint8Array | null; sew?: number; seh?: number;
}

let dbp: Promise<IDBPDatabase> | null = null;
function db() {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB is unavailable in this browser (private mode?). Projects can't be saved."));
  if (!dbp) {
    dbp = openDB("cutout-studio", 1, {
      upgrade(d) {
        d.createObjectStore("projects", { keyPath: "id" });
        d.createObjectStore("assets");
        d.createObjectStore("masks");
        d.createObjectStore("meta");
      },
    });
  }
  return dbp;
}

export class QuotaError extends Error {}
function wrap(e: unknown): never {
  if (e instanceof DOMException && (e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED")) {
    throw new QuotaError("Browser storage is full. Delete saved projects or free up space; your current edits stay open but aren't saved.");
  }
  throw e instanceof Error ? e : new Error(String(e));
}

export async function putAsset(id: string, blob: Blob) { try { await (await db()).put("assets", blob, id); } catch (e) { wrap(e); } }
export async function getAsset(id: string): Promise<Blob | undefined> { return (await db()).get("assets", id); }

export async function saveProject(p: Project, mask?: MaskRecord) {
  try {
    const d = await db();
    const tx = d.transaction(["projects", "masks"], "readwrite");
    await tx.objectStore("projects").put({ ...p, updatedAt: Date.now() });
    if (mask) await tx.objectStore("masks").put(mask, p.id);
    await tx.done;
  } catch (e) { wrap(e); }
}

export async function loadMasks(id: string): Promise<MaskRecord | undefined> { return (await db()).get("masks", id); }

export async function listProjects(): Promise<Project[]> {
  const all = (await (await db()).getAll("projects")) as Project[];
  return all.filter((p) => p.schemaVersion <= SCHEMA_VERSION).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteProject(p: Project) {
  const d = await db();
  const tx = d.transaction(["projects", "masks", "assets"], "readwrite");
  await tx.objectStore("projects").delete(p.id);
  await tx.objectStore("masks").delete(p.id);
  await tx.objectStore("assets").delete(p.originalAssetId);
  if (p.state.background.image.assetId) await tx.objectStore("assets").delete(p.state.background.image.assetId);
  await tx.done;
}

export async function setMeta<T>(key: string, v: T) { try { await (await db()).put("meta", v, key); } catch (e) { wrap(e); } }
export async function getMeta<T>(key: string): Promise<T | undefined> { try { return (await db()).get("meta", key); } catch { return undefined; } }

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null;
  const e = await navigator.storage.estimate();
  return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
}
