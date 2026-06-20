# Internal Network — GitLab + Runner + Registry

A self-hosted CI/CD stack that replaces GitHub Actions + the GitHub Container
Registry. All three services are plain Docker containers brought up with
Compose — no cloud account, no public IP needed.

> Part of the [dockerized-service-lab](../README.md) project. This is the
> **CI infrastructure**: GitLab runs the pipeline, the runner executes the jobs,
> and the registry stores the images that get deployed to the
> [Terraform-provisioned VM](../terraform/README.md).

---

## What's here

`docker-compose.yaml` defines three services on the default bridge network:

| Service   | Image                  | Purpose                                                       |
| --------- | ---------------------- | ------------------------------------------------------------- |
| `gitlab`  | `gitlab/gitlab-ce`     | GitLab CE — hosts the repo and runs the pipelines              |
| `runner1` | `gitlab/gitlab-runner` | Executes pipeline jobs via the **Docker executor**             |
| `registry`| `registry:3`           | Local Docker registry the pipeline pushes images to            |

The runner mounts the host's Docker socket (`/var/run/docker.sock`), so images
it builds are immediately visible to the registry and to the host — that's what
lets `docker push 192.168.122.1:5000/...` work from inside a job.

## Files

```
internal-net/
├── docker-compose.yaml   # The three services + volumes
├── example.env           # Template — copy to .env (gitignored)
└── .env                  # YOUR values (gitignored): image tags + hostnames
```

## Setup

**1. Create your env file**

```bash
cd internal-net
cp example.env .env
```

`example.env` ships sane defaults:

```env
GITLAB_TAG=18.10.5-ce.0
GITLAB_HOSTNAME="gitlab.local"

RUNNER_TAG=v18.11.3
RUNNER_HOSTNAME=runner1.local
```

The hostnames are what GitLab and the runner identify themselves as. Add them
to your `/etc/hosts` so the browser (and the runner) can resolve them:

```
127.0.0.1  gitlab.local runner1.local
```

**2. Bring the stack up**

```bash
docker compose up -d
```

GitLab takes a few minutes to come fully online. Watch it with:

```bash
docker compose logs -f gitlab
# or check the healthcheck the compose file defines:
docker inspect --format='{{.State.Health.Status}}' gitlab
```

When healthy, open **http://gitlab.local** and set the root password on first
visit.

**3. Register the runner**

GitLab's container doesn't auto-register. From the GitLab UI, get a registration
token under **Admin Area → CI/CD → Runners** (or **Settings → CI/CD → Runners**
for a project-scoped token), then register interactively:

```bash
docker compose exec runner1 gitlab-runner register
```

When prompted, choose:

- **Executor:** `docker`
- **Default image:** `docker:24` (matches what the pipeline's build jobs use)

This writes the runner config into the `runner1_config` volume, so it survives
restarts.

**4. Configure the runner (host Docker socket + host network)**

By default the Docker executor runs jobs in isolated containers that **can't**
build images or reach the host network — both of which this pipeline needs. The
compose file already bind-mounts `/var/run/docker.sock` into the *runner*
container, but the *job* containers it spins up need their own configuration.
Edit `/etc/gitlab-runner/config.toml` inside the runner:

```bash
# Mount the host Docker socket into job containers, so `docker build`/`push`
# inside a job talk to the host daemon (and land in the local registry).
docker compose exec runner1 sh -c \
  'sed -i "/volumes/c\    volumes = [\"/var/run/docker.sock:/var/run/docker.sock\", \"/cache\"]" /etc/gitlab-runner/config.toml'

# Run job containers on the host network, so they can reach GitLab
# (gitlab.local) and the local registry (192.168.122.1:5000).
docker compose exec runner1 sh -c 'echo "network_mode = \"host\"" >> /etc/gitlab-runner/config.toml'

# OPTIONAL — only if the runner can't pull the helper image from
# registry.gitlab.com. Pins a local helper image tag matching the runner.
docker compose exec runner1 sh -c 'echo "helper_image = \"gitlab/gitlab-runner-helper:x86_64-v18.11.3\"" >> /etc/gitlab-runner/config.toml'
```

Restart the runner so it picks up the config:

```bash
docker compose restart runner1
```

**5. Create the project & push**

In the GitLab UI, create a new (empty) project, then push this repo to it:

```bash
git remote add origin git@gitlab.local:<you>/dockerized-service-lab.git
git push -u origin main
```

(Use an HTTPS remote if you haven't added an SSH key to GitLab yet — GitLab's
SSH listener is on port `22` of the host, which may collide with your host's
sshd; the compose file maps it to `22:22`.)

**6. Add the pipeline's CI/CD variables**

The pipeline in [`../.gitlab-ci.yml`](../.gitlab-ci.yml) needs a few secrets.
Under **Settings → CI/CD → Variables**, add:

| Variable                  | Value                                                                  |
| ------------------------- | ---------------------------------------------------------------------- |
| `ENCODED_SSH_PRIVATE_KEY` | VM private key, base64-encoded: `base64 -w0 ~/.ssh/id_rsa`             |
| `SECRET_MESSAGE`          | Message returned by the app's `/secret` route                          |
| `USERNAME`                | Basic-Auth username for `/secret`                                      |
| `PASSWORD`                | Basic-Auth password for `/secret`                                      |

Mark `ENCODED_SSH_PRIVATE_KEY` and the credentials as **masked**.

That's it — the next push to `main` runs the full pipeline.

## Notes

- The registry is **plain HTTP** (`http://192.168.122.1:5000`). The target VM
  is told to trust it via the `insecure-registries` entry Ansible writes to
  `/etc/docker/daemon.json` (see
  [`../ansible/roles/docker-setup/tasks/main.yml`](../ansible/roles/docker-setup/tasks/main.yml)).
- GitLab is RAM-hungry. If the host is also running the 4 GiB KVM VM, give
  yourself comfortable headroom (~8 GB+ total).
- All three services use named volumes (`gitlab_data`, `runner1_config`,
  `registry-data`, etc.), so `docker compose down` keeps your data — use
  `docker compose down -v` to wipe everything.

## Teardown

```bash
docker compose down -v   # -v also removes the named volumes
```
