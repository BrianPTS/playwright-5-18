import express from "express";
import {
  getAllEvents,
  getEventById,
  createEvent,
  startEventScraping,
  stopEventScraping,
  deleteEvent,
  handleStaleEvents,
  getStaleEventStats,
} from "../controllers/eventController.js";

const router = express.Router();

router.get("/", getAllEvents);
router.get("/:eventId", getEventById);
router.post("/", createEvent);
router.post("/:eventId/start", startEventScraping);
router.post("/:eventId/stop", stopEventScraping);
router.delete("/:eventId", deleteEvent);

// Stale event monitoring (now Redis-powered)
router.post("/handle-stale", handleStaleEvents);
router.get("/stale-stats", getStaleEventStats);

export default router;
