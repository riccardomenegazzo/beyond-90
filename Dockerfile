# Beyond 90 in your own network: the browser app, served read-only by `beyond90 app`.
#   docker build -t beyond90 .
#   docker run --rm -p 8090:8090 beyond90            then open http://localhost:8090
# Put it behind HTTPS to reach it from other machines (browsers allow offline use and passphrases only on
# HTTPS or localhost), and pass the name it is reached by: docker run ... beyond90 --name beyond90.example.internal

FROM node:22-slim AS assets
WORKDIR /b
COPY site/npm/package.json site/npm/package-lock.json site/npm/
RUN npm ci --ignore-scripts --prefix site/npm

FROM python:3.15-slim AS site
WORKDIR /b
COPY pyproject.toml LICENSE THIRD_PARTY.md ./
COPY src src
COPY site site
COPY examples examples
COPY --from=assets /b/site/npm/node_modules site/npm/node_modules
RUN python site/build_site.py --out /site --pyodide site/npm/node_modules/pyodide

FROM python:3.15-slim
RUN useradd --system --uid 10001 --no-create-home beyond90
COPY --from=site /site /site
COPY src/beyond90 /app/beyond90
ENV PYTHONPATH=/app PYTHONDONTWRITEBYTECODE=1
USER 10001
EXPOSE 8090
HEALTHCHECK CMD ["python", "-c", "import urllib.request as u; u.urlopen('http://127.0.0.1:8090/build.json', timeout=3)"]
ENTRYPOINT ["python", "-m", "beyond90", "app", "--site", "/site", "--host", "0.0.0.0", "--port", "8090"]
