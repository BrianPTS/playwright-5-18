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
  testSeatFormatting,
} from "../controllers/eventController.js";

const router = express.Router();

router.get("/", getAllEvents);
router.get("/:eventId", getEventById);
router.post("/", createEvent);
router.post("/:eventId/start", startEventScraping);
router.post("/:eventId/stop", stopEventScraping);
router.delete("/:eventId", deleteEvent);

// Add stale event handling routes
router.post("/handle-stale", handleStaleEvents);
router.get("/stale-stats", getStaleEventStats);

// Add testing routes
router.post("/test-seats", testSeatFormatting);

export default router;
