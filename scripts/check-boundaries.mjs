#!/usr/bin/env node
/*
 * Server/client module boundary check.
 *
 * THE BUG THIS EXISTS FOR
 *
 * Every export of a "use client" module becomes a client reference. A server
 * component may render such an export as JSX, or pass it along as a prop — but
 * it may not CALL it or read its value. Do either and the page throws at request
 * time with "Attempted to call X() from the server but X is on the client."
 *
 * Neither `tsc` nor `next build` catches it. TypeScript sees an ordinary import.
 * The build only catches it on routes it prerenders, and every page behind auth
 * is `force-dynamic`, so the failure ships and first appears to whoever signs in.
 *
 * WHAT IT FLAGS
 *
 * A value imported from a "use client" module into a module that is not itself
 * "use client", where the importer mentions that name anywhere other than as a
 * JSX tag. Type-only imports are erased before any of this matters and are
 * ignored.
 *
 * A server module passing a client component around as a bare value — rather
 * than rendering it — is legal RSC and would be flagged here. It has not come up;
 * if it does, that line is the place to widen the rule, not the place to delete
 * it.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOTS = ["app", "components", "lib"];
const EXTENSIONS = [".ts", ".tsx"];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (EXTENSIONS.some((ext) => entry.endsWith(ext))) out.push(full);
  }
  return out;
}

const files = ROOTS.flatMap((r) => walk(join(ROOT, r)));
const source = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));

const isClient = (file) => /^\s*["']use client["'];?\s*$/m.test(source.get(file) ?? "");

/** Resolve an import specifier to a file we know about, or null for a package. */
function resolveImport(fromFile, specifier) {
  let base;
  if (specifier.startsWith("@/")) base = join(ROOT, specifier.slice(2));
  else if (specifier.startsWith(".")) base = resolve(dirname(fromFile), specifier);
  else return null;

  for (const candidate of [
    ...EXTENSIONS.map((ext) => base + ext),
    ...EXTENSIONS.map((ext) => join(base, "index" + ext)),
  ]) {
    if (source.has(candidate)) return candidate;
  }
  return null;
}

const IMPORT = /import\s+([\s\S]*?)\s+from\s+["']([^"']+)["']/g;

/** Local names bound by an import clause, minus anything type-only. */
function importedValues(clause) {
  if (/^type\s/.test(clause.trim())) return [];

  const names = [];
  const braces = clause.match(/\{([\s\S]*)\}/);

  const outside = (braces ? clause.replace(braces[0], "") : clause)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  for (const part of outside) {
    if (part.startsWith("*")) continue; // namespace import; nothing to call directly
    const name = part.replace(/^type\s+/, "").trim();
    if (/^[A-Za-z_$][\w$]*$/.test(name)) names.push(name);
  }

  if (braces) {
    for (const entry of braces[1].split(",")) {
      const trimmed = entry.trim();
      if (!trimmed || /^type\s/.test(trimmed)) continue;
      const local = trimmed.includes(" as ") ? trimmed.split(" as ")[1] : trimmed;
      const name = local.trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.push(name);
    }
  }

  return names;
}

const problems = [];

for (const file of files) {
  if (isClient(file)) continue;
  const text = source.get(file);
  // Comments and quoted strings go first: a component named in a comment or in
  // a table caption is not a use of it. Template literals stay, because
  // `${name}` inside one is a real read. The `[^:]` guard keeps `https://` from
  // being taken for a line comment.
  const withoutImports = text
    .replace(IMPORT, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''");

  for (const match of text.matchAll(IMPORT)) {
    const target = resolveImport(file, match[2]);
    if (!target || !isClient(target)) continue;

    for (const name of importedValues(match[1])) {
      // Every mention outside the import. `<Name` and `</Name` are renders,
      // which are legal; anything else is reading or calling a client
      // reference from the server.
      const uses = [...withoutImports.matchAll(new RegExp(`(.?)\\b${name}\\b`, "g"))];
      const illegal = uses.filter(([, before]) => before !== "<" && before !== "/");
      if (illegal.length === 0) continue;

      const line = text.slice(0, text.indexOf(match[0])).split("\n").length;
      problems.push(
        `${relative(ROOT, file)}:${line}  ${name} is a value from the client module ` +
          `${relative(ROOT, target)} — a server module may render it, not use it.`,
      );
    }
  }
}

if (problems.length > 0) {
  console.error("Server/client boundary problems:\n");
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(
    "\nMove the helper into a module with no \"use client\" directive and import it from there.",
  );
  process.exit(1);
}

console.log(`boundaries ok — ${files.length} files checked`);
