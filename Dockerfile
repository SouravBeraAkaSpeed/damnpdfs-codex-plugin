FROM node:22-alpine
WORKDIR /app
COPY --chown=node:node plugins/damnpdfs/mcp/ ./mcp/
USER node
CMD ["node", "mcp/server.mjs"]
