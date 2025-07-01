const { exec } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const config = require('../config');
const { logger } = require('../utils/logger');

const execAsync = promisify(exec);

const healthCheck = async (req, res) => {
  const startTime = Date.now();
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    checks: {}
  };

  try {
    // Check swetest binary availability
    try {
      const swetestPath = config.swisseph.binaryPath;
      const { stdout, stderr } = await execAsync(`${swetestPath} -h`, {
        timeout: 2000,
        cwd: path.dirname(swetestPath)
      });
      
      health.checks.swetest = {
        status: 'healthy',
        message: 'Swiss Ephemeris binary is accessible',
        path: swetestPath
      };
    } catch (swetestError) {
      health.checks.swetest = {
        status: 'unhealthy',
        message: 'Swiss Ephemeris binary not accessible',
        error: swetestError.message,
        path: config.swisseph.binaryPath
      };
      health.status = 'degraded';
    }

    // Check ephemeris data files
    try {
      const fs = require('fs').promises;
      const ephePath = config.swisseph.ephePath;
      await fs.access(ephePath);
      
      // Check for some key ephemeris files
      const files = await fs.readdir(ephePath);
      const hasSepl = files.some(f => f.startsWith('sepl_'));
      const hasSemo = files.some(f => f.startsWith('semo_'));
      
      health.checks.ephemeris_data = {
        status: hasSepl && hasSemo ? 'healthy' : 'degraded',
        message: hasSepl && hasSemo ? 'Ephemeris data files found' : 'Some ephemeris files missing',
        path: ephePath,
        file_count: files.length
      };
      
      if (!hasSepl || !hasSemo) {
        health.status = 'degraded';
      }
    } catch (epheError) {
      health.checks.ephemeris_data = {
        status: 'unhealthy',
        message: 'Ephemeris data directory not accessible',
        error: epheError.message,
        path: config.swisseph.ephePath
      };
      health.status = 'unhealthy';
    }

    // Check memory usage
    const memUsage = process.memoryUsage();
    const memUsagePercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
    health.checks.memory = {
      status: memUsagePercent < 80 ? 'healthy' : 'warning',
      message: `Memory usage: ${memUsagePercent.toFixed(1)}%`,
      heap_used_mb: Math.round(memUsage.heapUsed / 1024 / 1024),
      heap_total_mb: Math.round(memUsage.heapTotal / 1024 / 1024)
    };

    if (memUsagePercent >= 90 && health.status === 'healthy') {
      health.status = 'warning';
    }

    // Response time check
    health.response_time_ms = Date.now() - startTime;

    // Set HTTP status based on overall health
    let statusCode = 200;
    if (health.status === 'unhealthy') {
      statusCode = 503;
    } else if (health.status === 'degraded' || health.status === 'warning') {
      statusCode = 200; // Still operational
    }

    logger.info('Health check completed', {
      status: health.status,
      response_time_ms: health.response_time_ms
    });

    res.status(statusCode).json(health);

  } catch (error) {
    logger.error('Health check failed', { error: error.message });
    
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Health check failed',
      message: error.message
    });
  }
};

module.exports = {
  healthCheck
};