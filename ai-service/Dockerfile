# Build context must be the repository root:  docker build -f ai-service/Dockerfile -t goplay-ai .
# GPU image: base on ghcr.io/... / nvidia/cuda + KataGo CUDA build; CPU image below uses the Eigen build.
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends curl unzip ca-certificates libzip4 libgomp1 && rm -rf /var/lib/apt/lists/*
# Download a KataGo release (pick the build matching your hardware) and a network from https://katagotraining.org
ARG KATAGO_URL
ARG KATAGO_MODEL_URL
RUN mkdir -p /opt/katago && cd /opt/katago \
 && curl -fsSL "$KATAGO_URL" -o katago.zip && unzip -j katago.zip && chmod +x katago && rm katago.zip \
 && curl -fsSL "$KATAGO_MODEL_URL" -o model.bin.gz
WORKDIR /app
COPY src/engine ./src/engine
COPY ai-service ./ai-service
COPY ai-service/katago/analysis.cfg /opt/katago/analysis.cfg
ENV KATAGO_BIN=/opt/katago/katago KATAGO_MODEL=/opt/katago/model.bin.gz KATAGO_CONFIG=/opt/katago/analysis.cfg PORT=8787
EXPOSE 8787
CMD ["node", "ai-service/src/server.ts"]
