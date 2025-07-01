# Docker Deployment Guide

## Quick Start

### Development Mode
```bash
# Start development server with hot reload
docker-compose -f docker-compose.dev.yml up -d

# View logs
docker-compose -f docker-compose.dev.yml logs -f
```

### Production Mode
```bash
# Start production server
docker-compose up -d

# View logs
docker-compose logs -f api

# Stop services
docker-compose down
```

## Available Services

### Phase 1 (Current)
- **API Server**: Swiss Ephemeris API on port 3000
- **Health Check**: Built-in container health monitoring
- **Persistent Logs**: Volume mounted at `/app/logs`

### Phase 2 (Future)
- **Redis Cache**: Distributed caching (use `--profile phase2`)
- **Nginx Load Balancer**: Reverse proxy with rate limiting
- **Horizontal Scaling**: Multiple API instances

## Environment Variables

### Production Configuration
```yaml
environment:
  - NODE_ENV=production
  - PORT=3000
  - LOG_LEVEL=info
  - CACHE_MAX_SIZE=1000
  - CACHE_TTL=3600000
  - RATE_LIMIT_RPM=100
```

### Development Configuration
```yaml
environment:
  - NODE_ENV=development
  - LOG_LEVEL=debug
  - CACHE_MAX_SIZE=100
  - CACHE_TTL=300000
```

## Docker Images

### Multi-Stage Build
- **Base**: Node.js 18 Alpine with build tools
- **Builder**: Compiles Swiss Ephemeris binary
- **Production**: Minimal runtime image with security hardening

### Image Size Optimization
- Uses Alpine Linux base (small footprint)
- Multi-stage build removes build dependencies
- Non-root user for security
- Efficient layer caching

## Health Monitoring

### Container Health Check
```bash
# Check container health
docker ps

# View health check logs
docker inspect swiss-ephemeris-api | grep Health -A 10
```

### API Health Endpoint
```bash
curl http://localhost:3000/api/v1/health
```

Returns system status including:
- Swiss Ephemeris binary accessibility
- Ephemeris data file availability
- Memory usage monitoring
- Response time metrics

## Volume Management

### Persistent Data
```yaml
volumes:
  - api-logs:/app/logs          # Application logs
  - redis-data:/data            # Redis persistence (Phase 2)
```

### Development Volumes
```yaml
volumes:
  - ./api:/app                  # Hot reload source code
  - /app/node_modules           # Preserve installed packages
```

## Networking

### Internal Network
- All services communicate via `ephemeris-network`
- Service discovery by container name
- Isolated from host network except exposed ports

### Port Mapping
- **3000**: API server (production)
- **6379**: Redis cache (Phase 2)
- **80/443**: Nginx proxy (Phase 2)

## Security Features

### Container Security
- Non-root user (`apiuser:nodejs`)
- Read-only ephemeris data
- Minimal attack surface (Alpine base)
- Security headers via Nginx (Phase 2)

### Application Security
- Input validation and sanitization
- Rate limiting (100 req/min default)
- Error handling without information leakage
- CORS configuration

## Performance Tuning

### Resource Limits
```yaml
deploy:
  resources:
    limits:
      memory: 512M
      cpus: '0.5'
    reservations:
      memory: 256M
      cpus: '0.25'
```

### Cache Configuration
- **Phase 1**: In-memory LRU cache (1000 entries)
- **Phase 2**: Redis distributed cache
- TTL: 1 hour (configurable)

## Monitoring & Observability

### Log Aggregation
```bash
# Follow all logs
docker-compose logs -f

# Filter by service
docker-compose logs -f api

# Export logs
docker-compose logs --no-color > api.log
```

### Metrics Collection (Phase 2)
- Prometheus metrics endpoint
- Grafana dashboards
- Alert manager integration

## Troubleshooting

### Common Issues

**Port Already in Use**
```bash
# Kill process using port
lsof -ti:3000 | xargs kill -9

# Or change port in docker-compose.yml
ports:
  - "3001:3000"
```

**Container Won't Start**
```bash
# Check container logs
docker logs swiss-ephemeris-api

# Interactive debug
docker exec -it swiss-ephemeris-api sh
```

**Permission Issues**
```bash
# Rebuild with clean cache
docker-compose build --no-cache

# Check file permissions
docker exec swiss-ephemeris-api ls -la /app/
```

### Performance Issues
```bash
# Check resource usage
docker stats swiss-ephemeris-api

# Memory profiling
docker exec swiss-ephemeris-api cat /proc/meminfo

# Test endpoint performance
time curl "http://localhost:3000/api/v1/positions?date=01.01.2025"
```

## Production Deployment

### Prerequisites
- Docker Engine 20.10+
- Docker Compose v2.0+
- Minimum 1GB RAM
- SSL certificates (for HTTPS)

### Deployment Steps
1. Clone repository
2. Configure environment variables
3. Build and start services: `docker-compose up -d`
4. Verify health: `curl localhost:3000/api/v1/health`
5. Configure monitoring and alerts

### Scaling (Phase 2)
```bash
# Scale API instances
docker-compose up -d --scale api=3

# Enable load balancer
docker-compose --profile phase2 up -d
```

## Backup & Recovery

### Data Backup
- Ephemeris files: Read-only, no backup needed
- Logs: Rotate and archive via log management
- Cache: Ephemeral, rebuilds automatically

### Disaster Recovery
- Container restart: Automatic with `restart: unless-stopped`
- Image recovery: Rebuild from source
- Data recovery: Cache rebuilds from Swiss Ephemeris calculations