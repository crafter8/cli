FROM node:20-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    curl \
    gh \
    git \
    openssh-client \
    procps \
  && rm -rf /var/lib/apt/lists/*

COPY docker/sdk-dev-git-askpass.sh /usr/local/bin/sdk-dev-git-askpass

RUN chmod +x /usr/local/bin/sdk-dev-git-askpass

WORKDIR /workspace

ENV NODE_ENV=development
ENV GIT_SAFE_DIRECTORY=/workspace
ENV GIT_ASKPASS=/usr/local/bin/sdk-dev-git-askpass
ENV GIT_TERMINAL_PROMPT=0

USER node

CMD ["bash", "-lc", "sleep infinity"]
