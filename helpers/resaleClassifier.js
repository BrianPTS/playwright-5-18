/**
 * Resale Classifier
 *
 * Classifies resale listings as likely "verified_resale" (fan) or "3rd_party_resale" (broker)
 * based on listing ID clustering from the ISMDS facets response.
 *
 * How it works:
 * - Offer IDs are base32-encoded strings with structure: type|listing_id|hash
 *   - Primary offers: "2|<price_level>|<seat_id>"  (short IDs, ~10 chars)
 *   - Resale offers:  "3|<listing_id>|<hash>"       (long IDs, ~37 chars)
 * - Brokers upload inventory in bulk, creating clusters of sequential listing IDs
 * - Fans list individually, producing isolated listing IDs
 * - This clustering pattern persists even as tickets sell (IDs never change)
 *
 * Limitations:
 * - This is a heuristic, not a guarantee
 * - A fan who lists tickets for multiple events at once could appear clustered
 * - A broker who lists one pair looks isolated
 * - Ticketmaster does not expose seller type in the facets API
 *
 * Price-format signal (preferred when the event has it):
 * - TM serializes resale prices one of two ways per event. On some events (both NFL
 *   games checked) broker listings carry whole-number prices ("listPrice": 147) and
 *   fan listings one decimal ("listPrice": 147.0). On others (both Bruno Mars shows
 *   checked) every price has two decimals ("722.00") and carries no seller signal.
 * - Checked against the broker source (CIMS), Oct 2026. Price rule: Steelers vs Colts
 *   336/340 brokers, 0/1462 fans; Jets vs Browns 909/909 brokers, 0/728 fans;
 *   Tennessee vs Alabama 341/344, 0 fans. ID clustering (gap<=100, size>=3) on the
 *   two-decimal events: Bruno Oct 10 231/377, Bruno Oct 11 209/405, Usher 45/90,
 *   0 fans each. A tighter gap (25) made no difference there, so it stays at 100.
 * - So: price rule when the event uses the whole/one-decimal format, clustering when
 *   it uses two decimals. JSON.parse erases the formatting, so fetchers pass
 *   extractPriceSignal(rawText) along with the parsed response.
 */

// Base32 alphabet (RFC 4648)
const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Decode a base32 string to a Buffer
 */
function base32Decode(input) {
  // Remove any padding
  input = input.replace(/=+$/, '').toUpperCase();

  let bits = 0;
  let value = 0;
  let index = 0;
  const output = [];

  for (let i = 0; i < input.length; i++) {
    const charIndex = BASE32_CHARS.indexOf(input[i]);
    if (charIndex === -1) continue;

    value = (value << 5) | charIndex;
    bits += 5;

    if (bits >= 8) {
      output[index++] = (value >>> (bits - 8)) & 0xFF;
      bits -= 8;
    }
  }

  return Buffer.from(output);
}

/**
 * Extract listing ID from a resale offer ID
 * Returns null for primary offers or if decoding fails
 */
export function extractListingId(offerId) {
  try {
    const decoded = base32Decode(offerId).toString('ascii');
    const parts = decoded.split('|');

    // Primary offers decode to "2|..." , resale to "3|..."
    if (parts[0] !== '3' || parts.length < 2) {
      return null;
    }

    const listingId = parseInt(parts[1], 10);
    return isNaN(listingId) ? null : listingId;
  } catch {
    return null;
  }
}

const LIST_PRICE_RE = /"offerId"\s*:\s*"([A-Z0-9]+)"[^{}]*?"inventoryType"\s*:\s*"resale"[^{}]*?"listPrice"\s*:\s*(-?[\d.eE+]+)/g;

/**
 * Read the price formatting of resale offers from a raw facets/offers response.
 * Returns { wholeOfferIds, informative }: offers whose listPrice has no decimal point,
 * and whether this event uses the format that separates brokers (whole number vs one
 * decimal) rather than the uniform two-decimal format.
 * Keep in sync with the inline copies in browser-cookies.js (they run in-page).
 */
export function extractPriceSignal(rawText) {
  const wholeOfferIds = [];
  let informative = false;
  for (const m of rawText.matchAll(LIST_PRICE_RE)) {
    const price = m[2];
    if (!/[.eE]/.test(price)) {
      wholeOfferIds.push(m[1]);
      informative = true;
    } else if (/\.\d$/.test(price)) {
      informative = true;
    }
  }
  return { wholeOfferIds, informative };
}

// If every resale offer on a reasonably sized event looks whole-priced, assume TM
// changed its price formatting rather than tag the whole event broker. Real events
// can be majority broker (Jets vs Browns was 55%), so a share cap would misfire.
const MIN_OFFERS_FOR_FORMAT_CHECK = 20;

/**
 * Classify resale listings from facets data.
 *
 * @param {Array} facets - Raw facets array from the ISMDS API response
 * @param {Object} options
 * @param {number} options.clusterGap - Max gap between listing IDs to be considered same cluster (default: 100)
 * @param {number} options.minClusterSize - Min listings in a cluster to flag as broker (default: 3)
 * @param {{wholeOfferIds: string[], informative: boolean}} [options.priceSignal] - From
 *   extractPriceSignal(); used instead of clustering when informative
 * @returns {Map<string, string>} Map of offerId -> "verified_resale" | "3rd_party_resale",
 *   with a `rule` property: 'price' | 'listingId' | 'none' (which rule decided this event)
 */
export function classifyResaleListings(facets, options = {}) {
  const { clusterGap = 100, minClusterSize = 3, priceSignal } = options;

  // Step 1: Extract listing IDs from all resale facets
  const offerListingMap = new Map(); // offerId -> listingId

  for (const facet of facets) {
    if (!facet.inventoryTypes?.includes('resale')) continue;

    for (const offerId of (facet.offers || [])) {
      if (offerListingMap.has(offerId)) continue;

      const listingId = extractListingId(offerId);
      if (listingId !== null) {
        offerListingMap.set(offerId, listingId);
      }
    }
  }

  if (offerListingMap.size === 0) {
    return new Map();
  }

  if (priceSignal?.informative) {
    const wholePrice = new Set(priceSignal.wholeOfferIds);
    let wholeCount = 0;
    for (const offerId of offerListingMap.keys()) if (wholePrice.has(offerId)) wholeCount++;
    const result = new Map();
    if (offerListingMap.size >= MIN_OFFERS_FOR_FORMAT_CHECK && wholeCount === offerListingMap.size) {
      // A broker tagged fan is harmless, a fan tagged broker is not.
      console.warn(
        `[ResaleClassifier] all ${wholeCount} resale offers whole-priced; ` +
        `TM price format looks changed, tagging all fan`
      );
      for (const offerId of offerListingMap.keys()) result.set(offerId, 'verified_resale');
      result.rule = 'none';
      return result;
    }
    for (const offerId of offerListingMap.keys()) {
      result.set(offerId, wholePrice.has(offerId) ? '3rd_party_resale' : 'verified_resale');
    }
    result.rule = 'price';
    return result;
  }

  // Step 2: Sort all listing IDs and find clusters
  const entries = [...offerListingMap.entries()]
    .map(([offerId, listingId]) => ({ offerId, listingId }))
    .sort((a, b) => a.listingId - b.listingId);

  // Group into clusters based on gap threshold
  const clusters = [];
  let currentCluster = [entries[0]];

  for (let i = 1; i < entries.length; i++) {
    if (entries[i].listingId - entries[i - 1].listingId <= clusterGap) {
      currentCluster.push(entries[i]);
    } else {
      clusters.push(currentCluster);
      currentCluster = [entries[i]];
    }
  }
  clusters.push(currentCluster);

  // Step 3: Classify — clusters >= minClusterSize are likely broker
  const brokerOfferIds = new Set();

  for (const cluster of clusters) {
    if (cluster.length >= minClusterSize) {
      for (const entry of cluster) {
        brokerOfferIds.add(entry.offerId);
      }
    }
  }

  // Step 4: Build result map
  const result = new Map();
  for (const [offerId] of offerListingMap) {
    result.set(offerId, brokerOfferIds.has(offerId) ? '3rd_party_resale' : 'verified_resale');
  }
  result.rule = 'listingId';

  return result;
}

/**
 * Get classification summary for logging
 */
export function getClassificationSummary(classificationMap) {
  let fan = 0;
  let broker = 0;

  for (const type of classificationMap.values()) {
    if (type === 'verified_resale') fan++;
    else broker++;
  }

  return { fan, broker, total: fan + broker };
}

export default { classifyResaleListings, getClassificationSummary, extractListingId, extractPriceSignal };
