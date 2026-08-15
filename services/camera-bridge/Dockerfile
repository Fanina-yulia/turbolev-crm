FROM node:20-bullseye-slim

ARG TARGETARCH
ARG NEOLINK_VERSION=v0.6.2

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    unzip \
    ffmpeg \
    libgstrtspserver-1.0-0 \
    libgstreamer1.0-0 \
    libgstreamer-plugins-bad1.0-0 \
    gstreamer1.0-x \
    gstreamer1.0-plugins-base \
    gstreamer1.0-plugins-good \
    gstreamer1.0-plugins-bad \
    libssl1.1 \
  && rm -rf /var/lib/apt/lists/*

RUN set -eux; \
  case "${TARGETARCH:-amd64}" in \
    amd64) NEOLINK_ASSET="neolink_linux_x86_64_bullseye.zip" ;; \
    arm64) NEOLINK_ASSET="neolink_linux_arm64.zip" ;; \
    *) echo "Unsupported architecture: ${TARGETARCH}" >&2; exit 1 ;; \
  esac; \
  curl -fsSL "https://github.com/QuantumEntangledAndy/neolink/releases/download/${NEOLINK_VERSION}/${NEOLINK_ASSET}" -o /tmp/neolink.zip; \
  mkdir -p /tmp/neolink-unpack; \
  unzip /tmp/neolink.zip -d /tmp/neolink-unpack; \
  BIN="$(find /tmp/neolink-unpack -maxdepth 2 -type f \( -name 'neolink' -o -name 'neolink_linux_*' \) | head -n 1)"; \
  test -n "$BIN"; \
  cp "$BIN" /usr/local/bin/neolink; \
  chmod 0755 /usr/local/bin/neolink; \
  /usr/local/bin/neolink --version; \
  rm -rf /tmp/neolink.zip /tmp/neolink-unpack

WORKDIR /app
COPY services/camera-bridge/server.mjs /app/server.mjs

ENV PORT=8787 \
    NEOLINK_BINARY=/usr/local/bin/neolink \
    FFMPEG_BINARY=/usr/bin/ffmpeg \
    CAMERA_TEST_TIMEOUT_MS=20000 \
    RUST_LOG=info

EXPOSE 8787

CMD ["node", "/app/server.mjs"]
