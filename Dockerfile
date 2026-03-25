FROM node:20-alpine

WORKDIR /app

# Install backend dependencies
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

# Copy backend source
COPY src/ ./src/
COPY public/ ./public/
COPY server.js ./

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

EXPOSE 3000

CMD ["npm", "start"]
