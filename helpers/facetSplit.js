/**
 * Cold/hot facet split + per-event map cache.
 *
 * TM's ISMDS facets endpoint returns a mix of static metadata (section shapes,
 * area/description lookups, accessibility markers) and volatile data (offers,
 * available places). Static fields don't change between polls; re-downloading
 * them every 60s is wasted proxy bandwidth.
 *
 * Modes:
 *   'off'        — one full-param facet call every poll (current behaviour).
 *   'embed'      — SAFE. Hot call drops `embed=description` and `embed=area`
 *                  only. Grouping in the `facets` array is unchanged, so
 *                  merging back the `_embedded.description` / `_embedded.area`
 *                  lookup blocks from the cold cache is a plain object copy.
 *                  ~15–25% smaller hot payload. Zero grouping risk.
 *   'aggressive' — Drops `by=shape+attributes+accessibility+description`
 *                  from hot as well. Requires a placeId-level enrichment
 *                  from the cold cache before `GenerateNanoPlaces` is called.
 *                  ~50–60% smaller hot payload. Higher risk — validate in
 *                  shadow mode against real production polls before cutting
 *                  over.
 *
 * The mapsapi placeDetailNoKeys response is also cached per-event for 24h.
 * It never changes for the life of an event.
 */

import { getRedisClient, isRedisReady } from '../config/redis.js';

const COLD_FACET_TTL_SEC = 24 * 60 * 60;
const MAP_TTL_SEC = 24 * 60 * 60;
const COLD_KEY = (id) => `facet:cold:${id}`;
const MAP_KEY = (id) => `map:cache:${id}`;

const FACET_BASE = 'https://services.ticketmaster.com/api/ismds/event';
const APIKEY = 'b462oi7fic6pehcdkzony5bxhe';
const APISECRET = 'pquzpfrfz7zd2ylvtz3w5dtyse';
const RESALE_CHANNEL = 'internal.ecommerce.consumer.desktop.web.browser.ticketmaster.us';

const FULL_BY = 'section+shape+attributes+available+accessibility+offer+inventoryTypes+offerTypes+description';
const FULL_EMBED = 'embed=offer&embed=description&embed=area';

// 'embed' mode — same by=, drop static embed lookup blocks
const EMBED_HOT_EMBED = 'embed=offer';
const EMBED_COLD_BY = 'section+shape+attributes+accessibility+description';
const EMBED_COLD_EMBED = 'embed=description&embed=area';

// 'aggressive' mode — drop static per-facet fields too
const AGG_HOT_BY = 'section+available+offer+inventoryTypes+offerTypes';
const AGG_HOT_EMBED = 'embed=offer';
const AGG_COLD_BY = 'section+shape+attributes+accessibility+description';
const AGG_COLD_EMBED = 'embed=description&embed=area';

function buildUrl(eventId, by, embed, hot) {
  const cacheBuster = Date.now();
  const rand = Math.floor(Math.random() * 1_000_000);
  const q = hot ? '&q=available' : '';
  return (
    `${FACET_BASE}/${eventId}/facets?by=${by}` +
    `&show=places+inventoryTypes+offerTypes&${embed}${q}` +
    `&compress=places&resaleChannelId=${RESALE_CHANNEL}` +
    `&apikey=${APIKEY}&apisecret=${APISECRET}` +
    `&_=${cacheBuster}${hot ? `&t=${rand}` : ''}`
  );
}

export function facetUrls(eventId, mode) {
  if (mode === 'embed') {
    return {
      hot: buildUrl(eventId, FULL_BY, EMBED_HOT_EMBED, true),
      cold: buildUrl(eventId, EMBED_COLD_BY, EMBED_COLD_EMBED, false),
    };
  }
  if (mode === 'aggressive') {
    return {
      hot: buildUrl(eventId, AGG_HOT_BY, AGG_HOT_EMBED, true),
      cold: buildUrl(eventId, AGG_COLD_BY, AGG_COLD_EMBED, false),
    };
  }
  return { full: buildUrl(eventId, FULL_BY, FULL_EMBED, true) };
}

export function mapUrl(eventId) {
  const cacheBuster = Date.now();
  return (
    `https://mapsapi.tmol.io/maps/geometry/3/event/${eventId}` +
    `/placeDetailNoKeys?useHostGrids=true&app=CCP&sectionLevel=true&systemId=HOST` +
    `&_=${cacheBuster}`
  );
}

async function redisGetJson(key) {
  if (!isRedisReady()) return null;
  try {
    const raw = await getRedisClient().get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.warn(`[facetSplit] redis get(${key}) failed: ${e.message}`);
    return null;
  }
}

async function redisSetJson(key, value, ttlSec) {
  if (!isRedisReady()) return false;
  try {
    await getRedisClient().set(key, JSON.stringify(value), 'EX', ttlSec);
    return true;
  } catch (e) {
    console.warn(`[facetSplit] redis set(${key}) failed: ${e.message}`);
    return false;
  }
}

/**
 * Merge cold + hot in 'embed' mode.
 * Hot response is the base; we only need to attach `_embedded.description`
 * and `_embedded.area` from the cold snapshot.
 */
function mergeEmbedMode(hot, cold) {
  if (!hot) return hot;
  const merged = { ...hot };
  merged._embedded = { ...(hot._embedded || {}) };
  if (cold?._embedded?.description && !merged._embedded.description) {
    merged._embedded.description = cold._embedded.description;
  }
  if (cold?._embedded?.area && !merged._embedded.area) {
    merged._embedded.area = cold._embedded.area;
  }
  // attribute / accessibility embedded lookups — pass through if TM emits them
  if (cold?._embedded?.attribute && !merged._embedded.attribute) {
    merged._embedded.attribute = cold._embedded.attribute;
  }
  return merged;
}

/**
 * Build a placeId → per-place metadata index from a cold response.
 * Each cold facet row has a compressed `places` string that expands to a set
 * of placeIds sharing the same (accessibility, description, attributes,
 * shape, areas). We index each placeId to the row's metadata so we can
 * enrich hot facets that omit these fields.
 *
 * Import GenerateNanoPlaces lazily to avoid a circular-import risk.
 */
async function buildColdPlaceIndex(cold) {
  if (!cold?.facets?.length) return { placeIndex: new Map(), sectionIndex: new Map() };
  const { default: GenerateNanoPlaces } = await import('./seats.js');

  // Pre-fill missing fields so GenerateNanoPlaces doesn't crash on cold rows
  // that lack the volatile fields (offers/inventoryTypes) — we only need
  // section/row/place → static metadata.
  const safeFacets = cold.facets.map((f) => ({
    ...f,
    offers: Array.isArray(f.offers) ? f.offers : [],
    inventoryTypes: Array.isArray(f.inventoryTypes) ? f.inventoryTypes : [],
    accessibility: Array.isArray(f.accessibility) ? f.accessibility : [],
    attributes: f.attributes ?? [],
    areas: Array.isArray(f.areas) ? f.areas : [],
    description: f.description ?? '',
  }));

  const nano = GenerateNanoPlaces(safeFacets);
  const placeIndex = new Map();
  const sectionIndex = new Map();
  for (const row of nano) {
    const placeId = Array.isArray(row.places) ? row.places[0] : row.places;
    if (placeId && !placeIndex.has(placeId)) {
      placeIndex.set(placeId, {
        accessibility: row.accessibility ?? '',
        description: row.descriptionId ?? '',
        attributes: row.attributes ?? [],
        areas: row.areas ?? [],
        section: row.section ?? '',
        row: row.row ?? '',
      });
    }
    if (row.section) sectionIndex.set(row.section, true);
  }
  return { placeIndex, sectionIndex };
}

/**
 * Aggressive-mode merge. Hot facets are missing static per-place fields;
 * enrich the hot response by looking each hot facet's places up in the cold
 * placeIndex and back-filling the row-level fields with the majority value
 * for that group. Falls back to permissive defaults if a place is unknown.
 */
async function mergeAggressiveMode(hot, cold) {
  if (!hot?.facets?.length) return mergeEmbedMode(hot, cold);
  const { placeIndex } = await buildColdPlaceIndex(cold);

  // For each hot facet row we take the first known place's metadata as the
  // row's static metadata. In the aggressive `by=` we dropped shape/attrs/
  // description/accessibility, so TM groups by (section, available, offers,
  // inv/offerTypes) — that grouping is a superset of the cold grouping w.r.t
  // the dropped fields, so within a hot row every place *should* share
  // section/row but MAY straddle description/attribute values. We attach
  // the first-place value; downstream code treats it as a hint, not a key.
  const enriched = hot.facets.map((f) => {
    let sample = null;
    if (Array.isArray(f.places) && f.places.length > 0) {
      const firstId = extractFirstPlaceId(f.places[0]);
      if (firstId) sample = placeIndex.get(firstId);
    }
    const out = { ...f };
    if (out.accessibility === undefined) {
      out.accessibility = sample?.accessibility ? [sample.accessibility].filter(Boolean) : [];
    }
    if (out.description === undefined) {
      out.description = sample?.description ?? '';
    }
    if (out.attributes === undefined) {
      out.attributes = sample?.attributes ?? [];
    }
    if (!Array.isArray(out.areas) || out.areas.length === 0) {
      out.areas = sample?.areas ?? [];
    }
    return out;
  });

  return mergeEmbedMode({ ...hot, facets: enriched }, cold);
}

/**
 * Cheap first-placeId extractor from a compressed places string.
 * Full decompression happens in helpers/seats.js — here we only need the
 * first token to look up static metadata.
 */
function extractFirstPlaceId(compressed) {
  if (!compressed || typeof compressed !== 'string') return null;
  // Compressed format is base32-ish with bracket/comma expansion; the head
  // token before any '[' or ',' is the first place prefix. We use up to the
  // first delimiter and treat that plus the enclosing structure as best-effort.
  const cut = compressed.search(/[[,]/);
  return cut === -1 ? compressed : compressed.slice(0, cut);
}

/**
 * Detect whether the cold cache is stale for this hot response.
 * Trigger a cold refresh if:
 *  - any hot section is not present in the cold section index
 *  - any hot placeId (sampled) is not in the cold place index
 */
export async function shouldRefreshCold(hot, cold) {
  if (!hot || !cold) return true;
  if (!Array.isArray(hot.facets) || !Array.isArray(cold.facets)) return true;

  const coldSections = new Set(cold.facets.map((f) => f.section).filter(Boolean));
  for (const f of hot.facets) {
    if (f.section && !coldSections.has(f.section)) return true;
  }

  const { placeIndex } = await buildColdPlaceIndex(cold);
  let sampled = 0;
  for (const f of hot.facets) {
    if (sampled >= 20) break;
    if (!Array.isArray(f.places) || !f.places[0]) continue;
    const pid = extractFirstPlaceId(f.places[0]);
    if (pid && !placeIndex.has(pid)) return true;
    sampled += 1;
  }
  return false;
}

/**
 * High-level entry point.
 *
 * batchFn(urls) is called with a list of URL descriptors and should return
 * a parallel array of { success, data, error } — matches the interface
 * of scraper.js `browserPagePool.submitRequests`.
 */
export async function fetchFacetsSplit({
  eventId,
  mode,
  batchFn,
  hotHeaders,
  coldHeaders = null,
}) {
  const urls = facetUrls(eventId, mode);

  if (mode === 'off' || !mode) {
    const [result] = await batchFn([{ url: urls.full, headers: hotHeaders }]);
    return {
      merged: result?.success ? result.data : null,
      mode: 'off',
      coldHit: false,
      coldRefreshed: false,
    };
  }

  let cold = await redisGetJson(COLD_KEY(eventId));
  const coldHit = !!cold;

  // Fetch the hot payload. If we don't have a cold snapshot yet we fire both
  // in one batched round-trip.
  const batch = [{ url: urls.hot, headers: hotHeaders }];
  if (!cold) batch.push({ url: urls.cold, headers: coldHeaders || hotHeaders });

  const results = await batchFn(batch);
  const hotRes = results[0];
  const coldRes = cold ? null : results[1];

  if (!hotRes?.success) {
    return { merged: null, mode, coldHit, coldRefreshed: false, error: hotRes?.error };
  }

  if (!cold) {
    if (coldRes?.success) {
      cold = coldRes.data;
      await redisSetJson(COLD_KEY(eventId), cold, COLD_FACET_TTL_SEC);
    } else {
      // Cold fetch failed on a fresh-cache miss. Fall back to a one-shot
      // full-param call so the poll doesn't return truncated data.
      const [fullRes] = await batchFn([
        { url: buildUrl(eventId, FULL_BY, FULL_EMBED, true), headers: hotHeaders },
      ]);
      return {
        merged: fullRes?.success ? fullRes.data : null,
        mode: 'off-fallback',
        coldHit: false,
        coldRefreshed: false,
        error: fullRes?.success ? null : (fullRes?.error ?? 'cold+fallback failed'),
      };
    }
  }

  // Cold-refresh detection on cache hits — new sections or new placeIds
  let coldRefreshed = false;
  if (coldHit) {
    try {
      const stale = await shouldRefreshCold(hotRes.data, cold);
      if (stale) {
        const [refreshRes] = await batchFn([
          { url: urls.cold, headers: coldHeaders || hotHeaders },
        ]);
        if (refreshRes?.success) {
          cold = refreshRes.data;
          await redisSetJson(COLD_KEY(eventId), cold, COLD_FACET_TTL_SEC);
          coldRefreshed = true;
        }
      }
    } catch (e) {
      console.warn(`[facetSplit] cold-refresh detector failed: ${e.message}`);
    }
  }

  const merged =
    mode === 'aggressive'
      ? await mergeAggressiveMode(hotRes.data, cold)
      : mergeEmbedMode(hotRes.data, cold);

  return { merged, mode, coldHit, coldRefreshed };
}

/**
 * Per-event map cache. mapsapi placeDetailNoKeys never changes for the life
 * of a TM event id, so we cache for 24h.
 */
export async function fetchMapCached({ eventId, batchFn, headers }) {
  const cached = await redisGetJson(MAP_KEY(eventId));
  if (cached) return { data: cached, hit: true };

  const [res] = await batchFn([{ url: mapUrl(eventId), headers }]);
  if (res?.success) {
    await redisSetJson(MAP_KEY(eventId), res.data, MAP_TTL_SEC);
    return { data: res.data, hit: false };
  }
  return { data: null, hit: false, error: res?.error };
}

/**
 * Shadow-mode helper: fetch full + split in parallel and log a diff on the
 * merged output. Used to validate the split before cutting over.
 * Returns the FULL result (safe path) so downstream is untouched.
 */
export async function fetchFacetsShadow({
  eventId,
  mode,
  batchFn,
  hotHeaders,
  coldHeaders = null,
}) {
  const [fullRes, splitRes] = await Promise.all([
    batchFn([{ url: buildUrl(eventId, FULL_BY, FULL_EMBED, true), headers: hotHeaders }])
      .then((r) => r[0]),
    fetchFacetsSplit({ eventId, mode, batchFn, hotHeaders, coldHeaders }),
  ]);

  const fullData = fullRes?.success ? fullRes.data : null;
  const merged = splitRes?.merged;

  try {
    const summary = compareFacetShapes(fullData, merged);
    console.log(
      `[facetSplit:shadow] event=${eventId} mode=${mode} coldHit=${splitRes.coldHit} ` +
      `facets(full/merged)=${summary.fullFacets}/${summary.mergedFacets} ` +
      `offers=${summary.fullOffers}/${summary.mergedOffers} ` +
      `desc=${summary.fullDesc}/${summary.mergedDesc}`
    );
  } catch (e) {
    console.warn(`[facetSplit:shadow] compare failed: ${e.message}`);
  }

  return { merged: fullData, mode: 'shadow' };
}

function compareFacetShapes(a, b) {
  return {
    fullFacets: a?.facets?.length ?? 0,
    mergedFacets: b?.facets?.length ?? 0,
    fullOffers: a?._embedded?.offer?.length ?? 0,
    mergedOffers: b?._embedded?.offer?.length ?? 0,
    fullDesc: a?._embedded?.description ? Object.keys(a._embedded.description).length : 0,
    mergedDesc: b?._embedded?.description ? Object.keys(b._embedded.description).length : 0,
  };
}
