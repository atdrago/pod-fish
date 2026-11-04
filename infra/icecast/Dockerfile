# Icecast 2.5.0 from the pinned source tarball (KTD8). Support for 2.4.4 ends on
# 2026-12-31, and no maintained 2.5 image exists.
#
# Xiph publishes no checksum or signature file for these tarballs. The hashes
# below come from the download and match the FreeBSD ports, Void Linux, and
# nixpkgs entries for Icecast, and the Homebrew entry for libigloo.
#
# TLS terminates at the Fly edge, and no directory listing runs, so the build
# leaves out OpenSSL and curl.
FROM debian:trixie-slim@sha256:f6b08b09a05725f9431502d3b5714f5c4576e82c1a84fa1debe0c24a7e0c3ec4 AS build

ARG ICECAST_VERSION=2.5.0
ARG ICECAST_SHA256=d9aa07c7429aec19d950ff6fd425c371f77158cd34ff220fc191b2c186c67c7a
ARG LIBIGLOO_VERSION=0.9.5
ARG LIBIGLOO_SHA256=ea22e9119f7a2188810f99100c5155c6762d4595ae213b9ac29e69b4f0b87289

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates curl gcc libc6-dev libogg-dev librhash-dev libvorbis-dev libxml2-dev \
    libxslt1-dev make pkg-config

WORKDIR /build

RUN curl --fail --silent --show-error --location --output libigloo.tar.gz \
    "https://downloads.xiph.org/releases/igloo/libigloo-${LIBIGLOO_VERSION}.tar.gz" \
  && echo "${LIBIGLOO_SHA256}  libigloo.tar.gz" | sha256sum --check --strict \
  && tar xzf libigloo.tar.gz \
  && cd "libigloo-${LIBIGLOO_VERSION}" \
  && ./configure --prefix=/usr/local --disable-static \
  && make -j"$(nproc)" install-strip

RUN curl --fail --silent --show-error --location --output icecast.tar.gz \
    "https://downloads.xiph.org/releases/icecast/icecast-${ICECAST_VERSION}.tar.gz" \
  && echo "${ICECAST_SHA256}  icecast.tar.gz" | sha256sum --check --strict \
  && tar xzf icecast.tar.gz \
  && cd "icecast-${ICECAST_VERSION}" \
  && PKG_CONFIG_PATH=/usr/local/lib/pkgconfig ./configure --prefix=/usr/local --disable-yp \
    --without-curl --without-maxminddb --without-openssl --without-speex --without-theora \
  && make -j"$(nproc)" \
  && make install-strip

FROM debian:trixie-slim@sha256:f6b08b09a05725f9431502d3b5714f5c4576e82c1a84fa1debe0c24a7e0c3ec4

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    libogg0 librhash1 libvorbis0a libxml2 libxslt1.1 media-types \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --system --uid 10001 --user-group --no-create-home --home-dir /var/lib/icecast \
    --shell /usr/sbin/nologin icecast \
  && install -d -o icecast -g icecast -m 0700 /var/lib/icecast

COPY --from=build /usr/local/bin/icecast /usr/local/bin/icecast
COPY --from=build /usr/local/lib/ /usr/local/lib/
COPY --from=build /usr/local/share/icecast/ /usr/local/share/icecast/
COPY icecast.xml.template /etc/icecast/icecast.xml.template
COPY entrypoint.sh /usr/local/bin/icecast-entrypoint

RUN ldconfig

USER icecast
EXPOSE 8000
ENTRYPOINT ["/bin/sh", "/usr/local/bin/icecast-entrypoint"]
