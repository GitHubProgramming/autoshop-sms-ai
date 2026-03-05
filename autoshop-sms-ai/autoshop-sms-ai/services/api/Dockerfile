FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY packages/shared ./packages/shared
COPY services/api ./services/api
RUN npm install --workspaces
RUN npm run build --workspace=services/api

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/services/api/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 3001
CMD ["node", "dist/server.js"]
