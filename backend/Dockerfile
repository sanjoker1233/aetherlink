# ---- build stage ----
FROM golang:1.22-alpine AS build
WORKDIR /src
RUN apk add --no-cache git ca-certificates
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /app/server ./cmd/server

# ---- runtime stage ----
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata && adduser -D -u 10001 app
WORKDIR /app
COPY --from=build /app/server /app/server
RUN mkdir -p /data && chown -R app:app /data /app
USER app

# IMPORTANT : dans un conteneur il faut binder sur toutes les interfaces,
# sinon le serveur n'ecoute que sur 127.0.0.1 et reste injoignable.
ENV BIND=:9090 \
    PORT=9090 \
    DATA_DIR=/data
# JWT_SECRET (>=32 octets) et ALLOWED_ORIGINS doivent etre fournis a l'execution.

VOLUME ["/data"]
EXPOSE 9090

CMD ["/app/server"]
