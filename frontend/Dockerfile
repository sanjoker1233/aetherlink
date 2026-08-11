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
FROM node:18-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup -g 10001 -S nodejs && adduser -S -u 10001 -G nodejs nextjs

# On sert via `next start` : on a donc besoin des deps de prod + du build.
COPY --from=build /app/package.json /app/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/next.config.js ./next.config.js

USER nextjs
EXPOSE 3000
CMD ["npm", "start"]
