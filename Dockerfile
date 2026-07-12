# syntax=docker/dockerfile:1

# ---- Build stage: compile TypeScript to dist/ ----
FROM node:20-alpine AS build
WORKDIR /app

# Install all deps (incl. dev) for the TypeScript build
COPY package.json package-lock.json* ./
RUN npm ci

# Compile
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- Runtime stage: production-only deps + compiled output ----
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Install only production dependencies
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled JS from the build stage
COPY --from=build /app/dist ./dist

# Drop privileges: run as the built-in non-root "node" user
USER node

EXPOSE 3000
CMD ["node", "dist/server.js"]
