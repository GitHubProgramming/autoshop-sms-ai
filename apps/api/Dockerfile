FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache wget

FROM base AS deps
COPY apps/api/package.json ./
COPY apps/api/package-lock.json ./
RUN npm install --frozen-lockfile

FROM base AS dev
COPY --from=deps /app/node_modules ./node_modules
COPY apps/api/ .
EXPOSE 3000
CMD ["npm", "run", "dev"]

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY apps/api/ .
# Copy canonical project status into the deploy-safe location (overrides any stale copy)
COPY project-brain/project_status.json ./project-status/project_status.json
# Copy migration SQL files so they land in the production image
COPY db/migrations/ ./migrations/
# Copy frontend static files so they are served by the API
COPY apps/web/ ./public/
RUN npm run build

FROM base AS prod
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/migrations ./migrations
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/public ./public
COPY --from=builder /app/project-status ./project-status
EXPOSE 3000
# Run migrations first; exit loudly on failure so Render detects the broken deploy
CMD ["sh", "-c", "node scripts/migrate.js && node dist/index.js"]
