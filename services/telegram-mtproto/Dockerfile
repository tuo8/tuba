FROM node:20-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --ignore-scripts
COPY src ./src
COPY scripts ./scripts
COPY public ./public
EXPOSE 8788
CMD ["node", "src/server.js"]
