declare module "upng-js" {
  const UPNG: {
    encode(imgs: ArrayBuffer[], w: number, h: number, cnum: number, dels?: number[]): ArrayBuffer;
    decode(buf: ArrayBuffer): { width: number; height: number; depth: number; ctype: number; frames: unknown[]; tabs: Record<string, unknown>; data: ArrayBuffer };
    toRGBA8(img: unknown): ArrayBuffer[];
  };
  export default UPNG;
}
