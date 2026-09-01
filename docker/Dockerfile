# syntax=docker/dockerfile:1

########################################
# Stage 1: build
#
# Builds libs/contracts, apps/web (Angular production build) and
# apps/api (Nest), then assembles apps/api/public as the Angular build
# output so app.module.ts's ServeStaticModule can find it at runtime.
########################################
FROM node:22-alpine AS build
WORKDIR /app

# Copy just the manifests needed for `npm ci` to resolve the workspace
# graph first, so this layer is cached across source-only changes.
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY libs/contracts/package.json ./libs/contracts/package.json

RUN npm ci

# Now bring in the rest of the monorepo source (see .dockerignore for
# what's excluded — notably node_modules and any pre-existing dist/
# output, so nothing here shadows the npm ci above or the builds below).
COPY . .

# Build order: shared contracts -> web (Angular prod build) -> api.
# apps/api's own "prebuild" script (see apps/api/package.json) reruns
# the contracts build; that's an idempotent no-op re-run of tsc against
# already-built sources, safe and cheap.
RUN npm run build -w libs/contracts \
 && npm run build -w apps/web \
 && npm run build -w apps/api

# Angular's production build output lands at apps/web/dist/web/browser
# (Angular 20 default outputPath for the "web" project; no outputPath
# override is set in apps/web/angular.json). apps/api/src/app.module.ts's
# ServeStaticModule reads apps/api/public/ at runtime, resolved relative
# to apps/api/dist/main.js's own directory (i.e. a sibling of dist/) —
# so it only needs to exist alongside dist/ in the runtime stage below,
# not before the api build runs.
RUN mkdir -p apps/api/public \
 && cp -r apps/web/dist/web/browser/. apps/api/public/

# Trim node_modules down to production dependencies only, and make sure
# apps/api/node_modules exists (even if empty) so the runtime stage's
# COPY --from below always has a source to copy, regardless of whether
# npm workspace hoisting left anything workspace-local there.
RUN npm prune --omit=dev \
 && mkdir -p apps/api/node_modules

########################################
# Stage 2: runtime
#
# No tsconfig-paths shim, no shipped tsconfig.json — apps/api is built
# with plain tsc + tsc-alias (see apps/api/package.json "build" script),
# so the compiled dist/ has no unresolved path aliases left at runtime.
########################################
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app/apps/api

# Hoisted production dependencies live at the workspace root; Node's
# module resolution walks up from apps/api/dist to find them there.
COPY --from=build /app/node_modules /app/node_modules
# Anything npm left workspace-local (unhoisted) for apps/api specifically.
COPY --from=build /app/apps/api/node_modules ./node_modules
COPY --from=build /app/apps/api/package.json ./package.json
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/apps/api/public ./public

# node:22-alpine already ships an unprivileged "node" user/group.
USER node

EXPOSE 3000
CMD ["node", "dist/main.js"]
