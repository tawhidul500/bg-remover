"use client";
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2 } from "lucide-react";
import { MAX_BATCH } from "@/lib/config";
import { ingestFile, pendingFiles } from "@/lib/ingest";
import { setMeta } from "@/lib/storage";
import UploadDrop from "./UploadDrop";

/**
 * Saves the chosen image(s) to IndexedDB *before* navigating, so the editor opens with the
 * image already loaded. An in-memory handoff would be lost during the page change.
 */
export default function LandingUpload() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  const onFiles = useCallback(async (files: File[]) => {
    const list = files.slice(0, MAX_BATCH);
    setErrors([]);
    setBusy(list.length > 1 ? `Preparing ${list.length} images…` : `Preparing ${list[0].name}…`);
    const problems: string[] = [];
    let firstId: string | null = null;
    let storageFailed = false;

    for (const f of list) {
      try {
        const { project, bitmap, saveError } = await ingestFile(f);
        bitmap.close();
        if (saveError) storageFailed = true;
        if (!firstId) firstId = project.id;
      } catch (err) {
        problems.push(err instanceof Error ? err.message : String(err));
      }
    }

    if (!firstId) { setBusy(null); setErrors(problems); return; }
    if (storageFailed) {
      // Storage unavailable (e.g. private mode): fall back to handing the files over in memory.
      pendingFiles.splice(0, pendingFiles.length, ...list);
    } else {
      await setMeta("active", firstId).catch(() => {});
    }
    setErrors(problems);
    router.push("/editor");
  }, [router]);

  if (busy) {
    return (
      <div className="rounded-2xl border-2 border-dashed border-brand/30 bg-white p-10 text-center" role="status" aria-live="polite">
        <Loader2 className="mx-auto mb-3 animate-spin text-brand" size={32} />
        <p className="font-medium text-ink-2">{busy}</p>
        <p className="mt-1 text-sm text-muted">Checking the file and opening the editor.</p>
      </div>
    );
  }

  return (
    <div>
      <UploadDrop onFiles={onFiles} />
      {errors.length > 0 && (
        <ul className="mt-3 space-y-1.5" role="alert">
          {errors.map((e, i) => (
            <li key={i} className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-danger">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />{e}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
