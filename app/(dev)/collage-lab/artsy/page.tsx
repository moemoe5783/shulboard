"use client";

/*
 * The Artsy collage, made visible — the tuning bench the Artsy spec asks for
 * (§10) before the look's numbers are locked in.
 *
 * Two views of the same page. Real draws it exactly as a screen does, through
 * the widget's own ArtsyLayer and the player's own artsyCells, so nothing here
 * can drift from what a lobby sees. Debug draws the geometry: image areas as
 * solid rectangles, outer rects as outlines, fasteners as dots — and anything
 * that breaks a hard rule in red. Sliders move the tuning values (tilt,
 * jitter, hero scale, overlap cap); the stress test runs 1,000 random albums
 * through full cycles with those values and reports violations, coverage,
 * overlap and build time — the same lib/collage/artsy/stress.ts the test
 * (scripts/test-collage-artsy.ts) asserts against.
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { Button } from "@/components/Button";
import { Field, SelectField } from "@/components/Field";
import { albumVersion, paginate, type CollageBox, type CollageDensity, type CollagePhoto } from "@/lib/collage";
import {
  ARTSY_PAGINATION,
  artsyEngine,
  artsyViolations,
  corners,
  DEFAULT_ARTSY_TUNING,
  degToRad,
  FRAME_LABELS,
  FRAME_STYLES,
  runArtsyStress,
  type ArtsyLayout,
  type ArtsyOverlap,
  type ArtsyStressResult,
  type ArtsyTilt,
  type FrameStyle,
} from "@/lib/collage/artsy";
import { createRng } from "@/lib/collage/random";
import { MIXES, randomBox, randomPhotos } from "@/lib/collage/stress";
import { backdropStyle } from "@/widgets/collage/artsy-style";
import { ArtsyLayer } from "@/widgets/collage/ArtsyLayer";
import { ARTSY_BACKDROPS, readCollageConfig, type ArtsyBackdrop } from "@/widgets/collage/manifest";
import { artsyCells } from "@/widgets/collage/player";

const VIEW_WIDTH = 880;
const VIEW_HEIGHT = 520;

/** A plain photo of a given shape — board content, so any colour. */
function svgPhoto(width: number, height: number, hue: number): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="100%" height="100%" fill="hsl(${hue} 42% 48%)"/>` +
    `<circle cx="${width / 2}" cy="${height / 2}" r="${Math.min(width, height) / 4}" fill="hsl(${hue} 42% 78%)"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function Slider({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <label className="text-meta text-ink-soft flex flex-col gap-1">
      <span>
        {label} <span className="numeric text-ink">{value.toFixed(2)}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="accent-verdigris" />
    </label>
  );
}

export default function ArtsyLabPage() {
  const [mix, setMix] = useState("mixed");
  const [count, setCount] = useState(18);
  const [seed, setSeed] = useState(1);
  const [box, setBox] = useState<CollageBox>({ width: 1600, height: 900 });
  const [frame, setFrame] = useState<FrameStyle>("mixed");
  const [tilt, setTilt] = useState<ArtsyTilt>("subtle");
  const [overlap, setOverlap] = useState<ArtsyOverlap>("slight");
  const [fasteners, setFasteners] = useState(true);
  const [density, setDensity] = useState<CollageDensity>("auto");
  const [backdrop, setBackdrop] = useState<ArtsyBackdrop>("cork");
  const [view, setView] = useState<"real" | "debug">("real");
  const [tiltScale, setTiltScale] = useState(1);
  const [jitter, setJitter] = useState(DEFAULT_ARTSY_TUNING.jitter);
  const [heroMax, setHeroMax] = useState(DEFAULT_ARTSY_TUNING.heroScale[1]);
  const [overlapCap, setOverlapCap] = useState(DEFAULT_ARTSY_TUNING.overlapCap);
  const [pageIndex, setPageIndex] = useState(0);
  const [override, setOverride] = useState<{ photos: CollagePhoto[]; box: CollageBox } | null>(null);
  const [stress, setStress] = useState<ArtsyStressResult | null>(null);
  const [stressing, setStressing] = useState(false);

  const tuning = useMemo(
    () => ({
      ...DEFAULT_ARTSY_TUNING,
      tiltScale,
      jitter,
      heroScale: [Math.min(DEFAULT_ARTSY_TUNING.heroScale[0], heroMax), heroMax] as [number, number],
      overlapCap,
    }),
    [tiltScale, jitter, heroMax, overlapCap],
  );

  const photos = useMemo(
    () => override?.photos ?? randomPhotos(createRng(seed), count, MIXES[mix] ?? MIXES.mixed),
    [override, seed, count, mix],
  );
  const activeBox = override?.box ?? box;

  const pages = useMemo(() => {
    const engine = artsyEngine({ frame, tilt, overlap, fasteners, tuning });
    const out: { photos: CollagePhoto[]; layout: ArtsyLayout; ms: number }[] = [];
    const cycle = paginate(photos, activeBox, { ...ARTSY_PAGINATION, engine, density }, albumVersion(photos));
    for (;;) {
      const started = performance.now();
      const step = cycle.next();
      const ms = performance.now() - started;
      if (step.done) break;
      out.push({ photos: step.value.photos, layout: step.value.layout as ArtsyLayout, ms });
    }
    return out;
  }, [photos, activeBox, frame, tilt, overlap, fasteners, tuning, density]);

  const index = Math.min(pageIndex, pages.length - 1);
  const page = pages[index];
  const scale = Math.min(VIEW_WIDTH / activeBox.width, VIEW_HEIGHT / activeBox.height);
  const violations = page ? artsyViolations(page.layout, activeBox, tuning.shadowMargin) : null;
  const broken = new Set([...(violations?.images ?? []), ...(violations?.outOfBox ?? []), ...(violations?.fasteners ?? [])]);

  const planned = useMemo(() => {
    if (!page) return null;
    const hues = new Map(photos.map((photo, i) => [photo.id, (i * 47) % 360]));
    const byId = new Map(page.photos.map((photo) => [photo.id, photo]));
    const cells = artsyCells(page.layout, activeBox, (item) => {
      const photo = byId.get(item.photoId)!;
      return { src: svgPhoto(Math.round(photo.width / 4), Math.round(photo.height / 4), hues.get(item.photoId) ?? 0), alt: "" };
    });
    return { key: `lab:${index}`, cycle: 0, index, photoIds: page.photos.map((photo) => photo.id), cells };
  }, [page, photos, activeBox, index]);

  const config = readCollageConfig({ style: "artsy", artsyFrame: frame, artsyTilt: tilt, artsyOverlap: overlap, artsyBackdrop: backdrop, transition: "none" });

  const runStress = async () => {
    setStressing(true);
    await new Promise((resolve) => setTimeout(resolve, 30));
    setStress(runArtsyStress({ cases: 1000, seed: 42, now: () => performance.now(), tuning }));
    setStressing(false);
  };

  const showWorst = () => {
    if (!stress?.worstCase) return;
    const { layout, box: worstBox, options } = stress.worstCase;
    setOverride({
      photos: layout.items.map((item) => ({ id: item.photoId, width: Math.round(item.image.w * 100), height: Math.round(item.image.h * 100) })),
      box: worstBox,
    });
    if (options.frame) setFrame(options.frame);
    if (options.tilt) setTilt(options.tilt);
    if (options.overlap) setOverlap(options.overlap);
    setPageIndex(0);
  };

  const total = stress ? stress.imageViolations + stress.outOfBox + stress.fastenerViolations + stress.overlapViolations : 0;

  return (
    <main className="bg-paper font-ui min-h-screen p-6">
      <h1 className="text-title text-ink mb-1 font-semibold">Artsy collage lab</h1>
      <p className="text-meta text-ink-soft mb-5 max-w-[760px]">
        Framed, tilted prints through the Artsy engine. Real is exactly what a screen draws; Debug shows the geometry —
        photos as solid blocks, outer rects as outlines, tape and pins as dots, anything breaking a rule in red.{" "}
        <Link href="/collage-lab" className="text-verdigris">
          The Clean collage lab
        </Link>
      </p>

      <div className="mb-4 grid max-w-[1200px] grid-cols-6 gap-3">
        <SelectField id="mix" label="Photo mix" value={override ? "worst case" : mix} onChange={(e) => { setOverride(null); setMix(e.target.value); }}>
          {override && <option value="worst case">Worst case</option>}
          {Object.keys(MIXES).map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </SelectField>
        <Field id="count" label="Photos in album" type="number" min={1} max={80} value={count}
          onChange={(e) => { setOverride(null); setCount(Math.max(1, Number(e.target.value) || 1)); setPageIndex(0); }} />
        <Field id="bw" label="Box width" type="number" min={50} value={activeBox.width}
          onChange={(e) => { setOverride(null); setBox({ ...activeBox, width: Math.max(50, Number(e.target.value) || 50) }); }} />
        <Field id="bh" label="Box height" type="number" min={50} value={activeBox.height}
          onChange={(e) => { setOverride(null); setBox({ ...activeBox, height: Math.max(50, Number(e.target.value) || 50) }); }} />
        <SelectField id="frame" label="Frame" value={frame} onChange={(e) => setFrame(e.target.value as FrameStyle)}>
          {FRAME_STYLES.map((style) => (
            <option key={style} value={style}>{FRAME_LABELS[style]}</option>
          ))}
        </SelectField>
        <SelectField id="tilt" label="Tilt" value={tilt} onChange={(e) => setTilt(e.target.value as ArtsyTilt)}>
          <option value="none">None</option>
          <option value="subtle">Subtle</option>
          <option value="playful">Playful</option>
        </SelectField>
        <SelectField id="overlap" label="Overlap" value={overlap} onChange={(e) => setOverlap(e.target.value as ArtsyOverlap)}>
          <option value="none">None</option>
          <option value="slight">Slight</option>
        </SelectField>
        <SelectField id="density" label="Density" value={density} onChange={(e) => { setDensity(e.target.value as CollageDensity); setPageIndex(0); }}>
          <option value="auto">Auto (3–8)</option>
          <option value="few">Few (2–4)</option>
          <option value="medium">Medium (4–7)</option>
          <option value="many">Many (7–10)</option>
        </SelectField>
        <SelectField id="backdrop" label="Backdrop" value={backdrop} onChange={(e) => setBackdrop(e.target.value as ArtsyBackdrop)}>
          {ARTSY_BACKDROPS.map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </SelectField>
        <label className="text-meta text-ink-soft flex items-end gap-2 pb-2">
          <input type="checkbox" checked={fasteners} onChange={(e) => setFasteners(e.target.checked)} className="accent-verdigris" />
          Tape and pins
        </label>
      </div>

      <div className="mb-4 grid max-w-[1200px] grid-cols-4 gap-4">
        <Slider label="Tilt scale" value={tiltScale} min={0} max={2} step={0.05} onChange={setTiltScale} />
        <Slider label="Jitter" value={jitter} min={0} max={0.15} step={0.005} onChange={setJitter} />
        <Slider label="Hero scale, most" value={heroMax} min={1} max={1.35} step={0.01} onChange={setHeroMax} />
        <Slider label="Overlap cap" value={overlapCap} min={0} max={0.3} step={0.01} onChange={setOverlapCap} />
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        <Button onClick={() => setView(view === "real" ? "debug" : "real")}>{view === "real" ? "Show debug view" : "Show real view"}</Button>
        <Button onClick={() => { setOverride(null); setSeed(seed + 1); setPageIndex(0); }}>New photos</Button>
        <Button onClick={() => { setOverride(null); setBox(randomBox(createRng(seed * 7919 + Date.now()))); setPageIndex(0); }}>Random box</Button>
        <Button disabled={index <= 0} onClick={() => setPageIndex(index - 1)}>Previous page</Button>
        <Button disabled={index >= pages.length - 1} onClick={() => setPageIndex(index + 1)}>Next page</Button>
        <Button variant="primary" busy={stressing} onClick={runStress}>{stressing ? "Running 1,000 albums" : "Run stress test"}</Button>
      </div>

      <div className="flex flex-wrap items-start gap-6">
        <div
          className="border-rule relative overflow-hidden border"
          style={{ width: activeBox.width * scale, height: activeBox.height * scale, containerType: "inline-size" }}
          data-artsy-lab={view}
        >
          {view === "real" && planned && (
            <div className="absolute inset-0" style={backdropStyle(backdrop, config.artsyBackdropColor, activeBox.width)}>
              <ArtsyLayer page={planned} config={config} mode="none" canvas={{ width: activeBox.width }} role="entering" offset={0} />
            </div>
          )}
          {view === "debug" && page && (
            <svg viewBox={`0 0 ${activeBox.width} ${activeBox.height}`} className="bg-surface absolute inset-0 h-full w-full">
              {[...page.layout.items].sort((a, b) => a.zIndex - b.zIndex).map((item) => {
                const angle = degToRad(item.rotation);
                const outer = corners({ cx: item.cx, cy: item.cy, hw: item.outer.w / 2, hh: item.outer.h / 2, angle });
                const lx = item.image.x + item.image.w / 2 - item.outer.w / 2;
                const ly = item.image.y + item.image.h / 2 - item.outer.h / 2;
                const c = Math.cos(angle);
                const s = Math.sin(angle);
                const image = corners({ cx: item.cx + lx * c - ly * s, cy: item.cy + lx * s + ly * c, hw: item.image.w / 2, hh: item.image.h / 2, angle });
                const bad = broken.has(item.photoId);
                const points = (pts: { x: number; y: number }[]) => pts.map((p) => `${p.x},${p.y}`).join(" ");
                return (
                  <g key={item.photoId}>
                    <polygon points={points(outer)} fill="var(--paper)" fillOpacity={0.6} stroke={bad ? "var(--offline)" : "var(--ink-soft)"} strokeWidth={2} />
                    <polygon points={points(image)} fill={bad ? "var(--offline)" : "var(--verdigris)"} fillOpacity={item.hero ? 0.85 : 0.6} />
                    {item.fasteners.map((f, i) => {
                      const fx = f.x + f.w / 2 - item.outer.w / 2;
                      const fy = f.y + f.h / 2 - item.outer.h / 2;
                      return <circle key={i} cx={item.cx + fx * c - fy * s} cy={item.cy + fx * s + fy * c} r={Math.max(4, Math.min(f.w, f.h) / 2)} fill="var(--stale)" />;
                    })}
                  </g>
                );
              })}
            </svg>
          )}
        </div>

        <div className="min-w-[300px]">
          {page && (
            <dl className="text-cell text-ink mb-4 grid grid-cols-[auto_auto] gap-x-6 gap-y-1" data-artsy-lab-stats>
              <dt className="text-ink-soft">Page</dt>
              <dd className="numeric">{index + 1} of {pages.length}</dd>
              <dt className="text-ink-soft">Prints on page</dt>
              <dd className="numeric">{page.photos.length}</dd>
              <dt className="text-ink-soft">Violations</dt>
              <dd className={`numeric ${broken.size ? "text-offline" : ""}`} data-artsy-lab-violations>{broken.size}</dd>
              <dt className="text-ink-soft">Coverage</dt>
              <dd className="numeric">{(page.layout.coverage * 100).toFixed(1)}%</dd>
              <dt className="text-ink-soft">Overlapping pairs</dt>
              <dd className="numeric">{page.layout.overlapPairs}</dd>
              <dt className="text-ink-soft">Largest overlap</dt>
              <dd className="numeric">{(page.layout.maxOverlapOfCap * 100).toFixed(0)}% of the cap</dd>
              <dt className="text-ink-soft">Largest empty square</dt>
              <dd className="numeric">{(page.layout.hole * 100).toFixed(1)}% of the box</dd>
              <dt className="text-ink-soft">Score</dt>
              <dd className="numeric">{page.layout.score.toFixed(3)}</dd>
              <dt className="text-ink-soft">Build time</dt>
              <dd className="numeric" suppressHydrationWarning>{page.ms.toFixed(1)}ms{page.layout.fallback ? ", in-cell fallback" : ""}</dd>
            </dl>
          )}
          {stress && (
            <section data-artsy-lab-stress>
              <h2 className="text-heading text-ink mb-2 font-semibold">Stress test, 1,000 albums</h2>
              <dl className="text-cell text-ink grid grid-cols-[auto_auto] gap-x-6 gap-y-1">
                <dt className="text-ink-soft">Pages</dt>
                <dd className="numeric">{stress.pages}</dd>
                <dt className="text-ink-soft">Violations</dt>
                <dd className={`numeric ${total ? "text-offline" : ""}`}>{total}</dd>
                <dt className="text-ink-soft">Average coverage</dt>
                <dd className="numeric">{(stress.averageCoverage * 100).toFixed(1)}%</dd>
                <dt className="text-ink-soft">Worst coverage</dt>
                <dd className="numeric">{(stress.worstCoverage * 100).toFixed(1)}%</dd>
                <dt className="text-ink-soft">Overlapping pairs a page</dt>
                <dd className="numeric">{stress.averageOverlapPairs.toFixed(2)}</dd>
                <dt className="text-ink-soft">Build time</dt>
                <dd className="numeric">
                  {stress.averagePageMs.toFixed(1)}ms average, {stress.p99PageMs.toFixed(1)}ms p99, {stress.slowestPageMs.toFixed(1)}ms slowest
                </dd>
              </dl>
              <button type="button" className="text-verdigris text-meta mt-2" onClick={showWorst}>
                Show the worst-covered page
              </button>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
