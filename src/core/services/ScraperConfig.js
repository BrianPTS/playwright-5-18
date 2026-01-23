/**
 * Scraper Configuration Service
 * Centralizes all scraper-related configuration and constants
 * Following nodejs-backend patterns for configuration management
 */

import config from '../../../config/scraperConfig.js';

/**
 * Core scraper configuration constants
 */
export class ScraperConfig {
  // Processing intervals
  static MAX_UPDATE_INTERVAL = config.MAX_UPDATE_INTERVAL;
  static MAX_RETRIES = config.MAX_RETRIES;
  static SCRAPE_TIMEOUT = config.SCRAPE_TIMEOUT;
  static MIN_TIME_BETWEEN_EVENT_SCRAPES = config.MIN_TIME_BETWEEN_EVENT_SCRAPES;
  static MAX_ALLOWED_UPDATE_INTERVAL = 180000; // 3 minutes
  static EVENT_FAILURE_THRESHOLD = 120000; // 2 minutes
  static STALE_EVENT_THRESHOLD = 600000; // 10 minutes
  
  // Recovery intervals
  static CRITICAL_RECOVERY_INTERVAL = config.PROCESSING_INTERVAL * 20;
  static AGGRESSIVE_RECOVERY_INTERVAL = config.PROCESSING_INTERVAL * 40;
  static STANDARD_RECOVERY_INTERVAL = config.PROCESSING_INTERVAL * 60;
  static AUTO_STOP_CHECK_INTERVAL = config.PROCESSING_INTERVAL * 120;
  static DISABLE_AUTO_STOP = true;
  
  // Cookie and session management
  static COOKIE_EXPIRATION_MS = 10 * 60 * 1000; // 10 minutes
  static SESSION_REFRESH_INTERVAL = 10 * 60 * 1000; // 10 minutes
  static MIN_VALID_COOKIES = 3;
  
  // Logging
  static LOG_LEVEL = 3;
  
  // Essential cookies for Ticketmaster
  static ESSENTIAL_COOKIES = [
    "TMUO",
    "TMPS", 
    "TM_TKTS",
    "SESSION",
    "audit",
    "CMPS",
    "CMID",
    "MUID",
    "au_id",
    "aud",
    "tmTrackID",
    "TapAd_DID"
  ];
  
  /**
   * Get recovery interval based on priority level
   */
  static getRecoveryInterval(priority = 'standard') {
    switch (priority) {
      case 'critical': return this.CRITICAL_RECOVERY_INTERVAL;
      case 'aggressive': return this.AGGRESSIVE_RECOVERY_INTERVAL;
      case 'auto-stop': return this.AUTO_STOP_CHECK_INTERVAL;
      default: return this.STANDARD_RECOVERY_INTERVAL;
    }
  }
  
  /**
   * Check if auto-stop is disabled
   */
  static isAutoStopDisabled() {
    return this.DISABLE_AUTO_STOP;
  }
  
  /**
   * Check if cookies are valid based on count
   */
  static areValidCookies(cookies) {
    return Array.isArray(cookies) && cookies.length >= this.MIN_VALID_COOKIES;
  }
}

/**
 * Browser fingerprint service for anti-bot detection
 */
export class FingerprintService {
  static FINGERPRINT_POOL = [
    {
      language: 'en-US',
      timezone: 'America/Los_Angeles',
      platform: 'Win32',
      screen: { width: 1920, height: 1080 },
      deviceMemory: 8,
      hardwareConcurrency: 8,
      plugins: ['Widevine Content Decryption Module', 'Chrome PDF Viewer', 'Native Client']
    },
    {
      language: 'en-GB',
      timezone: 'Europe/London',
      platform: 'MacIntel',
      screen: { width: 1440, height: 900 },
      deviceMemory: 8,
      hardwareConcurrency: 4,
      plugins: ['PDF Viewer', 'QuickTime Plug-in 7.7.9', 'Java(TM) Platform SE 8 U211']
    },
    {
      language: 'fr-FR',
      timezone: 'Europe/Paris',
      platform: 'Win32',
      screen: { width: 1366, height: 768 },
      deviceMemory: 4,
      hardwareConcurrency: 4,
      plugins: ['Chrome PDF Viewer', 'Widevine Content Decryption Module']
    },
    {
      language: 'de-DE',
      timezone: 'Europe/Berlin',
      platform: 'Linux x86_64',
      screen: { width: 1920, height: 1080 },
      deviceMemory: 16,
      hardwareConcurrency: 8,
      plugins: ['Flash', 'QuickTime Plug-in', 'Java Bridge']
    },
    {
      language: 'en-US',
      timezone: 'America/New_York',
      platform: 'MacIntel',
      screen: { width: 1680, height: 1050 },
      deviceMemory: 8,
      hardwareConcurrency: 4,
      plugins: ['uBlock Origin', 'Privacy Badger', 'CanvasBlocker', 'NoScript', 'Video DownloadHelper']
    }
  ];
  
  /**
   * Get random browser fingerprint
   */
  static getRandomFingerprint() {
    return this.FINGERPRINT_POOL[Math.floor(Math.random() * this.FINGERPRINT_POOL.length)];
  }
  
  /**
   * Generate random IP address
   */
  static generateRandomIp() {
    return Array.from({ length: 4 }, () => Math.floor(Math.random() * 256)).join('.');
  }
}