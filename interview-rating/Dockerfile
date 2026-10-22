FROM node:22-alpine
WORKDIR /app
COPY . .
ENV PORT=3000 DB_FILE=/app/data/db.json
VOLUME /app/data
EXPOSE 3000
CMD ["node", "server.js"]
