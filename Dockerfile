FROM node:20-alpine

WORKDIR /app

# Install backend dependencies
COPY package*.json ./
COPY client/package*.json ./client/
RUN npm install --omit=dev

# Build Vue app
COPY client/ ./client/
RUN cd client && npm run build

# Copy backend source
COPY src/ ./src/
COPY server.js ./

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

EXPOSE 3000

CMD ["npm", "start"]
