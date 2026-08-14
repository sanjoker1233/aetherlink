# ---- build stage ----
FROM node:18-alpine AS build
WORKDIR /app

# NEXT_PUBLIC_* est inline AU BUILD : cette valeur est figee dans le bundle.
ARG NEXT_PUBLIC_API_URL=http://localhost:9090
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- runtime stage ----
# Use the `output: 'standalone'` server (already enabled in next.config.js):
# it bundles only the traced server deps, so we don't ship the full
# node_modules. Much smaller + smaller attack surface than `next start`.
FROM node:18-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup -g 10001 -S nodejs && adduser -S -u 10001 -G nodejs nextjs

# Standalone server + its traced deps, plus the static assets it serves.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

USER nextjs
EXPOSE 3000
ENV NODE_ENV=production
CMD ["node", "server.js"]
