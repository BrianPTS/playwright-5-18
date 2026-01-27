/**
 * BrowserService - Centralized browser management for the scraper system
 * Following nodejs-backend patterns for clean architecture
 */

import { Camoufox } from 'camoufox-js';
import { BrowserFingerprint } from '../../../browserFingerprint.js';
import { createDomainError } from '../errors/index.js';

/**
 * Domain errors for browser operations
 */
export const BrowserErrors = {
  INITIALIZATION_FAILED: 'BROWSER_INITIALIZATION_FAILED',
  CONTEXT_CREATION_FAILED: 'BROWSER_CONTEXT_CREATION_FAILED',
  PROXY_INVALID: 'BROWSER_PROXY_INVALID',
  NAVIGATION_FAILED: 'BROWSER_NAVIGATION_FAILED'
};

/**
 * Configuration for browser operations
 */
export const BrowserConfig = {
  TIMEOUT: 90000,
  MAX_INIT_RETRIES: 3,
  RETRY_DELAY: 1000,
  
  MOBILE_VIEWPORT: {
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true
  },
  
  CAMOUFOX_OPTIONS: {
    geoip: true,
    screen: '390x844',
    humanize: 0.5,
    addons: false,
    window_size: '390x844',
    headless: true
  },
  
  LAUNCH_ARGS: [
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
  
  LOCATIONS: [
    { locale: 'en-US', timezone: 'America/Los_Angeles', latitude: 34.052235, longitude: -118.243683 },
    { locale: 'en-US', timezone: 'America/New_York', latitude: 40.712776, longitude: -74.005974 },
    { locale: 'en-US', timezone: 'America/Chicago', latitude: 41.878113, longitude: -87.629799 },
    { locale: 'en-US', timezone: 'America/Denver', latitude: 39.739235, longitude: -104.990250 },
    { locale: 'en-CA', timezone: 'America/Toronto', latitude: 43.651070, longitude: -79.347015 },
    { locale: 'en-GB', timezone: 'Europe/London', latitude: 51.507351, longitude: -0.127758 }
  ]
};

/**
 * BrowserService handles all browser-related operations
 */
export class BrowserService {
  constructor({ logger }) {
    this.logger = logger;
    this.browserInstance = null;
    // Track active browser instances to enforce limits
    this.activeBrowsers = new Set();
    this.maxConcurrentBrowsers = 3;
  }

  /**
   * Get a random location for browser fingerprinting
   * @returns {Object} Random location configuration
   */
  getRandomLocation() {
    return BrowserConfig.LOCATIONS[Math.floor(Math.random() * BrowserConfig.LOCATIONS.length)];
  }

  /**
   * Generate a realistic iPhone user agent
   * @returns {string} User agent string
   */
  getRealisticIphoneUserAgent() {
    const iOSVersions = ['15_0', '15_1', '15_2', '15_3', '15_4', '15_5', '15_6', '16_0', '16_1', '16_2'];
    const version = iOSVersions[Math.floor(Math.random() * iOSVersions.length)];
    return `Mozilla/5.0 (iPhone; CPU iPhone OS ${version} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${version.split('_')[0]}.0 Mobile/15E148 Safari/604.1`;
  }

  /**
   * Enhance fingerprint with additional browser properties
   * @returns {Object} Enhanced fingerprint object
   */
  generateEnhancedFingerprint() {
    const baseFingerprint = BrowserFingerprint.generate();
    
    return {
      ...baseFingerprint,
      webgl: {
        vendor: "Apple Inc.",
        renderer: "Apple GPU"
      },
      fonts: [
        "Arial", "Courier New", "Georgia", "Times New Roman", 
        "Trebuchet MS", "Verdana"
      ],
      plugins: [
        "PDF Viewer", "Chrome PDF Viewer", "Chromium PDF Viewer",
        "Microsoft Edge PDF Viewer", "WebKit built-in PDF"
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
   * Get current active browser count
   * @returns {number} Number of active browsers
   */
  getActiveBrowserCount() {
    return this.activeBrowsers.size;
  }

  /**
   * Get maximum concurrent browser limit
   * @returns {number} Maximum concurrent browsers
   */
  getMaxConcurrentBrowsers() {
    return this.maxConcurrentBrowsers;
  }

  /**
   * Check if we can create a new browser instance
   * @returns {boolean} Whether we can create a new browser
   */
  canCreateBrowser() {
    return this.activeBrowsers.size < this.maxConcurrentBrowsers;
  }

  /**
   * Track a new browser instance
   * @param {Object} browserData - Browser instance data to track
   * @returns {string} Browser tracking ID
   */
  trackBrowser(browserData) {
    const trackingId = `browser_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.activeBrowsers.add({ ...browserData, trackingId });
    this.logger?.info(`Browser tracked. Active browsers: ${this.activeBrowsers.size}/${this.maxConcurrentBrowsers}`);
    return trackingId;
  }

  /**
   * Untrack a browser instance
   * @param {string} trackingId - Browser tracking ID
   */
  untrackBrowser(trackingId) {
    const browserData = Array.from(this.activeBrowsers).find(b => b.trackingId === trackingId);
    if (browserData) {
      this.activeBrowsers.delete(browserData);
      this.logger?.info(`Browser untracked. Active browsers: ${this.activeBrowsers.size}/${this.maxConcurrentBrowsers}`);
    }
  }

  /**
   * Validate proxy configuration
   * @param {Object} proxy - Proxy configuration
   * @returns {Object} Validated proxy configuration
   */
  validateProxy(proxy) {
    if (!proxy || typeof proxy !== 'object') {
      return null;
    }

    const proxyString = proxy.proxy;
    if (typeof proxyString !== 'string' || !proxyString.includes(':')) {
      throw createDomainError(
        BrowserErrors.PROXY_INVALID,
        `Invalid proxy format: ${proxyString}`,
        { proxy }
      );
    }

    const [server, port] = proxyString.split(':');
    if (!server || !port || isNaN(parseInt(port))) {
      throw createDomainError(
        BrowserErrors.PROXY_INVALID,
        `Invalid proxy server or port: ${proxyString}`,
        { proxy }
      );
    }

    return {
      server: `http://${server}:${port}`,
      username: proxy.username || undefined,
      password: proxy.password || undefined
    };
  }

  /**
   * Initialize browser with enhanced fingerprinting and proxy support
   * @param {Object} proxy - Optional proxy configuration
   * @returns {Promise<Object>} Browser initialization result
   */
  async initBrowser(proxy = null) {
    // Check if we can create a new browser
    if (!this.canCreateBrowser()) {
      throw createDomainError(
        BrowserErrors.INITIALIZATION_FAILED,
        `Maximum concurrent browsers reached (${this.maxConcurrentBrowsers})`,
        { activeBrowsers: this.activeBrowsers.size }
      );
    }

    let initAttempts = 0;
    let lastError = null;
    
    while (initAttempts < BrowserConfig.MAX_INIT_RETRIES) {
      try {
        this.logger?.info(`Initializing browser (attempt ${initAttempts + 1}/${BrowserConfig.MAX_INIT_RETRIES})`);
        
        // Get randomized properties
        const location = this.getRandomLocation();
        const fingerprint = this.generateEnhancedFingerprint();
        
        // Prepare Camoufox options
        const camoufoxOptions = {
          ...BrowserConfig.CAMOUFOX_OPTIONS,
          geoip: location.locale.includes('US') ? 'US' : 'CA',
          os: 'windows', // Use windows instead of ios
          humanize: Math.random() * 0.5 + 0.3, // Random humanization between 0.3-0.8
          timeout: BrowserConfig.TIMEOUT
        };

        // Add proxy if provided
        if (proxy) {
          const validatedProxy = this.validateProxy(proxy);
          if (validatedProxy) {
            // Camoufox proxy format: "http://user:pass@host:port" or "http://host:port"
            let proxyUrl = validatedProxy.server;
            if (validatedProxy.username && validatedProxy.password) {
              proxyUrl = proxyUrl.replace('http://', `http://${validatedProxy.username}:${validatedProxy.password}@`);
            }
            camoufoxOptions.proxy = proxyUrl;
            this.logger?.info(`Using proxy: ${proxyUrl}`);
          }
        }

        // Launch browser using Camoufox
        const browser = await Camoufox(camoufoxOptions);

        // Create context with additional options
        const contextOptions = {
          userAgent: this.getRealisticIphoneUserAgent(),
          locale: location.locale,
          timezoneId: location.timezone,
          geolocation: {
            latitude: location.latitude,
            longitude: location.longitude
          },
          permissions: ['geolocation'],
          viewport: BrowserConfig.MOBILE_VIEWPORT,
          ignoreHTTPSErrors: true,
          javaScriptEnabled: true,
          acceptDownloads: false,
          bypassCSP: false,
          extraHTTPHeaders: {
            'Accept-Language': location.locale,
            'Accept-Encoding': 'gzip, deflate, br',
            'DNT': '1',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Cache-Control': 'max-age=0'
          }
        };

        const context = await browser.newContext(contextOptions);

        // Create page 
        const page = await context.newPage();
        
        // Apply additional stealth measures (Camoufox already provides stealth features)
        await page.addInitScript(`
          // Override webgl fingerprinting
          Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
            value: function(contextType, ...args) {
              if (contextType === 'webgl' || contextType === 'experimental-webgl') {
                const gl = HTMLCanvasElement.prototype.getContext.call(this, contextType, ...args);
                if (gl) {
                  const getParameter = gl.getParameter;
                  gl.getParameter = function(parameter) {
                    if (parameter === 37445) return '${fingerprint.webgl.vendor}';
                    if (parameter === 37446) return '${fingerprint.webgl.renderer}';
                    return getParameter.call(this, parameter);
                  };
                }
                return gl;
              }
              return HTMLCanvasElement.prototype.getContext.call(this, contextType, ...args);
            }
          });

          // Override screen properties
          Object.defineProperties(screen, {
            width: { value: ${fingerprint.screen.width}, configurable: false },
            height: { value: ${fingerprint.screen.height}, configurable: false },
            availWidth: { value: ${fingerprint.screen.availWidth}, configurable: false },
            availHeight: { value: ${fingerprint.screen.availHeight}, configurable: false },
            colorDepth: { value: ${fingerprint.screen.colorDepth}, configurable: false },
            pixelDepth: { value: ${fingerprint.screen.pixelDepth}, configurable: false }
          });

          // Override plugins
          Object.defineProperty(navigator, 'plugins', {
            get: () => ${JSON.stringify(fingerprint.plugins.map((name, i) => ({ name, filename: name, description: name, length: 0 })))},
            configurable: false
          });
        `);

        // Set default timeout
        page.setDefaultTimeout(BrowserConfig.TIMEOUT);

        const browserData = {
          browser: browser,
          context,
          page,
          fingerprint,
          location
        };

        // Track this browser instance
        const trackingId = this.trackBrowser(browserData);
        browserData.trackingId = trackingId;

        this.browserInstance = browser; // Store for future reference

        this.logger?.info('Browser initialized successfully with Camoufox');
        return browserData;

      } catch (error) {
        lastError = error;
        initAttempts++;
        this.logger?.error(`Browser init attempt ${initAttempts} failed:`, error.message);
        
        if (initAttempts < BrowserConfig.MAX_INIT_RETRIES) {
          await new Promise(resolve => setTimeout(resolve, BrowserConfig.RETRY_DELAY * initAttempts));
        }
      }
    }

    throw createDomainError(
      BrowserErrors.INITIALIZATION_FAILED,
      `Failed to initialize browser after ${BrowserConfig.MAX_INIT_RETRIES} attempts`,
      { lastError: lastError?.message }
    );
  }

  /**
   * Simulate various mobile interactions to appear human-like
   * @param {Object} page - Playwright page object
   * @returns {Promise<void>}
   */
  async simulateMobileInteractions(page) {
    try {
      // Get viewport size
      const viewportSize = page.viewportSize();
      if (!viewportSize) {
        this.logger?.warn('No viewport size available for mobile interactions');
        return;
      }
      
      // Random scroll actions
      const scrollOptions = [
        { direction: 'down', amount: 300 },
        { direction: 'down', amount: 500 },
        { direction: 'down', amount: 800 },
        { direction: 'up', amount: 200 },
        { direction: 'up', amount: 400 }
      ];
      
      // Perform 2-3 random scrolls with longer pauses
      const scrollCount = 2 + Math.floor(Math.random() * 2);
      for (let i = 0; i < scrollCount; i++) {
        const option = scrollOptions[Math.floor(Math.random() * scrollOptions.length)];
        const scrollY = option.direction === 'down' ? option.amount : -option.amount;
        
        await page.evaluate((y) => {
          window.scrollBy({
            top: y,
            behavior: 'smooth'
          });
        }, scrollY);
        
        // Longer pause between scrolls to let cookies load
        await page.waitForTimeout(1000 + Math.floor(Math.random() * 2000));
      }
      
      // Simulate random taps/clicks with longer delays
      const tapCount = 1 + Math.floor(Math.random() * 2);
      for (let i = 0; i < tapCount; i++) {
        const x = 50 + Math.floor(Math.random() * (viewportSize.width - 100));
        const y = 150 + Math.floor(Math.random() * (viewportSize.height - 300));
        
        await page.mouse.click(x, y);
        await page.waitForTimeout(1500 + Math.floor(Math.random() * 2000));
      }
      
      this.logger?.info('Completed mobile interaction simulation');
      
    } catch (error) {
      this.logger?.warn('Error during mobile interaction simulation:', error.message);
    }
  }

  /**
   * Navigate to URL with error handling
   * @param {Object} page - Playwright page object
   * @param {string} url - URL to navigate to
   * @param {Object} options - Navigation options
   * @returns {Promise<Object>} Navigation response
   */
  async navigateToUrl(page, url, options = {}) {
    try {
      this.logger?.info(`Navigating to: ${url}`);
      
      const defaultOptions = {
        waitUntil: 'domcontentloaded',
        timeout: 60000
      };
      
      const response = await page.goto(url, { ...defaultOptions, ...options });
      
      if (!response || !response.ok()) {
        throw createDomainError(
          BrowserErrors.NAVIGATION_FAILED,
          `Navigation failed with status: ${response?.status()}`,
          { url, status: response?.status() }
        );
      }
      
      this.logger?.info(`Successfully navigated to: ${url}`);
      return response;
      
    } catch (error) {
      this.logger?.error(`Navigation failed for ${url}:`, error.message);
      throw createDomainError(
        BrowserErrors.NAVIGATION_FAILED,
        `Failed to navigate to ${url}: ${error.message}`,
        { url, originalError: error }
      );
    }
  }

  /**
   * Properly cleanup browser instance and tracking
   * @param {Object} browserData - Browser data object with tracking ID
   * @returns {Promise<void>}
   */
  async cleanupBrowser(browserData) {
    try {
      if (browserData) {
        // Close context first
        if (browserData.context && !browserData.context.closed) {
          await browserData.context.close();
        }

        // Close page if still open
        if (browserData.page && !browserData.page.isClosed()) {
          await browserData.page.close();
        }

        // Untrack the browser
        if (browserData.trackingId) {
          this.untrackBrowser(browserData.trackingId);
        }

        this.logger?.info('Browser cleaned up successfully');
      }
    } catch (error) {
      this.logger?.error('Error cleaning up browser:', error.message);
    }
  }

  /**
   * Close browser instance
   * @returns {Promise<void>}
   */
  async closeBrowser() {
    try {
      if (this.browserInstance && this.browserInstance.isConnected()) {
        await this.browserInstance.close();
        this.browserInstance = null;
        this.logger?.info('Browser closed successfully');
      }
    } catch (error) {
      this.logger?.error('Error closing browser:', error.message);
    }
  }
}