import { BrowserService, BrowserConfig } from './src/core/services/BrowserService.js';
import { CookieService, CookieConfig } from './src/core/services/CookieService.js';
import { BrowserFingerprint } from './browserFingerprint.js';

// Initialize services
const logger = {
  info: (msg) => console.log(`[INFO] ${msg}`),
  warn: (msg) => console.warn(`[WARN] ${msg}`),
  error: (msg, error) => console.error(`[ERROR] ${msg}`, error)
};

const browserService = new BrowserService({ logger });
const cookieService = new CookieService({ logger, browserService });

// Legacy browser instance for compatibility
let browser = null;









/**
 * Initialize the browser with enhanced fingerprinting
 */

/**
 * Initialize the browser with enhanced fingerprinting
 * Legacy wrapper for the new modular BrowserService
 */
async function initBrowser(proxy) {
  try {
    // Use the new modular BrowserService
    const result = await browserService.initBrowser(proxy);
    
    // Set legacy browser reference for compatibility
    browser = result.browser;
    
    // Add human-like delay before any action
    await result.page.waitForTimeout(1500 + Math.random() * 2500);
    await browserService.simulateMobileInteractions(result.page);
    
    return {
      context: result.context,
      fingerprint: result.fingerprint,
      page: result.page,
      browser: result.browser
    };
  } catch (error) {
    console.error("Error initializing browser:", error.message);
    throw error;
  }
} // Added missing closing bracket for initBrowser function

/**
 * Handle Ticketmaster challenge pages (CAPTCHA, etc.)
 */
async function handleTicketmasterChallenge(page) {
  try {
    const challengePresent = await page.evaluate(() => {
      const bodyText = document.body.textContent || '';
      const titleText = document.title || '';
      
      // Check for various challenge indicators
      return bodyText.includes("Your Browsing Activity Has Been Paused") ||
             bodyText.includes("Access Denied") ||
             bodyText.includes("Security Check") ||
             bodyText.includes("Please verify you are a human") ||
             titleText.includes("Access Denied") ||
             titleText.includes("Just a moment") ||
             document.querySelector('#px-captcha') !== null ||
             document.querySelector('.g-recaptcha') !== null;
    }).catch(() => false);

    if (challengePresent) {
      console.log(" CHALLENGE DETECTED: Bot detection triggered - aborting this session");
      console.log(" This proxy/session is compromised. Will request new proxy for retry.");
      
      // Throw error to trigger proxy rotation
      throw new Error("CHALLENGE_DETECTED_ABORT_SESSION");
    }
    
    return true;
  } catch (error) {
    if (error.message === "CHALLENGE_DETECTED_ABORT_SESSION") {
      throw error; // Re-throw to propagate up
    }
    console.warn("Challenge check failed:", error.message);
    return false;
  }
}

/**
 * Check for Ticketmaster challenge page
 */
async function checkForTicketmasterChallenge(page) {
  try {
    // Check for CAPTCHA or other blocking mechanisms
    const challengeSelector = "#challenge-running"; // Example selector for CAPTCHA
    const isChallengePresent = (await page.$(challengeSelector)) !== null;

    if (isChallengePresent) {
      console.warn("Ticketmaster challenge detected");
      return true;
    }

    // Also check via text content
    const challengePresent = await page.evaluate(() => {
      return document.body.textContent.includes(
        "Your Browsing Activity Has Been Paused"
      );
    }).catch(() => false);

    return challengePresent;
  } catch (error) {
    console.error("Error checking for Ticketmaster challenge:", error);
    return false;
  }
}

/**
 * Capture cookies from the browser
 */
async function captureCookies(page, fingerprint) {
  let retryCount = 0;
  const MAX_RETRIES = 5;
  
  while (retryCount < MAX_RETRIES) {
    try {
      const challengePresent = await page.evaluate(() => {
        return document.body.textContent.includes(
          "Your Browsing Activity Has Been Paused"
        );
      }).catch(() => false);

      if (challengePresent) {
        console.log(
          `Attempt ${retryCount + 1}: Challenge detected during cookie capture`
        );

        const challengeResolved = await handleTicketmasterChallenge(page);
        if (!challengeResolved) {
          if (retryCount === MAX_RETRIES - 1) {
            console.log("Max retries reached during challenge resolution");
            return { cookies: null, fingerprint };
          }
          await page.waitForTimeout(CONFIG.RETRY_DELAY);
          retryCount++;
          continue;
        }
      }

      // Get context from page's browser context
      const context = page.context();
      if (!context) {
        throw new Error("Cannot access browser context from page");
      }

      let cookies = await context.cookies().catch(() => []);

      if (!cookies?.length) {
        console.log(`Attempt ${retryCount + 1}: No cookies captured`);
        if (retryCount === MAX_RETRIES - 1) {
          return { cookies: null, fingerprint };
        }
        await page.waitForTimeout(CONFIG.RETRY_DELAY);
        retryCount++;
        continue;
      }

      // Filter out reCAPTCHA Google cookies
      cookies = cookies.filter(cookie => !cookie.name.includes('_grecaptcha') && 
                                      !cookie.domain.includes('google.com'));

      // Check if we have enough cookies from ticketmaster.com
      const ticketmasterCookies = cookies.filter(cookie => 
        cookie.domain.includes('ticketmaster.com') || 
        cookie.domain.includes('.ticketmaster.com')
      );

      if (ticketmasterCookies.length < 3) {
        console.log(`Attempt ${retryCount + 1}: Not enough Ticketmaster cookies`);
        if (retryCount === MAX_RETRIES - 1) {
          return { cookies: null, fingerprint };
        }
        await page.waitForTimeout(CONFIG.RETRY_DELAY);
        retryCount++;
        continue;
      }

      // Check JSON size
      const cookiesJson = JSON.stringify(cookies, null, 2);
      const lineCount = cookiesJson.split('\n').length;
      
      if (lineCount < 200) {
        console.log(`Attempt ${retryCount + 1}: Cookie JSON too small (${lineCount} lines)`);
        if (retryCount === MAX_RETRIES - 1) {
          return { cookies: null, fingerprint };
        }
        await page.waitForTimeout(CONFIG.RETRY_DELAY);
        retryCount++;
        continue;
      }

      const oneHourFromNow = Date.now() + CONFIG.COOKIE_REFRESH_INTERVAL;
      cookies = cookies.map((cookie) => ({
        ...cookie,
        expires: oneHourFromNow / 1000,
        expiry: oneHourFromNow / 1000,
      }));

      // Add cookies one at a time with error handling
      for (const cookie of cookies) {
        try {
          await context.addCookies([cookie]);
        } catch (error) {
          console.warn(`Error adding cookie ${cookie.name}:`, error.message);
        }
      }

      // Save cookies to file
      await saveCookiesToFile(cookies);
      console.log(`Successfully captured cookies on attempt ${retryCount + 1}`);
      return { cookies, fingerprint };
    } catch (error) {
      console.error(`Error capturing cookies on attempt ${retryCount + 1}:`, error);
      if (retryCount === MAX_RETRIES - 1) {
        return { cookies: null, fingerprint };
      }
      await page.waitForTimeout(CONFIG.RETRY_DELAY);
      retryCount++;
    }
  }

  return { cookies: null, fingerprint };
}

/**
 * Save cookies to a file
 */
async function saveCookiesToFile(cookies) {
  try {
    // Format the cookies with updated expiration
    const cookieData = cookies.map(cookie => ({
      ...cookie,
      expires: cookie.expires || Date.now() + CONFIG.COOKIE_REFRESH_INTERVAL,
      expiry: cookie.expiry || Date.now() + CONFIG.COOKIE_REFRESH_INTERVAL
    }));

    await fs.writeFile(COOKIES_FILE, JSON.stringify(cookieData, null, 2));
    console.log(`Saved ${cookies.length} cookies to ${COOKIES_FILE}`);
    return true;
  } catch (error) {
    console.error(`Error saving cookies to file: ${error.message}`);
    return false;
  }
}

/**
 * Load cookies from file
 */
/**
 * Load cookies from file
 * Legacy wrapper for the new modular CookieService
 */
async function loadCookiesFromFile() {
  try {
    return await cookieService.loadCookiesFromFile();
  } catch (error) {
    console.error('Error loading cookies from file:', error.message);
    return null;
  }
}

/**
 * Get fresh cookies by opening a browser and navigating to Ticketmaster
 * Legacy wrapper for the new modular CookieService
 */
async function refreshCookies(eventId, proxy = null, forceFresh = false) {
  try {
    // Use the new modular CookieService
    return await cookieService.refreshCookies(eventId, proxy, forceFresh);
  } catch (error) {
    console.error(`Cookie refresh failed for event ${eventId}:`, error.message);
    throw error;
  }
}

/**
 * Generate an alternative event ID for retry attempts
 * This function attempts to find a similar event or generates a fallback
 */
async function generateAlternativeEventId(originalEventId) {
  try {
    // For now, we'll generate a simple variation of the original event ID
    // In a production environment, this could query a database for similar events
    const timestamp = Date.now().toString().slice(-6);
    const randomSuffix = Math.random().toString(36).substring(2, 8);
    
    // Create a variation that's likely to be a valid event ID format
    const alternativeId = originalEventId.replace(/\d+$/, timestamp + randomSuffix);
    
    console.log(`Generated alternative event ID: ${alternativeId} from original: ${originalEventId}`);
    return alternativeId;
  } catch (error) {
    console.warn(`Failed to generate alternative event ID: ${error.message}`);
    return originalEventId; // Fallback to original
  }
}

/**
 * Get an alternative proxy for retry attempts
 * This function should integrate with your proxy management system
 */

/**
 * Clean up browser resources
 */
async function cleanup() {
  if (browser) {
    try {
      await browser.close();
      browser = null;
    } catch (error) {
      console.warn("Error closing browser:", error.message);
    }
  }
}

// Legacy wrapper functions for compatibility
const enhancedFingerprint = () => browserService.generateEnhancedFingerprint();
const getRandomLocation = () => browserService.getRandomLocation();  
const getRealisticIphoneUserAgent = () => browserService.getRealisticIphoneUserAgent();
const simulateMobileInteractions = async (page) => browserService.simulateMobileInteractions(page);

export {
  initBrowser,
  captureCookies,
  refreshCookies,
  loadCookiesFromFile,
  saveCookiesToFile,
  cleanup,
  handleTicketmasterChallenge,
  checkForTicketmasterChallenge,
  enhancedFingerprint,
  getRandomLocation,
  getRealisticIphoneUserAgent,
  generateAlternativeEventId,
  simulateMobileInteractions,
  // Export services for advanced usage
  browserService,
  cookieService
};