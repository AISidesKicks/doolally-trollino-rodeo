FROM node:24-slim

WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3030 \
    DLLY_DB_PATH=/data/lab.db \
    DLLY_LOG_DIR=/data/logs

COPY package.json ./
COPY src ./src
COPY datasets ./datasets

RUN node src/build-gui.js && mkdir -p /data/logs

EXPOSE 3030

CMD ["node", "src/server.js"]
