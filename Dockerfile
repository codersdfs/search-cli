FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
RUN npm run build

FROM node:20-alpine
RUN apk add --no-cache ca-certificates
COPY --from=builder /app/dist /usr/local/lib/ghfind
COPY --from=builder /app/node_modules /usr/local/lib/ghfind/node_modules
RUN ln -s /usr/local/lib/ghfind/cli.js /usr/local/bin/ghfind
ENTRYPOINT ["ghfind"]
CMD ["--help"]