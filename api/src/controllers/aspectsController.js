const SwissEphemerisService = require('../services/swissEphemerisService');
const cacheManager = require('../utils/cache');
const { logger } = require('../utils/logger');
const { APIError } = require('../middleware/errorHandler');

const swissEphemerisService = new SwissEphemerisService();

// Aspect definitions in degrees
const ASPECTS = {
  conjunction: 0,
  semisextile: 30,
  semisquare: 45,
  sextile: 60,
  quintile: 72,
  square: 90,
  trine: 120,
  sesquiquadrate: 135,
  biquintile: 144,
  quincunx: 150,
  opposition: 180
};

// Planet codes that we'll check for aspects
const PLANET_CODES = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']; // Sun through Pluto

/**
 * Calculate the angular difference between two longitudes
 */
function calculateAngularDifference(long1, long2) {
  let diff = Math.abs(long1 - long2);
  if (diff > 180) {
    diff = 360 - diff;
  }
  return diff;
}

/**
 * Check if an angular difference matches any aspect (within 0.1 degree tolerance for "exact")
 */
function findMatchingAspect(angleDiff) {
  const tolerance = 0.1; // 0.1 degree tolerance for "exact" aspects
  
  for (const [aspectName, aspectDegrees] of Object.entries(ASPECTS)) {
    if (Math.abs(angleDiff - aspectDegrees) <= tolerance) {
      return aspectName;
    }
  }
  return null;
}

/**
 * Get planetary positions for a specific date and time with only major planets
 */
async function getPlanetPositionsForTime(service, dateStr, timeStr) {
  const args = [
    `-edir${service.ephePath}`,
    '-p0123456789', // Only major planets (Sun through Pluto)
    `-b${dateStr}`,
    `-utc${timeStr}`,
    '-fPTZ',
    '-head'
  ];

  try {
    const output = await service.executeSwetestCommand(args);
    return service.parseSwetestOutput(output);
  } catch (error) {
    // Log but don't throw - we'll skip this time point
    logger.warn('Failed to get positions for time', { 
      date: dateStr, 
      time: timeStr, 
      error: error.message 
    });
    return [];
  }
}

/**
 * Find all exact aspects for a given day
 */
const getExactAspects = async (req, res, next) => {
  try {
    const startTime = Date.now();
    let { date } = req.method === 'POST' ? req.body : req.query;
    
    // Validate date format
    swissEphemerisService.validateDateFormat(date);
    
    // Check cache first
    const cacheKey = `aspects_${date}`;
    const cached = cacheManager.get(cacheKey);
    if (cached) {
      const responseTime = Date.now() - startTime;
      
      const response = {
        ...cached,
        response_time_ms: responseTime,
        cached: true
      };
      
      res.set({
        'X-Cache': 'HIT',
        'X-Response-Time': `${responseTime}ms`,
        'Cache-Control': `public, max-age=${Math.floor(cacheManager.cache.ttl / 1000)}`
      });
      
      logger.info('Served cached aspects', {
        date,
        response_time_ms: responseTime,
        cache_hit: true,
        aspect_count: cached.aspects.length
      });
      
      return res.json(response);
    }
    
    logger.info('Starting aspect calculation for full day', { date });
    
    const aspects = [];
    const stepSize = 10; // Check every 10 seconds for performance
    const totalSeconds = 86400; // 24 hours * 60 minutes * 60 seconds
    let processedSteps = 0;
    
    // Process every 10 seconds of the day for performance
    for (let second = 0; second < totalSeconds; second += stepSize) {
      const hours = Math.floor(second / 3600);
      const minutes = Math.floor((second % 3600) / 60);
      const secs = second % 60;
      
      const timeStr = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
      
      // Get positions for this time
      const positions = await getPlanetPositionsForTime(swissEphemerisService, date, timeStr);
      
      if (positions.length >= 2) {
        // Check all planet pairs for aspects
        for (let i = 0; i < positions.length; i++) {
          for (let j = i + 1; j < positions.length; j++) {
            const planet1 = positions[i];
            const planet2 = positions[j];
            
            const angleDiff = calculateAngularDifference(
              planet1.longitude_decimal,
              planet2.longitude_decimal
            );
            
            const aspectType = findMatchingAspect(angleDiff);
            
            if (aspectType) {
              aspects.push({
                time: timeStr,
                planet1: planet1.name,
                planet2: planet2.name,
                aspect: aspectType,
                angle: ASPECTS[aspectType],
                actual_angle: Math.round(angleDiff * 1000) / 1000,
                planet1_position: {
                  longitude_decimal: planet1.longitude_decimal,
                  zodiac_position: planet1.zodiac_position
                },
                planet2_position: {
                  longitude_decimal: planet2.longitude_decimal,
                  zodiac_position: planet2.zodiac_position
                }
              });
            }
          }
        }
      }
      
      processedSteps++;
      
      // Log progress every 600 steps (1 hour of checks)
      if (processedSteps % 360 === 0) {
        const progressPercent = Math.round((second / totalSeconds) * 100);
        logger.info('Aspect calculation progress', {
          date,
          progress: `${progressPercent}%`,
          aspects_found: aspects.length,
          processed_steps: processedSteps
        });
      }
    }
    
    const calculationTime = Date.now() - startTime;
    
    const result = {
      date,
      total_aspects: aspects.length,
      calculation_time_ms: calculationTime,
      aspects: aspects.sort((a, b) => a.time.localeCompare(b.time))
    };
    
    // Cache the result
    cacheManager.set(cacheKey, result);
    
    const responseTime = Date.now() - startTime;
    
    const response = {
      ...result,
      response_time_ms: responseTime,
      cached: false
    };
    
    res.set({
      'X-Cache': 'MISS',
      'X-Response-Time': `${responseTime}ms`,
      'Cache-Control': `public, max-age=${Math.floor(cacheManager.cache.ttl / 1000)}`
    });
    
    logger.info('Aspect calculation completed', {
      date,
      total_aspects: aspects.length,
      calculation_time_ms: calculationTime,
      response_time_ms: responseTime
    });
    
    res.json(response);
    
  } catch (error) {
    logger.error('Failed to calculate aspects', {
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

module.exports = {
  getExactAspects
};