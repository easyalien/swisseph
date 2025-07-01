const express = require('express');
const positionsController = require('../controllers/positionsController');
const healthController = require('../controllers/healthController');

const router = express.Router();

// Health check endpoint
router.get('/health', healthController.healthCheck);

// API information endpoint
router.get('/info', (req, res) => {
  res.json({
    name: 'Swiss Ephemeris API',
    version: '1.0.0',
    description: 'High-precision planetary position calculations using Swiss Ephemeris',
    author: 'Swiss Ephemeris API Team',
    license: 'AGPL-3.0',
    endpoints: {
      '/health': {
        method: 'GET',
        description: 'Health check and system status'
      },
      '/positions': {
        methods: ['GET', 'POST'],
        description: 'Get planetary positions for specified date and time',
        parameters: {
          date: {
            required: true,
            format: 'DD.MM.YYYY',
            example: '14.10.2020',
            description: 'Date for calculation'
          },
          time: {
            required: false,
            format: 'HH:MM:SS',
            example: '13:43:00',
            default: '12:00:00',
            description: 'Time in UTC'
          }
        }
      }
    },
    supported_objects: [
      'Major Planets (Sun through Pluto)',
      'Lunar Nodes (Mean and True)',
      'Lunar Apogees (Mean and Osculating)',
      'Major Asteroids (Chiron, Pholus, Ceres, Pallas, Juno, Vesta)',
      'Galactic Center',
      'Great Attractor'
    ],
    examples: {
      get_request: {
        url: '/api/v1/positions?date=14.10.2020&time=13:43:00',
        description: 'GET request with query parameters'
      },
      post_request: {
        url: '/api/v1/positions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: {
          date: '14.10.2020',
          time: '13:43:00'
        },
        description: 'POST request with JSON body'
      }
    },
    response_format: {
      timestamp: 'ISO 8601 datetime string',
      count: 'Number of celestial objects calculated',
      positions: [
        {
          name: 'Object name',
          longitude_decimal: 'Longitude in decimal degrees (0-360)',
          zodiac_position: {
            sign: 'Two-letter zodiac sign code',
            degrees: 'Degrees within sign (0-29)',
            minutes: 'Minutes (0-59)',
            seconds: 'Seconds with decimal (0-59.99)'
          }
        }
      ]
    }
  });
});

// Planetary positions endpoints
router.get('/positions', positionsController.getPositions);
router.post('/positions', positionsController.getPositions);

module.exports = router;