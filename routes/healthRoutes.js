import express from "express";
import { checkHealth, checkRedisHealth } from "../controllers/healthController.js";

const router = express.Router();

router.get("/", checkHealth);
router.get("/redis", checkRedisHealth);

export default router;
