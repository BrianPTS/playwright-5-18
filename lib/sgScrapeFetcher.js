/**
 * SeatGeek Scrape Fetcher (fallback path)
 *
 * Drop-in alternative to lib/sgBrokerFetcher.js when we don't have a
 * Broker Data API token. Uses a headless Chromium session (with residential
 * proxy) to intercept seatgeek.com/api/event_listings_v2 — the internal XHR
 * the event page itself calls — and returns rows in the same normalized
 * inventory shape.
 *
 * Env:
 *   SG_SCRAPE_PROXY   http(s):// proxy URL, residential recommended
 *   SG_SCRAPE_PROXY_USER, SG_SCRAPE_PROXY_PASS   optional auth
 *   SG_SCRAPE_HEADFUL if truthy, run non-headless (debug)
 *
 * Tradeoffs vs the API path:
 *   - No wholesale price (bp), no SG listing ID (sglid), no deal score (ds),
 *     no broker-owned flag (bo). Everything downstream cares about survives.
 *   - Cloudflare-fronted. Requires residential IPs at scale.
 *   - ~10x slower per event than a single API GET.
 */

import { chromium } from "playwright";
import dotenv from "dotenv";

dotenv.config();

const HOME_URL = "https://seatgeek.com/";
const LISTINGS_PATH_RE = /\/api\/event_listings_v2\/(\d+)/;
const NAV_TIMEOUT_MS = 45_000;
const XHR_WAIT_MS = 15_000;
const MAX_ATTEMPTS = 2;

const SOURCE = "seatgeek";

let sharedBrowser = null;
let sharedContext = null;
let warmed = false;

function proxyConfig() {
  const server = process.env.SG_SCRAPE_PROXY?.trim();
  if (!server) return undefined;
  return {
    server,
    username: process.env.SG_SCRAPE_PROXY_USER || undefined,
    password: process.env.SG_SCRAPE_PROXY_PASS || undefined,
  };
}

async function getContext() {
  if (sharedContext) return sharedContext;
  sharedBrowser = await chromium.launch({
    headless: !process.env.SG_SCRAPE_HEADFUL,
    args: [
      "--no-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--disable-features=IsolateOrigins,site-per-process",
    ],
    proxy: proxyConfig(),
  });
  sharedContext = await sharedBrowser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 },
    locale: "en-US",
    timezoneId: "America/New_York",
  });
  await sharedContext.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, "languages", {
      get: () => ["en-US", "en"],
    });
  });
  return sharedContext;
}

async function warmSession(ctx) {
  if (warmed) return;
  const page = await ctx.newPage();
  try {
    await page.goto(HOME_URL, {
      waitUntil: "domcontentloaded",
      timeout: NAV_TIMEOUT_MS,
    });
    await page.waitForTimeout(2500);
    warmed = true;
  } finally {
    await page.close();
  }
}

export async function closeSgScraper() {
  warmed = false;
  try {
    if (sharedContext) await sharedContext.close();
  } catch {}
  try {
    if (sharedBrowser) await sharedBrowser.close();
  } catch {}
  sharedContext = null;
  sharedBrowser = null;
}

function mapMarketToInventoryType(m) {
  const v = (m || "").toString().toLowerCase();
  if (v === "exchange") return "sg_primary";
  if (v.includes("fan")) return "fan_resale";
  if (v.includes("market") || v === "open") return "resale";
  return "resale";
}

/**
 * Web XHR uses shortened keys that overlap heavily with the API but drift
 * from release to release. Read defensively via multiple aliases.
 */
function pick(obj, ...keys) {
  for (const k of keys) if (obj?.[k] !== undefined) return obj[k];
  return undefined;
}

function normalizeListing(raw, eventMeta) {
  const section = String(pick(raw, "s", "section", "sectionFull") ?? "");
  const row = String(pick(raw, "r", "row") ?? "");
  const qty = Number(pick(raw, "q", "quantity") ?? 0);
  const priceAllIn = Number(
    pick(raw, "pf", "priceWithFees", "dp", "displayPrice") ?? 0,
  );
  const priceBase = Number(pick(raw, "p", "price") ?? 0);
  const market = pick(raw, "m", "marketplace", "source");
  const seats = pick(raw, "seats", "seat_numbers");

  return {
    source: SOURCE,
    eventId: String(eventMeta?.id ?? ""),
    eventName: eventMeta?.name ?? "",
    venue: eventMeta?.venue ?? "",
    startDate: eventMeta?.startDate ?? "",

    row,
    section,
    selection: mapMarketToInventoryType(market),
    offerId: "",
    listingId: String(pick(raw, "id", "listing_id", "lid") ?? ""),
    places: [],
    seats: Array.isArray(seats) ? seats.map(String) : [],
    lowSeat: 0,
    highSeat: 0,
    count: qty,

    price: priceAllIn || priceBase,
    wholesalePrice: 0,
    dealScore: pick(raw, "ds", "dealScore") ?? null,
    currency: "USD",

    stockType: pick(raw, "st", "stockType") ?? "",
    deliveryMethod: pick(raw, "dm", "deliveryType", "delivery_method") ?? "",
    inHandDate: pick(raw, "ihd", "inHandDate") ?? "",
    instantDelivery: !!pick(raw, "idl", "instantDelivery"),
    splits: [],

    accessibility: pick(raw, "wa") ? "wheelchair" : "",
    attributes: [
      pick(raw, "lv", "limitedView") ? "limited" : null,
      pick(raw, "sro") ? "sro" : null,
    ].filter(Boolean),

    tags: {
      market: market ?? null,
      limitedView: !!pick(raw, "lv", "limitedView"),
      sro: !!pick(raw, "sro"),
      raw: undefined,
    },
  };
}

async function fetchListingsForEvent(ctx, eventUrl, eventId) {
  const page = await ctx.newPage();
  let capturedBody = null;
  let capturedStatus = 0;

  const listener = async (res) => {
    const url = res.url();
    const m = url.match(LISTINGS_PATH_RE);
    if (!m) return;
    if (eventId && m[1] !== String(eventId)) return;
    if (capturedBody) return;
    capturedStatus = res.status();
    try {
      capturedBody = await res.json();
    } catch {
      try {
        capturedBody = JSON.parse(await res.text());
      } catch {
        capturedBody = null;
      }
    }
  };
  page.on("response", listener);

  try {
    await page.goto(eventUrl, {
      waitUntil: "domcontentloaded",
      timeout: NAV_TIMEOUT_MS,
    });

    const deadline = Date.now() + XHR_WAIT_MS;
    while (!capturedBody && Date.now() < deadline) {
      await page.waitForTimeout(400);
    }
  } finally {
    page.off("response", listener);
    await page.close();
  }

  if (!capturedBody) {
    throw new Error(
      `[SG scrape] no event_listings_v2 XHR captured for ${eventId} (status seen: ${capturedStatus})`,
    );
  }
  return capturedBody;
}

/**
 * Same signature as sgBrokerFetcher.fetchSgEventInventory so callers can
 * pick between paths with a factory. The web endpoint is keyed by numeric
 * event_id, but the event URL (with slug) is what the browser navigates to;
 * pass either or both.
 *
 * @param {string|number} eventId
 * @param {object} [opts]
 * @param {string} [opts.eventUrl]  full seatgeek.com/.../<id> URL. If omitted,
 *   we try the id-only fallback URL, which redirects to the canonical slug.
 * @returns {Promise<{event, listings, refreshedAt, cacheHit, source}>}
 */
export async function fetchSgEventInventory(eventId, opts = {}) {
  if (!eventId) throw new Error("fetchSgEventInventory: eventId is required");
  const eventUrl = opts.eventUrl || `https://seatgeek.com/e/${eventId}`;

  const ctx = await getContext();
  await warmSession(ctx);

  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const body = await fetchListingsForEvent(ctx, eventUrl, eventId);
      const eventMeta = body?.event ?? {
        id: eventId,
        name: body?.eventName,
        venue: body?.venue,
        startDate: body?.startDate,
      };
      const raw = Array.isArray(body?.listings)
        ? body.listings
        : Array.isArray(body)
          ? body
          : [];
      const listings = raw.map((l) => normalizeListing(l, eventMeta));

      return {
        source: SOURCE,
        event: eventMeta,
        listings,
        refreshedAt: new Date().toISOString(),
        cacheHit: false,
      };
    } catch (err) {
      lastError = err;
      warmed = false;
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
  }
  throw lastError;
}

export const __internal = {
  normalizeListing,
  mapMarketToInventoryType,
  pick,
};

export default fetchSgEventInventory;
