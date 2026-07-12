FROM oven/bun:1.3 AS builder
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun build src/cli.ts --compile --outfile /tmp/search-cli

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /tmp/search-cli /usr/local/bin/search-cli
ENTRYPOINT ["search-cli"]
CMD ["--help"]
