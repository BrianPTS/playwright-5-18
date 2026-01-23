/**
 * @file HTTP utility functions
 * @description Centralized HTTP client to eliminate duplicate request patterns.
 *
 * Key exports:
 * - createHttpClient() - Configurable HTTP client with proxy/retry/throttle
 * - apiRequest() - Standardized API calls
 * - createProxyAgent() - Proxy agent creation
 * - throttledRequest() - Rate-limited requests
 *
 * Replaces HTTP patterns in:
 * - scraper.js throttledRequest, makeRequest, got requests
 * - inventoryApi.js axios patterns
 * - Multiple controller axios calls
 * - ProxyManager proxy agent creation
 */

import axios from 'axios';
import got from 'got';
import pThrottle from 'p-throttle';
import { createRequire } from "module";
import logger from './logger.js';

const require = createRequire(import.meta.url);
const { HttpsProxyAgent } = require("https-proxy-agent");

/**
 * Default HTTP client configuration
 */
const DEFAULT_CONFIG = {
  timeout: 30000,
  retries: 3,
  retryDelay: 1000,
  throttleLimit: 10,
  throttleInterval: 1000,
  keepAlive: true
};

/**
 * Create a proxy agent from proxy configuration
 * @param {Object} proxy - Proxy configuration
 * @param {string} proxy.proxy - Proxy server (host:port)
 * @param {string} proxy.username - Proxy username
 * @param {string} proxy.password - Proxy password
 * @returns {HttpsProxyAgent} Configured proxy agent
 */
export function createProxyAgent(proxy) {
  try {
    const proxyUrl = new URL(`http://${proxy.proxy}`);
    const proxyUrlWithAuth = `http://${proxy.username}:${proxy.password}@${proxyUrl.hostname}:${proxyUrl.port || 80}`;
    
    const proxyAgent = new HttpsProxyAgent(proxyUrlWithAuth, {
      timeout: 30000,
      keepAlive: true,
      keepAliveMsecs: 1000,
      maxSockets: 256,
      maxFreeSockets: 256
    });
    
    logger.debug(`Created proxy agent for ${proxy.proxy}`, 'http');
    return proxyAgent;
  } catch (error) {
    logger.error(`Failed to create proxy agent: ${error.message}`, 'http', error);
    throw new Error(`Invalid proxy configuration: ${error.message}`);
  }
}

/**
 * Create throttled request function
 * @param {Object} options - Throttle configuration
 * @returns {Function} Throttled request function
 */
export function createThrottledRequest(options = {}) {
  const config = { ...DEFAULT_CONFIG, ...options };
  
  const throttle = pThrottle({
    limit: config.throttleLimit,
    interval: config.throttleInterval
  });
  
  return throttle(async (requestOptions) => {
    return makeRequest(requestOptions);
  });
}

/**
 * Make HTTP request with retry logic and error handling
 * @param {Object} options - Request options
 * @returns {Promise<Object>} Response data
 */
export async function makeRequest(options) {
  const config = { ...DEFAULT_CONFIG, ...options };
  
  for (let attempt = 1; attempt <= config.retries; attempt++) {
    try {
      logger.debug(`HTTP request attempt ${attempt}/${config.retries}`, 'http', {
        url: options.url,
        method: options.method || 'GET'
      });
      
      let response;
      
      if (options.client === 'got') {
        response = await makeGotRequest(options);
      } else {
        response = await makeAxiosRequest(options);
      }
      
      logger.debug('HTTP request successful', 'http', {
        status: response.status || response.statusCode,
        url: options.url
      });
      
      return response;
    } catch (error) {
      logger.warn(`HTTP request attempt ${attempt} failed: ${error.message}`, 'http', {
        url: options.url,
        attempt,
        error: error.message
      });
      
      if (attempt === config.retries) {
        logger.error(`HTTP request failed after ${config.retries} attempts`, 'http', error);
        throw error;
      }
      
      // Wait before retry
      if (config.retryDelay > 0) {
        await new Promise(resolve => setTimeout(resolve, config.retryDelay * attempt));
      }
    }
  }
}

/**
 * Make request using axios
 */
async function makeAxiosRequest(options) {
  const axiosConfig = {
    url: options.url,
    method: options.method || 'GET',
    headers: options.headers || {},
    timeout: options.timeout || DEFAULT_CONFIG.timeout,
    data: options.data
  };
  
  if (options.proxy) {
    axiosConfig.httpsAgent = createProxyAgent(options.proxy);
  }
  
  return await axios(axiosConfig);
}

/**
 * Make request using got
 */
async function makeGotRequest(options) {
  const gotOptions = {
    url: options.url,
    method: options.method || 'GET',
    headers: options.headers || {},
    timeout: { request: options.timeout || DEFAULT_CONFIG.timeout },
    json: options.json,
    body: options.body
  };
  
  if (options.proxy) {
    gotOptions.agent = {
      https: createProxyAgent(options.proxy)
    };
  }
  
  return await got(gotOptions);
}

/**
 * Standardized API request function
 * @param {string} url - API endpoint URL
 * @param {Object} options - Request options
 * @returns {Promise<Object>} API response
 */
export async function apiRequest(url, options = {}) {
  const defaults = {
    url,
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...options.headers
    },
    timeout: 30000
  };
  
  const config = { ...defaults, ...options };
  
  logger.api(`Starting API request`, config.method, url, {
    headers: config.headers,
    hasData: !!config.data
  });
  
  try {
    const response = await makeRequest(config);
    
    logger.api(`API request successful`, config.method, url, {
      status: response.status || response.statusCode
    });
    
    return response;
  } catch (error) {
    logger.api(`API request failed: ${error.message}`, config.method, url, {
      error: error.message,
      status: error.response?.status
    });
    throw error;
  }
}

/**
 * Create HTTP client with default configuration
 * @param {Object} config - Client configuration
 * @returns {Object} HTTP client methods
 */
export function createHttpClient(config = {}) {
  const clientConfig = { ...DEFAULT_CONFIG, ...config };
  
  return {
    get: (url, options = {}) => apiRequest(url, { ...options, method: 'GET', ...clientConfig }),
    post: (url, data, options = {}) => apiRequest(url, { ...options, method: 'POST', data, ...clientConfig }),
    put: (url, data, options = {}) => apiRequest(url, { ...options, method: 'PUT', data, ...clientConfig }),
    delete: (url, options = {}) => apiRequest(url, { ...options, method: 'DELETE', ...clientConfig }),
    patch: (url, data, options = {}) => apiRequest(url, { ...options, method: 'PATCH', data, ...clientConfig })
  };
}

// Export default throttled client
export const httpClient = createHttpClient();
export const throttledRequest = createThrottledRequest();