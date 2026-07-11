# dex-arb-bot — runs the TypeScript bot directly on Node 22 (native type
# stripping; no build step, no ts-node). Pure background worker, no ports.
FROM node:22-alpine

WORKDIR /app

# Only runtime deps (ethers). devDependencies (typescript, @types/node) are not
# needed at runtime — Node strips the types itself.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
CMD ["node", "src/index.ts"]
