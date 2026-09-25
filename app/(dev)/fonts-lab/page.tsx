"use client";

/*
 * Every board font, by eye — the lab the font system is tuned in
 * (lib/fonts). A dev page like /zmanim-lab and /font-parity: the (dev) route
 * group keeps it out of production, and scripts/test-fonts-lab.mjs drives it.
 *
 *   ?section=type     every font at TV sizes, in each weight it offers, with a
 *                     mixed English and Hebrew line — where size-adjust is
 *                     judged: the Hebrew should stand as tall as the English.
 *   ?section=nikud    every Hebrew font with a pasuk with nekudos.
 *   ?section=zmanim   the real Zmanim widget in every font: the times line up.
 *   ?section=themes   the six font themes on one sample board.
 *   ?section=timefallback  each face with old-style figures beside its
 *                     fallback at every weight — where the weight a time is
 *                     set at in the fallback (TIME_FALLBACK_WEIGHT) is chosen.
 *   ?section=plain    one small board and nothing else (&hebrew=1 adds a
 *                     Hebrew line) — what the test checks downloads against.
 *   &font=<id>        one font only, in the sections that list fonts.
 *
 * With no section, all four of the first. Sizes are design units on a
 * 1920-wide board, drawn here at two thirds (a 1280px board), so "48" is how
 * 48 looks on a board shown this size.
 */

import { useSearchParams } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { BoardRenderer } from "@/components/board/BoardRenderer";
import { parseBoardDoc, type BoardDoc } from "@/lib/board-doc";
import type { BoardZmanim } from "@/lib/board-zmanim";
import { DEMO_LOCATION } from "@/lib/demo-board";
import { CATEGORY_LABELS, HEBREW_OVERRIDE_FONTS, PICKABLE_FONTS, digitFallbackFor, fontInfo, hebrewFont, offeredWeights } from "@/lib/fonts";
import { TIME_FALLBACK_WEIGHT } from "@/lib/fonts/catalog";
import { numericWeight } from "@/lib/board-theme";
import { fontStack } from "@/lib/fonts/stack";
import { FONT_THEMES, fontThemePatch } from "@/lib/fonts/themes";
import { buildCache, ROWS } from "../zmanim-lab/fixture";

const CANVAS = { width: 1920, height: 1080 };
/** Design units to CSS px on this page: a 1920 board drawn 1280 wide. */
const SCALE = 1280 / 1920;
const MIXED = "Mincha מנחה 6:45, Shabbos שבת";
const PASUK = "בְּרֵאשִׁית בָּרָא אֱלֹהִים אֵת הַשָּׁמַיִם וְאֵת הָאָרֶץ׃";
/** The marks not every face has: maqaf, paseq, sof pasuk, gershayim, geresh. */
const MARKS_LINE = "וְרוּחַ אֱלֹהִים מְרַחֶפֶת עַל־פְּנֵי ׀ הַמָּיִם׃ רש״י, ר׳ יוחנן";

const WEIGHT_NAMES: Record<number, string> = {
  100: "Thin",
  200: "Extra light",
  300: "Light",
  400: "Regular",
  500: "Medium",
  600: "Semibold",
  700: "Bold",
  800: "Extra bold",
  900: "Black",
};

const zmanim: BoardZmanim = { provider: "chabad", hasChabadLocation: true, chabadZmanim: buildCache("english") };

const definedOnly = (patch: Record<string, string | undefined>) =>
  Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4" data-lab-section={id}>
      <h2 className="text-ink text-[16px] font-semibold">{title}</h2>
      {children}
    </section>
  );
}

/** Every font, every weight, at 48 and 96 on the board. */
function TypeSection({ only }: { only: string | null }) {
  const fonts = PICKABLE_FONTS.filter((font) => !only || font.id === only);
  return (
    <Section id="type" title="Every font at TV sizes">
      <table className="w-full border-collapse">
        <tbody>
          {fonts.map((font) =>
            offeredWeights(font.id).map((weight, i) => (
              <tr key={`${font.id}-${weight}`} className="border-rule border-b align-baseline" data-lab-font={font.id} data-lab-weight={weight}>
                <td className="text-ink-soft w-56 py-2 pr-4 text-[13px]">
                  {i === 0 && (
                    <>
                      <span className="text-ink block text-[14px]">{font.name}</span>
                      {CATEGORY_LABELS[font.category]}
                      {font.capsOnly ? ", capitals only" : ""}
                    </>
                  )}
                </td>
                <td className="text-ink-soft w-24 text-[13px]">{WEIGHT_NAMES[weight]}</td>
                <td className="text-ink py-2" style={{ fontFamily: fontStack(font.id), fontWeight: weight }}>
                  <div dir="auto" style={{ fontSize: 48 * SCALE, lineHeight: 1.2 }}>
                    {MIXED}
                  </div>
                  <div dir="auto" style={{ fontSize: 96 * SCALE, lineHeight: 1.2 }}>
                    {MIXED}
                  </div>
                </td>
              </tr>
            )),
          )}
        </tbody>
      </table>
    </Section>
  );
}

/** Every Hebrew font with nekudos, at a TV size. */
function NikudSection({ only }: { only: string | null }) {
  const fonts = [...HEBREW_OVERRIDE_FONTS, hebrewFont("alef")!, hebrewFont("miriam-libre")!]
    .filter((font) => !only || font.id === only)
    .map((font) => ({ font, info: fontInfo(font.id)! }));
  return (
    <Section id="nikud" title="Nikud in every Hebrew font">
      <table className="w-full border-collapse">
        <tbody>
          {fonts.map(({ font, info }) => (
            <tr key={font.id} className="border-rule border-b align-middle" data-lab-nikud={font.id}>
              <td className="text-ink-soft w-56 py-3 pr-4 text-[13px]">
                <span className="text-ink block text-[14px]">{font.label ? `${font.label} (${font.name})` : font.name}</span>
                {info.measured.nikudOk ? "Sets nikud" : "Nikud may not show properly"}
                {font.group === "legacy" ? ", kept for boards that use it" : ""}
                {info.measured.hebrewMissing.length > 0 && (
                  <span className="block">No {info.measured.hebrewMissing.join(", ")}: from the stack&rsquo;s marks face</span>
                )}
              </td>
              {/* The face's board stack, as a board draws it — so a mark the
                  face lacks comes from the marks face at its end. */}
              <td dir="rtl" lang="he" className="text-ink py-3" style={{ fontFamily: fontStack(font.id), fontSize: 64 * SCALE, lineHeight: 1.6 }}>
                <div>{PASUK}</div>
                <div data-lab-marks>{MARKS_LINE}</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

function zmanimBoard(font: string): BoardDoc {
  return parseBoardDoc({
    schemaVersion: 1,
    themeOverrides: { font, ink: "ink", background: "surface" },
    widgets: [
      {
        id: "55555555-5555-4555-8555-555555555555",
        type: "zmanim",
        x: 4,
        y: 4,
        w: 92,
        h: 92,
        z: 0,
        config: { zmanim: ROWS.map((row) => row.id), displayMode: "all", labelScript: "english", size: 32 },
      },
    ],
  });
}

/** The real Zmanim widget in every font. */
function ZmanimSection({ only }: { only: string | null }) {
  const fonts = PICKABLE_FONTS.filter((font) => !only || font.id === only);
  const size = { width: 400, height: 225 };
  return (
    <Section id="zmanim" title="A zmanim table in every font">
      <div className="flex flex-wrap gap-4">
        {fonts.map((font) => (
          <figure key={font.id} className="flex flex-col gap-1" data-lab-zmanim={font.id}>
            <figcaption className="text-ink-soft text-[13px]">{font.name}</figcaption>
            <div className="border-rule border" style={{ position: "relative", ...size }}>
              <BoardRenderer doc={zmanimBoard(font.id)} canvas={CANVAS} location={DEMO_LOCATION} zmanim={zmanim} style={size} />
            </div>
          </figure>
        ))}
      </div>
    </Section>
  );
}

function themeBoard(themeId: string): BoardDoc {
  const theme = FONT_THEMES.find((t) => t.id === themeId)!;
  const widget = (id: number, type: string, x: number, y: number, w: number, h: number, config: Record<string, unknown>) => ({
    id: `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
    type,
    x,
    y,
    w,
    h,
    z: id,
    config,
  });
  return parseBoardDoc({
    schemaVersion: 1,
    themeOverrides: { ink: "ink", background: "surface", ...definedOnly(fontThemePatch(theme)) },
    widgets: [
      widget(1, "title", 4, 4, 56, 18, { text: "Beis Menachem", subtitle: "בית מנחם, Shabbos Bereishis", align: "left" }),
      widget(2, "clock", 64, 5, 32, 14, { sizingMode: "fit", align: "right", showSeconds: false }),
      widget(3, "text", 4, 26, 56, 26, {
        text: "Kiddush after davening, sponsored by the Levy family.\nקידוש אחרי התפילה",
        size: 34,
        title: "Notices",
      }),
      ...(theme.roles.accent
        ? [widget(4, "text", 4, 56, 56, 16, { text: "Mazel tov!", size: 64, font: "accent", align: "center" })]
        : []),
      ...(theme.roles.quote
        ? [widget(5, "text", 4, 56, 56, 16, { text: "וְאָהַבְתָּ לְרֵעֲךָ כָּמוֹךָ — Love your fellow as yourself", size: 30, font: "quote" })]
        : []),
      widget(6, "zmanim", 64, 24, 32, 72, { zmanim: ROWS.map((row) => row.id), displayMode: "all", labelScript: "english", size: 28, title: "Zmanim" }),
    ],
  });
}

/** The six themes on one sample board. */
function ThemesSection() {
  const size = { width: 640, height: 360 };
  return (
    <Section id="themes" title="The six font themes">
      <div className="flex flex-wrap gap-4">
        {FONT_THEMES.map((theme) => (
          <figure key={theme.id} className="flex flex-col gap-1" data-lab-theme={theme.id}>
            <figcaption className="text-ink-soft text-[13px]">
              {theme.name}: {theme.description}
            </figcaption>
            <div className="border-rule border" style={{ position: "relative", ...size }}>
              <BoardRenderer
                doc={themeBoard(theme.id)}
                canvas={CANVAS}
                location={DEMO_LOCATION}
                zmanim={zmanim}
                style={size}
                widgetProps={(widget) => ({ "data-widget-id": widget.id })}
              />
            </div>
          </figure>
        ))}
      </div>
    </Section>
  );
}

/** Each face with old-style figures, as its own text looks beside a time,
 *  and the fallback its times are set in at every weight — the chosen one
 *  marked. */
function TimeFallbackSection() {
  // "chosen" is what the renderer uses (lib/board-theme.ts, numericWeight),
  // and each row also draws a real clock through the renderer, so the marker
  // and what ships can't drift (scripts/test-fonts-lab.mjs compares them).
  const rows = Object.keys(TIME_FALLBACK_WEIGHT).map((id) => ({ id, chosen: numericWeight(id), fallback: fontInfo(digitFallbackFor(id))! }));
  const clockSize = { width: 240, height: 68 };
  const clockBoard = (font: string) =>
    parseBoardDoc({
      schemaVersion: 1,
      themeOverrides: { font, ink: "ink", background: "surface" },
      widgets: [{ id: "88888888-8888-4888-8888-888888888888", type: "clock", x: 0, y: 0, w: 100, h: 100, z: 0, config: { sizingMode: "fit", align: "left" } }],
    });
  return (
    <Section id="timefallback" title="Times in the fallback, weight by weight">
      <table className="w-full border-collapse">
        <tbody>
          {rows.map(({ id, chosen, fallback }) => (
            <tr key={id} className="border-rule border-b align-baseline" data-lab-timefallback={id}>
              <td className="text-ink py-3 pr-6" style={{ fontFamily: fontStack(id), fontSize: 56 * SCALE, fontWeight: 600 }}>
                Candle lighting
              </td>
              <td className="py-3 pr-4" data-lab-renderer-clock>
                <div style={{ position: "relative", ...clockSize }}>
                  <BoardRenderer doc={clockBoard(id)} canvas={CANVAS} style={clockSize} />
                </div>
                <div className="text-ink-soft text-[12px]">As the renderer draws it</div>
              </td>
              {offeredWeights(fallback.id).filter((w) => w >= 300).map((weight) => (
                <td key={weight} className="py-3 pr-4 text-center">
                  <div className="text-ink" style={{ fontFamily: fontStack(fallback.id), fontSize: 56 * SCALE, fontWeight: weight, fontVariantNumeric: "lining-nums tabular-nums" }}>
                    7:22 PM
                  </div>
                  <div
                    className={`text-[12px] ${weight === chosen ? "text-ink font-semibold" : "text-ink-soft"}`}
                    data-lab-chosen={weight === chosen ? weight : undefined}
                  >
                    {fallback.name} {weight}
                    {weight === chosen ? " (chosen)" : ""}
                  </div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

/** One small board, for checking what a board downloads. */
function PlainSection({ hebrew }: { hebrew: boolean }) {
  const size = { width: 640, height: 360 };
  const doc = parseBoardDoc({
    schemaVersion: 1,
    themeOverrides: { font: "inter", ink: "ink", background: "surface" },
    widgets: [
      {
        id: "66666666-6666-4666-8666-666666666666",
        type: "text",
        x: 5,
        y: 5,
        w: 90,
        h: 40,
        z: 0,
        config: { text: hebrew ? "Welcome ברוכים הבאים" : "Welcome", size: 60 },
      },
    ],
  });
  return (
    <Section id="plain" title="One board">
      <div style={{ position: "relative", ...size }} data-lab-plain>
        <BoardRenderer doc={doc} canvas={CANVAS} style={size} />
      </div>
    </Section>
  );
}

function FontsLabInner() {
  const params = useSearchParams();
  const section = params.get("section");
  const only = params.get("font");
  const show = (id: string) => (section ? section === id : id !== "plain");
  return (
    <main className="bg-paper font-ui flex flex-col gap-10 p-6">
      <h1 className="text-ink text-[20px] font-semibold">Fonts lab</h1>
      {show("type") && <TypeSection only={only} />}
      {show("nikud") && <NikudSection only={only} />}
      {show("zmanim") && <ZmanimSection only={only} />}
      {show("themes") && <ThemesSection />}
      {show("timefallback") && <TimeFallbackSection />}
      {show("plain") && <PlainSection hebrew={params.get("hebrew") === "1"} />}
    </main>
  );
}

export default function FontsLabPage() {
  return (
    <Suspense fallback={null}>
      <FontsLabInner />
    </Suspense>
  );
}
