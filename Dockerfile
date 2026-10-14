FROM node:20-alpine

WORKDIR /app

ENV PORT=3000

# Cài đặt đầy đủ dependencies (bao gồm TypeScript compiler) để build
COPY package*.json ./
RUN npm install

# Copy mã nguồn TypeScript và thư mục catalog âm thanh
COPY tsconfig.json ./
COPY src ./src
COPY sounds ./sounds

# Biên dịch TypeScript sang JavaScript (dist/) và dọn dẹp devDependencies
RUN npm run build && npm prune --omit=dev && npm cache clean --force

ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "dist/server.js"]
