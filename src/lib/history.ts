import type { InputTransform, ProjectState } from "./types";

/** Largest retained input-space mask. Cropping is a view onto this immutable source. */
export interface MaskReserve {
  input: InputTransform;
  current: Uint8Array;
  auto: Uint8Array | null;
}

export interface ShadowEraseSnap {
  data: Uint8Array;
  w: number;
  h: number;
}

export interface Snapshot {
  state: ProjectState;
  mask: Uint8Array | null;
  /** Automatic mask must travel with input transforms so undo and Reset mask stay aligned. */
  autoMask: Uint8Array | null;
  maskInputKey: string | null;
  maskReserve: MaskReserve | null;
  /** Shadow brush edits (canvas space). Null = full shadow, nothing erased. */
  shadowErase: ShadowEraseSnap | null;
  label: string;
}

/** Bounded undo/redo. Mask buffers held here are never mutated (callers copy before painting). */
export class History {
  past: Snapshot[] = [];
  future: Snapshot[] = [];
  constructor(private maxEntries = 80, private maxMaskBytes = 192 * 1024 * 1024) {}

  push(s: Snapshot) {
    this.past.push(s);
    this.future = [];
    this.trim();
  }
  undo(current: Snapshot): Snapshot | null {
    const s = this.past.pop();
    if (!s) return null;
    this.future.push({ ...current, label: s.label });
    return s;
  }
  redo(current: Snapshot): Snapshot | null {
    const s = this.future.pop();
    if (!s) return null;
    this.past.push({ ...current, label: s.label });
    return s;
  }
  clear() { this.past = []; this.future = []; }
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }

  maskBytes(): number {
    const seen = new Set<Uint8Array>();
    let n = 0;
    for (const s of [...this.past, ...this.future]) {
      if (s.mask && !seen.has(s.mask)) { seen.add(s.mask); n += s.mask.byteLength; }
      if (s.autoMask && !seen.has(s.autoMask)) { seen.add(s.autoMask); n += s.autoMask.byteLength; }
      for (const m of [s.maskReserve?.current, s.maskReserve?.auto]) {
        if (m && !seen.has(m)) { seen.add(m); n += m.byteLength; }
      }
      const se = s.shadowErase?.data;
      if (se && !seen.has(se)) { seen.add(se); n += se.byteLength; }
    }
    return n;
  }
  private trim() {
    while (this.past.length > this.maxEntries) this.past.shift();
    while (this.past.length > 1 && this.maskBytes() > this.maxMaskBytes) this.past.shift();
  }
}
