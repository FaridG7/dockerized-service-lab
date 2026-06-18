FROM node:22-alpine

# Run as non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Copy manifests first to leverage layer caching —
# npm install only re-runs when these files change
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application source
COPY index.js ./

USER appuser

EXPOSE 3000

CMD ["node", "index.js"]
