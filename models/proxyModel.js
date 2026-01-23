import mongoose from "mongoose";

const proxySchema = new mongoose.Schema(
  {
    // Unique identifier for the proxy
    proxy_id: {
      type: String,
      required: true,
      unique: true,
    },
    // Proxy server details
    server: {
      type: String,
      required: true,
      // Format: "ip:port"
    },
    ip: {
      type: String,
      required: true,
      validate: {
        validator: function(v) {
          return /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(v);
        },
        message: 'Invalid IP address format'
      }
    },
    port: {
      type: Number,
      required: true,
      min: 1,
      max: 65535
    },
    // Authentication details
    username: {
      type: String,
      required: true,
    },
    password: {
      type: String,
      required: true,
    },
    // Proxy metadata
    provider: {
      type: String,
      default: "unknown"
    },
    region: {
      type: String,
      default: "unknown"
    },
    country_code: {
      type: String,
      default: "unknown"
    },
    // Status and health
    status: {
      type: String,
      enum: ['active', 'inactive', 'blacklisted', 'maintenance'],
      default: 'active'
    },
    is_working: {
      type: Boolean,
      default: true
    },
    last_tested: {
      type: Date,
      default: Date.now
    },
    response_time: {
      type: Number, // in milliseconds
      default: 0
    },
    success_rate: {
      type: Number, // percentage 0-100
      default: 100
    },
    // Usage tracking
    total_requests: {
      type: Number,
      default: 0
    },
    failed_requests: {
      type: Number,
      default: 0
    },
    current_usage_count: {
      type: Number,
      default: 0
    },
    max_concurrent_usage: {
      type: Number,
      default: 1
    },
    last_used: {
      type: Date,
      default: null
    },
    // Rate limiting
    requests_per_minute_limit: {
      type: Number,
      default: 60
    },
    requests_this_minute: {
      type: Number,
      default: 0
    },
    minute_window_start: {
      type: Date,
      default: Date.now
    },
    // Event tracking for assignment
    assigned_events: [{
      event_id: String,
      assigned_at: {
        type: Date,
        default: Date.now
      }
    }],
    // Error tracking
    consecutive_failures: {
      type: Number,
      default: 0
    },
    last_error: {
      message: String,
      timestamp: Date,
      error_code: String
    },
    // Blacklist/whitelist
    blacklisted_events: [String], // Array of event IDs
    whitelisted_events: [String], // Array of event IDs
    // Rotation settings
    rotation_weight: {
      type: Number,
      default: 1, // Higher weight = more likely to be selected
      min: 0,
      max: 10
    },
    // Tags for categorization
    tags: [String],
    // Raw proxy string for compatibility
    raw_proxy_string: {
      type: String,
      required: true
      // Format: "ip:port:username:password"
    }
  },
  {
    timestamps: true, // Adds createdAt and updatedAt
    collection: 'proxies'
  }
);

// Indexes for better performance
proxySchema.index({ proxy_id: 1 });
proxySchema.index({ status: 1, is_working: 1 });
proxySchema.index({ server: 1 });
proxySchema.index({ ip: 1 });
proxySchema.index({ success_rate: -1 });
proxySchema.index({ current_usage_count: 1 });
proxySchema.index({ last_used: 1 });
proxySchema.index({ tags: 1 });
proxySchema.index({ provider: 1 });

// Virtual for formatted proxy URL
proxySchema.virtual('proxy_url').get(function() {
  return `http://${this.username}:${this.password}@${this.server}`;
});

// Virtual for full proxy object (legacy compatibility)
proxySchema.virtual('proxy_object').get(function() {
  return {
    server: this.server,
    username: this.username,
    password: this.password,
    proxy: this.server, // For backward compatibility
    ip: this.ip,
    port: this.port
  };
});

// Static method to parse raw proxy string
proxySchema.statics.parseRawProxy = function(rawProxyString) {
  const [ip, port, username, password] = rawProxyString.split(":");
  if (!ip || !port || !username || !password) {
    throw new Error(`Invalid proxy format: ${rawProxyString}`);
  }
  
  return {
    proxy_id: `${ip}_${port}`,
    server: `${ip}:${port}`,
    ip: ip,
    port: parseInt(port),
    username: username,
    password: password,
    raw_proxy_string: rawProxyString
  };
};

// Static method to create proxy from raw string
proxySchema.statics.createFromRaw = async function(rawProxyString, additionalData = {}) {
  const proxyData = this.parseRawProxy(rawProxyString);
  return await this.create({ ...proxyData, ...additionalData });
};

// Instance method to update usage stats
proxySchema.methods.incrementUsage = async function() {
  this.total_requests += 1;
  this.current_usage_count += 1;
  this.last_used = new Date();
  
  // Reset minute window if needed
  const now = new Date();
  const minutesDiff = (now - this.minute_window_start) / (1000 * 60);
  if (minutesDiff >= 1) {
    this.requests_this_minute = 1;
    this.minute_window_start = now;
  } else {
    this.requests_this_minute += 1;
  }
  
  return await this.save();
};

// Instance method to record failure
proxySchema.methods.recordFailure = async function(error = {}) {
  this.failed_requests += 1;
  this.consecutive_failures += 1;
  this.last_error = {
    message: error.message || 'Unknown error',
    timestamp: new Date(),
    error_code: error.code || 'UNKNOWN'
  };
  
  // Auto-disable if too many consecutive failures
  /*
  if (this.consecutive_failures >= 5) {
    this.status = 'inactive';
    this.is_working = false;
  }
  */
  
  // Update success rate
  if (this.total_requests > 0) {
    this.success_rate = ((this.total_requests - this.failed_requests) / this.total_requests) * 100;
  }
  
  return await this.save();
};

// Instance method to record success
proxySchema.methods.recordSuccess = async function(responseTime = 0) {
  this.consecutive_failures = 0;
  this.response_time = responseTime;
  this.last_tested = new Date();
  
  // Re-enable if it was disabled due to failures
  if (this.status === 'inactive' && this.consecutive_failures === 0) {
    this.status = 'active';
    this.is_working = true;
  }
  
  // Update success rate
  if (this.total_requests > 0) {
    this.success_rate = ((this.total_requests - this.failed_requests) / this.total_requests) * 100;
  }
  
  return await this.save();
};

// Instance method to assign to event
proxySchema.methods.assignToEvent = async function(eventId) {
  if (!this.assigned_events.some(assignment => assignment.event_id === eventId)) {
    this.assigned_events.push({
      event_id: eventId,
      assigned_at: new Date()
    });
    await this.save();
  }
  return this;
};

// Instance method to release from event
proxySchema.methods.releaseFromEvent = async function(eventId) {
  this.assigned_events = this.assigned_events.filter(
    assignment => assignment.event_id !== eventId
  );
  this.current_usage_count = Math.max(0, this.current_usage_count - 1);
  await this.save();
  return this;
};

// Static method to get available proxies for load balancing
proxySchema.statics.getAvailableProxies = async function(filters = {}) {
  const query = {
    status: 'active',
    is_working: true,
    current_usage_count: { $lt: this.schema.path('max_concurrent_usage').defaultValue },
    $expr: { $lt: ['$requests_this_minute', '$requests_per_minute_limit'] },
    ...filters
  };
  
  return await this.find(query)
    .sort({ rotation_weight: -1, success_rate: -1, current_usage_count: 1 });
};

const Proxy = mongoose.model("Proxy", proxySchema);

export { Proxy };