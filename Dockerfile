ARG NODE_VERSION=current
FROM node:${NODE_VERSION}-alpine AS base
RUN apk add --no-cache curl
WORKDIR /usr/src/app

FROM base AS development
ENV NODE_ENV=development
RUN npm install -g nodemon
RUN --mount=type=bind,source=package.json,target=package.json \
    --mount=type=bind,source=package-lock.json,target=package-lock.json \
    --mount=type=cache,target=/root/.npm \
    npm ci --include=dev
USER node
EXPOSE 3001 3003 9229-9249
COPY . .
CMD ["nodemon", "src/index.js"]

FROM base AS production
ENV NODE_ENV=production
RUN --mount=type=bind,source=package.json,target=package.json \
    --mount=type=bind,source=package-lock.json,target=package-lock.json \
    --mount=type=cache,target=/root/.npm \
    npm ci
USER node
EXPOSE 3001 3003
COPY . .
CMD  ["node", "src/index.js"]