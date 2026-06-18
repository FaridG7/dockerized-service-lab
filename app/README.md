# secret-service

A tiny Node.js + Express service with two routes:

- `GET /` — returns `Hello, world!`
- `GET /secret` — protected by HTTP Basic Auth; returns a secret message on success

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Configure environment variables in `.env` (a default file is included — edit the values):

   ```env
   PORT=3000
   SECRET_MESSAGE=You found the secret stash of cookies!
   USERNAME=admin
   PASSWORD=supersecret
   ```

3. Start the server:

   ```bash
   npm start
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
(via the `WWW-Authenticate: Basic` header). Enter the `USERNAME` and
`PASSWORD` from your `.env` file.

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

- The server validates that `SECRET_MESSAGE`, `USERNAME`, and `PASSWORD`
  are all set on startup and exits with an error if any are missing, so a
  misconfigured `.env` can't accidentally leave the route open or broken.
- Basic Auth sends credentials base64-encoded, not encrypted — this is fine
  for local development or behind an HTTPS-terminating proxy, but don't rely
  on it alone over plain HTTP in production.
- `.env` is included here for convenience since this is a self-contained
  example, but in a real project you'd typically add it to `.gitignore` and
  share a `.env.example` instead so secrets never end up in version control.

## Docker

### Build and run with Docker Compose (recommended)

```bash
docker compose up --build
```

The service is reachable at `http://app:3000` from other containers on the
same Docker network (e.g. your reverse proxy). It is **not** published to the
host — `expose` makes it available only within the Docker network, which
replaces the `127.0.0.1` binding used in the bare-metal setup.

Env vars are loaded from your `.env` file via `env_file` in `docker-compose.yml`.

### Build and run with plain Docker

```bash
# Build the image
docker build -t secret-service .

# Run — pass env vars explicitly and connect to your proxy's network
docker run --rm \
  --network your-proxy-network \
  --env-file .env \
  secret-service
```

### Connecting your reverse proxy

Reference the app container by its service name (`app`) as the upstream.
For nginx:

```nginx
location / {
    proxy_pass http://app:3000;
}
```
