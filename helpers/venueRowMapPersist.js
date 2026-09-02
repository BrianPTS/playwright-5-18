import { VenueRowMap } from "../models/venueRowMapModel.js";

/**
 * One-time persist of TM's front-to-back row order for each section
 * observed in a seat-map response. Upserts VenueRowMap per (venue, section)
 * — the row order is stable across every event at the venue, so a single
 * successful fetch per pair is enough forever. Skips sections we already
 * have in the cache so we never rewrite them on subsequent scrapes.
 *
 * `mapData` is the raw JSON returned by mapsapi.tmol.io/…/placeDetailNoKeys.
 * `venue` is the event's Venue string (matches Event.Venue in scraper-5-18).
 * `source` records which fetch path we came from — 'mapsapi' or 'discovery'.
 *
 * Fails silently: this is a cache-warming side effect and must never
 * break the scrape if Mongo is temporarily unavailable or the shape is
 * unexpected.
 */
export async function persistVenueRowMapFromMapData(mapData, venue, source = "mapsapi") {
  try {
    if (!venue) return;
    const sections = extractSectionRows(mapData);
    if (sections.size === 0) return;

    const existing = await VenueRowMap.find(
      { venue, section: { $in: [...sections.keys()] } },
      { section: 1 },
    ).lean();
    const known = new Set((existing || []).map((d) => d.section));

    const ops = [];
    for (const [sectionName, rows] of sections) {
      if (known.has(sectionName)) continue;
      if (!rows || rows.length === 0) continue;
      ops.push({
        updateOne: {
          filter: { venue, section: sectionName },
          update: {
            $setOnInsert: {
              venue,
              section: sectionName,
              rows,
              source,
              lastFetchedAt: new Date(),
            },
          },
          upsert: true,
        },
      });
    }
    if (ops.length > 0) {
      await VenueRowMap.bulkWrite(ops, { ordered: false });
      console.log(
        `[venueRowMap] cached ${ops.length} new sections for venue="${venue}" (source=${source})`,
      );
    }
  } catch (err) {
    console.warn(`[venueRowMap] persist failed: ${err?.message || err}`);
  }
}

// Walk the mapsapi.tmol.io tree and pull out { sectionName -> [row0, row1, ...] }
// preserving Ticketmaster's front-to-back array order.
function extractSectionRows(mapData) {
  const out = new Map();
  const pages = mapData?.pages;
  if (!Array.isArray(pages) || pages.length === 0) return out;
  for (const page of pages) {
    const composites = page?.segments;
    if (!Array.isArray(composites)) continue;
    for (const composit of composites) {
      const sections = composit?.segments;
      if (!Array.isArray(sections)) continue;
      for (const SECTION of sections) {
        const name = SECTION?.name;
        const segs = SECTION?.segments;
        if (!name || !Array.isArray(segs) || segs.length === 0) continue;
        const rows = segs
          .map((ROW) => ROW?.name)
          .filter((n) => typeof n === "string" && n.length > 0);
        if (rows.length === 0) continue;
        // If the same section appears twice, keep the longer ordering.
        const prior = out.get(name);
        if (!prior || rows.length > prior.length) out.set(name, rows);
      }
    }
  }
  return out;
}
