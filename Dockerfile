FROM node:22-alpine
WORKDIR /app
COPY --chown=node:node plugins/damnpdfs/mcp/ ./mcp/
COPY --chown=node:node plugins/damnpdfs/assets/catalog.json ./assets/catalog.json
USER node
CMD ["node", "mcp/server.mjs"]
