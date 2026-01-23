/**
 * @file Date and time utility functions
 * @description Centralized date formatting to eliminate duplication across the codebase.
 *
 * Key exports:
 * - formatTimestamp() - Standard timestamp format (YYYY-MM-DD HH:mm:ss)
 * - formatDate() - Date only format (YYYY-MM-DD) 
 * - formatTimestampWithMs() - Timestamp with milliseconds
 * - calculateRuntime() - Duration calculation
 * - formatInHandDate() - Event date formatting
 *
 * Replaces duplicate patterns in:
 * - AdvancedScraperLogger.js (4+ patterns)
 * - ScraperLogger.js
 * - DatabaseManager.js 
 * - seatBatch.js
 */

import moment from "moment";

/**
 * Formats a date into standard timestamp format: YYYY-MM-DD HH:mm:ss
 * @param {Date|moment|string} date - Date to format (defaults to now)
 * @returns {string} Formatted timestamp
 */
export function formatTimestamp(date = new Date()) {
  return moment(date).format('YYYY-MM-DD HH:mm:ss');
}

/**
 * Formats a date into standard timestamp with milliseconds: YYYY-MM-DD HH:mm:ss.SSS
 * @param {Date|moment|string} date - Date to format (defaults to now)
 * @returns {string} Formatted timestamp with milliseconds
 */
export function formatTimestampWithMs(date = new Date()) {
  return moment(date).format('YYYY-MM-DD HH:mm:ss.SSS');
}

/**
 * Formats a date into date-only format: YYYY-MM-DD
 * @param {Date|moment|string} date - Date to format (defaults to now)
 * @returns {string} Formatted date
 */
export function formatDate(date = new Date()) {
  return moment(date).format('YYYY-MM-DD');
}

/**
 * Calculates runtime duration from a start time
 * @param {moment|Date} startTime - The start time to calculate from
 * @returns {moment.Duration} Duration object
 */
export function calculateRuntime(startTime) {
  return moment.duration(moment().diff(startTime));
}

/**
 * Formats in-hand date for events (commonly used pattern)
 * @param {string|Date} inHandDate - Event in-hand date
 * @returns {string} Formatted date or empty string if invalid
 */
export function formatInHandDate(inHandDate) {
  if (!inHandDate) return '';
  return moment(inHandDate).format('YYYY-MM-DD');
}

/**
 * Gets current timestamp for database updates
 * @returns {string} Current timestamp in database format
 */
export function getDatabaseTimestamp() {
  return moment().format('YYYY-MM-DD HH:mm:ss');
}

/**
 * Creates a moment instance (wrapper for consistency)
 * @param {Date|string} date - Date to create moment from
 * @returns {moment.Moment} Moment instance
 */
export function createMoment(date) {
  return moment(date);
}