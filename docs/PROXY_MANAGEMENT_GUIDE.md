# Proxy Management System - Documentation

## Overview

This proxy management system provides a unified schema and interface for handling proxies across both frontend and backend applications. Both systems can connect directly to the same MongoDB database for consistent data management.

## Raw Proxy Format

Your provider gives you proxies in this format:
```
139.171.128.91:5091:V6t6WYtx0m:pDdstBA9NM
139.171.135.176:6961:V6t6WYtx0m:pDdstBA9NM
139.171.143.137:8962:V6t6WYtx0m:pDdstBA9NM
```

Format: `ip:port:username:password`

## Database Schema

The system uses a comprehensive MongoDB schema with these key fields:

### Core Fields
- `proxy_id`: Unique identifier (ip_port format)
- `server`: IP:port combination
- `ip`: IP address
- `port`: Port number
- `username`: Authentication username
- `password`: Authentication password
- `raw_proxy_string`: Original format from provider

### Metadata Fields
- `provider`: Source of the proxy
- `region`: Geographic region
- `country_code`: Country code
- `tags`: Array of categorization tags

### Status & Health
- `status`: active/inactive/blacklisted/maintenance
- `is_working`: Boolean health status
- `success_rate`: Percentage (0-100)
- `response_time`: Average response time in ms
- `last_tested`: Last health check timestamp

### Usage Tracking
- `total_requests`: Total requests made
- `failed_requests`: Number of failures
- `current_usage_count`: Current concurrent usage
- `max_concurrent_usage`: Maximum allowed concurrent usage

### Rate Limiting
- `requests_per_minute_limit`: Max requests per minute
- `requests_this_minute`: Current minute counter

## Backend Setup

### 1. Import Existing Proxies

```javascript
// Run the import script
node examples/importProxies.js import
```

### 2. Use Proxy Controller

```javascript
import { ProxyController } from './controllers/proxyController.js';

// Get available proxies
const result = await ProxyController.getAvailableProxies({
  limit: 10,
  requiredTags: ['residential']
});

if (result.success) {
  console.log(`Found ${result.data.length} proxies`);
}
```

### 3. Use Proxy Service

```javascript
import { ProxyService } from './helpers/ProxyService.js';

// Get next proxy for rotation
const proxy = await ProxyService.getNextProxy({
  eventId: 'event_123',
  excludeProxies: ['ip1_port1']
});

if (proxy.success) {
  // Use proxy.data for your requests
  console.log(`Using proxy: ${proxy.data.server}`);
}
```

## Frontend Setup

### 1. Install MongoDB Driver

```bash
npm install mongodb
# or
npm install mongoose
```

### 2. Import Configuration

```javascript
import { ProxyConfig, ProxyUtils, ProxySchema } from '../config/proxyConfig.js';
```

### 3. Direct Database Connection

```javascript
import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db();
const proxiesCollection = db.collection('proxies');
```

### 4. Frontend Proxy Operations

```javascript
// Get available proxies
const availableProxies = await proxiesCollection.find({
  status: 'active',
  is_working: true,
  current_usage_count: { $lt: 1 }
}).sort({ success_rate: -1 }).limit(10).toArray();

// Create new proxy from raw string
const rawProxy = "139.171.128.91:5091:V6t6WYtx0m:pDdstBA9NM";
const proxyData = ProxyUtils.parseRawProxy(rawProxy);

await proxiesCollection.insertOne({
  ...proxyData,
  provider: 'my_provider',
  status: 'active',
  is_working: true,
  tags: ['imported'],
  createdAt: new Date(),
  updatedAt: new Date()
});

// Update proxy usage
await proxiesCollection.updateOne(
  { proxy_id: 'proxy_id_here' },
  {
    $inc: { 
      total_requests: 1,
      current_usage_count: 1
    },
    $set: { 
      last_used: new Date(),
      updatedAt: new Date()
    }
  }
);

// Record proxy failure
await proxiesCollection.updateOne(
  { proxy_id: 'proxy_id_here' },
  {
    $inc: { 
      failed_requests: 1,
      consecutive_failures: 1
    },
    $set: {
      last_error: {
        message: 'Connection timeout',
        timestamp: new Date(),
        error_code: 'TIMEOUT'
      },
      updatedAt: new Date()
    }
  }
);
```

## Common Operations

### 1. Proxy Rotation

```javascript
// Backend
const newProxy = await ProxyService.rotateProxy('old_proxy_id', 'event_123');

// Frontend
const availableProxies = await proxiesCollection.find({
  status: 'active',
  is_working: true,
  proxy_id: { $ne: 'current_proxy_id' }
}).limit(1).toArray();

const nextProxy = availableProxies[0];
```

### 2. Health Checking

```javascript
// Backend
await ProxyService.healthCheck();

// Frontend
const unhealthyProxies = await proxiesCollection.find({
  $or: [
    { consecutive_failures: { $gte: 5 } },
    { success_rate: { $lt: 70 } }
  ]
}).toArray();

// Disable unhealthy proxies
await proxiesCollection.updateMany(
  { proxy_id: { $in: unhealthyProxies.map(p => p.proxy_id) } },
  { 
    $set: { 
      status: 'inactive',
      is_working: false,
      updatedAt: new Date()
    }
  }
);
```

### 3. Statistics Dashboard

```javascript
// Get proxy statistics
const stats = await proxiesCollection.aggregate([
  {
    $group: {
      _id: null,
      total: { $sum: 1 },
      active: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
      inactive: { $sum: { $cond: [{ $eq: ['$status', 'inactive'] }, 1, 0] } },
      working: { $sum: { $cond: ['$is_working', 1, 0] } },
      avgSuccessRate: { $avg: '$success_rate' },
      avgResponseTime: { $avg: '$response_time' },
      totalRequests: { $sum: '$total_requests' },
      totalFailures: { $sum: '$failed_requests' }
    }
  }
]).toArray();

console.log('Proxy Statistics:', stats[0]);
```

## Best Practices

### 1. Error Handling

```javascript
// Always wrap proxy operations in try-catch
try {
  const proxy = await ProxyService.getNextProxy();
  if (!proxy.success) {
    throw new Error(proxy.error);
  }
  // Use proxy...
} catch (error) {
  console.error('Proxy operation failed:', error.message);
  // Fallback logic...
}
```

### 2. Connection Pooling

```javascript
// For frontend, use connection pooling
const client = new MongoClient(uri, {
  maxPoolSize: 10,
  serverSelectionTimeoutMS: 5000,
});
```

### 3. Rate Limiting

```javascript
// Check rate limits before using proxy
const proxy = await proxiesCollection.findOne({ proxy_id: 'proxy_id' });

if (proxy.requests_this_minute >= proxy.requests_per_minute_limit) {
  // Find alternative proxy or wait
  console.log('Proxy rate limit exceeded');
}
```

### 4. Cleanup Tasks

```javascript
// Regular cleanup (run every hour)
setInterval(async () => {
  // Reset minute counters
  const oneMinuteAgo = new Date(Date.now() - 60000);
  await proxiesCollection.updateMany(
    { minute_window_start: { $lt: oneMinuteAgo } },
    {
      $set: {
        requests_this_minute: 0,
        minute_window_start: new Date()
      }
    }
  );
  
  // Clean up old assignments
  const oneHourAgo = new Date(Date.now() - 3600000);
  await proxiesCollection.updateMany(
    { 'assigned_events.assigned_at': { $lt: oneHourAgo } },
    {
      $pull: {
        assigned_events: { assigned_at: { $lt: oneHourAgo } }
      }
    }
  );
}, 3600000); // Every hour
```

## Migration from Legacy System

If you have existing proxy handling code, you can migrate gradually:

```javascript
// Convert legacy proxy objects
import { ProxyUtils } from './config/proxyConfig.js';

const legacyProxy = {
  server: "139.171.128.91:5091",
  username: "V6t6WYtx0m",
  password: "pDdstBA9NM"
};

const newFormat = ProxyUtils.parseRawProxy(
  `${legacyProxy.server}:${legacyProxy.username}:${legacyProxy.password}`
);
```

## Environment Variables

Make sure both frontend and backend use the same database:

```bash
# .env file
MONGODB_URI=mongodb://localhost:27017/your_database
# or
DATABASE_URL=mongodb://localhost:27017/your_database
```

## Testing

```bash
# Test proxy import
node examples/importProxies.js test "139.171.128.91:5091:V6t6WYtx0m:pDdstBA9NM"

# Import all proxies
node examples/importProxies.js import

# Query existing proxies
node examples/importProxies.js query
```

## Conclusion

This system provides:
- ✅ Unified schema for frontend and backend
- ✅ Direct database access (no API routes needed)
- ✅ Comprehensive proxy management features
- ✅ Built-in health checking and rotation
- ✅ Rate limiting and usage tracking
- ✅ Easy migration from existing systems
- ✅ Backward compatibility with legacy formats

Both your frontend and backend can now use the same database and schema for consistent proxy management across your entire system.