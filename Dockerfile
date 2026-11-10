FROM node:22-bookworm-slim AS build
WORKDIR /app/apps/web
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.base.json /app/
COPY apps/web/ ./
ARG NEXT_PUBLIC_APP_URL
ARG RENDER_EXTERNAL_URL
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ENV NEXT_TELEMETRY_DISABLED=1
RUN export NEXT_PUBLIC_APP_URL="${NEXT_PUBLIC_APP_URL:-$RENDER_EXTERNAL_URL}" \
    && test -n "$NEXT_PUBLIC_APP_URL" && test -n "$NEXT_PUBLIC_SUPABASE_URL" && test -n "$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" && npm run build

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates clamav clamav-freshclam tini \
    && rm -rf /var/lib/apt/lists/* \
    && install -d -o node -g node /var/lib/gabriela-clamav
WORKDIR /app/apps/web
COPY --from=build --chown=node:node /app/apps/web /app/apps/web
COPY --from=build /app/tsconfig.base.json /app/tsconfig.base.json
COPY --chmod=0755 deploy/start-web.sh deploy/scan-file.sh /usr/local/bin/
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=10000 CLAMSCAN_PATH=/usr/local/bin/scan-file.sh
USER node
EXPOSE 10000
ENTRYPOINT ["/usr/bin/tini", "-g", "--"]
CMD ["/usr/local/bin/start-web.sh"]
