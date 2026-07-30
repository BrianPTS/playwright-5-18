/**
 * SeatGeek event job — analog of ScrapeEvent for TM, invoked by
 * scraperManager when an event's Source field is "seatgeek".
 *
 * Contract mirrors scrapeEventWithNaturalBehavior's return: boolean success
 * (true → processed, false → skip / non-fatal, throw on hard failure).
 *
 * Persistence: writes normalized listings onto the Event doc in Redis
 * (live store) under `SgListings` + `SgRefreshedAt`. Downstream CSV
 * emitters read from the same event doc, so no schema changes required.
 */

import { fetchSgEventInventory } from "./sgFetcherFactory.js";
import redisLiveStore from "../helpers/RedisLiveStore.js";

const SOURCE = "seatgeek";

export async function runSgEventJob(eventDoc, { logger } = {}) {
  const eventId = eventDoc?.Event_ID || eventDoc?.eventId;
  const sgEventId =
    eventDoc?.SgEventId || eventDoc?.External_SG_ID || eventDoc?.Sg_Event_ID;
  const eventUrl =
    eventDoc?.SgEventUrl || eventDoc?.Sg_URL || eventDoc?.SgUrl;

  if (!eventId) throw new Error("[SG job] missing Event_ID on event doc");
  if (!sgEventId) {
    (logger || console.log)(
      `[SG job] event ${eventId} has no SG event id — skipping`,
    );
    return false;
  }

  const t0 = Date.now();
  const { event, listings, refreshedAt, cacheHit } =
    await fetchSgEventInventory(sgEventId, { eventUrl });

  await redisLiveStore.updateEvent(eventId, {
    Source: SOURCE,
    SgEventId: String(sgEventId),
    SgListings: listings,
    SgListingsCount: listings.length,
    SgRefreshedAt: refreshedAt,
    SgCacheHit: !!cacheHit,
    SgEventMeta: event,
    Last_Updated: new Date(),
  });

  (logger || console.log)(
    `[SG job] ${eventId} (sg=${sgEventId}) → ${listings.length} listings in ${Date.now() - t0}ms`,
  );
  return true;
}

export default runSgEventJob;
