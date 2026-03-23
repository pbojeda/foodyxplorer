FROM node:20-alpine
WORKDIR /app

# Copy root workspace files
COPY package*.json ./
COPY tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/api/package.json packages/api/
COPY packages/scraper/package.json packages/scraper/

# Install all dependencies (tsx needed as runtime)
RUN npm ci

# Copy source code
COPY packages/shared/ packages/shared/
COPY packages/api/ packages/api/
COPY packages/scraper/ packages/scraper/

# Generate Prisma Client
RUN npx prisma generate --schema=packages/api/prisma/schema.prisma

EXPOSE 3001
CMD ["npx", "tsx", "packages/api/src/server.ts"]
