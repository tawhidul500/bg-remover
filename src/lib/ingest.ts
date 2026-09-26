import { DEFAULT_WORKING_SIDE, MAX_OUTPUT_PIXELS } from "./config";
import { sanitizeName } from "./encode";
import { fitDims } from "./imageops";
import { putAsset, saveProject } from "./storage";
import { defaultState, newId, SCHEMA_VERSION, type Project } from "./types";
import { validateAndDecode } from "./validate";

/** Files handed from the landing page to the editor during client-side navigation. */
export const pendingFiles: File[] = [];

export async function ingestFile(file: File, signal?: AbortSignal): Promise<{ project: Project; bitmap: ImageBitmap; blob: Blob; saveError: string | null }> {
  const dec = await validateAndDecode(file, signal);
  const { width, height } = fitDims(dec.width, dec.height, DEFAULT_WORKING_SIDE, MAX_OUTPUT_PIXELS);
  const id = newId();
  const assetId = newId();
  const name = sanitizeName(file.name);
  const project: Project = {
    schemaVersion: SCHEMA_VERSION, id, name, createdAt: Date.now(), updatedAt: Date.now(), originalAssetId: assetId,
    original: { name: file.name, type: dec.type, size: file.size, width: dec.width, height: dec.height },
    maskInputKey: null, model: null, state: defaultState(width, height, `${name}-edited`),
  };
  if (signal?.aborted) { dec.bitmap.close(); throw new DOMException("Cancelled", "AbortError"); }
  // Immutable copy of the original bytes; never modified afterwards.
  const blob = file.slice(0, file.size, dec.type);
  let saveError: string | null = null;
  try {
    await putAsset(assetId, blob);
    await saveProject(project, { auto: null, current: null, width, height });
  } catch (e) {
    saveError = e instanceof Error ? e.message : String(e);
  }
  return { project, bitmap: dec.bitmap, blob, saveError };
}
