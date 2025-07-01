const { LRUCache } = require('lru-cache');
const config = require('../config');
const { logger } = require('./logger');

class CacheManager {
  constructor() {
    this.cache = new LRUCache({
      max: config.cache.maxSize,
      ttl: config.cache.ttl,
      updateAgeOnGet: true,
      updateAgeOnHas: true
    });

    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0
    };

    // Log cache stats periodically
    this.statsInterval = setInterval(() => {
      this.logStats();
    }, 60000); // Every minute
  }

  /**
   * Generate cache key from date and time
   */
  generateKey(date, time) {
    return `positions:${date}:${time}`;
  }

  /**
   * Get cached positions
   */
  get(dateOrKey, time) {
    let key;
    if (time !== undefined) {
      key = this.generateKey(dateOrKey, time);
    } else {
      key = dateOrKey; // Direct key provided
    }
    
    const value = this.cache.get(key);
    
    if (value) {
      this.stats.hits++;
      logger.debug('Cache hit', { key, size: this.cache.size });
      return value;
    } else {
      this.stats.misses++;
      logger.debug('Cache miss', { key, size: this.cache.size });
      return null;
    }
  }

  /**
   * Set cached positions
   */
  set(dateOrKey, timeOrData, positions) {
    let key, data;
    if (positions !== undefined) {
      // Three parameters: date, time, positions
      key = this.generateKey(dateOrKey, timeOrData);
      data = positions;
    } else {
      // Two parameters: key, data
      key = dateOrKey;
      data = timeOrData;
    }
    
    // Add cache metadata
    const cacheValue = {
      ...data,
      cached_at: new Date().toISOString(),
      cache_ttl_ms: config.cache.ttl
    };
    
    this.cache.set(key, cacheValue);
    this.stats.sets++;
    
    logger.debug('Cache set', { 
      key, 
      size: this.cache.size,
      max_size: this.cache.max 
    });
    
    return cacheValue;
  }

  /**
   * Delete cached entry
   */
  delete(dateOrKey, time) {
    let key;
    if (time !== undefined) {
      key = this.generateKey(dateOrKey, time);
    } else {
      key = dateOrKey; // Direct key provided
    }
    
    const deleted = this.cache.delete(key);
    
    if (deleted) {
      this.stats.deletes++;
      logger.debug('Cache delete', { key, size: this.cache.size });
    }
    
    return deleted;
  }

  /**
   * Clear all cache entries
   */
  clear() {
    const sizeBefore = this.cache.size;
    this.cache.clear();
    
    logger.info('Cache cleared', { 
      entries_removed: sizeBefore 
    });
    
    return sizeBefore;
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? (this.stats.hits / total) * 100 : 0;
    
    return {
      size: this.cache.size,
      max_size: this.cache.max,
      hits: this.stats.hits,
      misses: this.stats.misses,
      sets: this.stats.sets,
      deletes: this.stats.deletes,
      hit_rate_percent: Math.round(hitRate * 100) / 100,
      ttl_ms: config.cache.ttl
    };
  }

  /**
   * Log cache statistics
   */
  logStats() {
    const stats = this.getStats();
    
    if (stats.hits + stats.misses > 0) {
      logger.info('Cache statistics', stats);
    }
  }

  /**
   * Cleanup cache manager
   */
  cleanup() {
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
    }
  }
}

// Create singleton instance
const cacheManager = new CacheManager();

// Cleanup on process exit
process.on('SIGTERM', () => {
  cacheManager.cleanup();
});

process.on('SIGINT', () => {
  cacheManager.cleanup();
});

module.exports = cacheManager;