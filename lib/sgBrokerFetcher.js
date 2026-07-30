/**
 * SeatGeek Broker Data Fetcher
 *
 * Pulls secondary-marketplace listings and sales for a given SeatGeek event
 * via the Seller Direct Broker Data API (brokerdata.seatgeek.com).
 *
 * Auth: seller/broker token, provided by SeatGeek partner enablement.
 * Set SG_BROKER_TOKEN in the environment.
 *
 * Endpoints used:
 *   GET /v2/listings?event_id=&token=   → all secondary listings on SG marketplace
 *   GET /listings?event_id=&token=      → this broker's own inventory only
 *   GET /sales?event_id=&token=         → sales history for the event
 *
 * Output shape is a superset of what the TM pipeline emits (row/section/qty/
 * price/etc.) so records can be merged into the same downstream CSV.
 */

import dotenv from "dotenv";

dotenv.config();

const BASE_URL = "https://brokerdata.seatgeek.com";
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 500;

const SOURCE = "seatgeek";

function getToken() {
  const token = process.env.SG_BROKER_TOKEN?.trim();
  if (!token) {
    throw new Error(
      "SG_BROKER_TOKEN is not set — SeatGeek broker fetches are disabled",
    );
  }
  return token;
}

/**
 * Fetch JSON from the Broker Data API with timeout + bounded retry.
 * Retries only on network errors and 5xx / 429.
 */
async function apiGet(path, params = {}) {
  const url = new URL(BASE_URL + path);
  url.searchParams.set("token", getToken());
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }

  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.ok) return await res.json();

      // 4xx (except 429) — don't retry, caller needs to see it
      if (res.status !== 429 && res.status < 500) {
        const body = await res.text().catch(() => "");
        throw new Error(
          `[SG] ${res.status} ${res.statusText} — ${path} — ${body.slice(0, 200)}`,
        );
      }
      lastError = new Error(`[SG] transient ${res.status} on ${path}`);
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
    }

    if (attempt < MAX_ATTEMPTS) {
      await new Promise((r) =>
        setTimeout(r, RETRY_BASE_MS * 2 ** (attempt - 1)),
      );
    }
  }
  throw lastError;
}

/**
 * Map SG marketplace source code → our internal inventoryType tag.
 * SG Listing.m values seen in the wild: "exchange", "open_marketplace",
 * "marketplace", "fan_to_fan", "open".
 */
function mapMarketToInventoryType(m) {
  const v = (m || "").toLowerCase();
  if (v === "exchange") return "sg_primary";
  if (v.includes("fan")) return "fan_resale";
  if (v.includes("market") || v === "open") return "resale";
  return "resale";
}

/**
 * Normalize one SG Listing (raw API shape) into our downstream inventory
 * record — same field names the TM pipeline emits so they merge cleanly.
 * SG does not broadcast individual seat numbers on secondary, so `seats`
 * is empty and lowSeat/highSeat are 0 (matches TM resale behavior).
 */
function normalizeListing(listing, event) {
  const section = String(listing.s ?? "");
  const row = String(listing.r ?? "");
  const qty = Number(listing.q ?? 0);

  return {
    source: SOURCE,
    eventId: String(event?.id ?? ""),
    eventName: event?.name ?? "",
    venue: event?.location ?? "",
    startDate: event?.start_data ?? event?.start_date ?? "",

    row,
    section,
    selection: mapMarketToInventoryType(listing.m),
    offerId: "",
    listingId: String(listing.sglid ?? listing.id ?? ""),
    places: [],
    seats: [],
    lowSeat: 0,
    highSeat: 0,
    count: qty,

    price: Number(listing.pf ?? 0),
    wholesalePrice: Number(listing.bp ?? 0),
    dealScore: listing.ds ?? null,
    currency: "USD",

    stockType: listing.st ?? "",
    deliveryMethod: listing.dm ?? "",
    inHandDate: listing.ihd ?? "",
    instantDelivery: !!listing.idl,
    splits: Array.isArray(listing.sp) ? listing.sp : [],

    accessibility: listing.wa ? "wheelchair" : listing.ada ? "ada" : "",
    attributes: [
      listing.lv ? "limited" : null,
      listing.sro ? "sro" : null,
      listing.is_b2b ? "b2b" : null,
    ].filter(Boolean),

    tags: {
      market: listing.m ?? null,
      isB2B: !!listing.is_b2b,
      brokerOwned: !!listing.bo,
      limitedView: !!listing.lv,
      sro: !!listing.sro,
      wheelchair: !!listing.wa,
      sellerNotes: listing.pn ?? "",
    },
  };
}

/**
 * Fetch every secondary listing on the SG marketplace for an event and
 * normalize to the downstream inventory shape.
 *
 * @param {string|number} eventId  SeatGeek event ID
 * @param {object} [opts]
 * @param {boolean} [opts.ownOnly] if true, hit /listings (this broker only)
 *   instead of /v2/listings (whole marketplace)
 * @returns {Promise<{event: object, listings: object[], refreshedAt: string, cacheHit: boolean, source: string}>}
 */
export async function fetchSgEventInventory(eventId, opts = {}) {
  if (!eventId) throw new Error("fetchSgEventInventory: eventId is required");
  const path = opts.ownOnly ? "/listings" : "/v2/listings";
  const body = await apiGet(path, { event_id: eventId });

  const event = body?.event ?? { id: eventId };
  const raw = Array.isArray(body?.listings) ? body.listings : [];
  const listings = raw.map((l) => normalizeListing(l, event));

  return {
    source: SOURCE,
    event,
    listings,
    refreshedAt: body?.refreshed_at_utc ?? new Date().toISOString(),
    cacheHit: !!body?.cache_hit,
  };
}

/**
 * Fetch sales for an event. Response schema switches between line-item and
 * aggregate depending on account enablement; both are returned as-is under
 * `sales` and left to callers to interpret.
 */
export async function fetchSgEventSales(eventId) {
  if (!eventId) throw new Error("fetchSgEventSales: eventId is required");
  const body = await apiGet("/sales", { event_id: eventId });
  return {
    source: SOURCE,
    event: body?.event ?? { id: eventId },
    sales: body?.sales ?? [],
    refreshedAt: body?.refreshed_at_utc ?? new Date().toISOString(),
    cacheHit: !!body?.cache_hit,
  };
}

export const __internal = {
  apiGet,
  normalizeListing,
  mapMarketToInventoryType,
};

export default fetchSgEventInventory;
