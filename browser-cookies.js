import {devices } from "patchright";
import fs from "fs/promises";
import path from "path";
import { chromium } from 'patchright'

import { BrowserFingerprint } from "./browserFingerprint.js";
// Device settings
const iphone13 = devices["iPhone 13"];

// Constants
const COOKIES_FILE = "cookies.json";

// Persistent browser context for API requests (bypasses TLS fingerprinting)
let apiBrowser = null;
let apiContext = null;
let apiPage = null;
let apiContextLock = false;
const CONFIG = {
  COOKIE_REFRESH_INTERVAL: 45 * 60 * 1000, // 45 minutes
  PAGE_TIMEOUT: 90000, // 60 seconds for page operations
  MAX_RETRIES: 5, // Reduced from 5 to fail faster
  RETRY_DELAY: 8000, // Reduced from 10s to 8s
  CHALLENGE_TIMEOUT: 15000, // 15 seconds for challenge handling
  COOKIE_REFRESH_TIMEOUT: 2 * 60 * 1000, // 2 minutes timeout for cookie refresh
  MAX_REFRESH_RETRIES: 3, // Maximum retries for cookie refresh with new proxy/event
};

let browser = null;

/**
 * Gets a random location for browser fingerprinting
 */
function getRandomLocation() {
  const locations = [
    { locale: 'en-US', timezone: 'America/Los_Angeles', latitude: 34.052235, longitude: -118.243683 },
    { locale: 'en-US', timezone: 'America/New_York', latitude: 40.712776, longitude: -74.005974 },
    { locale: 'en-US', timezone: 'America/Chicago', latitude: 41.878113, longitude: -87.629799 },
    { locale: 'en-US', timezone: 'America/Denver', latitude: 39.739235, longitude: -104.990250 },
    { locale: 'en-CA', timezone: 'America/Toronto', latitude: 43.651070, longitude: -79.347015 },
    { locale: 'en-GB', timezone: 'Europe/London', latitude: 51.507351, longitude: -0.127758 },
  ];
  
  return locations[Math.floor(Math.random() * locations.length)];
}

/**
 * Generate a realistic iPhone user agent
 */
function getRealisticIphoneUserAgent() {
  // Updated to current iOS versions as of early 2026
  const iOSVersions = ['18_0', '18_1', '18_2', '18_3', '19_0', '19_1', '19_2'];
  const version = iOSVersions[Math.floor(Math.random() * iOSVersions.length)];
  return `Mozilla/5.0 (iPhone; CPU iPhone OS ${version} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${version.split('_')[0]}.0 Mobile/15E148 Safari/604.1`;
}

/**
 * Enhance fingerprint with more browser properties
 */
function enhancedFingerprint() {
  const baseFingerprint = BrowserFingerprint.generate();
  
  // Add additional properties to make fingerprint more realistic
  return {
    ...baseFingerprint,
    webgl: {
      vendor: "Apple Inc.",
      renderer: "Apple GPU",
    },
    fonts: [
      "Arial",
      "Courier New",
      "Georgia",
      "Times New Roman",
      "Trebuchet MS",
      "Verdana"
    ],
    plugins: [
      "PDF Viewer",
      "Chrome PDF Viewer",
      "Chromium PDF Viewer",
      "Microsoft Edge PDF Viewer",
      "WebKit built-in PDF"
    ],
    screen: {
      width: 390,
      height: 844,
      availWidth: 390,
      availHeight: 844,
      colorDepth: 24,
      pixelDepth: 24
    },
    timezone: {
      offset: new Date().getTimezoneOffset()
    }
  };
}

/**
 * Simulate various mobile interactions to appear more human-like
 */
async function simulateMobileInteractions(page) {
  try {
    // Get viewport size
    const viewportSize = page.viewportSize();
    if (!viewportSize) return;
    
    // Random scroll amounts
    const scrollOptions = [
      { direction: 'down', amount: 300 },
      { direction: 'down', amount: 500 },
      { direction: 'down', amount: 800 },
      { direction: 'up', amount: 200 },
      { direction: 'up', amount: 400 }
    ];
    
    // Pick 2-3 random scroll actions
    const scrollCount = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < scrollCount; i++) {
      const option = scrollOptions[Math.floor(Math.random() * scrollOptions.length)];
      
      // Scroll with a dynamic speed
      const scrollY = option.direction === 'down' ? option.amount : -option.amount;
      await page.evaluate((y) => {
        window.scrollBy({
          top: y,
          behavior: 'smooth'
        });
      }, scrollY);
      
      // Random pause between scrolls (500-2000ms)
      await page.waitForTimeout(500 + Math.floor(Math.random() * 1500));
    }
    
    // Simulate random taps/clicks (1-2 times)
    const tapCount = 1 + Math.floor(Math.random() * 2);
    for (let i = 0; i < tapCount; i++) {
      // Random position within viewport
      const x = 50 + Math.floor(Math.random() * (viewportSize.width - 100));
      const y = 150 + Math.floor(Math.random() * (viewportSize.height - 300));
      
      await page.mouse.click(x, y);
      await page.waitForTimeout(500 + Math.floor(Math.random() * 1000));
    }
  } catch (error) {
    console.warn("Error during mobile interaction simulation:", error.message);
  }
}

/**
 * Initialize the browser with enhanced fingerprinting
 */

async function initBrowser(proxy) {
  let context = null;
  
  try {
    // Get randomized human-like properties
    const location = getRandomLocation();
    
    // For persisting browser sessions, use same browser if possible
    if (!browser || !browser.isConnected()) {
      // Launch options with enhanced stealth
      const launchOptions = {
        headless: true,
        args: [
          '--disable-blink-features=AutomationControlled',
          '--disable-features=IsolateOrigins,site-per-process',
          '--disable-web-security',
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-infobars',
          '--disable-notifications',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--disable-features=TranslateUI',
          '--disable-ipc-flooding-protection',
          '--enable-features=NetworkService,NetworkServiceInProcess',
          '--force-color-profile=srgb',
          '--metrics-recording-only',
          '--mute-audio',
          '--disable-hang-monitor',
          '--disable-prompt-on-repost',
          '--disable-sync',
          '--password-store=basic',
          '--use-mock-keychain'
        ],
        timeout: 90000,
      };

      if (proxy && typeof proxy === 'object' && proxy.proxy) {
        try {
          // Extract hostname and port from proxy string
          const proxyString = proxy.proxy;
          
          // Ensure proxyString is a string before using string methods
          if (typeof proxyString !== 'string') {
            throw new Error('Invalid proxy format: proxy.proxy must be a string, got ' + typeof proxyString);
          }
          
          // Check if proxy string is in correct format (host:port)
          if (!proxyString.includes(':')) {
            throw new Error('Invalid proxy format: ' + proxyString);
          }
          
          const [hostname, portStr] = proxyString.split(':');
          const port = parseInt(portStr) || 80;
          
          launchOptions.proxy = {
            server: `http://${hostname}:${port}`,
            username: proxy.username,
            password: proxy.password,
          };
          
          console.log(`Configuring browser with proxy: ${hostname}:${port}`);
        } catch (error) {
          throw new Error(`Invalid proxy configuration, cannot refresh cookies without proxy: ${error.message}`);
        }
      } else {
        throw new Error('Cannot refresh cookies without a valid proxy');
      }

      // Launch browser
            browser = await chromium.launch(launchOptions);
    }
    
    // Create new context with enhanced fingerprinting and stealth
    context = await browser.newContext({
      ...iphone13,
      userAgent: getRealisticIphoneUserAgent(),
      locale: location.locale,
      colorScheme: ["dark", "light"][Math.floor(Math.random() * 2)],
      timezoneId: location.timezone,
      geolocation: {
        latitude: location.latitude,
        longitude: location.longitude,
        accuracy: 100 * Math.random() + 50,
      },
      permissions: [
        "geolocation",
        "notifications",
        "microphone",
        "camera",
      ],
      deviceScaleFactor: 2 + Math.random() * 0.5,
      hasTouch: true,
      isMobile: true,
      javaScriptEnabled: true,
      acceptDownloads: true,
      ignoreHTTPSErrors: true,
      bypassCSP: true,
      extraHTTPHeaders: {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9",
        "Accept-Language": `${location.locale},en;q=0.9`,
        "Accept-Encoding": "gzip, deflate, br",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "DNT": Math.random() > 0.5 ? "1" : "0",
        "Upgrade-Insecure-Requests": "1",
        "Cache-Control": "max-age=0"
      },
      viewport: {
        width: [375, 390, 414][Math.floor(Math.random() * 3)],
        height: [667, 736, 812, 844][Math.floor(Math.random() * 4)]
      }
    });
    
    // Add stealth scripts to mask automation (Patchright compatible)
    await context.addInitScript(() => {
      // Override navigator.webdriver
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined
      });
      
      // Remove automation indicators
      try {
        delete navigator.__proto__.webdriver;
      } catch (e) {}
      
      // Override plugins to look real
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5]
      });
      
      // Override languages
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en']
      });
      
      // Mock chrome object
      window.chrome = {
        runtime: {},
        loadTimes: function() {},
        csi: function() {},
        app: {}
      };
      
      // Override permissions
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications' ?
          Promise.resolve({ state: Notification.permission }) :
          originalQuery(parameters)
      );
      
      // Add realistic connection info
      Object.defineProperty(navigator, 'connection', {
        get: () => ({
          effectiveType: '4g',
          rtt: 50,
          downlink: 10,
          saveData: false
        })
      });
      
      // Mock battery API
      Object.defineProperty(navigator, 'getBattery', {
        get: () => async () => ({
          charging: Math.random() > 0.5,
          chargingTime: 0,
          dischargingTime: Infinity,
          level: 0.5 + Math.random() * 0.5
        })
      });
      
      // Mock touch events for mobile
      window.ontouchstart = null;
      document.ontouchstart = null;
      
      // Add realistic screen properties
      Object.defineProperty(screen, 'availWidth', { get: () => window.innerWidth });
      Object.defineProperty(screen, 'availHeight', { get: () => window.innerHeight });
    });
    
    // Create a new page and simulate human behavior
    const page = await context.newPage();
    
    // Set realistic page load timeout
    page.setDefaultTimeout(CONFIG.PAGE_TIMEOUT);
    page.setDefaultNavigationTimeout(CONFIG.PAGE_TIMEOUT);
    
    // Human-like delay before any action
    await page.waitForTimeout(1500 + Math.random() * 2500);
    await simulateMobileInteractions(page);
    
    return { context, fingerprint: enhancedFingerprint(), page, browser };
  } catch (error) {
    console.error("Error initializing browser:", error.message);
    
    // Cleanup on error
    if (context) await context.close().catch(() => {});
    
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
async function loadCookiesFromFile() {
  try {
    const cookiesFile = path.join(process.cwd(), COOKIES_FILE);
    
    // Check if file exists
    try {
      await fs.access(cookiesFile);
    } catch (error) {
      console.log("Cookies file does not exist");
      return null;
    }
    
    // Read and parse
    const fileData = await fs.readFile(cookiesFile, 'utf8');
    const cookies = JSON.parse(fileData);
    
    if (!Array.isArray(cookies) || cookies.length === 0) {
      console.log("Invalid or empty cookies file");
      return null;
    }
    
    console.log(`Loaded ${cookies.length} cookies from file`);
    return cookies;
  } catch (error) {
    console.error(`Error loading cookies from file: ${error.message}`);
    return null;
  }
}

/**
 * Get fresh cookies by opening a browser and navigating to Ticketmaster
 */
async function refreshCookies(eventId, proxy = null) {
  if (!proxy || !proxy.proxy) {
    throw new Error('Cannot refresh cookies without a valid proxy');
  }
  let retryCount = 0;
  let lastError = null;
  
  while (retryCount <= CONFIG.MAX_REFRESH_RETRIES) {
    let localContext = null;
    let page = null;
    let browserInstance = null;
    let timeoutId = null;
    
    try {
      console.log(`Refreshing cookies using event ${eventId} (attempt ${retryCount + 1}/${CONFIG.MAX_REFRESH_RETRIES + 1})`);

      // Try to load existing cookies first (only on first attempt)
      if (retryCount === 0) {
        const existingCookies = await loadCookiesFromFile();
        if (existingCookies && existingCookies.length >= 3) {
          const cookieAge = existingCookies[0]?.expiry ? 
            (existingCookies[0].expiry * 1000 - Date.now()) : 0;
          
          if (cookieAge > 0 && cookieAge < CONFIG.COOKIE_REFRESH_INTERVAL) {
            console.log(`Using existing cookies (age: ${Math.floor(cookieAge/1000/60)} minutes)`);
            return {
              cookies: existingCookies,
              fingerprint: BrowserFingerprint.generate(),
              lastRefresh: Date.now()
            };
          }
        }
      }
      
      // Create a promise that will be resolved/rejected based on timeout
      const refreshPromise = new Promise(async (resolve, reject) => {
        // Set up timeout
        timeoutId = setTimeout(() => {
          reject(new Error(`Cookie refresh timeout after ${CONFIG.COOKIE_REFRESH_TIMEOUT / 1000} seconds`));
        }, CONFIG.COOKIE_REFRESH_TIMEOUT);
        
        try {

          // Initialize browser with improved error handling
          let initAttempts = 0;
          let initSuccess = false;
          let initError = null;
          
          while (initAttempts < 3 && !initSuccess) {
            try {
              const result = await initBrowser(proxy);
              if (!result || !result.context || !result.fingerprint) {
                throw new Error("Failed to initialize browser or generate fingerprint");
              }
              
              browserInstance = result.browser;
              localContext = result.context;
              page = result.page;
              
              initSuccess = true;
            } catch (error) {
              initAttempts++;
              initError = error;
              console.error(`Browser init attempt ${initAttempts} failed:`, error.message);
              await new Promise(resolve => setTimeout(resolve, 1000 * initAttempts));
            }
          }
          
          if (!initSuccess) {
            console.error("All browser initialization attempts failed");
            throw initError || new Error("Failed to initialize browser");
          }

          // Navigate to event page
          const url = `https://www.ticketmaster.com/event/${eventId}`;
          console.log(`Navigating to ${url}`);
          
          await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: CONFIG.PAGE_TIMEOUT
          });
          
          // Check if the page loaded properly
          const currentUrl = page.url();
          const pageLoadSuccessful = currentUrl.includes(`/event/${eventId}`);
          
          if (!pageLoadSuccessful) {
            console.warn(`Failed to load event page, URL: ${currentUrl}`);
            
            // Try refreshing the page
            console.log("Attempting to reload the page...");
            await page.reload({ waitUntil: "domcontentloaded", timeout: CONFIG.PAGE_TIMEOUT });
            
            const newUrl = page.url();
            const reloadSuccessful = newUrl.includes(`/event/${eventId}`);
            
            if (!reloadSuccessful) {
              console.warn(`Reload failed, URL: ${newUrl}`);
              throw new Error("Failed to load Ticketmaster event page");
            }
          }
          
          console.log(`Successfully loaded page for event ${eventId}`);
          
          // Check for Ticketmaster challenge
          const isChallengePresent = await checkForTicketmasterChallenge(page);
          if (isChallengePresent) {
            console.warn("Detected Ticketmaster challenge page, attempting to resolve...");
            await handleTicketmasterChallenge(page);
          }
          
          // Simulate human behavior
          await simulateMobileInteractions(page);
          
          // Wait for cookies to be set
          await page.waitForTimeout(2000);
          
          // Capture cookies
          const fingerprint = BrowserFingerprint.generate();
          const { cookies } = await captureCookies(page, fingerprint);
          
          if (!cookies || cookies.length === 0) {
            throw new Error("Failed to capture cookies");
          }
          
          // Clear timeout and resolve with success
          clearTimeout(timeoutId);
          resolve({
            cookies,
            fingerprint,
            lastRefresh: Date.now()
          });
        } catch (error) {
          clearTimeout(timeoutId);
          reject(error);
        }
      });
      
      // Wait for the refresh promise to complete
      const result = await refreshPromise;
      return result;
    } catch (error) {
      lastError = error;
      console.error(`Cookie refresh attempt ${retryCount + 1} failed: ${error.message}`);
      
      // Check if this was a timeout error
      const isTimeout = error.message.includes('timeout');
      
      if (isTimeout && retryCount < CONFIG.MAX_REFRESH_RETRIES) {
        console.log(`Cookie refresh timed out, will retry with new proxy and event ID`);
        
        // Generate a new event ID for retry (use a different event from the same venue/artist)
        const newEventId = await generateAlternativeEventId(eventId);
        if (newEventId && newEventId !== eventId) {
          console.log(`Using alternative event ID for retry: ${newEventId}`);
          eventId = newEventId;
        }
        
        // Get a new proxy for retry
        if (proxy) {
          const newProxy = await getAlternativeProxy(proxy);
          if (newProxy) {
            console.log(`Using alternative proxy for retry: ${newProxy.host}:${newProxy.port}`);
            proxy = newProxy;
          }
        }
      }
      
      retryCount++;
      
      // If we've exhausted all retries, throw the last error
      if (retryCount > CONFIG.MAX_REFRESH_RETRIES) {
        console.error(`All cookie refresh attempts failed after ${CONFIG.MAX_REFRESH_RETRIES + 1} tries`);
        throw lastError;
      }
      
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY * retryCount));
      
    } finally {
      // Close page and context but keep browser open for reuse
      if (page) {
        try {
          await page.close().catch(e => console.error("Error closing page:", e));
        } catch (e) {
          console.error("Error closing page in finally block:", e);
        }
      }
      
      if (localContext) {
        try {
          await localContext.close().catch(e => console.error("Error closing context:", e));
        } catch (e) {
          console.error("Error closing context in finally block:", e);
        }
      }
    }
  }
  
  // This should never be reached, but just in case
  throw lastError || new Error('Cookie refresh failed after all retries');
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
 * Initialize persistent browser context for API requests
 * This bypasses TLS fingerprinting by using real browser requests
 */
async function initApiBrowserContext(proxy = null, cookies = null) {
  // If context already exists and is valid, return it
  if (apiContext && apiBrowser && apiBrowser.isConnected()) {
    // Update cookies if provided
    if (cookies && cookies.length > 0) {
      try {
        await apiContext.clearCookies();
        const browserCookies = cookies.map(c => ({
          name: c.name,
          value: c.value,
          domain: c.domain || '.ticketmaster.com',
          path: c.path || '/',
          expires: c.expires || c.expiry || -1,
          httpOnly: c.httpOnly || false,
          secure: c.secure || true,
          sameSite: c.sameSite || 'Lax'
        }));
        await apiContext.addCookies(browserCookies);
      } catch (e) {
        console.warn('Error updating API context cookies:', e.message);
      }
    }
    return { browser: apiBrowser, context: apiContext, page: apiPage };
  }

  // Wait if context is being created
  if (apiContextLock) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    if (apiContext && apiBrowser && apiBrowser.isConnected()) {
      return { browser: apiBrowser, context: apiContext, page: apiPage };
    }
  }

  apiContextLock = true;

  try {
    const location = getRandomLocation();
    const fingerprint = BrowserFingerprint.generate('desktop');
    
    const launchOptions = {
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920,1080',
        '--disable-web-security',
        '--disable-features=IsolateOrigins',
        '--disable-site-isolation-trials',
      ],
    };

    // Configure proxy if provided
    if (proxy) {
      try {
        let proxyString = proxy.proxy || proxy;
        if (typeof proxyString !== 'string') {
          throw new Error('Invalid proxy format');
        }
        
        const [hostname, portStr] = proxyString.split(':');
        const port = parseInt(portStr) || 80;
        
        launchOptions.proxy = {
          server: `http://${hostname}:${port}`,
          username: proxy.username,
          password: proxy.password,
        };
      } catch (error) {
        console.warn('Invalid proxy for API context:', error.message);
      }
    }

    // Launch browser for API requests
    apiBrowser = await chromium.launch(launchOptions);
    
    // Create desktop context (better for API requests)
    apiContext = await apiBrowser.newContext({
      userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36`,
      locale: location.locale,
      timezoneId: location.timezone,
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
      hasTouch: false,
      isMobile: false,
      javaScriptEnabled: true,
      ignoreHTTPSErrors: true,
      extraHTTPHeaders: {
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
      }
    });

    // Add cookies if provided
    if (cookies && cookies.length > 0) {
      const browserCookies = cookies.map(c => ({
        name: c.name,
        value: c.value,
        domain: c.domain || '.ticketmaster.com',
        path: c.path || '/',
        expires: c.expires || c.expiry || -1,
        httpOnly: c.httpOnly || false,
        secure: c.secure || true,
        sameSite: c.sameSite || 'Lax'
      }));
      await apiContext.addCookies(browserCookies);
    }

    // Create a page for requests
    apiPage = await apiContext.newPage();
    
    // Navigate to ticketmaster initially to establish session
    try {
      await apiPage.goto('https://www.ticketmaster.com/', { 
        waitUntil: 'domcontentloaded',
        timeout: 30000 
      });
      await new Promise(r => setTimeout(r, 1000));
    } catch (e) {
      console.warn('Initial TM navigation warning:', e.message);
    }

    console.log('API browser context initialized successfully');
    return { browser: apiBrowser, context: apiContext, page: apiPage };
    
  } catch (error) {
    console.error('Failed to initialize API browser context:', error.message);
    await cleanupApiBrowser();
    throw error;
  } finally {
    apiContextLock = false;
  }
}

/**
 * Make an API request through the browser context (bypasses TLS fingerprinting)
 * @param {string} url - The URL to fetch
 * @param {object} headers - Request headers
 * @param {object} proxy - Proxy configuration
 * @param {array} cookies - Cookies to use
 * @returns {Promise<object>} Response data
 */
async function browserApiRequest(url, headers = {}, proxy = null, cookies = null) {
  try {
    // Initialize or get existing API context
    const { page, context } = await initApiBrowserContext(proxy, cookies);
    
    if (!page || !context) {
      throw new Error('Failed to get API browser context');
    }

    // Make request using page.evaluate with fetch (uses browser's TLS stack)
    const result = await page.evaluate(async ({ url, headers }) => {
      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: headers,
          credentials: 'include',
          mode: 'cors',
        });
        
        const status = response.status;
        const statusText = response.statusText;
        
        if (!response.ok) {
          return { 
            success: false, 
            status, 
            statusText,
            error: `HTTP ${status}: ${statusText}` 
          };
        }
        
        const data = await response.json();
        return { success: true, data, status };
        
      } catch (error) {
        return { 
          success: false, 
          error: error.message,
          status: 0 
        };
      }
    }, { url, headers });

    if (!result.success) {
      const error = new Error(result.error || `Request failed with status ${result.status}`);
      error.statusCode = result.status;
      throw error;
    }

    return result.data;
    
  } catch (error) {
    // If browser context fails, try to reinitialize
    if (error.message?.includes('Target closed') || error.message?.includes('Browser')) {
      await cleanupApiBrowser();
    }
    throw error;
  }
}

/**
 * Clean up API browser resources
 */
async function cleanupApiBrowser() {
  try {
    if (apiPage) {
      await apiPage.close().catch(() => {});
      apiPage = null;
    }
    if (apiContext) {
      await apiContext.close().catch(() => {});
      apiContext = null;
    }
    if (apiBrowser) {
      await apiBrowser.close().catch(() => {});
      apiBrowser = null;
    }
  } catch (error) {
    console.warn('Error cleaning up API browser:', error.message);
  }
}

/**
 * Check if API browser context is available
 */
function isApiBrowserAvailable() {
  return apiBrowser && apiBrowser.isConnected() && apiContext && apiPage;
}

/**
 * Clean up browser resources
 */
async function cleanup() {
  // Clean up main browser
  if (browser) {
    try {
      await browser.close();
      browser = null;
    } catch (error) {
      console.warn("Error closing browser:", error.message);
    }
  }
  
  // Clean up API browser
  await cleanupApiBrowser();
}

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
  // Browser-based API functions (bypass TLS fingerprinting)
  initApiBrowserContext,
  browserApiRequest,
  cleanupApiBrowser,
  isApiBrowserAvailable
};