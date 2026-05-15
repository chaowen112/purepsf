FROM python:3.12-slim AS build
WORKDIR /app
ENV PIP_DISABLE_PIP_VERSION_CHECK=1 PIP_NO_CACHE_DIR=1
COPY pyproject.toml ./
COPY src ./src
RUN pip install --prefix=/install .

FROM python:3.12-slim
WORKDIR /app
COPY --from=build /install /usr/local
# Run as non-root; mount /data for manual files (subzone GeoJSON, etc.)
RUN useradd --create-home --uid 1000 etl
USER etl
ENTRYPOINT ["purepsf-etl"]
CMD ["--help"]
