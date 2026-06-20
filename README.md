# Dockerized Service Deployment Lab

A fully **self-contained, local CI/CD pipeline** that builds a containerized web
service and deploys it to a virtual machine — all running on one host, with no
cloud account and no public IP required.

A push to `main` triggers a GitLab pipeline that lints the nginx config, builds
the app and nginx images, pushes them to a local Docker registry, and runs an
Ansible playbook that pulls and runs them on a KVM VM provisioned with
Terraform.

```
                          ┌───────────────  Your workstation (libvirt host) ───────────────┐
                          │                                                                │
               ┌──────────────────────┐         ┌──────────────────┐                       │
    git push ─▶│ GitLab CE (self-host)│ ──runs─▶│ GitLab Runner    │                       │
               │  + Docker registry   │         │ (docker executor)│                       │
               └──────────────────────┘         └────────┬─────────┘                       │
                          │                              │ build & push                    │
                          │              ┌───────────────▼──────────────┐                  │
                          │              │ 192.168.122.1:5000 (registry)│                  │
                          │              └───────────────┬──────────────┘                  │
                          │                              │ pull                            │
                          │              ┌───────────────▼───────────────┐                 │
                          │              │  VM (Terraform + libvirt/KVM) │                 │
                          │              │  Ansible → docker containers  │                 │
                          │              │   ├─ myapp (Node.js)          │                 │
                          │              │   └─ nginx_proxy (reverse px) │                 │
                          │              └───────────────────────────────┘                 │
                          └────────────────────────────────────────────────────────────────┘
```

## Why this project exists

The original task came from the
[Dockerized Service Deployment](https://roadmap.sh/projects/dockerized-service-deployment)
project on roadmap.sh, which calls for DigitalOcean + GitHub Actions. I don't
have a public IP for GitHub Actions runners to reach, so I rebuilt the whole
flow on infrastructure I already control:

| Original task                  | This project's replacement                          |
| ------------------------------ | --------------------------------------------------- |
| DigitalOcean droplet           | Local **libvirt/KVM** VM provisioned with Terraform |
| GitHub Actions (cloud runners) | Self-hosted **GitLab CE** + **GitLab Runner**       |
| GitHub Container Registry      | Local **Docker registry** (`registry:3`)            |

The result is the same end-to-end story — _commit → test → build → deploy_ —
but with **zero per-run cloud cost** and the added learning value of standing up
the CI server itself.

> This is primarily a learning project, structured so it can also stand in as a
> portfolio piece. Each stage is its own small, reviewable component (see
> [Project structure](#project-structure)).

---

## Pipeline overview

`.gitlab-ci.yml` defines three stages, each gated by `changes:` rules so they
only run when the relevant code changes:

| Stage  | Job           | Image             | What it does                                                             |
| ------ | ------------- | ----------------- | ------------------------------------------------------------------------ |
| test   | `test-nginx`  | `nginx:stable`    | Validates `nginx/nginx.conf` syntax before building                      |
| build  | `build-app`   | `docker:24`       | Builds `app/` → `myapp:latest`, pushes to the local registry             |
| build  | `build-nginx` | `docker:24`       | Builds `nginx/` → `nginx:latest`, pushes to the local registry           |
| deploy | `deploy`      | `cytopia/ansible` | SSHes into the VM and runs the Ansible playbook to pull & run containers |

The runner uses the Docker executor, mounting the host's Docker socket so it can
build images that land directly in the local registry. The deploy job injects
the VM's SSH private key (base64-encoded, stored as a masked CI variable) and
runs `ansible-playbook` against the Terraform-provisioned VM.

The Ansible playbook (`ansible/site.yml`) runs three roles in order:

1. **`base`** — `apt dist-upgrade` on the VM.
2. **`docker-setup`** — installs Docker, declares the local registry as
   insecure in `/etc/docker/daemon.json`, adds the deploy user to the `docker`
   group.
3. **`app-deploy`** — creates a shared Docker network and runs the `myapp` and
   `nginx_proxy` containers on it (`comparisons.image: strict` forces a
   recreate whenever a pulled digest differs).

---

## Project structure

```
.
├── terraform/        # Provisions the KVM VM (libvirt provider) — pipeline stage 0
├── internal-net/     # Self-hosted GitLab + runner + registry (the CI infra)
├── app/              # The service itself: tiny Node.js/Express app  → [see its README]
├── nginx/            # Reverse proxy: nginx + h5bp server configs     → [see its README]
├── ansible/          # Configures the VM and runs the containers
├── docker-compose.yml# Local dev wiring of app + nginx (not used by CI)
├── .gitlab-ci.yml    # The pipeline
└── .env.example      # App env vars consumed at runtime
```

Each subdirectory has its own README with component-specific details:

- [`terraform/`](terraform/README.md) — VM provisioning (libvirt/KVM, cloud-init)
- [`internal-net/`](internal-net/README.md) — GitLab + runner + registry bootstrap
- [`app/`](app/README.md) — the Node.js service
- [`nginx/`](nginx/README.md) — the nginx reverse proxy (h5bp configs)

---

## Prerequisites

This whole stack runs on a single Linux host. You'll need:

- **libvirt + KVM** with the `default` network up, and your user in the
  `libvirt` group.
- **Terraform** `~> 1.15` and the `dmacvicar/libvirt` provider.
- **Docker** + **Docker Compose** (to bring up GitLab).
- An **SSH keypair** (default `~/.ssh/id_rsa`) — the public half is injected
  into the VM by cloud-init, the private half is given to GitLab CI.
- ~6 GB of RAM to spare (the VM alone takes 4 GiB, GitLab takes more).

---

## Setup

The pipeline has a bootstrapping chicken-and-egg: GitLab can't run until it's
deployed, and the VM can't be deployed until something runs the playbook. So the
very first run is partly manual. After that, every push to `main` is automated.

### 1. Provision the VM with Terraform

See [`terraform/README.md`](terraform/README.md) for full detail. In short:

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars   # edit ip/mac/ssh key
terraform init
terraform apply
ssh ubuntu@192.168.122.100                       # verify
```

### 2. Bring up the CI infrastructure (GitLab + runner + registry)

This is the self-hosted replacement for GitHub Actions + GHCR. Full steps are in
[`internal-net/README.md`](internal-net/README.md). In short:

```bash
cd internal-net
cp example.env .env        # tweak versions/hostnames if you like
docker compose up -d
```

Then, in the GitLab web UI (`http://gitlab.local` after a `/etc/hosts` entry):
create the project, push this repo to it, and register the runner using the
**Docker executor** with a Docker-based default image.

### 3. Give the pipeline the secrets it needs

In **GitLab → Settings → CI/CD → Variables**, add:

| Variable                  | Value                                                                   |
| ------------------------- | ----------------------------------------------------------------------- |
| `ENCODED_SSH_PRIVATE_KEY` | Your VM private key (`id_rsa`), **base64-encoded**: `base64 -w0 id_rsa` |
| `SECRET_MESSAGE`          | The message returned by the app's `/secret` route                       |
| `USERNAME` / `PASSWORD`   | Basic-Auth credentials for `/secret`                                    |

> `ENCODED_SSH_PRIVATE_KEY` is masked; the app secrets are passed with
> `--extra-vars` and the deploy task uses `no_log: true` so they don't leak in
> job logs.

### 4. Push and watch it go

```bash
git remote add origin git@gitlab.local:<you>/dockerized-service-lab.git
git push -u origin main
```

Open the pipeline view in GitLab. On a clean push you'll see `test-nginx` →
`build-app` / `build-nginx` → `deploy` light up green.

### 5. Verify the deployed service

Add the app host to your `/etc/hosts` (the VM IP from `terraform.tfvars`):

```
192.168.122.100  myapp.local
```

```bash
curl http://myapp.local/                  # -> Hello, world!
curl -u admin:<PASSWORD> http://myapp.local/secret   # -> <SECRET_MESSAGE>
```

The app is reachable on the host because nginx publishes port `80`; the app
container stays internal to the Docker network and is only reachable _through_
the reverse proxy.

---

## Local development (without the pipeline)

For quick iteration you can skip the whole pipeline and run the app + nginx
pair locally with the root `docker-compose.yml`:

```bash
cp .env.example .env      # set PORT / SECRET_MESSAGE / USERNAME / PASSWORD
docker compose up --build
```

This wires `app` and `nginx` onto a `bridge` network — useful for testing the
service and proxy config in isolation. See [`app/README.md`](app/README.md) for
running the app alone.

---

## Teardown

Reverse the setup order:

```bash
# Stop the CI infra
cd internal-net && docker compose down -v

# Destroy the VM and its volumes
cd terraform && terraform destroy
```

The downloaded Ubuntu cloud image under `terraform/iso/` and the libvirt
`default` network are left untouched.

---

## Troubleshooting

- **`terraform apply` hangs waiting for the IP.** This usually means the
  `qemu-guest-agent` isn't reporting inside the VM. cloud-init installs and
  starts it (see `terraform/user-data.tftpl`); confirm with
  `ssh ubuntu@<vm_ip> systemctl status qemu-guest-agent`. Re-applying after the
  agent is up will resolve the wait.
- **Pipeline can't push/pull from the registry (`http://server gave HTTP response to HTTPS`).** The local registry is plain HTTP. The deploy VM is told to
  trust it via the `insecure-registries` entry Ansible writes — if you skipped
  the `docker-setup` role or changed the registry address, that's the culprit.
  The Docker _daemon_ running the runner's builds may also need the same entry
  on the host running GitLab.
- **Deploy job fails on SSH (`Host key verification failed`).** The job does an
  `ssh-keyscan` of the VM into `known_hosts`. If the VM was recreated (new host
  key), the cached entry is stale — clear it or rely on the keyscan running
  fresh on each job (it does, appending to the file).
- **`/etc/hosts` entries.** Both `gitlab.local` (for the UI/runner) and
  `myapp.local` (for the deployed app) need to resolve to the right IPs from
  your browser/curl — see the two `/etc/hosts` notes in the setup steps.

## Tech stack

- **Terraform** + `dmacvicar/libvirt` — KVM VM provisioning
- **cloud-init** — VM bootstrap (user, SSH key, static IP, qemu-guest-agent)
- **GitLab CE** + **GitLab Runner** — CI/CD (self-hosted)
- **Docker registry** — image storage
- **Ansible** — configuration management & deployment
- **Docker** — container runtime & image builds
- **Node.js** + **Express** — the deployed service
- **nginx** + [h5bp server configs](https://github.com/h5bp/server-configs-nginx) — reverse proxy

## What I learned

- Designing a multi-stage CI pipeline and reasoning about job dependencies,
  `needs:`/`optional:` chaining, and `changes:`-based triggering.
- Bridging the gap between a CI runner and a private target host when there's no
  public IP — handling SSH key injection, `known_hosts`, and an insecure local
  registry.
- Idempotent configuration management with Ansible roles (and the subtle bugs:
  forgetting `become: true`, group membership needing
  `meta: reset_connection`, `image: strict` comparisons to actually recreate
  containers on digest change).
- Provisioning VMs declaratively with Terraform + cloud-init instead of a
  manual `virt-install`.

## License

For learning and portfolio use. Bundled third-party configs retain their own
licenses — notably the h5bp nginx configs under [`nginx/`](nginx/) (MIT).
