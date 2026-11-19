# syntax=docker/dockerfile:1.7
#
# PerthMap pipeline image: Python geo stack + osmium. Routing itself runs in the
# upstream MOTIS image (see docker-compose.yml); this image only prepares inputs,
# queries MOTIS over HTTP and builds the isochrone GeoJSON.

FROM python:3.12-slim-bookworm

RUN apt-get update \
 && apt-get install -y --no-install-recommends osmium-tool tini ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.8.4 /uv /usr/local/bin/uv

ENV PATH=/opt/venv/bin:$PATH \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_PYTHON_DOWNLOADS=never \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PYTHONUNBUFFERED=1 \
    HOME=/tmp \
    DATA_DIR=/data

WORKDIR /opt/app
COPY data/pyproject.toml data/uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-install-project --no-dev --python "$(which python3)"

COPY pipeline.py bike.py elevation.py intake.py schools.py /opt/app/
WORKDIR /data
ENTRYPOINT ["tini", "--", "python", "/opt/app/pipeline.py"]
CMD ["--help"]
