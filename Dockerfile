# Blocks Construct frontend image.
#
# Matches the platform's React-Construct pipeline convention
# (blocks-cloudbuild `pipeline_fe_react_construct.yaml`):
#   - the pipeline builds the repo-root `Dockerfile`
#   - it passes `--build-arg ci_build=prod`, and the build runs `npm run build:${ci_build}`
#   - the runtime is nginx-unprivileged serving on 8080 (NOT 80 — set the pipeline's
#     `port` param to 8080 or the probes and Service will point at a closed port)

# ---------------------------------------------------------------- build stage
FROM node:22-alpine AS builder
WORKDIR /app

# ci_build selects the build script AND therefore the env file, per branch:
#   dev branch  -> ci_build=dev  -> npm run build:dev  -> .env.dev
#   stg branch  -> ci_build=stg  -> npm run build:stg  -> .env.stg
#   main branch -> ci_build=prod -> npm run build:prod -> .env.prod
#
# No default on purpose. Defaulting would let a pipeline that forgot --build-arg produce an
# image silently configured for the wrong environment — the worst possible failure mode here,
# since it would point a deployment at another environment's Blocks project.
ARG ci_build
RUN test -n "$ci_build" || (echo "ERROR: --build-arg ci_build=<dev|stg|prod> is required" >&2; exit 1)
RUN case "$ci_build" in dev|stg|prod) ;; \
      *) echo "ERROR: ci_build must be dev, stg or prod (got '$ci_build')" >&2; exit 1 ;; esac

# Copy manifests first so `npm ci` is cached until dependencies actually change.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

# 4 GB heap: tsc + vite on a large TS project OOMs on the default limit in CI.
RUN NODE_OPTIONS="--max-old-space-size=4096" npm run "build:${ci_build}"

# -------------------------------------------------------------- runtime stage
FROM nginxinc/nginx-unprivileged:1.29-alpine AS runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY nginx-security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=builder /app/dist /usr/share/nginx/html

# The runtime config script writes config.js into the web root on container start,
# so the image is environment-agnostic. The unprivileged image runs as uid 101, which
# cannot write to a root-owned web root — hand it over while we are still root.
USER root
COPY docker/30-blocks-runtime-config.sh /docker-entrypoint.d/30-blocks-runtime-config.sh
RUN chmod +x /docker-entrypoint.d/30-blocks-runtime-config.sh \
 && chown -R 101:101 /usr/share/nginx/html
USER 101

EXPOSE 8080

# Uses the nginx-unprivileged entrypoint, which runs /docker-entrypoint.d/*.sh
# before starting nginx.
