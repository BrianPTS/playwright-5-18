import mongoose from "mongoose";

/**
 * EventRowMap — permanent per-event cache of Ticketmaster's front-to-back
 * row order for each section. Shared with the scraper-5-18 app so the
 * dominated-listings ranker can look up the true row index from a single
 * successful map fetch, forever.
 *
 * Keyed by (eventId, section). rows[] is stored in the exact TM order:
 * rows[0] = closest to stage. source records which fetch path filled it:
 *   mapsapi   — helpers/seatBatch.js after GetMapSeats returned data
 *   discovery — lib/tmDiscoveryMapFetcher.js SVG fallback
 *   manual    — admin override
 */

const eventRowMapSchema = new mongoose.Schema(
  {
    eventId: { type: String, required: true },
    venue: { type: String, default: "" },
    section: { type: String, required: true },
    rows: { type: [String], default: [] },
    source: {
      type: String,
      enum: ["mapsapi", "discovery", "manual"],
      default: "mapsapi",
    },
    lastFetchedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

eventRowMapSchema.index({ eventId: 1, section: 1 }, { unique: true });

export const EventRowMap =
  mongoose.models.EventRowMap ||
  mongoose.model("EventRowMap", eventRowMapSchema);

// Back-compat alias — earlier code referenced VenueRowMap.
export const VenueRowMap = EventRowMap;
