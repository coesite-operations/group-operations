// Each face's reach in the books: the dated readings a persona's turn appends to
// <persona>/data/records/reach/<site>.jsonl (public-personality persona-tend), read here from those
// records alone. `reachReadoutOf` is a pure function of the readings and the readout's window.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const isReading = (row) => typeof row?.site === "string" && Number.isSafeInteger(row.views) && Number.isSafeInteger(row.hits) && Number.isFinite(Date.parse(row.at));

/**
 * The reach section of a readout: for each face (site), its latest reading at or before `to` (views, hits and
 * when), and the change over the window `from`..`to`. The change is measured from the last reading at or
 * before `from`, else from the first reading inside the window; a face with a single reading in sight has no
 * change to tell (`delta: null`), never a zero. Counts are Neocities' lifetime totals, so a delta is what
 * accrued between two readings. Readings from before the window, or after it, never count as inside it.
 */
export function reachReadoutOf(readings, { from, to }) {
  const start = Date.parse(from), end = Date.parse(to);
  const bySite = new Map();
  for (const row of readings.filter(isReading)) bySite.set(row.site, [...(bySite.get(row.site) ?? []), row]);
  const faces = [...bySite].sort(([a], [b]) => a.localeCompare(b)).flatMap(([site, rows]) => {
    const seen = rows.filter((row) => Date.parse(row.at) <= end).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const latest = seen.at(-1);
    if (latest === undefined) return [];
    const base = seen.findLast((row) => Date.parse(row.at) <= start) ?? seen.find((row) => Date.parse(row.at) > start);
    const delta = base === undefined || base === latest ? null
      : Object.freeze({ views: latest.views - base.views, hits: latest.hits - base.hits, since: base.at });
    return [Object.freeze({ site, at: latest.at, views: latest.views, hits: latest.hits, delta })];
  });
  return Object.freeze({ from, to, faces: Object.freeze(faces) });
}

/** Every reading under a directory of personas (<persona>/data/records/reach/*.jsonl); a damaged line is no reading. */
export function readReachRecords(personasDir) {
  if (!existsSync(personasDir)) return [];
  const readings = [];
  for (const persona of readdirSync(personasDir).sort()) {
    const directory = join(personasDir, persona, "data", "records", "reach");
    if (!existsSync(directory)) continue;
    for (const name of readdirSync(directory).filter((entry) => entry.endsWith(".jsonl")).sort()) {
      for (const line of readFileSync(join(directory, name), "utf8").split("\n")) {
        if (line.trim() === "") continue;
        try { readings.push({ ...JSON.parse(line), persona }); } catch { /* A damaged line is no reading. */ }
      }
    }
  }
  return readings;
}

/** The personas' directory beside the data root this readout reads: the public-personality section's services. */
export const personasRootOf = (environment) => environment.PERSONA_ROOT
  ?? (typeof environment.METROPLAT_DATA_ROOT === "string" && environment.METROPLAT_DATA_ROOT !== ""
    ? join(environment.METROPLAT_DATA_ROOT, "..", "public-services-section", "services", "public-media-services-section", "services", "public-personality-services-section", "services")
    : undefined);
