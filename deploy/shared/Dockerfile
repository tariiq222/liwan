# Build context MUST be the repository root. Dedicated web/Odoo images are unchanged.
FROM node:24.21.0-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --chown=node:node deploy/shared/guard.mjs deploy/shared/start.mjs deploy/shared/healthcheck.mjs ./deploy/shared/
COPY --chown=node:node apps/web/server/utils/tenantRegistry.ts apps/web/server/utils/tenantHostResolver.ts ./apps/web/server/utils/
# Native type stripping follows exactly these relative imports; no node_modules required.
RUN node --input-type=module -e "const m = await import('./deploy/shared/guard.mjs'); if (typeof m.createGuard !== 'function') process.exit(1)"
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "deploy/shared/healthcheck.mjs"]
CMD ["node", "deploy/shared/start.mjs"]
