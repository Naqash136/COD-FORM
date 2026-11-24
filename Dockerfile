FROM node:22-alpine
RUN apk add --no-cache openssl ca-certificates

EXPOSE 3000

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json* ./

RUN npm ci --omit=dev && npm cache clean --force

COPY . .

RUN cat certs/prod-ca-2021.crt >> /etc/ssl/certs/ca-certificates.crt
ENV SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt

RUN npm run build

ENV HOST=0.0.0.0

CMD ["npm", "run", "docker-start"]
