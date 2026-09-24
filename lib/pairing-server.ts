import "server-only";

import { createHash, randomInt } from "node:crypto";

/** What the server keeps of a device secret: its SHA-256, hex. */
export function hashDeviceSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/** A 6-digit code, leading zeros kept. */
export function newPairingCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}
