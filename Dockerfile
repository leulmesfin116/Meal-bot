# Use Node.js 22 LTS (required for node:sqlite DatabaseSync)
FROM node:22-alpine

# Set working directory
WORKDIR /app

# Copy client package files
COPY client/package*.json ./client/

# Install dependencies (including production tsx)
WORKDIR /app/client
RUN npm install

# Copy source code and assets
COPY client/ ./

# Create data directory for persistent SQLite database
RUN mkdir -p /app/data

# Environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/app/data/meal_bot.db

# Expose port
EXPOSE 3000

# Start the application
CMD ["npm", "start"]
