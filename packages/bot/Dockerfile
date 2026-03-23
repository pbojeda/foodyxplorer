FROM node:20-alpine
WORKDIR /app

# Copy root workspace files
COPY package*.json ./
COPY tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/bot/package.json packages/bot/

# Install all dependencies (tsx needed as runtime)
RUN npm ci

# Copy source code
COPY packages/shared/ packages/shared/
COPY packages/bot/ packages/bot/

EXPOSE 3001
CMD ["npx", "tsx", "packages/bot/src/index.ts"]
