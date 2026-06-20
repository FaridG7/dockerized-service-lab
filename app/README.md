# App — the deployed service

The service this pipeline builds and ships: a tiny Node.js + Express app with
two routes.

> Part of the [dockerized-service-lab](../README.md) project. The CI pipeline
> builds this directory into the `myapp` image; Ansible then runs it behind the
> [`nginx`](../nginx/README.md) reverse proxy on the
> [Terraform-provisioned VM](../terraform/README.md).

## Routes

- `GET /` — returns `Hello, world!`
- `GET /secret` — protected by HTTP Basic Auth; returns a secret message on success

## Setup

**1. Install dependencies**

```bash
npm install
```

**2. Provide the required environment variables**

The app validates on startup that `SECRET_MESSAGE`, `USERNAME`, and `PASSWORD`
are all set, and exits with an error if any are missing — so a misconfigured
environment can't accidentally leave `/secret` open or broken.

```env
PORT=3000
SECRET_MESSAGE=You found the secret stash of cookies!
USERNAME=admin
PASSWORD=supersecret
```

> Note: the app reads these straight from `process.env` (there's no `dotenv`
> dependency). The `.env` file is consumed by **Docker** — via `env_file` in the
> root [`docker-compose.yml`](../docker-compose.yml) and the `env` dict in the
> [Ansible deploy role](../ansible/roles/app-deploy/tasks/main.yml). To run the
> app directly with node, export the variables in your shell first:

```bash
export PORT=3000 SECRET_MESSAGE="..." USERNAME=admin PASSWORD=supersecret
npm run dev
```

The server logs the URLs it's listening on, e.g. `http://localhost:3000`.

## Usage

### Public route

```bash
curl http://localhost:3000/
# -> Hello, world!
```

### Protected route

Visiting `/secret` in a browser triggers a native username/password prompt
(via the `WWW-Authenticate: Basic` header). Enter the `USERNAME` and `PASSWORD`
from your environment.

From the command line:

```bash
# Correct credentials -> 200 + secret message
curl -u admin:supersecret http://localhost:3000/secret

# Incorrect credentials -> 401 + error message
curl -u admin:wrongpass http://localhost:3000/secret

# No credentials -> 401, prompts for auth
curl http://localhost:3000/secret
```

## Notes

- Basic Auth sends credentials base64-encoded, **not encrypted** — fine for
  local development or behind an HTTPS-terminating proxy, but don't rely on it
  alone over plain HTTP in production.
- In the deployed setup the app is **not** published to the host — it only
  listens on the internal Docker network and is reachable solely through the
  nginx reverse proxy (`proxy_pass http://myapp`).

## Docker

### Build and run with Docker Compose (recommended)

From the **repository root** (the compose file lives there, not in `app/`):

```bash
cp .env.example .env      # set PORT / SECRET_MESSAGE / USERNAME / PASSWORD
docker compose up --build
```

This brings up both `app` and `nginx`. The app is reachable at `http://app:3000`
from other containers on the same Docker network. Env vars are loaded from your
`.env` via `env_file` in `docker-compose.yml`.

### Build and run with plain Docker

```bash
# Build the image
docker build -t myapp .

# Run — pass env vars explicitly and connect to your proxy's network
docker run --rm \
  --network your-proxy-network \
  --env-file .env \
  myapp
```

### Connecting your reverse proxy

Reference the app container by its service name (`app` locally, `myapp` in the
deployed setup) as the upstream. For nginx:

```nginx
location / {
    proxy_pass http://myapp;
}
```
