/**
 * SeatGeek fetcher factory.
 *
 * Picks the Broker Data API path when SG_BROKER_TOKEN is set, falls back
 * to the headless-Chromium scrape path otherwise. Both paths return the
 * same normalized {source, event, listings, refreshedAt} shape.
 */

let cached = null;

export async function getSgFetcher() {
  if (cached) return cached;
  if (process.env.SG_BROKER_TOKEN?.trim()) {
    cached = await import("./sgBrokerFetcher.js");
    cached.__mode = "api";
  } else {
    cached = await import("./sgScrapeFetcher.js");
    cached.__mode = "scrape";
  }
  return cached;
}

export async function fetchSgEventInventory(eventId, opts) {
  const f = await getSgFetcher();
  return f.fetchSgEventInventory(eventId, opts);
}

export async function fetchSgEventSales(eventId) {
  const f = await getSgFetcher();
  if (typeof f.fetchSgEventSales !== "function") {
    throw new Error(
      `SeatGeek sales endpoint requires the Broker Data API — current mode is "${f.__mode}"`,
    );
  }
  return f.fetchSgEventSales(eventId);
}

export async function closeSgFetcher() {
  if (!cached) return;
  if (typeof cached.closeSgScraper === "function") {
    await cached.closeSgScraper();
  }
  cached = null;
}

export default fetchSgEventInventory;
