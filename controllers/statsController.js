import { Event, ErrorLog } from "../models/index.js";
import scraperManager from "../scraperManager.js";
import redisLiveStore from "../helpers/RedisLiveStore.js";

// Initialize scraper manager

export const getStats = async (req, res) => {
  try {
    // Read counts from Redis (sub-ms) instead of MongoDB countDocuments
    const allEvents = await redisLiveStore.getAllEvents();
    const totalEvents = allEvents.length;
    const activeEvents = allEvents.filter(e => !e.Skip_Scraping).length;

    // ErrorLog stays in MongoDB (low-frequency reads, not on hot path)
    const totalErrors = await ErrorLog.countDocuments();
    const recentErrors = await ErrorLog.find().sort({ createdAt: -1 }).limit(5);

    const eventsWithChanges = allEvents
      .filter(e => e.metadata?.ticketStats?.ticketCountChange && e.metadata.ticketStats.ticketCountChange !== 0)
      .sort((a, b) => new Date(b.Last_Updated || 0) - new Date(a.Last_Updated || 0))
      .slice(0, 5);

    // Staleness / SLA stats from Redis sorted set
    const stalenessStats = await redisLiveStore.getStalenessStats();

    res.json({
      status: "success",
      data: {
        totalEvents,
        activeEvents,
        totalErrors,
        recentErrors,
        eventsWithChanges,
        stalenessStats,
        scraperStatus: {
          isRunning: scraperManager.isRunning,
          successCount: scraperManager.successCount,
          failedCount: scraperManager.failedEvents.size,
          activeJobs: Array.from(scraperManager.activeJobs.keys()),
        },
      },
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: error.message,
    });
  }
};
