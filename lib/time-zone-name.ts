/**
 * A timezone as a person says it — "Eastern Time", not "America/New_York" —
 * for showing back what the address set. Falls back to the IANA name on a
 * runtime without generic zone names.
 */
export function timeZoneName(zone: string): string {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longGeneric" })
      .formatToParts(new Date())
      .find((p) => p.type === "timeZoneName")?.value;
    return part && !/^GMT/.test(part) ? part : zone;
  } catch {
    return zone;
  }
}
