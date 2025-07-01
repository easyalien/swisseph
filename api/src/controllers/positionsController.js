const SwissEphemerisService = require('../services/swissEphemerisService');
const cacheManager = require('../utils/cache');
const { logger } = require('../utils/logger');
const { APIError } = require('../middleware/errorHandler');

const swissEphemerisService = new SwissEphemerisService();

/**
 * Get planetary positions for specified date and time
 */
const getPositions = async (req, res, next) => {
  try {
    const startTime = Date.now();
    let { date, time } = req.method === 'POST' ? req.body : req.query;
    
    // Validate and normalize inputs
    swissEphemerisService.validateDateFormat(date);
    time = swissEphemerisService.validateTimeFormat(time);
    
    // Check cache first
    const cached = cacheManager.get(date, time);
    if (cached) {
      const responseTime = Date.now() - startTime;
      
      // Add response metadata
      const response = {
        ...cached,
        response_time_ms: responseTime,
        cached: true
      };
      
      // Add cache headers
      res.set({
        'X-Cache': 'HIT',
        'X-Response-Time': `${responseTime}ms`,
        'Cache-Control': `public, max-age=${Math.floor(cacheManager.cache.ttl / 1000)}`
      });
      
      logger.info('Served cached planetary positions', {
        date,
        time,
        response_time_ms: responseTime,
        cache_hit: true,
        count: cached.count
      });
      
      return res.json(response);
    }
    
    // Calculate positions
    const positions = await swissEphemerisService.getAllPositions(date, time);
    
    // Cache the result
    const cachedResult = cacheManager.set(date, time, positions);
    
    const responseTime = Date.now() - startTime;
    
    // Add response metadata
    const response = {
      ...cachedResult,
      response_time_ms: responseTime,
      cached: false
    };
    
    // Add response headers
    res.set({
      'X-Cache': 'MISS',
      'X-Response-Time': `${responseTime}ms`,
      'Cache-Control': `public, max-age=${Math.floor(cacheManager.cache.ttl / 1000)}`
    });
    
    logger.info('Served calculated planetary positions', {
      date,
      time,
      response_time_ms: responseTime,
      calculation_time_ms: positions.calculation_time_ms,
      cache_hit: false,
      count: positions.count
    });
    
    res.json(response);
    
  } catch (error) {
    logger.error('Failed to get planetary positions', {
      error: error.message,
      stack: error.stack,
      request: {
        method: req.method,
        body: req.body,
        query: req.query
      }
    });
    
    next(error);
  }
};

/**
 * Get cache statistics (debugging/monitoring endpoint)
 */
const getCacheStats = async (req, res) => {
  try {
    const stats = cacheManager.getStats();
    
    res.json({
      cache_statistics: stats,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('Failed to get cache statistics', { error: error.message });
    res.status(500).json({
      error: 'Failed to retrieve cache statistics',
      message: error.message
    });
  }
};

/**
 * Clear cache (admin endpoint)
 */
const clearCache = async (req, res) => {
  try {
    const entriesRemoved = cacheManager.clear();
    
    logger.info('Cache cleared manually', {
      entries_removed: entriesRemoved,
      user_agent: req.get('User-Agent'),
      ip: req.ip
    });
    
    res.json({
      message: 'Cache cleared successfully',
      entries_removed: entriesRemoved,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('Failed to clear cache', { error: error.message });
    res.status(500).json({
      error: 'Failed to clear cache',
      message: error.message
    });
  }
};

module.exports = {
  getPositions,
  getCacheStats,
  clearCache
};