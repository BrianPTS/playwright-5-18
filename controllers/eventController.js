import { Event, ConsecutiveGroup, ErrorLog } from "../models/index.js";
import scraperManager from "../scraperManager.js";
import redisLiveStore from "../helpers/RedisLiveStore.js";

// Initialize scraper manager

export const getAllEvents = async (req, res) => {
  try {
    // Read from Redis (sub-ms) — falls back to MongoDB internally
    const events = await redisLiveStore.getAllEvents();

    // Sort by Last_Updated desc & add active status
    const eventsWithStatus = events
      .sort((a, b) => new Date(b.Last_Updated || 0) - new Date(a.Last_Updated || 0))
      .map((event) => ({
        ...event,
        isActive: scraperManager.activeJobs.has(event.Event_ID),
      }));

    res.json({ status: "success", data: eventsWithStatus });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
};

export const getEventById = async (req, res) => {
  try {
    // Try Redis first (by Event_ID or mapping_id)
    const event = await redisLiveStore.findEventByIdOrMapping(req.params.eventId);
    if (!event) {
      return res.status(404).json({ status: "error", message: "Event not found" });
    }

    // Seat groups from Redis
    const seatGroups = await redisLiveStore.getSeatGroups(event.Event_ID);
    const isActive = scraperManager.activeJobs.has(event.Event_ID);

    res.json({ status: "success", data: { ...event, isActive, seatGroups } });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ status: "error", message: error.message });
  }
};

export const createEvent = async (req, res) => {
  try {
    const {
      Event_ID,
      Event_Name,
      Event_DateTime,
      Venue,
      URL,
      inHandDate,
      Available_Seats = 0,
      Skip_Scraping = true,
      Zone,
      priceIncreasePercentage = 25, // Default 25% if not provided
      mapping_id,
    } = req.body;

    // Use mapping_id directly
    const finalMappingId = mapping_id;

    if (!Event_Name || !inHandDate || !Event_DateTime || !URL || !finalMappingId) {
      return res.status(400).json({
        status: "error",
        message: "Missing required fields",
      });
    }

    // Check for existing event with same URL or mapping_id
    const existingEvent = await Event.findOne({
      $or: [
        { URL },
        { mapping_id: finalMappingId }
      ]
    });
    
    if (existingEvent) {
      return res.status(400).json({
        status: "error",
        message: existingEvent.URL === URL 
          ? "Event with this URL already exists"
          : "Event with this mapping_id already exists",
      });
    }

    const event = new Event({
      Event_ID,
      Event_Name,
      Event_DateTime,
      Venue,
      URL,
      inHandDate,
      Zone: Zone || "none",
      Available_Seats: Available_Seats || 0,
      Skip_Scraping,
      priceIncreasePercentage,
      mapping_id: finalMappingId,
      metadata: {
        iterationNumber: 0,
      },
    });

    await event.save();

    // Sync to Redis live store so all instances see the new event immediately
    await redisLiveStore.createEvent(event.toObject());

    res.status(201).json({
      status: "success",
      data: event,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({
      status: "error",
      message: error.message,
    });
  }
};

export const startEventScraping = async (req, res) => {
  try {
    const { eventId } = req.params;

    // Update MongoDB
    const event = await Event.findOneAndUpdate(
      { Event_ID: eventId },
      { Skip_Scraping: false },
      { new: true }
    );

    if (!event) {
      return res.status(404).json({ status: "error", message: "Event not found" });
    }

    // Sync to Redis — adds to active set + staleness index
    await redisLiveStore.setSkipScraping(eventId, false);

    if (scraperManager.activeJobs.has(eventId)) {
      return res.status(400).json({ status: "error", message: "Scraping is already running for this event" });
    }

    await scraperManager.scrapeEvent(eventId);
    res.json({ status: "success", message: `Scraping started for event ${eventId}`, data: event });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
};

export const stopEventScraping = async (req, res) => {
  try {
    const { eventId } = req.params;

    // Find by Event_ID or mapping_id via Redis first
    let event = await redisLiveStore.findEventByIdOrMapping(eventId);
    if (!event) {
      return res.status(404).json({ status: "error", message: "Event not found" });
    }

    const realEventId = event.Event_ID;

    // Update MongoDB
    const updatedEvent = await Event.findOneAndUpdate(
      { Event_ID: realEventId },
      { Skip_Scraping: true },
      { new: true }
    );

    // Sync to Redis — removes from active set + staleness index
    await redisLiveStore.setSkipScraping(realEventId, true);

    scraperManager.cleanupEventTracking(realEventId);

    res.json({
      status: "success",
      message: `Scraping stopped for event ${realEventId}`,
      data: updatedEvent,
    });
  } catch (error) {
    console.error("Error stopping event scraping:", error);
    res.status(500).json({ status: "error", message: error.message });
  }
};

export const deleteEvent = async (req, res) => {
  try {
    const { eventId } = req.params;

    const event = await Event.findOneAndDelete({ Event_ID: eventId });
    if (!event) {
      return res.status(404).json({ status: "error", message: "Event not found" });
    }

    // Remove from Redis (active set, staleness index, keys)
    await redisLiveStore.deleteEvent(eventId);
    scraperManager.cleanupEventTracking(eventId);

    res.json({ status: "success", message: `Event ${eventId} deleted successfully` });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
};

export const handleStaleEvents = async (req, res) => {
  try {
    const overdue = await redisLiveStore.getOverdueEvents(120000); // 2min
    res.json({
      status: "success",
      data: { overdueCount: overdue.length, events: overdue },
    });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
};

export const getStaleEventStats = async (req, res) => {
  try {
    const stats = await redisLiveStore.getStalenessStats();
    res.json({ status: "success", data: stats });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
};
