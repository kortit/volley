FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app

# Dependencies first so code edits don't bust the layer cache.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY public ./public

# App Service injects PORT, but default it so `docker run -p 8080:8080` just works.
ENV PORT=8080
EXPOSE 8080

# Deliberately running as root: App Service mounts persistent /home over CIFS
# and a non-root uid can't reliably write there.
CMD ["node", "src/server.js"]
