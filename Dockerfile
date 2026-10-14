FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Cài đặt dependencies trước để tận dụng Docker Layer Cache
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

# Copy mã nguồn backend và thư mục catalog âm thanh
COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
