/**
 * Lets a Node test import modules written for the bundler: `@/…` resolves to
 * the repo root, and an extensionless import finds its `.ts` (or folder
 * `index.ts`), the way Next resolves them. Type-only imports never reach it —
 * `--experimental-strip-types` erases them first.
 *
 * Used as: node --import ./scripts/alias-loader.mjs …
 */
import { existsSync, statSync } from "node:fs";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

if (!globalThis.__aliasLoaderRegistered) {
  globalThis.__aliasLoaderRegistered = true;
  register(import.meta.url, pathToFileURL("./"));
}

const ROOT = new URL("../", import.meta.url);

function withExtension(url) {
  const path = fileURLToPath(url);
  if (existsSync(path) && statSync(path).isFile()) return url;
  for (const candidate of [".ts", ".tsx", "/index.ts"]) {
    if (existsSync(path + candidate)) return new URL(url.href + candidate);
  }
  return url;
}

export async function resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) {
    return next(withExtension(new URL(specifier.slice(2), ROOT)).href, context);
  }
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
    return next(withExtension(new URL(specifier, context.parentURL)).href, context);
  }
  return next(specifier, context);
}
