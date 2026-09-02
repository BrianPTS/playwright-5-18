import { persistVenueRowMapFromMapData } from "../helpers/venueRowMapPersist.js";

/**
 * Path C — Ticketmaster Discovery API seatmap fallback.
 *
 * When the primary map endpoint (mapsapi.tmol.io) returns empty or is
 * blocked for an event, we can still recover row order from Ticketmaster's
 * public Discovery API. Two shapes are useful:
 *
 *   1. /discovery/v2/venues/<venueId>?apikey=<key> → returns metadata
 *      including a `boxOfficeInfo` and, on some venues, a seatmap URL.
 *   2. /discovery/v2/events/<eventId>/images → some events return an SVG
 *      seatmap where <text> nodes carry the row labels grouped by
 *      <g data-section="..."> parents.
 *
 * We only fire the Discovery path when the primary map fetch failed
 * AND we have no VenueRowMap entry for the section yet. Runs
 * fire-and-forget; failure is logged and swallowed.
 *
 * Requires TM_DISCOVERY_API_KEY. Without it this module is a no-op.
 */

const DISCOVERY_BASE = "https://app.ticketmaster.com/discovery/v2";

export async function fetchDiscoverySeatmapForEvent(eventId) {
  const apiKey = process.env.TM_DISCOVERY_API_KEY;
  if (!apiKey || !eventId) return null;
  const url = `${DISCOVERY_BASE}/events/${eventId}/images?apikey=${encodeURIComponent(apiKey)}`;
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json,image/svg+xml" },
    });
    if (!res.ok) {
      console.warn(
        `[discovery] events/${eventId}/images returned ${res.status}`,
      );
      return null;
    }
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("svg")) return { svg: await res.text() };
    return await res.json();
  } catch (err) {
    console.warn(`[discovery] fetch failed: ${err?.message || err}`);
    return null;
  }
}

/**
 * Parse a TM Discovery SVG seatmap into the same
 * { sectionName: [row0, row1, ...] } shape the persist helper expects,
 * then feed it into persistVenueRowMapFromMapData(source='discovery').
 *
 * Discovery seatmaps use <g class="section" data-section="117"> wrappers
 * whose child <g class="row" data-row="1">...</g> nodes appear in DOM
 * order matching front-to-back placement (TM authors the SVG from the
 * same map data as mapsapi). We turn the parsed structure into a shim
 * mapData object so the existing persist path handles it identically.
 */
export async function fillCacheFromDiscoverySvg(eventId, venue = "") {
  if (!eventId) return false;
  const doc = await fetchDiscoverySeatmapForEvent(eventId);
  if (!doc || !doc.svg) return false;
  const sections = extractSectionRowsFromSvg(doc.svg);
  if (sections.size === 0) return false;

  const shim = {
    pages: [
      {
        segments: [
          {
            segments: [...sections.entries()].map(([name, rows]) => ({
              name,
              segments: rows.map((r) => ({ name: r })),
            })),
          },
        ],
      },
    ],
  };
  await persistVenueRowMapFromMapData(shim, eventId, venue, "discovery");
  return true;
}

// Extract { section -> [row, row, ...] } from a Discovery SVG. Uses regex
// rather than a full DOM parser to avoid pulling in jsdom just for this.
function extractSectionRowsFromSvg(svg) {
  const out = new Map();
  const sectionRe =
    /<g[^>]*class=["'][^"']*section[^"']*["'][^>]*data-section=["']([^"']+)["'][^>]*>([\s\S]*?)<\/g>/gi;
  const rowRe =
    /<g[^>]*class=["'][^"']*row[^"']*["'][^>]*data-row=["']([^"']+)["']/gi;
  let mSection;
  while ((mSection = sectionRe.exec(svg)) !== null) {
    const sectionName = mSection[1];
    const inner = mSection[2];
    const rows = [];
    let mRow;
    rowRe.lastIndex = 0;
    while ((mRow = rowRe.exec(inner)) !== null) {
      if (mRow[1]) rows.push(mRow[1]);
    }
    if (rows.length > 0) out.set(sectionName, rows);
  }
  return out;
}
