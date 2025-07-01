# Multi-stage build for Swiss Ephemeris API
FROM node:18-alpine AS base

# Install build dependencies for compiling swetest if needed
RUN apk add --no-cache \
    build-base \
    linux-headers \
    python3 \
    make \
    gcc \
    g++

WORKDIR /app

# Copy package files
COPY api/package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Development stage
FROM base AS development
RUN npm ci
COPY api/ ./
EXPOSE 3000
CMD ["npm", "run", "dev"]

# Build stage - compile Swiss Ephemeris
FROM base AS builder

# Copy Swiss Ephemeris source code
COPY Makefile ./
COPY *.c *.h ./
COPY ephe/ ./ephe/

# Build swetest binary
RUN make swetest

# Production stage
FROM node:18-alpine AS production

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S apiuser -u 1001

# Install runtime dependencies
RUN apk add --no-cache \
    libstdc++ \
    libgcc

WORKDIR /app

# Copy built application
COPY --from=base /app/node_modules ./node_modules
COPY api/ ./

# Copy Swiss Ephemeris binary and data files
COPY --from=builder /app/swetest ./swetest
COPY --from=builder /app/ephe ./ephe

# Set correct paths for container environment
ENV SWETEST_PATH=/app/swetest
ENV EPHE_PATH=/app/ephe

# Ensure binary is executable
RUN chmod +x ./swetest

# Create logs directory
RUN mkdir -p logs && chown -R apiuser:nodejs /app

# Switch to non-root user
USER apiuser

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/api/v1/health', (res) => { \
        if (res.statusCode === 200) process.exit(0); else process.exit(1); \
    }).on('error', () => process.exit(1))"

EXPOSE 3000

# Start the application
CMD ["npm", "start"]