/**
 * @file Centralized logging utility
 * @description Unified logging system to eliminate duplicate logging patterns.
 *
 * Key exports:
 * - Logger.log() - Standard logging with levels
 * - Logger.logWithTime() - Logging with timestamps
 * - Logger.debug/info/warn/error() - Level-specific methods
 * - Logger.api() - API-specific logging
 *
 * Replaces logging in:
 * - ScraperLogger.js
 * - AdvancedScraperLogger.js
 * - ProxyManager.js logging
 * - 20+ console.log patterns across files
 */

import moment from "moment";
import * as fs from "fs";
import path from "path";

class Logger {
  constructor() {
    this.startTime = moment();
    this.logLevels = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3
    };
    this.currentLevel = process.env.LOG_LEVEL || 'info';
    this.enableFileLogging = process.env.ENABLE_FILE_LOGGING === 'true';
    this.logDirectory = process.env.LOG_DIRECTORY || './logs';
  }

  /**
   * Main logging method with timestamp and formatting
   * @param {string} message - Message to log
   * @param {string} level - Log level (debug, info, warn, error)
   * @param {string} component - Component/module name
   * @param {Object} data - Additional data to log
   */
  log(message, level = 'info', component = 'system', data = null) {
    // Check if we should log this level
    if (this.logLevels[level] < this.logLevels[this.currentLevel]) {
      return;
    }

    const timestamp = moment().format('YYYY-MM-DD HH:mm:ss.SSS');
    const emoji = this.getLevelEmoji(level);
    const componentTag = component ? `[${component.toUpperCase()}]` : '';
    
    const logLine = `${emoji} ${timestamp} ${componentTag} ${message}`;
    
    // Console output with color
    this.outputToConsole(logLine, level);
    
    // File output if enabled
    if (this.enableFileLogging) {
      this.outputToFile(logLine, level, data);
    }
  }

  /**
   * Log with execution time from start
   * @param {string} message - Message to log 
   * @param {string} level - Log level
   * @param {string} component - Component name
   */
  logWithTime(message, level = 'info', component = 'system') {
    const runtime = moment.duration(moment().diff(this.startTime));
    const runtimeStr = `[${Math.floor(runtime.asMinutes())}m ${runtime.seconds()}s]`;
    this.log(`${runtimeStr} ${message}`, level, component);
  }

  /**
   * Debug level logging
   */
  debug(message, component = 'system', data = null) {
    this.log(message, 'debug', component, data);
  }

  /**
   * Info level logging  
   */
  info(message, component = 'system', data = null) {
    this.log(message, 'info', component, data);
  }

  /**
   * Warning level logging
   */
  warn(message, component = 'system', data = null) {
    this.log(message, 'warn', component, data);
  }

  /**
   * Error level logging
   */
  error(message, component = 'system', error = null) {
    const errorData = error ? {
      message: error.message,
      stack: error.stack,
      ...error
    } : null;
    this.log(message, 'error', component, errorData);
  }

  /**
   * API-specific logging (replaces [API DEBUG] patterns)
   */
  api(message, method = 'GET', url = '', data = null) {
    const apiMessage = `${method} ${url} - ${message}`;
    this.log(apiMessage, 'info', 'api', data);
  }

  /**
   * Get emoji for log level
   */
  getLevelEmoji(level) {
    const emojis = {
      debug: '🔍',
      info: 'ℹ️ ',
      warn: '⚠️ ',
      error: '❌'
    };
    return emojis[level] || '📝';
  }

  /**
   * Output to console with colors
   */
  outputToConsole(logLine, level) {
    const colors = {
      debug: '\x1b[36m', // cyan
      info: '\x1b[37m',  // white  
      warn: '\x1b[33m',  // yellow
      error: '\x1b[31m'  // red
    };
    const reset = '\x1b[0m';
    
    const coloredLine = `${colors[level] || ''}${logLine}${reset}`;
    console.log(coloredLine);
  }

  /**
   * Output to log files
   */
  outputToFile(logLine, level, data) {
    try {
      // Ensure log directory exists
      if (!fs.existsSync(this.logDirectory)) {
        fs.mkdirSync(this.logDirectory, { recursive: true });
      }

      const logFileName = `${moment().format('YYYY-MM-DD')}.log`;
      const logFilePath = path.join(this.logDirectory, logFileName);
      
      let logEntry = logLine;
      if (data) {
        logEntry += ` DATA: ${JSON.stringify(data, null, 2)}`;
      }
      logEntry += '\n';
      
      fs.appendFileSync(logFilePath, logEntry);
    } catch (error) {
      console.error('Failed to write to log file:', error.message);
    }
  }
}

// Create singleton instance
const logger = new Logger();

// Export both class and convenience methods
export default logger;
export { Logger };

// Convenience exports that match existing patterns
export const log = (message, level, component, data) => logger.log(message, level, component, data);
export const logWithTime = (message, level, component) => logger.logWithTime(message, level, component);
export const debug = (message, component, data) => logger.debug(message, component, data);
export const info = (message, component, data) => logger.info(message, component, data);
export const warn = (message, component, data) => logger.warn(message, component, data);
export const error = (message, component, error) => logger.error(message, component, error);
export const api = (message, method, url, data) => logger.api(message, method, url, data);