import { DEMO_LOCATION } from "@/lib/demo-board";
import type { ChabadZmanimByDate } from "@/lib/zmanim/resolve.ts";

/*
 * The zmanim lab's synthetic day (see page.tsx for why it's synthetic), shared
 * with /fonts-lab, which draws the same table in every font.
 */

/**
 * One day's rows, shaped like Chabad's and chosen for their hour widths:
 * 7, 10, 11, 1, 1, 5, 6, 7, 8, 7, 1. Right-aligning the whole string puts
 * five of those edges in one place and six in another, which is precisely
 * the report ("7:22 PM and 11:21 AM don't line up").
 *
 * `hour24` is only here to build an instant that sorts the way the display
 * reads, so the rendered order matches a real luach's.
 */
export const ROWS: {
  id: string;
  label: string;
  translit: string;
  display: string;
  hour24: number;
  minute: number;
  nextDay?: boolean;
}[] = [
  { id: "netz", label: "Sunrise", translit: "Netz", display: "7:14 AM", hour24: 7, minute: 14 },
  {
    id: "sof_zman_shma_baal_hatanya",
    label: "Latest Shema",
    translit: "Sof Zman Shema",
    display: "10:18 AM",
    hour24: 10,
    minute: 18,
  },
  {
    id: "sof_zman_tfila_baal_hatanya",
    label: "Latest Shacharit",
    translit: "Sof Zman Tefila",
    display: "11:21 AM",
    hour24: 11,
    minute: 21,
  },
  { id: "chatzos", label: "Midday", translit: "Chatzos", display: "1:27 PM", hour24: 13, minute: 27 },
  {
    id: "mincha_gedola",
    label: "Earliest Mincha",
    translit: "Mincha Gedola",
    display: "1:59 PM",
    hour24: 13,
    minute: 59,
  },
  {
    id: "mincha_ketana",
    label: "Mincha Ketana",
    translit: "Mincha Ketana",
    display: "5:08 PM",
    hour24: 17,
    minute: 8,
  },
  {
    id: "plag_hamincha",
    label: "Plag HaMincha",
    translit: "Plag HaMincha",
    display: "6:26 PM",
    hour24: 18,
    minute: 26,
  },
  {
    id: "candle_lighting",
    label: "Candle Lighting",
    translit: "Hadlakas Neiros",
    display: "7:22 PM",
    hour24: 19,
    minute: 22,
  },
  { id: "shkia", label: "Sunset", translit: "Shkia", display: "7:41 PM", hour24: 19, minute: 41 },
  {
    id: "tzeis_baal_hatanya",
    label: "Nightfall",
    translit: "Tzeis HaKochavim",
    display: "8:05 PM",
    hour24: 20,
    minute: 5,
  },
  {
    id: "chatzos_laila",
    label: "Midnight",
    translit: "Chatzos HaLaila",
    display: "1:27 AM",
    hour24: 1,
    minute: 27,
    nextDay: true,
  },
];

/** Today, in the demo location's own zone — the date the widget resolves
 *  against. Built from `formatToParts` rather than a `format()` string, the
 *  same way lib/zmanim/warm.ts does it. */
function todayInZone(timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function buildCache(script: "english" | "transliteration"): ChabadZmanimByDate {
  const date = todayInZone(DEMO_LOCATION.timeZone);
  const [year, month, day] = date.split("-").map(Number);
  const day1 = Object.fromEntries(
    ROWS.map((row) => {
      const at = Date.UTC(year, month - 1, day + (row.nextDay ? 1 : 0), row.hour24, row.minute);
      return [
        row.id,
        {
          iso: new Date(at).toISOString(),
          display: row.display,
          label: row.label,
          // Absent in the English case, so the label fallback is exercised
          // rather than assumed — a row with no provider transliteration
          // shows its English (plan.md §5c: no house table).
          ...(script === "transliteration" ? { translit: row.translit } : {}),
        },
      ];
    }),
  );
  return { [date]: day1 };
}
