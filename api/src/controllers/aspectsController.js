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
 * Check if an angular difference matches any aspect (within 0.01 degree tolerance for "exact")
 */
function findMatchingAspect(angleDiff) {
  const tolerance = 0.01; // 0.01 degree tolerance for exact aspects
  
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
 * Deduplicate aspects by finding the most exact occurrence within consecutive series
 */
async function deduplicateAspects(aspects, service, dateStr) {
  if (aspects.length === 0) return [];
  
  // Sort aspects by planet pair, aspect type, and time
  const sorted = aspects.sort((a, b) => {
    const pairA = `${a.planet1}-${a.planet2}-${a.aspect}`;
    const pairB = `${b.planet1}-${b.planet2}-${b.aspect}`;
    if (pairA !== pairB) return pairA.localeCompare(pairB);
    return a.time.localeCompare(b.time);
  });
  
  const deduplicated = [];
  let currentGroup = [sorted[0]];
  const maxGapMinutes = 30; // Maximum time gap to consider aspects as part of same series
  
  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const previous = sorted[i - 1];
    
    // Check if this aspect is part of the same series as the previous one
    const sameAspect = current.planet1 === previous.planet1 && 
                      current.planet2 === previous.planet2 && 
                      current.aspect === previous.aspect;
    
    if (!sameAspect) {
      // Different aspect - finalize previous group and start new one
      deduplicated.push(await findMostExactInGroup(currentGroup, service, dateStr));
      currentGroup = [current];
    } else {
      // Same aspect - check time gap
      const timeGap = calculateTimeGapMinutes(previous.time, current.time);
      
      if (timeGap <= maxGapMinutes) {
        // Part of same series
        currentGroup.push(current);
      } else {
        // Time gap too large - finalize previous group and start new one
        deduplicated.push(await findMostExactInGroup(currentGroup, service, dateStr));
        currentGroup = [current];
      }
    }
  }
  
  // Don't forget the last group
  if (currentGroup.length > 0) {
    deduplicated.push(await findMostExactInGroup(currentGroup, service, dateStr));
  }
  
  // Sort by time for final output
  return deduplicated.sort((a, b) => a.time.localeCompare(b.time));
}

/**
 * Calculate time gap between two time strings in minutes
 */
function calculateTimeGapMinutes(time1, time2) {
  const [h1, m1, s1] = time1.split(':').map(Number);
  const [h2, m2, s2] = time2.split(':').map(Number);
  
  const seconds1 = h1 * 3600 + m1 * 60 + s1;
  const seconds2 = h2 * 3600 + m2 * 60 + s2;
  
  return Math.abs(seconds2 - seconds1) / 60;
}

/**
 * Find the most exact aspect in a group (closest to perfect aspect angle)
 * Then refine it to find the exact moment
 */
async function findMostExactInGroup(group, service, dateStr) {
  if (group.length === 1) {
    // Refine the single aspect to find exact timing
    const aspect = group[0];
    const refined = await refineAspectTiming(
      service, 
      dateStr, 
      aspect.time, 
      aspect.planet1, 
      aspect.planet2, 
      aspect.aspect, 
      aspect.angle
    );
    return refined || aspect;
  }
  
  const mostExact = group.reduce((mostExact, current) => {
    const exactnessError = Math.abs(current.actual_angle - current.angle);
    const currentBestError = Math.abs(mostExact.actual_angle - mostExact.angle);
    
    return exactnessError < currentBestError ? current : mostExact;
  });
  
  // Refine the most exact aspect to find the precise moment
  const refined = await refineAspectTiming(
    service,
    dateStr,
    mostExact.time,
    mostExact.planet1,
    mostExact.planet2,
    mostExact.aspect,
    mostExact.angle
  );
  
  return refined || mostExact;
}

/**
 * Refine aspect timing by searching around a found aspect at 1-second intervals
 * to find the moment when the aspect is most exact
 */
async function refineAspectTiming(service, dateStr, approximateTimeStr, planet1Name, planet2Name, aspectType, aspectDegrees) {
  const [hours, minutes, seconds] = approximateTimeStr.split(':').map(Number);
  const approximateTimeSeconds = hours * 3600 + minutes * 60 + seconds;
  
  // Search ±5 minutes around the approximate time at 1-second intervals
  const searchRangeSeconds = 5 * 60; // 5 minutes
  const startTimeSeconds = Math.max(0, approximateTimeSeconds - searchRangeSeconds);
  const endTimeSeconds = Math.min(86399, approximateTimeSeconds + searchRangeSeconds); // 86399 = 23:59:59
  
  let mostExactAspect = null;
  let smallestError = Infinity;
  
  for (let timeSeconds = startTimeSeconds; timeSeconds <= endTimeSeconds; timeSeconds++) {
    const h = Math.floor(timeSeconds / 3600);
    const m = Math.floor((timeSeconds % 3600) / 60);
    const s = timeSeconds % 60;
    const timeStr = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    
    try {
      const positions = await getPlanetPositionsForTime(service, dateStr, timeStr);
      if (positions.length < 2) continue;
      
      // Find the two planets we're refining
      const planet1 = positions.find(p => p.name === planet1Name);
      const planet2 = positions.find(p => p.name === planet2Name);
      
      if (!planet1 || !planet2) continue;
      
      const angleDiff = calculateAngularDifference(planet1.longitude_decimal, planet2.longitude_decimal);
      const error = Math.abs(angleDiff - aspectDegrees);
      
      if (error < smallestError) {
        smallestError = error;
        mostExactAspect = {
          time: timeStr,
          planet1: planet1.name,
          planet2: planet2.name,
          aspect: aspectType,
          angle: aspectDegrees,
          actual_angle: Math.round(angleDiff * 10000) / 10000, // 4 decimal places for precision
          precision_error: Math.round(error * 10000) / 10000,
          planet1_position: {
            longitude_decimal: planet1.longitude_decimal,
            zodiac_position: planet1.zodiac_position
          },
          planet2_position: {
            longitude_decimal: planet2.longitude_decimal,
            zodiac_position: planet2.zodiac_position
          }
        };
      }
    } catch (error) {
      // Skip this time point if there's an error
      continue;
    }
  }
  
  return mostExactAspect;
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
    
    logger.info(`RAW ASPECTS FOUND: ${aspects.length}`);
    
    // Deduplicate aspects to find most exact occurrences with 1-second precision refinement
    logger.info(`Before deduplication: ${aspects.length} aspects found`);
    let deduplicatedAspects;
    try {
      logger.info('Starting precise timing refinement for each aspect...');
      deduplicatedAspects = await deduplicateAspects(aspects, swissEphemerisService, date);
      logger.info(`After deduplication and refinement: ${deduplicatedAspects.length} aspects remaining`);
    } catch (dedupError) {
      logger.error('Deduplication failed, using raw aspects', { error: dedupError.message });
      deduplicatedAspects = aspects;
    }
    
    const calculationTime = Date.now() - startTime;
    
    const result = {
      date,
      total_aspects: deduplicatedAspects.length,
      raw_aspects_found: aspects.length,
      calculation_time_ms: calculationTime,
      aspects: deduplicatedAspects
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
      total_aspects: deduplicatedAspects.length,
      raw_aspects_found: aspects.length,
      deduplication_ratio: Math.round((1 - deduplicatedAspects.length / aspects.length) * 100),
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