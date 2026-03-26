FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json .
RUN npm install
COPY frontend/ .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY backend/package.json .
RUN npm install --production
COPY backend/ .
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

RUN mkdir -p /data

ENV NODE_ENV=production
ENV DB_PATH=/data/garden.db
ENV PORT=3700

EXPOSE 3700
CMD ["node", "server.js"]
