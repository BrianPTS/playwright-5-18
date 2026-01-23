# Proxy Caching System Documentation

## Overview

The enhanced ProxyManager now includes intelligent caching with automatic change detection. This system fetches proxies from the database, caches them in memory, and automatically refreshes when changes are detected.

## Key Features

### 1. Smart Caching
- Proxies are fetched from database and cached in memory
- Cache is automatically refreshed when changes are detected
- Configurable refresh intervals (default: 30s check, 5min force refresh)

### 2. Change Detection
- Monitors proxy count changes in database
- Compares cached count with database count
- Automatically refreshes cache when changes detected

### 3. Performance Optimization
- Reduces database queries by caching proxy list
- Only refreshes when necessary
- Maintains backward compatibility with existing code

## Configuration

The caching system has configurable intervals:

```javascript
this.cacheRefreshInterval = 30000; // 30 seconds - check for changes
this.forceRefreshInterval = 300000; // 5 minutes - force refresh
```

## Key Methods

### Cache Management

#### `initialize()`
Loads initial proxy list and starts cache management timers.

```javascript
await proxyManager.initialize();
```

#### `refreshProxyCache(force = false)`
Refreshes proxy cache from database. If `force` is true, ignores change detection.

```javascript
await proxyManager.refreshProxyCache(true); // Force refresh
```

#### `checkForChangesAndRefresh()`
Checks database for changes and refreshes cache if needed.

```javascript
const changed = await proxyManager.checkForChangesAndRefresh();
```

#### `getCacheStats()`
Returns detailed cache statistics.

```javascript
const stats = proxyManager.getCacheStats();
console.log(stats);
// Output:
// {
//   cached_proxies: 53,
//   last_cache_update: 1234567890123,
//   cache_age_seconds: 45,
//   is_initialized: true,
//   cache_management_active: true,
//   proxy_count: 53,
//   refresh_interval_ms: 30000,
//   force_refresh_interval_ms: 300000
// }
```

#### `resetCache()`
Stops cache management, refreshes cache, and restarts management.

```javascript
await proxyManager.resetCache();
```

#### `cleanup()`
Stops all cache management timers. Call this when shutting down.

```javascript
proxyManager.cleanup();
```

### Proxy Operations

#### `getProxyForEvent(eventId)` 
Gets a proxy for a single event. Now checks cache freshness first.

```javascript
const proxy = await proxyManager.getProxyForEvent("event-123");
```

#### `getProxyForBatch(eventIds)`
Gets proxies for batch processing. Checks cache freshness before assignment.

```javascript
const result = await proxyManager.getProxyForBatch(["event-1", "event-2"]);
```

## Cache Behavior

### Automatic Refresh Triggers

1. **Count Change Detection**: When database proxy count differs from cached count
2. **Time-based Refresh**: When cache is older than force refresh interval
3. **Empty Cache**: When no proxies are cached
4. **Manual Refresh**: When `refreshProxyList()` is called

### Fallback Behavior

- If database query fails, existing cache is preserved
- If no proxies available, cache is not cleared
- Error handling ensures system continues operating

## Usage Patterns

### Basic Usage

```javascript
import ProxyManager from "./helpers/ProxyManager.js";
import { ScraperLogger } from "./helpers/ScraperLogger.js";

const logger = new ScraperLogger();
const proxyManager = new ProxyManager(logger);

// Initialize with caching
await proxyManager.initialize();

// Get proxy (automatically checks cache freshness)
const proxy = await proxyManager.getProxyForEvent("my-event");

// When done, cleanup
proxyManager.cleanup();
```

### Advanced Usage with Monitoring

```javascript
// Monitor cache performance
setInterval(() => {
  const stats = proxyManager.getCacheStats();
  console.log(`Cache: ${stats.cached_proxies} proxies, age: ${stats.cache_age_seconds}s`);
}, 60000);

// Force refresh when needed
if (proxyManager.shouldRefreshCache()) {
  await proxyManager.refreshProxyList();
}

// Get detailed usage statistics
const usage = proxyManager.getUsageStats();
console.log(`Using ${usage.usedProxies}/${usage.totalProxies} proxies`);
```

## Database Integration

The caching system integrates with your existing database schema:

- Uses `ProxyController.getAvailableProxies()` to fetch proxies
- Uses `ProxyController.getProxyStats()` to check for changes
- Records proxy usage with `ProxyController.recordProxyUsage()`

## Performance Benefits

1. **Reduced Database Load**: Caches proxies in memory, reducing frequent database queries
2. **Smart Refreshing**: Only refreshes when changes detected, not on every request
3. **Background Updates**: Cache management runs in background, doesn't block operations
4. **Batch Optimization**: Efficiently handles batch operations without multiple database calls

## Migration from File-based System

The new caching system is fully backward compatible:

- Same method signatures as before
- Same proxy object structure
- Existing code works without changes
- Just adds caching layer underneath

## Error Handling

- Database connection issues don't break existing cache
- Failed refreshes preserve current cache
- Comprehensive logging for troubleshooting
- Graceful degradation when database unavailable

## Best Practices

1. Always call `initialize()` before using proxies
2. Call `cleanup()` when shutting down application
3. Monitor cache stats for performance optimization
4. Use batch operations for multiple events
5. Handle null returns when no proxies available

## Troubleshooting

### Common Issues

1. **Cache not refreshing**: Check if database is accessible and returning proxy count
2. **High memory usage**: Reduce `cacheRefreshInterval` or limit proxy count
3. **Stale data**: Call `resetCache()` to force complete refresh
4. **Timer conflicts**: Ensure `cleanup()` is called before reinitializing

### Debug Information

Enable debug logging to see cache operations:

```javascript
const stats = proxyManager.getCacheStats();
console.log("Cache debug info:", stats);

// Check if refresh is needed
const shouldRefresh = proxyManager.shouldRefreshCache();
console.log("Should refresh:", shouldRefresh);
```