"use client";

import { useSyncExternalStore } from "react";

/*
 * The token reference. Not product UI and not a component library — it renders
 * docs/design.md §3 so the values can be checked by eye.
 *
 * Resolved values are read from the DOM rather than written here, so this page
 * cannot drift from lib/tokens.css and no color value is duplicated outside it.
 */

const SURFACE_COLORS = [
  { token: "--ink", use: "Primary text, editor chrome" },
  { token: "--ink-soft", use: "Secondary text, metadata" },
  { token: "--ink-faint", use: "Placeholders, disabled" },
  { token: "--paper", use: "App background" },
  { token: "--surface", use: "Content panes, table bodies" },
  { token: "--rule", use: "Hairlines" },
  { token: "--rule-firm", use: "Section dividers, table header rule" },
  { token: "--verdigris", use: "The one accent: primary action, active nav, links" },
  { token: "--verdigris-wash", use: "Selected rows, active nav background" },
];

const STATUS_COLORS = [
  { token: "--live", label: "Live", use: "Checked in within the last minute" },
  { token: "--stale", label: "Stale", use: "Hasn't checked in recently" },
  { token: "--offline", label: "Offline", use: "Hasn't checked in since Monday" },
];

const TYPE_SCALE = [
  {
    className: "text-title",
    name: "Page title",
    spec: "20px / 600 / -0.01em",
    english: "Screens",
    hebrew: "מסכים",
  },
  {
    className: "text-heading",
    name: "Section heading",
    spec: "16px / 600",
    english: "Davening times",
    hebrew: "זמני תפילה",
  },
  {
    className: "text-body",
    name: "Body",
    spec: "15px / 400",
    english: "Each screen gets its own link.",
    hebrew: "לכל מסך יש קישור משלו.",
  },
  {
    className: "text-cell",
    name: "Table cell",
    spec: "14px / 400",
    english: "Main lobby",
    hebrew: "לובי ראשי",
  },
  {
    className: "text-meta",
    name: "Metadata, labels",
    spec: "13px / 400",
    english: "Last seen 4 minutes ago",
    hebrew: "נראה לפני 4 דקות",
  },
  {
    className: "text-min",
    name: "Smallest",
    spec: "12px / 400",
    english: "The floor. Never go below it.",
    hebrew: "הגודל הקטן ביותר",
  },
];

const RADII = [
  { token: "--corner-control", use: "Controls and inputs" },
  { token: "--corner-panel", use: "Panels and content panes" },
];

const ZMANIM = [
  { label: "Alos", time: "05:11" },
  { label: "Netz", time: "06:24" },
  { label: "Sof zman shma", time: "09:41" },
  { label: "Chatzos", time: "12:48" },
  { label: "Shkia", time: "19:11" },
  { label: "Tzeis", time: "19:58" },
];

const NO_VALUES: Record<string, string> = {};
let resolved: Record<string, string> | null = null;

/**
 * Reads each custom property off the document root, once, and caches it.
 *
 * The cache matters: useSyncExternalStore calls the snapshot on every render and
 * would loop forever if it returned a fresh object each time. Tokens do not
 * change at runtime, so subscribing to nothing is correct.
 */
function readTokens(tokens: string[]): Record<string, string> {
  if (resolved) return resolved;

  const computed = getComputedStyle(document.documentElement);
  const values: Record<string, string> = {};
  for (const token of tokens) {
    values[token] = computed.getPropertyValue(token).trim();
  }
  resolved = values;
  return values;
}

function subscribe() {
  return () => {};
}

function useResolvedTokens(tokens: string[]) {
  return useSyncExternalStore(
    subscribe,
    () => readTokens(tokens),
    () => NO_VALUES,
  );
}

/**
 * A ruled section inside the single content pane.
 *
 * Deliberately not a card. The spec's shell has one content pane per view, and
 * hierarchy inside it comes from rule weight, the way it does on a printed luach.
 * Five surface panes stacked up would be the SaaS card kit with the shadows taken
 * off.
 */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-rule-firm border-t px-5 py-5 first:border-t-0">
      <h2 className="text-heading">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function HeaderRow({ labels }: { labels: string[] }) {
  return (
    <thead>
      <tr className="border-b border-rule-firm">
        {labels.map((label) => (
          <th key={label} className="text-meta text-ink-soft py-2 pr-6 text-left font-regular">
            {label}
          </th>
        ))}
      </tr>
    </thead>
  );
}

export default function TokensPage() {
  const allTokens = [
    ...SURFACE_COLORS.map((c) => c.token),
    ...STATUS_COLORS.map((c) => c.token),
    ...RADII.map((r) => r.token),
  ];
  const values = useResolvedTokens(allTokens);

  return (
    <main className="font-ui mx-auto max-w-6xl px-8 py-10">
      <h1 className="text-title">Design tokens</h1>
      <p className="text-body text-ink-soft mt-1 max-w-2xl">
        Every color, size and radius in the product, read live from{" "}
        <span className="text-ink">lib/tokens.css</span>. Nothing on this page is a
        component.
      </p>

      <div className="rounded-panel border-rule bg-surface mt-8 border">
        <Section title="Color">
          <table className="w-full">
            <HeaderRow labels={["Swatch", "Token", "Value", "What it's for"]} />
            <tbody>
              {SURFACE_COLORS.map(({ token, use }) => (
                <tr key={token} className="h-10">
                  <td className="w-16 pr-6">
                    <span
                      className="rounded-control border-rule block h-6 w-10 border"
                      style={{ backgroundColor: `var(${token})` }}
                    />
                  </td>
                  <td className="text-cell pr-6">{token}</td>
                  <td className="text-cell text-ink-soft numeric pr-6">
                    {values[token] ?? " "}
                  </td>
                  <td className="text-cell text-ink-soft">{use}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section title="Status">
          <p className="text-body text-ink-soft mb-4 max-w-2xl">
            A 6px dot and plain-language time. These three colors mean status and
            nothing else — they are never decorative, and status is never a badge
            pill.
          </p>
          <table className="w-full">
            <HeaderRow labels={["Dot", "State", "Token", "Value", "Reads as"]} />
            <tbody>
              {STATUS_COLORS.map(({ token, label, use }) => (
                <tr key={token} className="h-10">
                  <td className="w-10 pr-6">
                    <span
                      className="block h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: `var(${token})` }}
                    />
                  </td>
                  <td className="text-cell pr-6">{label}</td>
                  <td className="text-cell pr-6">{token}</td>
                  <td className="text-cell text-ink-soft numeric pr-6">
                    {values[token] ?? " "}
                  </td>
                  <td className="text-cell text-ink-soft">{use}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section title="Type scale">
          <p className="text-body text-ink-soft mb-4 max-w-2xl">
            Assistant carries both scripts. Weight is baked into each step, because
            the spec pairs them — there is no 20px at weight 400 in this design. The
            specimens carry the numeric utility, though Assistant has no tabular
            figure set for it to act on. Numerals, below, shows what that costs.
          </p>
          <table className="w-full">
            <HeaderRow labels={["Step", "Spec", "English", "Hebrew"]} />
            <tbody>
              {TYPE_SCALE.map(({ className, name, spec, english, hebrew }) => (
                <tr key={name} className="border-rule border-b last:border-b-0">
                  <td className="text-cell w-44 py-3 pr-6 align-baseline">{name}</td>
                  <td className="text-cell text-ink-soft numeric w-44 py-3 pr-6 align-baseline">
                    {spec}
                  </td>
                  <td className={`${className} numeric w-80 py-3 pr-6 align-baseline`}>
                    {english}
                  </td>
                  <td className={`${className} numeric py-3 align-baseline`} dir="rtl" lang="he">
                    {hebrew}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className="text-body text-ink-soft mt-6 max-w-2xl">
            Frank Ruhl Libre is loaded and reserved for Hebrew dates and zmanim
            values, where sefarim typography belongs. It appears here as a specimen
            only — it is never used in interface chrome.
          </p>
          <p className="font-sefarim text-title mt-2" dir="rtl" lang="he">
            כ״ג אלול תשפ״ו
          </p>
        </Section>

        <Section title="Space and shape">
          <table className="w-full">
            <HeaderRow labels={["Specimen", "Token", "Value", "Applies to"]} />
            <tbody>
              {RADII.map(({ token, use }) => (
                <tr key={token} className="h-10">
                  <td className="w-16 pr-6">
                    <span
                      className="bg-paper border-rule block h-6 w-10 border"
                      style={{ borderRadius: `var(${token})` }}
                    />
                  </td>
                  <td className="text-cell pr-6">{token}</td>
                  <td className="text-cell text-ink-soft numeric pr-6">
                    {values[token] ?? " "}
                  </td>
                  <td className="text-cell text-ink-soft">{use}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-body text-ink-soft mt-4 max-w-2xl">
            Two radii, and that is the whole set. Spacing is a 4px base unit, so
            every gap and pad on this page is a multiple of it.
          </p>
        </Section>

        <Section title="Numerals">
          <p className="text-body text-ink-soft mb-4 max-w-3xl">
            The same six times, set four ways. Assistant has no tabular figure set,
            so the <span className="text-ink">numeric</span> utility has no effect
            on it and the first two columns are identical to the pixel. Frank Ruhl
            Libre does have one, so its two columns differ — that is what the
            utility looks like when the face supports it.
          </p>
          <table className="w-full max-w-4xl">
            <HeaderRow
              labels={[
                "Zman",
                "Assistant, numeric",
                "Assistant, plain",
                "Frank Ruhl, numeric",
                "Frank Ruhl, plain",
              ]}
            />
            <tbody>
              {ZMANIM.map(({ label, time }) => (
                <tr key={label} className="h-10">
                  <td className="text-cell w-40 pr-6">{label}</td>
                  <td className="text-cell numeric w-40 pr-6">{time}</td>
                  <td className="text-cell text-ink-soft w-40 pr-6">{time}</td>
                  <td className="font-sefarim text-cell numeric w-40 pr-6">{time}</td>
                  <td className="font-sefarim text-cell text-ink-soft w-40">{time}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-body text-ink-soft mt-4 max-w-3xl">
            Zmanim values on a board are set in Frank Ruhl Libre and align. Times in
            dashboard chrome are set in Assistant and drift by up to 3px across a
            five-figure run at 15px, which is visible down a 40px-row table. Closing
            that gap needs a decision about the chrome face, not another utility.
          </p>
        </Section>

      </div>
    </main>
  );
}
