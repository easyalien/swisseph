const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { logger } = require('./src/utils/logger');
const config = require('./src/config');
const routes = require('./src/routes');
const { errorHandler, notFoundHandler } = require('./src/middleware/errorHandler');

const app = express();

// Security middleware
app.use(helmet());
app.use(cors());
app.use(compression());

// Rate limiting
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: config.rateLimits.requestsPerMinute,
  message: {
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: `Too many requests. Limit: ${config.rateLimits.requestsPerMinute} requests per minute`
    }
  },
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api', limiter);

// Body parsing
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info('HTTP Request', {
      method: req.method,
      url: req.url,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });
  });
  next();
});

// API routes
app.use('/api/v1', routes);

// Root endpoint - API documentation
app.get('/', (req, res) => {
  res.json({
    name: 'Swiss Ephemeris API',
    version: '1.0.0',
    description: 'High-precision planetary position calculations',
    documentation: '/api/v1/info',
    health: '/api/v1/health',
    endpoints: {
      positions: {
        url: '/api/v1/positions',
        methods: ['GET', 'POST'],
        description: 'Get planetary positions for specified date/time'
      },
      aspects: {
        url: '/api/v1/aspects',
        methods: ['GET', 'POST'],
        description: 'Find exact planetary aspects for every second of a given day'
      }
    },
    examples: {
      positions_get: '/api/v1/positions?date=14.10.2020&time=13:43:00',
      positions_post: {
        url: '/api/v1/positions',
        body: {
          date: '14.10.2020',
          time: '13:43:00'
        }
      },
      aspects_get: '/api/v1/aspects?date=14.10.2020',
      aspects_post: {
        url: '/api/v1/aspects',
        body: {
          date: '14.10.2020'
        }
      }
    }
  });
});

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  server.close(() => {
    logger.info('Process terminated');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  server.close(() => {
    logger.info('Process terminated');
    process.exit(0);
  });
});

// Start server
const server = app.listen(config.port, config.host, () => {
  logger.info(`Swiss Ephemeris API server started`, {
    host: config.host,
    port: config.port,
    environment: config.nodeEnv,
    pid: process.pid
  });
});

module.exports = app;