/**
 * Add pictures to the board background library (lib/background-library.ts).
 *
 * Put the originals in backgrounds-src/, one subfolder per category — the
 * folder name is the category the editor groups them under, and the file name
 * is the picture's name:
 *
 *   backgrounds-src/Shabbos/Candles at dusk.jpg
 *   backgrounds-src/Yom Tov/Sukkah lights.png
 *
 * then run `npm run backgrounds`. Each picture becomes two WebP files in
 * public/backgrounds/ — the picture (fitted inside 3840×2160, the size of a 4K
 * TV, never enlarged) and a 480px thumbnail for the editor — named with a
 * content hash, and an entry in the catalogue with its measured brightness,
 * which decides whether a board's text turns light on it. JPEG, PNG, WebP,
 * AVIF, TIFF and HEIC (where the local sharp build supports it) all work.
 *
 * Re-running is safe: an unchanged picture keeps its entry; a changed one gets
 * new files and the old ones are removed. Entries whose original is no longer
 * in backgrounds-src/ are KEPT (the originals don't have to live in the repo);
 * to remove a picture, delete its entry and its two files.
 *
 * Options (for tests): --src <dir> --public <dir> --catalogue <file>
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import sharp from "sharp";

const root = resolve(import.meta.dirname, "..");
const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 ? resolve(process.argv[at + 1]) : fallback;
};
const SRC = arg("src", join(root, "backgrounds-src"));
const PUBLIC = arg("public", join(root, "public", "backgrounds"));
const CATALOGUE = arg("catalogue", join(root, "lib", "background-library.ts"));
const URL_BASE = "/backgrounds";

const MAX = { width: 3840, height: 2160 };
const THUMB_WIDTH = 480;
const PICTURE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif", ".tif", ".tiff", ".heic", ".heif"]);

const MARK = /\/\* BEGIN LIBRARY \*\/([\s\S]*?)\/\* END LIBRARY \*\//;

function readCatalogue() {
  const source = readFileSync(CATALOGUE, "utf8");
  const match = MARK.exec(source);
  if (!match) throw new Error(`${CATALOGUE} has no BEGIN/END LIBRARY markers.`);
  return { source, entries: JSON.parse(match[1].trim() || "[]") };
}

function writeCatalogue(source, entries) {
  entries.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  const json = JSON.stringify(entries, null, 2);
  writeFileSync(CATALOGUE, source.replace(MARK, `/* BEGIN LIBRARY */ ${json} /* END LIBRARY */`));
}

const slug = (text) =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "picture";

/** Sentence case from a file name: "candles_at-dusk" → "Candles at dusk". */
const nameFrom = (file) => {
  const words = basename(file, extname(file)).replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

function pictures(dir) {
  if (!existsSync(dir)) return [];
  const found = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...pictures(path));
    else if (PICTURE_EXTENSIONS.has(extname(entry).toLowerCase())) found.push(path);
  }
  return found.sort();
}

/** Average relative luminance, 0–1, the same formula the editor uses. */
async function luminanceOf(buffer) {
  const { data } = await sharp(buffer).resize(32, 32, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let total = 0;
  for (let i = 0; i < data.length; i += 3) {
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]].map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    total += 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  return total / (data.length / 3);
}

const files = pictures(SRC);
if (files.length === 0) {
  console.log(`No pictures in ${relative(root, SRC) || SRC}. Put them in category folders there, then run this again.`);
  process.exit(0);
}

mkdirSync(PUBLIC, { recursive: true });
const { source, entries } = readCatalogue();
const byId = new Map(entries.map((entry) => [entry.id, entry]));
const usedIds = new Set();

for (const file of files) {
  const rel = relative(SRC, file);
  const category = rel.includes("/") ? rel.split("/")[0] : "Other";
  const name = nameFrom(file);
  let id = slug(`${category}-${name}`);
  for (let n = 2; usedIds.has(id); n += 1) id = slug(`${category}-${name}-${n}`);
  usedIds.add(id);

  let picture;
  let thumb;
  try {
    const input = sharp(readFileSync(file)).rotate(); // honour EXIF orientation; output carries no metadata
    picture = await input
      .clone()
      .resize({ ...MAX, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82, effort: 5 })
      .toBuffer({ resolveWithObject: true });
    thumb = await input.clone().resize({ width: THUMB_WIDTH }).webp({ quality: 70 }).toBuffer();
  } catch (error) {
    console.log(`  skipped  ${rel} — ${error.message}`);
    continue;
  }

  const hash = createHash("sha256").update(picture.data).digest("hex").slice(0, 10);
  const pictureFile = `${id}-${hash}.webp`;
  const thumbFile = `${id}-${hash}-thumb.webp`;
  const previous = byId.get(id);
  const src = `${URL_BASE}/${pictureFile}`;

  if (previous && previous.src === src) {
    console.log(`  same     ${rel}`);
    continue;
  }
  if (previous) {
    for (const old of [previous.src, previous.thumb]) rmSync(join(PUBLIC, basename(old)), { force: true });
  }

  writeFileSync(join(PUBLIC, pictureFile), picture.data);
  writeFileSync(join(PUBLIC, thumbFile), thumb);
  const luminance = Number((await luminanceOf(picture.data)).toFixed(4));
  byId.set(id, {
    id,
    name,
    category,
    tone: luminance > 0.18 ? "light" : "dark",
    luminance,
    src,
    thumb: `${URL_BASE}/${thumbFile}`,
    width: picture.info.width,
    height: picture.info.height,
  });
  console.log(
    `  ${previous ? "updated" : "added  "}  ${rel} → ${pictureFile} (${picture.info.width}×${picture.info.height}, ${Math.round(picture.data.length / 1024)} KB)`,
  );
}

writeCatalogue(source, [...byId.values()]);
console.log(`\n${byId.size} pictures in the library.`);
