"use client";

/*
 * The collage engine, made visible — the tuning bench the collage spec asks
 * for before any UI polish. Generate a photo set from a mix of aspect ratios,
 * pick a box, and see the pages the engine builds as plain rectangles with
 * their coverage, smallest photo and score. "Run stress test" runs 1,000
 * random albums through full cycles and reports average and worst coverage and
 * the slowest page build, which is how the weights in lib/collage/layout.ts
 * get tuned.
 *
 * A dev reference page, like /zmanim-lab. It imports the same lib/collage the
 * widget does, and the same lib/collage/stress.ts scripts/test-collage.ts
 * asserts against, so the numbers here are the numbers the test checks.
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { Button } from "@/components/Button";
import { Field, SelectField } from "@/components/Field";
import {
  albumVersion,
  aspectOf,
  DEFAULT_WEIGHTS,
  paginate,
  type CollageBox,
  type CollageDensity,
  type CollageLayout,
  type CollagePhoto,
} from "@/lib/collage";
import { createRng } from "@/lib/collage/random";
import { MIXES, randomBox, randomPhotos, runStress, type StressResult } from "@/lib/collage/stress";

const VIEW_WIDTH = 880;
const VIEW_HEIGHT = 520;

/** A shade of the accent per kind of photo, so the mix reads at a glance. */
function kindOf(aspect: number): { label: string; strength: number } {
  if (aspect >= 2.4) return { label: "panorama", strength: 90 };
  if (aspect > 1.1) return { label: "landscape", strength: 60 };
  if (aspect >= 0.9) return { label: "square", strength: 40 };
  if (aspect >= 0.46) return { label: "portrait", strength: 25 };
  return { label: "tall", strength: 75 };
}

type StressRow = { name: string; result: StressResult };

export default function CollageLabPage() {
  const [mix, setMix] = useState("mixed");
  const [count, setCount] = useState(24);
  const [seed, setSeed] = useState(1);
  const [box, setBox] = useState<CollageBox>({ width: 1600, height: 900 });
  const [gap, setGap] = useState(8);
  const [density, setDensity] = useState<CollageDensity>("auto");
  const [exactCount, setExactCount] = useState(6);
  const [minShortPct, setMinShortPct] = useState(12);
  const [weights, setWeights] = useState(DEFAULT_WEIGHTS);
  const [pageIndex, setPageIndex] = useState(0);
  const [override, setOverride] = useState<{ photos: CollagePhoto[]; box: CollageBox } | null>(null);
  const [stress, setStress] = useState<StressRow[] | null>(null);
  const [stressing, setStressing] = useState<string | null>(null);

  const photos = useMemo(
    () => override?.photos ?? randomPhotos(createRng(seed), count, MIXES[mix] ?? MIXES.mixed),
    [override, seed, count, mix],
  );
  const activeBox = override?.box ?? box;
  const options = useMemo(
    () => ({ gap, density, exactCount, minShortFraction: minShortPct / 100, weights }),
    [gap, density, exactCount, minShortPct, weights],
  );

  const pages = useMemo(() => {
    const out: { photos: CollagePhoto[]; layout: CollageLayout; ms: number }[] = [];
    const cycle = paginate(photos, activeBox, options, albumVersion(photos));
    for (;;) {
      const started = performance.now();
      const step = cycle.next();
      const ms = performance.now() - started;
      if (step.done) break;
      out.push({ photos: step.value.photos, layout: step.value.layout, ms });
    }
    return out;
  }, [photos, activeBox, options]);

  const page = pages[Math.min(pageIndex, pages.length - 1)];
  const scale = Math.min(VIEW_WIDTH / activeBox.width, VIEW_HEIGHT / activeBox.height);

  const runAllStress = async () => {
    const rows: StressRow[] = [];
    const runs: [string, (typeof MIXES)[string] | undefined, number][] = [
      ["random mixes", undefined, 1000],
      ...Object.entries(MIXES).map(([name, m]) => [name, m, 150] as [string, (typeof MIXES)[string], number]),
    ];
    for (const [name, m, cases] of runs) {
      setStressing(name);
      // Yield between runs so the page stays responsive and shows progress.
      await new Promise((resolve) => setTimeout(resolve, 0));
      rows.push({ name, result: runStress({ cases, seed: 1, now: () => performance.now(), options, mix: m }) });
      setStress([...rows]);
    }
    setStressing(null);
  };

  const showWorst = (result: StressResult) => {
    if (!result.worstCase) return;
    setOverride({ photos: result.worstCase.photos, box: result.worstCase.box });
    setPageIndex(0);
  };

  const threshold = (minShortPct / 100) * Math.min(activeBox.width, activeBox.height);

  return (
    <main className="bg-paper font-ui min-h-screen p-6">
      <h1 className="text-title text-ink mb-1 font-semibold">Collage lab</h1>
      <p className="text-meta text-ink-soft mb-5 max-w-[720px]">
        Random photo sets through the collage engine. Every rectangle is a photo at its own aspect ratio — nothing is
        cropped — and the gap between them is exact. Tune the weights, then run the stress test.{" "}
        <Link href="/collage-lab/artsy" className="text-verdigris">
          The Artsy style has its own lab
        </Link>
        .
      </p>

      <div className="mb-4 grid max-w-[1200px] grid-cols-6 gap-3">
        <SelectField
          id="mix"
          label="Photo mix"
          value={override ? "worst case" : mix}
          onChange={(event) => {
            setOverride(null);
            setMix(event.target.value);
          }}
        >
          {override && <option value="worst case">Worst case</option>}
          {Object.keys(MIXES).map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </SelectField>
        <Field id="count" label="Photos in album" type="number" min={1} max={80} value={count}
          onChange={(e) => { setOverride(null); setCount(Math.max(1, Number(e.target.value) || 1)); setPageIndex(0); }} />
        <Field id="bw" label="Box width" type="number" min={50} value={activeBox.width}
          onChange={(e) => { setOverride(null); setBox({ ...activeBox, width: Math.max(50, Number(e.target.value) || 50) }); }} />
        <Field id="bh" label="Box height" type="number" min={50} value={activeBox.height}
          onChange={(e) => { setOverride(null); setBox({ ...activeBox, height: Math.max(50, Number(e.target.value) || 50) }); }} />
        <Field id="gap" label="Gap" type="number" min={0} max={60} value={gap}
          onChange={(e) => setGap(Math.max(0, Number(e.target.value) || 0))} />
        <SelectField id="density" label="Density" value={density}
          onChange={(e) => { setDensity(e.target.value as CollageDensity); setPageIndex(0); }}>
          <option value="auto">Auto</option>
          <option value="few">Few (2–4)</option>
          <option value="medium">Medium (4–8)</option>
          <option value="many">Many (8–14)</option>
          <option value="exact">Exact</option>
        </SelectField>
        {density === "exact" && (
          <Field id="exact" label="Photos per page" type="number" min={1} max={14} value={exactCount}
            onChange={(e) => setExactCount(Math.max(1, Math.min(14, Number(e.target.value) || 1)))} />
        )}
        <Field id="minshort" label="Smallest photo, % of box" type="number" min={1} max={50} value={minShortPct}
          onChange={(e) => setMinShortPct(Math.max(1, Number(e.target.value) || 1))} />
        {(Object.keys(weights) as (keyof typeof weights)[]).map((key) => (
          <Field key={key} id={`w-${key}`} label={`Weight: ${key}`} type="number" step={0.05} value={weights[key]}
            onChange={(e) => setWeights({ ...weights, [key]: Number(e.target.value) || 0 })} />
        ))}
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        <Button onClick={() => { setOverride(null); setSeed(seed + 1); setPageIndex(0); }}>New photos</Button>
        <Button onClick={() => { setOverride(null); setBox(randomBox(createRng(seed * 7919 + Date.now()))); setPageIndex(0); }}>
          Random box
        </Button>
        <Button disabled={pageIndex === 0} onClick={() => setPageIndex(pageIndex - 1)}>Previous page</Button>
        <Button disabled={pageIndex >= pages.length - 1} onClick={() => setPageIndex(pageIndex + 1)}>Next page</Button>
        <Button variant="primary" disabled={stressing !== null} onClick={runAllStress}>
          {stressing ? `Running ${stressing}…` : "Run stress test"}
        </Button>
      </div>

      <div className="flex flex-wrap items-start gap-6">
        <div
          className="bg-surface border-rule relative border"
          style={{ width: activeBox.width * scale, height: activeBox.height * scale }}
          data-collage-lab
        >
          {page?.layout.cells.map((cell) => {
            const p = page.photos.find((x) => x.id === cell.photoId)!;
            const aspect = aspectOf(p);
            const kind = kindOf(aspect);
            const small = Math.min(cell.w, cell.h) < threshold;
            return (
              <div
                key={cell.photoId}
                className="text-meta absolute flex items-center justify-center overflow-hidden"
                title={`${kind.label} ${aspect.toFixed(2)}`}
                style={{
                  left: cell.x * scale,
                  top: cell.y * scale,
                  width: cell.w * scale,
                  height: cell.h * scale,
                  background: `color-mix(in srgb, var(--verdigris) ${kind.strength}%, var(--surface))`,
                  color: kind.strength >= 60 ? "var(--surface)" : "var(--ink)",
                  outline: small ? "2px solid var(--offline)" : undefined,
                }}
              >
                {aspect.toFixed(2)}
              </div>
            );
          })}
        </div>

        <div className="min-w-[280px]">
          {page && (
            <dl className="text-cell text-ink mb-4 grid grid-cols-[auto_auto] gap-x-6 gap-y-1">
              <dt className="text-ink-soft">Page</dt>
              <dd className="numeric">{Math.min(pageIndex, pages.length - 1) + 1} of {pages.length}</dd>
              <dt className="text-ink-soft">Photos on page</dt>
              <dd className="numeric">{page.photos.length}</dd>
              <dt className="text-ink-soft">Coverage</dt>
              <dd className="numeric" data-lab-coverage>{(page.layout.coverage * 100).toFixed(1)}%</dd>
              <dt className="text-ink-soft">Smallest photo</dt>
              <dd className="numeric">
                {page.layout.minShortSide.toFixed(0)} ({((page.layout.minShortSide / Math.min(activeBox.width, activeBox.height)) * 100).toFixed(1)}% of box)
              </dd>
              <dt className="text-ink-soft">Score</dt>
              <dd className="numeric">{page.layout.score.toFixed(3)}</dd>
              <dt className="text-ink-soft">Build time</dt>
              <dd className="numeric">{page.ms.toFixed(1)}ms</dd>
            </dl>
          )}
          <p className="text-meta text-ink-soft mb-2">Photos under the smallest size are outlined.</p>
          <table className="text-cell w-full">
            <thead>
              <tr className="text-meta text-ink-soft border-rule-firm border-b text-left">
                <th className="py-1 pr-3 font-normal">Page</th>
                <th className="py-1 pr-3 font-normal">Photos</th>
                <th className="py-1 pr-3 font-normal">Coverage</th>
              </tr>
            </thead>
            <tbody>
              {pages.map((p, i) => (
                <tr key={i} className={`cursor-pointer ${i === pageIndex ? "bg-verdigris-wash" : ""}`} onClick={() => setPageIndex(i)}>
                  <td className="numeric py-1 pr-3">{i + 1}</td>
                  <td className="numeric py-1 pr-3">{p.photos.length}</td>
                  <td className="numeric py-1 pr-3">{(p.layout.coverage * 100).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {stress && (
        <section className="mt-8 max-w-[900px]">
          <h2 className="text-heading text-ink mb-2 font-semibold">Stress test</h2>
          <table className="text-cell w-full" data-lab-stress>
            <thead>
              <tr className="text-meta text-ink-soft border-rule-firm border-b text-left">
                <th className="py-1 pr-3 font-normal">Mix</th>
                <th className="py-1 pr-3 font-normal">Albums</th>
                <th className="py-1 pr-3 font-normal">Pages</th>
                <th className="py-1 pr-3 font-normal">Average coverage</th>
                <th className="py-1 pr-3 font-normal">Worst coverage</th>
                <th className="py-1 pr-3 font-normal">Slowest page</th>
                <th className="py-1 font-normal" />
              </tr>
            </thead>
            <tbody>
              {stress.map(({ name, result }) => (
                <tr key={name} className="border-rule border-b">
                  <td className="py-1 pr-3">{name}</td>
                  <td className="numeric py-1 pr-3">{result.cases}</td>
                  <td className="numeric py-1 pr-3">{result.pages}</td>
                  <td className="numeric py-1 pr-3">{(result.averageCoverage * 100).toFixed(1)}%</td>
                  <td className="numeric py-1 pr-3">{(result.worstCoverage * 100).toFixed(1)}%</td>
                  <td className="numeric py-1 pr-3">{result.slowestPageMs.toFixed(1)}ms</td>
                  <td className="py-1">
                    <button type="button" className="text-verdigris text-meta" onClick={() => showWorst(result)}>
                      Show worst
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}
