/**
 * CookieService - Centralized cookie management for the scraper system
 * Following nodejs-backend patterns for clean architecture
 */

import fs from 'fs/promises';
import path from 'path';
import { BrowserFingerprint } from '../../../browserFingerprint.js';
import { createDomainError } from '../errors/index.js';

/**
 * Domain errors for cookie operations
 */
export const CookieErrors = {
  REFRESH_TIMEOUT: 'COOKIE_REFRESH_TIMEOUT',
  BROWSER_INIT_FAILED: 'BROWSER_INIT_FAILED',
  INVALID_COOKIES: 'INVALID_COOKIES',
  LOAD_FAILED: 'COOKIE_LOAD_FAILED',
  SAVE_FAILED: 'COOKIE_SAVE_FAILED'
};

/**
 * Configuration for cookie operations
 */
export const CookieConfig = {
  REFRESH_INTERVAL: 45 * 60 * 1000, // 45 minutes
  REFRESH_TIMEOUT: 4 * 60 * 1000, // 4 minutes timeout (increased for longer waits)
  MAX_RETRIES: 3,
  RETRY_DELAY: 8000,
  MAX_COOKIE_LENGTH: 8000,
  MAX_COOKIE_AGE: 7 * 24 * 60 * 60 * 1000, // 7 days
  
  ESSENTIAL_COOKIES: [
    'TMUO', 'TMPS', 'TM_TKTS', 'SESSION', 'audit',
    'CMPS', 'CMID', 'MUID', 'au_id', 'aud',
    'tmTrackID', 'TapAd_DID', 'uid'
  ],
  
  AUTH_COOKIES: ['TMUO', 'TMPS', 'TM_TKTS', 'SESSION', 'audit'],
  
  FILES: {
    COOKIES: 'cookies.json'
  }
};

/**
 * CookieService handles all cookie-related operations
 */
export class CookieService {
  constructor({ logger, browserService }) {
    this.logger = logger;
    this.browserService = browserService;
    this.cookiesPath = path.join(process.cwd(), CookieConfig.FILES.COOKIES);
    this.isRefreshing = false;
    this.refreshQueue = [];
  }

  /**
   * Load cookies from file
   * @returns {Promise<Array>} Array of cookie objects
   */
  async loadCookiesFromFile() {
    try {
      const data = await fs.readFile(this.cookiesPath, 'utf8');
      const parsed = JSON.parse(data);
      
      let cookies;
      
      // Handle different cookie file formats
      if (Array.isArray(parsed)) {
        // New simple array format
        cookies = parsed;
      } else if (parsed.cookieSets && Array.isArray(parsed.cookieSets)) {
        // Legacy complex format - extract cookies
        cookies = [];
        parsed.cookieSets.forEach(cookieSet => {
          if (cookieSet.cookies && Array.isArray(cookieSet.cookies)) {
            cookies.push(...cookieSet.cookies);
          } else if (cookieSet.name && cookieSet.value) {
            cookies.push(cookieSet);
          }
        });
      } else {
        throw createDomainError(
          CookieErrors.INVALID_COOKIES,
          'Cookies file format not recognized'
        );
      }
      
      if (!Array.isArray(cookies)) {
        throw createDomainError(
          CookieErrors.INVALID_COOKIES,
          'Could not extract valid cookie array from file'
        );
      }
      
      // Validate cookies are not expired
      const now = Date.now();
      const validCookies = cookies.filter(cookie => {
        const expiry = cookie.expiry || cookie.expires;
        return expiry && (typeof expiry === 'number' ? expiry * 1000 : new Date(expiry).getTime()) > now;
      });
      
      this.logger?.info(`Loaded ${validCookies.length} valid cookies from file`);
      return validCookies;
      
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.logger?.info('No cookies file found, will create new one');
        return [];
      }
      
      this.logger?.error('Failed to load cookies from file:', error);
      throw createDomainError(
        CookieErrors.LOAD_FAILED,
        `Failed to load cookies: ${error.message}`,
        { originalError: error }
      );
    }
  }

  /**
   * Save cookies to file
   * @param {Array} cookies - Array of cookie objects
   * @returns {Promise<void>}
   */
  async saveCookiesToFile(cookies) {
    try {
      if (!Array.isArray(cookies)) {
        throw createDomainError(
          CookieErrors.INVALID_COOKIES,
          'Cookies must be an array'
        );
      }
      
      // Use simple array format - normalize cookie expiry
      const normalizedCookies = cookies.map(cookie => ({
        ...cookie,
        expires: cookie.expires || Date.now() + CookieConfig.REFRESH_INTERVAL,
        expiry: cookie.expiry || Date.now() + CookieConfig.REFRESH_INTERVAL
      }));
      
      // Save as simple array (not nested object)
      await fs.writeFile(this.cookiesPath, JSON.stringify(normalizedCookies, null, 2));
      this.logger?.info(`Saved ${cookies.length} cookies to file`);
      
    } catch (error) {
      this.logger?.error('Failed to save cookies to file:', error);
      throw createDomainError(
        CookieErrors.SAVE_FAILED,
        `Failed to save cookies: ${error.message}`,
        { originalError: error }
      );
    }
  }

  /**
   * Extract essential cookies from cookie string
   * @param {string} cookieString - Raw cookie string
   * @returns {string} Filtered cookie string with essential cookies
   */
  extractEssentialCookies(cookieString) {
    if (!cookieString || typeof cookieString !== 'string') {
      return '';
    }

    const cookieMap = new Map();
    cookieString.split(';').forEach(cookie => {
      const [name, value] = cookie.trim().split('=');
      if (name && value) {
        cookieMap.set(name, value);
      }
    });

    // Prioritize auth cookies
    const essentialCookies = [];
    
    CookieConfig.AUTH_COOKIES.forEach(name => {
      if (cookieMap.has(name)) {
        essentialCookies.push(`${name}=${cookieMap.get(name)}`);
        cookieMap.delete(name);
      }
    });

    // Add other essential cookies if we have space
    CookieConfig.ESSENTIAL_COOKIES.forEach(name => {
      if (cookieMap.has(name) && essentialCookies.length < 20) {
        essentialCookies.push(`${name}=${cookieMap.get(name)}`);
        cookieMap.delete(name);
      }
    });

    // Add remaining cookies if they fit
    if (essentialCookies.join('; ').length < CookieConfig.MAX_COOKIE_LENGTH) {
      for (const [name, value] of cookieMap.entries()) {
        const potentialCookie = `${name}=${value}`;
        if (essentialCookies.join('; ').length + potentialCookie.length + 2 < CookieConfig.MAX_COOKIE_LENGTH) {
          essentialCookies.push(potentialCookie);
        }
      }
    }

    return essentialCookies.join('; ');
  }

  /**
   * Check if cookies need refreshing
   * @param {Array} cookies - Current cookies
   * @returns {boolean} True if refresh is needed
   */
  needsRefresh(cookies) {
    if (!cookies || !Array.isArray(cookies) || cookies.length < 3) {
      return true;
    }

    const now = Date.now();
    const cookieAge = cookies[0]?.expiry ? 
      (cookies[0].expiry * 1000 - now) : 0;
      
    return cookieAge <= 0 || cookieAge > CookieConfig.REFRESH_INTERVAL;
  }

  /**
   * Refresh cookies with retry logic and queue management
   * @param {string} eventId - Event ID to use for refresh
   * @param {Object} proxy - Proxy configuration
   * @param {boolean} forceFresh - Force refresh even if cookies exist
   * @returns {Promise<Object>} Refresh result with cookies, fingerprint, and timestamp
   */
  async refreshCookies(eventId, proxy = null, forceFresh = false) {
    // Implement queue for concurrent refresh requests
    if (this.isRefreshing && !forceFresh) {
      return new Promise((resolve, reject) => {
        this.refreshQueue.push({ resolve, reject });
      });
    }

    this.isRefreshing = true;
    let retryCount = 0;
    let lastError = null;

    try {
      while (retryCount <= CookieConfig.MAX_RETRIES) {
        try {
          this.logger?.info(`Refreshing cookies for event ${eventId} (attempt ${retryCount + 1}/${CookieConfig.MAX_RETRIES + 1})`);

          // Try existing cookies on first attempt (unless forced)
          if (retryCount === 0 && !forceFresh) {
            const existingCookies = await this.loadCookiesFromFile();
            if (!this.needsRefresh(existingCookies)) {
              const cookieAge = Math.floor((existingCookies[0].expiry * 1000 - Date.now()) / 1000 / 60);
              this.logger?.info(`Using existing cookies (age: ${cookieAge} minutes)`);
              
              return {
                cookies: existingCookies,
                fingerprint: BrowserFingerprint.generate(),
                lastRefresh: Date.now(),
                fromCache: true
              };
            }
          }

          // Perform actual refresh with timeout
          const refreshResult = await this.performCookieRefresh(eventId, proxy, retryCount);
          
          // Save fresh cookies
          await this.saveCookiesToFile(refreshResult.cookies);
          
          // Process queued requests
          this.processRefreshQueue(refreshResult);
          
          return refreshResult;

        } catch (error) {
          lastError = error;
          retryCount++;
          
          this.logger?.error(`Cookie refresh attempt ${retryCount} failed:`, error.message);
          
          if (retryCount <= CookieConfig.MAX_RETRIES) {
            this.logger?.info(`Retrying in ${CookieConfig.RETRY_DELAY/1000} seconds...`);
            await new Promise(resolve => setTimeout(resolve, CookieConfig.RETRY_DELAY));
          }
        }
      }

      // All retries failed
      const finalError = createDomainError(
        CookieErrors.REFRESH_TIMEOUT,
        `Cookie refresh failed after ${CookieConfig.MAX_RETRIES + 1} attempts`,
        { lastError: lastError?.message }
      );
      
      this.processRefreshQueue(null, finalError);
      throw finalError;

    } finally {
      this.isRefreshing = false;
    }
  }

  /**
   * Perform actual cookie refresh with proper waiting and validation
   * Based on the original working implementation
   * @private
   */
  async performCookieRefresh(eventId, proxy, retryCount) {
    return new Promise(async (resolve, reject) => {
      let browserResult = null;
      
      const timeoutId = setTimeout(async () => {
        // Clean up browser on timeout
        if (browserResult && this.browserService && typeof this.browserService.cleanupBrowser === 'function') {
          await this.browserService.cleanupBrowser(browserResult).catch(e => 
            this.logger?.warn('Error cleaning up browser on timeout:', e)
          );
        }
        
        reject(createDomainError(
          CookieErrors.REFRESH_TIMEOUT,
          `Cookie refresh timeout after ${CookieConfig.REFRESH_TIMEOUT / 1000} seconds`
        ));
      }, CookieConfig.REFRESH_TIMEOUT);

      try {
        // Initialize browser context
        browserResult = await this.browserService.initBrowser(proxy);
        if (!browserResult?.context || !browserResult?.page) {
          throw createDomainError(
            CookieErrors.BROWSER_INIT_FAILED,
            'Failed to initialize browser context'
          );
        }

        const { context, page } = browserResult;

        // Navigate to event page - USE CONSERVATIVE APPROACH
        const url = `https://www.ticketmaster.com/event/${eventId}`;
        this.logger?.info(`Navigating to ${url}`);
        
        await page.goto(url, { 
          waitUntil: 'load',  // Wait for complete load
          timeout: 90000 
        });
        
        // Wait for page to be fully loaded
        await page.waitForLoadState('load');
        
        // Additional wait for scripts and cookies to load
        await page.waitForTimeout(10000);
        
        // Simple mobile interaction simulation (original approach)
        await this.browserService.simulateMobileInteractions(page);
        
        // Wait much longer for cookies to be properly set after interactions
        await page.waitForTimeout(15000);

        // Additional wait to ensure all tracking cookies are set
        await page.evaluate(() => {
          return new Promise((resolve) => {
            setTimeout(resolve, 5000);
          });
        });

        // Extract cookies using original working logic
        let cookies = await context.cookies().catch(() => []);
        
        if (!cookies?.length) {
          throw createDomainError(
            CookieErrors.INVALID_COOKIES,
            'No cookies were captured'
          );
        }
        
        // Apply original working validation logic
        // Filter out reCAPTCHA Google cookies
        cookies = cookies.filter(cookie => 
          !cookie.name.includes('_grecaptcha') && 
          !cookie.domain.includes('google.com')
        );

        // Check if we have enough cookies from ticketmaster.com
        const ticketmasterCookies = cookies.filter(cookie => 
          cookie.domain.includes('ticketmaster.com') || 
          cookie.domain.includes('.ticketmaster.com')
        );

        this.logger?.info(`Found ${ticketmasterCookies.length} Ticketmaster cookies out of ${cookies.length} total cookies`);

        if (ticketmasterCookies.length < 1) {
          throw createDomainError(
            CookieErrors.INVALID_COOKIES,
            `Not enough Ticketmaster cookies: ${ticketmasterCookies.length} found, need at least 1`
          );
        }

        // Very lenient JSON size check (reduced from 50 to 10 lines minimum)
        const cookiesJson = JSON.stringify(cookies, null, 2);
        const lineCount = cookiesJson.split('\n').length;
        
        if (lineCount < 10) {
          throw createDomainError(
            CookieErrors.INVALID_COOKIES,
            `Cookie JSON too small: ${lineCount} lines, need at least 10`
          );
        }
        
        this.logger?.info(`Captured ${cookies.length} cookies from ${url} (${ticketmasterCookies.length} Ticketmaster cookies)`);

        // Clean up browser resources properly
        if (this.browserService && typeof this.browserService.cleanupBrowser === 'function') {
          await this.browserService.cleanupBrowser(browserResult);
        } else {
          await context.close().catch(e => this.logger?.warn('Context cleanup error:', e));
        }

        clearTimeout(timeoutId);
        resolve({
          cookies,
          fingerprint: BrowserFingerprint.generate(),
          lastRefresh: Date.now(),
          fromCache: false
        });

      } catch (error) {
        // Ensure browser cleanup even on error
        if (this.browserService && typeof this.browserService.cleanupBrowser === 'function' && browserResult) {
          await this.browserService.cleanupBrowser(browserResult).catch(e => 
            this.logger?.warn('Error cleaning up browser on error:', e)
          );
        } else if (browserResult?.context) {
          await browserResult.context.close().catch(e => this.logger?.warn('Context cleanup error on error:', e));
        }
        
        clearTimeout(timeoutId);
        reject(error);
      }
    });
  }

  /**
   * Process queued refresh requests
   * @private
   */
  processRefreshQueue(result, error = null) {
    const queue = [...this.refreshQueue];
    this.refreshQueue = [];

    queue.forEach(({ resolve, reject }) => {
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    });
  }

  /**
   * Start periodic cookie refresh
   * @param {Function} getEventId - Function to get random event ID
   * @returns {NodeJS.Timeout} Interval ID
   */
  startPeriodicRefresh(getEventId) {
    const refreshInterval = 10 * 60 * 1000; // Exactly 10 minutes
    
    const intervalId = setInterval(async () => {
      try {
        const eventId = await getEventId();
        if (eventId) {
          this.logger?.info('Starting periodic cookie refresh...');
          await this.refreshCookies(eventId, null, true); // Force fresh cookies
          this.logger?.info('Periodic cookie refresh completed successfully');
        } else {
          this.logger?.warn('No event ID available for periodic cookie refresh');
        }
      } catch (error) {
        this.logger?.error('Periodic cookie refresh failed:', error.message);
        // Continue the interval even on error - don't let one failure stop the schedule
      }
    }, refreshInterval);

    this.logger?.info(`Started periodic cookie refresh with exactly ${Math.floor(refreshInterval/60000)} minute interval`);
    
    // Do an immediate refresh on start
    setTimeout(async () => {
      try {
        const eventId = await getEventId();
        if (eventId) {
          this.logger?.info('Running initial periodic cookie refresh...');
          await this.refreshCookies(eventId, null, true);
        }
      } catch (error) {
        this.logger?.warn('Initial periodic refresh failed:', error.message);
      }
    }, 5000); // 5 seconds after start
    
    return intervalId;
  }
}