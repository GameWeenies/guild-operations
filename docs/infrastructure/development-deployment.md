# Development deployment workflow

This document records an **installation-specific development workflow** for the original Guild Operations deployment. Paths, project names, ports, and addresses below are historical configuration examples and must be checked against the host before use. For other guilds, use the repository README.

## Deployment boundaries

| | Development | Production |
| --- | --- | --- |
| Checkout / Compose directory | Host-specific checkout | `/opt/guild-operations` |
| Compose project | Host-configured project | Host-configured project |
| Image | `ghcr.io/gameweenies/guild-operations:dev` | Pinned versioned image |
| Host HTTP port | Host-configured port | Host-configured port |
| Public address | `https://dev.guild.gameweenies.net` | `https://guild.gameweenies.net` |

Keep development and production Compose projects and persistent volumes separate. Reverse-proxy routing and ports are installation-specific; verify the active host configuration before running commands.

## Publish a committed branch from GitHub

1. Push the feature branch to GitHub. It need not be merged into `main`.
2. Open **Actions → Publish Guild Operations Image → Run workflow**, choose that branch, and start the run.
3. Wait for the **Publish image** job to succeed. The workflow publishes the mutable `:dev` tag and a commit-SHA tag to GHCR.
4. On the development host, deploy deliberately:

```bash
cd /path/to/your/guild-operations-checkout
GUILD_OPERATIONS_VERSION=dev docker compose pull
GUILD_OPERATIONS_VERSION=dev docker compose up -d --no-build --pull never
GUILD_OPERATIONS_VERSION=dev docker compose ps
```

The checked-out Git branch does **not** determine which code is in the pulled image; the last successfully published `:dev` image does. The Compose checkout supplies deployment configuration. Do not assume that pulling Git commits updates running containers.

## Build from the local checkout

To test a local checkout, including uncommitted changes, build the same tag locally:

```bash
cd /path/to/your/guild-operations-checkout
docker build -t ghcr.io/gameweenies/guild-operations:dev .
GUILD_OPERATIONS_VERSION=dev docker compose up -d --no-build --pull never --force-recreate api discord
```

A local build overwrites the host's local `:dev` tag. A subsequent `docker compose pull` replaces it with the registry version. Avoid pulling when the intention is to deploy local changes. Local builds are useful for experiments but are not evidence of a reproducible release candidate until the changes are committed and verified by CI.

## Verify readiness

The API may take time to start after Compose reports that the containers were started. A transient Nginx 502 immediately after deployment is not by itself evidence of a failed deployment.

```bash
cd /path/to/your/guild-operations-checkout
for attempt in $(seq 1 12); do
  if curl --fail --silent --show-error --max-time 5 \
    https://dev.guild.gameweenies.net/health; then
    echo
    echo "PASS: development API healthy"
    break
  fi
  if [ "$attempt" -eq 12 ]; then
    echo "FAIL: development API did not become healthy" >&2
    exit 1
  fi
  sleep 5
done
```

If the public endpoint remains unavailable, compare the direct API with the Nginx route and inspect logs:

```bash
curl -si --max-time 10 http://127.0.0.1:${HTTP_PORT:-3000}/health
curl -si --max-time 10 https://dev.guild.gameweenies.net/health
GUILD_OPERATIONS_VERSION=dev docker compose ps
GUILD_OPERATIONS_VERSION=dev docker compose logs --tail=60 api
```

A successful health response is `{"status":"ok"}`. It confirms API readiness, not that every feature or external OAuth integration works; validate those separately.

## Safety and release boundary

- Publishing an image does not deploy it. Pulling and restarting development are explicit host-operator actions.
- Manual workflow dispatch selects the branch whose source is published to `:dev`. Pushes to `main` do not automatically overwrite that tag.
- `:dev` is mutable and must not be used for production. Release tags are published through the separate version-tag trigger; production deployments should pin a version.
- Do not run `docker compose down -v` during routine updates: it deletes persistent volumes.
- Preserve both database and installation volumes for recovery. Production deployment, secrets, database, and reverse-proxy configuration are not part of this development procedure.
