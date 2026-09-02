import mongoose from "mongoose";

/**
 * VenueRowMap — permanent per-venue cache of Ticketmaster's front-to-back
 * row order for each section. Shared with the scraper-5-18 app so the
 * dominated-listings ranker can look up the true row index from a single
 * successful map fetch, forever.
 *
 * rows[] is stored in the exact TM order: rows[0] = closest to stage.
 * source records which fetch path filled it:
 *   mapsapi   — helpers/seatBatch.js after GetMapSeats returned data
 *   discovery — lib/tmDiscoveryMapFetcher.js SVG fallback
 *   manual    — admin override
 */

const venueRowMapSchema = new mongoose.Schema(
  {
    venue: { type: String, required: true },
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

venueRowMapSchema.index({ venue: 1, section: 1 }, { unique: true });

export const VenueRowMap =
  mongoose.models.VenueRowMap ||
  mongoose.model("VenueRowMap", venueRowMapSchema);
