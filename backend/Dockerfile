# Multi-stage build for optimized production image with pnpm

# Stage 1: Build
FROM node:20-alpine AS builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml* ./

# Install dependencies (including dev dependencies for build)
# Use --ignore-scripts to skip optional native builds like msgpackr-extract
RUN pnpm install --frozen-lockfile --ignore-scripts

# Copy source code
COPY . .

# Build TypeScript
RUN pnpm run build

# Stage 2: Production
FROM node:20-alpine

# Install pnpm and wget for healthchecks
RUN corepack enable && corepack prepare pnpm@latest --activate && \
    apk add --no-cache wget

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml* ./

# Install production dependencies only
# Use --ignore-scripts to skip optional native builds like msgpackr-extract
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

# Copy built application from builder
COPY --from=builder /app/dist ./dist

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Change ownership
RUN chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:3000/health || exit 1

# Start application
CMD ["node", "dist/index.js"]
