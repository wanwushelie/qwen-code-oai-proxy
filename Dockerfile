FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

RUN npm ci --ignore-scripts

COPY . .

RUN npm rebuild better-sqlite3 --build-from-source

RUN npm run build:core

RUN mkdir -p /root/.qwen /root/.local/share/qwen-proxy

EXPOSE ${PORT:-8006}

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 8006) + '/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

ENV HOST=0.0.0.0

CMD ["node", "dist/src/cli/qwen-proxy.js", "serve", "--headless"]
