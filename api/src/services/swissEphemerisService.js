const { spawn, execFile } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const config = require('../config');
const { logger } = require('../utils/logger');
const { APIError } = require('../middleware/errorHandler');

const execFileAsync = promisify(execFile);

class SwissEphemerisService {
  constructor() {
    this.swetestPath = config.swisseph.binaryPath;
    this.ephePath = config.swisseph.ephePath;
    this.timeout = config.swisseph.timeout;
  }

  /**
   * Parse swetest output into structured position data
   */
  parseSwetestOutput(output) {
    const positions = [];
    const lines = output.trim().split('\n');
    
    for (const line of lines) {
      if (!line.trim()) continue;
      
      // Skip header/info lines
      if (line.includes('date (dmy)') || line.includes('UT:') || 
          line.includes('TT:') || line.includes('Epsilon') || 
          line.includes('Nutation') || line.includes('error:') ||
          line.includes('warning:')) {
        continue;
      }
      
      // Parse position lines: "Planet name    date time UT  position"
      const match = line.match(/^([^0-9]+?)\s+\d+\.\d+\.\d+\s+\d+:\d+:\d+\s+UT\s+(.+)$/);
      if (match) {
        const name = match[1].trim();
        const positionPart = match[2].trim();
        
        // Parse zodiac position like "21 li 40' 3.9926"
        const zodiacMatch = positionPart.match(/(\d+)\s+([a-z]{2})\s+(\d+)'\s*([\d.]+)/);
        if (zodiacMatch) {
          const degrees = parseInt(zodiacMatch[1]);
          const sign = zodiacMatch[2];
          const minutes = parseInt(zodiacMatch[3]);
          const seconds = parseFloat(zodiacMatch[4]);
          
          // Convert to decimal degrees
          const signMap = {
            'ar': 0, 'ta': 30, 'ge': 60, 'cn': 90, 'le': 120, 'vi': 150,
            'li': 180, 'sc': 210, 'sa': 240, 'cp': 270, 'aq': 300, 'pi': 330
          };
          
          const longitudeDecimal = signMap[sign] + degrees + minutes/60 + seconds/3600;
          
          positions.push({
            name: name,
            longitude_decimal: Math.round(longitudeDecimal * 1000000) / 1000000, // 6 decimal precision
            zodiac_position: {
              sign: sign,
              degrees: degrees,
              minutes: minutes,
              seconds: Math.round(seconds * 100) / 100 // 2 decimal precision
            }
          });
        }
      }
    }
    
    return positions;
  }

  /**
   * Execute swetest command with specified parameters
   */
  async executeSwetestCommand(args) {
    try {
      const { stdout, stderr } = await execFileAsync(
        this.swetestPath,
        args,
        { 
          timeout: this.timeout,
          cwd: path.dirname(this.swetestPath),
          maxBuffer: 1024 * 1024 // 1MB buffer
        }
      );

      if (stderr && stderr.trim()) {
        logger.warn('swetest stderr output', { stderr: stderr.trim(), args });
      }

      return stdout;
    } catch (error) {
      logger.error('swetest execution failed', { 
        error: error.message, 
        args,
        code: error.code,
        signal: error.signal
      });

      if (error.code === 'ENOENT') {
        throw new APIError(
          'Swiss Ephemeris binary not found',
          500,
          'SWETEST_NOT_FOUND',
          { path: this.swetestPath }
        );
      } else if (error.signal === 'SIGTERM' || error.code === 'ETIMEDOUT') {
        throw new APIError(
          'Calculation timeout',
          504,
          'CALCULATION_TIMEOUT',
          { timeout: this.timeout }
        );
      } else {
        throw new APIError(
          'Calculation failed',
          500,
          'CALCULATION_ERROR',
          { originalError: error.message }
        );
      }
    }
  }

  /**
   * Get major planets and lunar points
   */
  async getMajorPlanets(dateStr, timeStr) {
    const args = [
      `-edir${this.ephePath}`,
      '-p0123456789mtAB',  // Major planets + nodes + apogees
      `-b${dateStr}`,
      `-utc${timeStr}`,
      '-fPTZ',
      '-head'
    ];

    const output = await this.executeSwetestCommand(args);
    return this.parseSwetestOutput(output);
  }

  /**
   * Get major asteroids
   */
  async getMajorAsteroids(dateStr, timeStr) {
    const args = [
      `-edir${this.ephePath}`,
      '-pDEFGHI',  // Chiron, Pholus, Ceres, Pallas, Juno, Vesta
      `-b${dateStr}`,
      `-utc${timeStr}`,
      '-fPTZ',
      '-head'
    ];

    const output = await this.executeSwetestCommand(args);
    return this.parseSwetestOutput(output);
  }

  /**
   * Get fixed star positions (Galactic Center, Great Attractor)
   */
  async getFixedStars(dateStr, timeStr) {
    const stars = ['Galactic Center', 'Great Attractor'];
    const positions = [];

    for (const starName of stars) {
      try {
        const args = [
          `-edir${this.ephePath}`,
          '-pf',
          `-xf${starName}`,
          `-b${dateStr}`,
          `-utc${timeStr}`,
          '-fPTZ',
          '-head'
        ];

        const output = await this.executeSwetestCommand(args);
        const starPositions = this.parseSwetestOutput(output);
        positions.push(...starPositions);
      } catch (error) {
        logger.warn(`Failed to get position for ${starName}`, { 
          error: error.message,
          star: starName
        });
        // Continue with other stars if one fails
      }
    }

    return positions;
  }

  /**
   * Get all planetary positions for a given date and time
   */
  async getAllPositions(dateStr, timeStr = '12:00:00') {
    const startTime = Date.now();
    
    try {
      logger.info('Calculating planetary positions', { 
        date: dateStr, 
        time: timeStr 
      });

      // Execute all calculations in parallel for better performance
      const [majorPlanets, asteroids, fixedStars] = await Promise.all([
        this.getMajorPlanets(dateStr, timeStr),
        this.getMajorAsteroids(dateStr, timeStr),
        this.getFixedStars(dateStr, timeStr)
      ]);

      const allPositions = [
        ...majorPlanets,
        ...asteroids,
        ...fixedStars
      ];

      const calculationTime = Date.now() - startTime;
      
      logger.info('Planetary positions calculated successfully', {
        date: dateStr,
        time: timeStr,
        count: allPositions.length,
        calculation_time_ms: calculationTime
      });

      return {
        timestamp: `${dateStr} ${timeStr} UTC`,
        count: allPositions.length,
        calculation_time_ms: calculationTime,
        positions: allPositions
      };

    } catch (error) {
      const calculationTime = Date.now() - startTime;
      
      logger.error('Failed to calculate planetary positions', {
        error: error.message,
        date: dateStr,
        time: timeStr,
        calculation_time_ms: calculationTime
      });

      throw error;
    }
  }

  /**
   * Validate date format (DD.MM.YYYY)
   */
  validateDateFormat(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') {
      throw new APIError(
        'Date is required',
        400,
        'MISSING_DATE'
      );
    }

    const dateRegex = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;
    const match = dateStr.match(dateRegex);
    
    if (!match) {
      throw new APIError(
        'Invalid date format. Use DD.MM.YYYY (e.g., 14.10.2020)',
        400,
        'INVALID_DATE_FORMAT',
        { provided: dateStr, expected: 'DD.MM.YYYY' }
      );
    }

    const day = parseInt(match[1]);
    const month = parseInt(match[2]);
    const year = parseInt(match[3]);

    // Basic validation
    if (day < 1 || day > 31) {
      throw new APIError(
        'Invalid day. Must be between 1 and 31',
        400,
        'INVALID_DAY',
        { day }
      );
    }

    if (month < 1 || month > 12) {
      throw new APIError(
        'Invalid month. Must be between 1 and 12',
        400,
        'INVALID_MONTH',
        { month }
      );
    }

    if (year < 1000 || year > 3000) {
      throw new APIError(
        'Invalid year. Must be between 1000 and 3000',
        400,
        'INVALID_YEAR',
        { year }
      );
    }

    return true;
  }

  /**
   * Validate time format (HH:MM:SS)
   */
  validateTimeFormat(timeStr) {
    if (!timeStr) {
      return '12:00:00'; // Default time
    }

    if (typeof timeStr !== 'string') {
      throw new APIError(
        'Time must be a string',
        400,
        'INVALID_TIME_TYPE'
      );
    }

    const timeRegex = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;
    const match = timeStr.match(timeRegex);
    
    if (!match) {
      throw new APIError(
        'Invalid time format. Use HH:MM:SS or HH:MM (e.g., 13:43:00)',
        400,
        'INVALID_TIME_FORMAT',
        { provided: timeStr, expected: 'HH:MM:SS' }
      );
    }

    const hours = parseInt(match[1]);
    const minutes = parseInt(match[2]);
    const seconds = match[3] ? parseInt(match[3]) : 0;

    if (hours < 0 || hours > 23) {
      throw new APIError(
        'Invalid hours. Must be between 0 and 23',
        400,
        'INVALID_HOURS',
        { hours }
      );
    }

    if (minutes < 0 || minutes > 59) {
      throw new APIError(
        'Invalid minutes. Must be between 0 and 59',
        400,
        'INVALID_MINUTES',
        { minutes }
      );
    }

    if (seconds < 0 || seconds > 59) {
      throw new APIError(
        'Invalid seconds. Must be between 0 and 59',
        400,
        'INVALID_SECONDS',
        { seconds }
      );
    }

    // Return normalized format
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
}

module.exports = SwissEphemerisService;