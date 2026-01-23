import ProxyManager from './helpers/ProxyManager.js';
import logger from './utils/logger.js';

/**
 * Setup global components and configuration for the application
 */
async function setupGlobals() {
  logger.info('Initializing global components...', 'setup');

  // Create a global ProxyManager instance
  if (!global.proxyManager) {
    global.proxyManager = new ProxyManager({
      info: (msg) => logger.info(msg, 'proxy'),
      warn: (msg) => logger.warn(msg, 'proxy'),
      error: (msg, err) => logger.error(msg, 'proxy', err)
    });
    
    // Initialize ProxyManager with database
    await global.proxyManager.initialize();
    logger.info(`Global ProxyManager initialized with ${global.proxyManager.proxies.length} proxies`, 'setup');
  }
  
  // Track global statistics
  global.stats = {
    startTime: new Date(),
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    requestsByProxy: new Map(),
    errors: {
      '403': 0,
      '429': 0,
      'network': 0,
      'timeout': 0,
      'other': 0
    }
  };
  
  // Set up periodic stats logging
  setInterval(() => {
    const uptime = Math.floor((new Date() - global.stats.startTime) / 1000 / 60);
    const stats = {
      uptime,
      totalRequests: global.stats.totalRequests,
      successRate: (global.stats.successfulRequests / global.stats.totalRequests * 100 || 0).toFixed(2),
      errors: global.stats.errors
    };
    logger.info(`STATS (${uptime} minutes uptime)`, 'stats', stats);
    
    // Log proxy usage statistics
    const proxyStats = global.proxyManager.getUsageStats();
    logger.info('Proxy Statistics', 'proxy', {
      used: `${proxyStats.usedProxies}/${proxyStats.totalProxies}`,
      healthy: `${proxyStats.healthyProxies}/${proxyStats.totalProxies}`,
      banned: proxyStats.bannedProxies
    });
  }, 5 * 60 * 1000); // Every 5 minutes
  
  // Set up error tracking
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught Exception:', 'process', err);
    // Continue running despite error
  });
  
  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection', 'process', { promise, reason });
    // Continue running despite error
  });
  
  logger.info('Global components initialized successfully', 'setup');
}

// Export setup function
export default setupGlobals; 