# syntax=docker/dockerfile:1
# The tracker image (root Dockerfile, built first as tracker:local) plus Litestream, which restores /data/tracker.db
# from R2 on a cold start and replicates it while the tracker runs. Containers have no persistent disk.
ARG BASE=tracker:local
FROM ${BASE}
USER root
ARG LITESTREAM_VERSION=0.5.17
ARG LITESTREAM_SHA256=cfb371176d164437ae869f8351cfde49bd1804ae71c61923f75c9cba9c9c006d
ADD https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/litestream-${LITESTREAM_VERSION}-linux-x86_64.tar.gz /tmp/litestream.tar.gz
RUN echo "${LITESTREAM_SHA256}  /tmp/litestream.tar.gz" | sha256sum -c - \
  && tar -xzf /tmp/litestream.tar.gz -C /usr/local/bin litestream \
  && rm /tmp/litestream.tar.gz
COPY litestream.yml /etc/litestream.yml
COPY --chmod=755 entrypoint.sh /usr/local/bin/tracker-entrypoint
USER node
ENTRYPOINT ["/usr/local/bin/tracker-entrypoint"]
CMD []
