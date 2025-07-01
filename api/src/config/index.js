const path = require('path');

const config = {
  // Server configuration
  port: process.env.PORT || 3000,
  host: process.env.HOST || '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',

  // Swiss Ephemeris configuration
  swisseph: {
    // Path to swetest binary (relative to project root)
    binaryPath: process.env.SWETEST_PATH || path.join(__dirname, '../../../swetest'),
    // Path to ephemeris data files
    ephePath: process.env.EPHE_PATH || path.join(__dirname, '../../../ephe'),
    // Default timeout for swetest calls (ms)
    timeout: parseInt(process.env.SWETEST_TIMEOUT) || 5000
  },

  // Caching configuration
  cache: {
    // Maximum number of cached responses
    maxSize: parseInt(process.env.CACHE_MAX_SIZE) || 1000,
    // Cache TTL in milliseconds (1 hour default)
    ttl: parseInt(process.env.CACHE_TTL) || 60 * 60 * 1000
  },

  // Rate limiting configuration
  rateLimits: {
    // Requests per minute per IP
    requestsPerMinute: parseInt(process.env.RATE_LIMIT_RPM) || 100
  },

  // Logging configuration
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    format: process.env.LOG_FORMAT || 'json'
  },

  // API configuration
  api: {
    // Maximum allowed date range for bulk requests (future feature)
    maxDateRange: parseInt(process.env.MAX_DATE_RANGE) || 365,
    // Default timezone for requests without explicit timezone
    defaultTimezone: process.env.DEFAULT_TIMEZONE || 'UTC'
  }
};

// Validation
if (config.nodeEnv === 'production') {
  // Ensure required environment variables are set in production
  const requiredEnvVars = [];
  
  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      throw new Error(`Required environment variable ${envVar} is not set`);
    }
  }
}

module.exports = config;