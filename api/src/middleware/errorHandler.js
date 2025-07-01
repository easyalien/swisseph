const { logger } = require('../utils/logger');

class APIError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR', details = null) {
    super(message);
    this.name = 'APIError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;
  }
}

const notFoundHandler = (req, res, next) => {
  const error = new APIError(
    `Route ${req.method} ${req.path} not found`,
    404,
    'ROUTE_NOT_FOUND'
  );
  next(error);
};

const errorHandler = (err, req, res, next) => {
  // Default to 500 if no status code is set
  let statusCode = err.statusCode || 500;
  let code = err.code || 'INTERNAL_ERROR';
  let message = err.message || 'Internal server error';
  let details = err.details || null;

  // Handle specific error types
  if (err.name === 'ValidationError') {
    statusCode = 400;
    code = 'VALIDATION_ERROR';
    message = 'Invalid request data';
    details = err.details;
  } else if (err.name === 'SyntaxError' && err.type === 'entity.parse.failed') {
    statusCode = 400;
    code = 'INVALID_JSON';
    message = 'Invalid JSON in request body';
  } else if (err.code === 'ENOENT') {
    statusCode = 500;
    code = 'FILE_NOT_FOUND';
    message = 'Required file not found';
  } else if (err.code === 'ETIMEDOUT') {
    statusCode = 504;
    code = 'TIMEOUT';
    message = 'Request timeout';
  }

  // Log error details
  const logLevel = statusCode >= 500 ? 'error' : 'warn';
  logger[logLevel]('API Error', {
    error: {
      message: err.message,
      stack: err.stack,
      code,
      statusCode
    },
    request: {
      method: req.method,
      url: req.url,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    }
  });

  // Send error response
  const response = {
    error: {
      code,
      message,
      ...(details && { details })
    }
  };

  // Add request ID if available
  if (req.id) {
    response.requestId = req.id;
  }

  // Add stack trace in development
  if (process.env.NODE_ENV === 'development' && err.stack) {
    response.error.stack = err.stack;
  }

  res.status(statusCode).json(response);
};

module.exports = {
  APIError,
  errorHandler,
  notFoundHandler
};