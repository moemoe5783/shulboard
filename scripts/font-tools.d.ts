// The two build-time font libraries ship no types; scripts/build-fonts.ts
// only uses a handful of calls from each.
declare module "fontkit" {
  export function create(buffer: Buffer): unknown;
}
declare module "wawoff2" {
  export function decompress(buffer: Uint8Array): Promise<Uint8Array>;
}
