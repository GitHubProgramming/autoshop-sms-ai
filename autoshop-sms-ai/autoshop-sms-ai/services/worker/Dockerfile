FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY packages/shared ./packages/shared
COPY services/worker ./services/worker
RUN npm install --workspaces
RUN npm run build --workspace=services/worker

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/services/worker/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
CMD ["node", "dist/index.js"]
