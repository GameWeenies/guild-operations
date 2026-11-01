# Guild Operations

Guild Operations is a self-hosted application for World of Warcraft guilds. One deployment represents one guild. Blizzard is authoritative for account control and WoW character facts. Current documented membership and rank authority is defined in `docs/doctrine/architecture.md` and `docs/doctrine/member-objects.md`; changes to that authority model must be explicitly reconciled with those contracts.

## Requirements

A normal installation requires Docker with Docker Compose, an address through which Guild Operations can be reached, a Blizzard account that can create an application in the Blizzard Developer Portal, and a current rank-0 Guild Master who can authorize the selected guild.

PostgreSQL is packaged with Guild Operations and is not exposed on the host.

## Install

Clone the repository, configure the host-owned settings, and start the deployment:

```sh
git clone https://github.com/GameWeenies/guild-operations.git
cd guild-operations
cp .env.example .env
```

Edit the single `.env` file in sections: installation origin, Blizzard application, database, optional Discord integration, and operational settings. Set `PUBLIC_ORIGIN`, `BLIZZARD_CLIENT_ID`, and `BLIZZARD_CLIENT_SECRET`. Configure the Blizzard OAuth callback for that origin. If enabling Discord, provide all three Discord application credentials for the same application. These are host-owned values, not Guild Settings.

For a **new bundled PostgreSQL installation**, `.env.example` contains `POSTGRES_PASSWORD=change-me-now` as an obvious placeholder. **Replace it with a unique URL-safe password before first startup**; for example, `openssl rand -hex 32` produces a suitable value. The placeholder is not a secure credential. Leave `DATABASE_URL` unset: Compose constructs the matching bundled database URL from `POSTGRES_PASSWORD`. Protect the file with `chmod 600 .env`; do not commit it.

```sh
docker compose up -d
docker compose ps
```

The bundled database is not exposed on the host. The web service publishes port 3000 by default (`HTTP_PORT` overrides it). The image defaults to `:latest`; set `GUILD_OPERATIONS_VERSION` to pin a release or to `dev` for development.

**Existing bundled installations:** `compose.yaml` retains its legacy database password when `POSTGRES_PASSWORD` is unset, to preserve existing-volume continuity. This shared compatibility default is not recommended for new installations; use a unique password whenever possible. Never change `POSTGRES_PASSWORD` on an initialized database merely by editing `.env`: PostgreSQL does not rotate existing database passwords when its startup environment changes. Coordinate any rotation with a database migration and a verified backup.

### Credential source precedence

The standard installation uses one `.env` file. Optional Compose overlays support protected files for operators who prefer them. For each application credential, an explicitly configured `*_FILE` source **wins over** the direct environment value. A selected file that is missing, unreadable, or empty causes an error; it never silently falls back to `.env`. Values without a selected file come from the environment. `PUBLIC_ORIGIN_FILE` is supported by application code but requires the host to arrange its mount; the supplied Compose files use `PUBLIC_ORIGIN` directly.

Use `compose.blizzard-secret.yaml` and `compose.discord-secret.yaml` for file-based application credentials, or `compose.database-secret.yaml` for a file-based database URL. For a **new** bundled database, `sh scripts/init-bundled-db-secrets.sh` and `compose.bundled-db-secret.yaml` remain an optional alternative to `POSTGRES_PASSWORD` in `.env`. Do not apply that overlay to an existing database without credential migration. The bundled PostgreSQL server's password source and the application connection URL must always agree. When using an overlay, keep the same Compose file selection for subsequent commands and preserve the files in secure backups.

Docker Compose environment variables (including values sourced from `.env`) can be visible through rendered Compose configuration and container inspection. Use protected file overlays if that exposure is unacceptable for your host.

### External PostgreSQL

For a PostgreSQL server managed independently of Guild Operations, use the standalone Compose topology rather than layering it on the bundled topology:

```sh
# Configure DATABASE_URL in the protected .env file first.
docker compose -f compose.external-db.yaml config --services
docker compose -f compose.external-db.yaml up -d
```

The service list must contain `migrate`, `api`, and `discord`, **not** `db`. Set `DATABASE_URL` to a PostgreSQL URL containing the database, host, and application credentials. Provision the database and user on the external server before starting. Guild Operations continues to run its own schema migrations through the one-shot `migrate` service. The host/provider owns PostgreSQL server availability, TLS policy, credentials, backups, and restoration.

To keep the connection URL in a protected file rather than `.env`, place it in `./secrets/database-url` and use both files in this order:

```sh
docker compose -f compose.external-db.yaml -f compose.database-secret.yaml up -d
```

Do not use `compose.yaml` in the external database command: it includes the bundled `db` service. Do not switch an existing installation to a fresh external database without a planned data migration and verified backup. The installation encryption key must remain paired with the migrated database state.

**Database topology safety:** Do not combine `compose.bundled-db-secret.yaml` with `compose.database-secret.yaml` or the external database topology. Do not change database credentials or topology on an existing deployment without a deliberate migration.

## First-run setup

With host configuration in place, open the public origin in a browser. A new installation redirects to `/setup`. Sign in with Blizzard and complete the Guild Master authorization for the host-configured target guild. Host access does not grant guild authority.

Blizzard credentials and public origin are configured on the host, **not** through the browser setup wizard. A separate System Administration service and setup-token bootstrap are not part of this deployment.

Discord application credentials are likewise host-owned. Guild-authorized operators configure the Discord server, channels, and integration enablement in Guild Settings. Replacing the Discord application identity requires explicit reconnection; rotating credentials for the same application does not require reselecting guild-owned settings.

## Persistent data

The packaged bundled-database deployment uses two Docker named volumes:

| Volume | Purpose |
| --- | --- |
| guild-operations-db | PostgreSQL application and installation state |
| guild-operations-installation | Installation-owned encryption material |

Containers are disposable. Ordinary restarts, replacements, upgrades, and docker compose down leave these volumes intact.

Do not use docker compose down -v unless you intend to delete persistent deployment state.

### Backups

A recoverable backup must preserve both the PostgreSQL data and the installation volume, including /var/lib/guild-operations/installation.key.

Preserve the installation volume alongside the database for continuity and recovery. Also back up the host-owned configuration and credential material separately and securely; a database backup alone does not capture these host settings.

## Restarting

A normal container restart does not require setup again. Use **the same Compose file selection used to create the deployment**. For a standard bundled installation configured through `.env`:

```sh
docker compose down
docker compose up -d
docker compose ps
```

For bundled installations using protected-file overlays, retain the original Compose file selection. For external PostgreSQL installations, use `docker compose -f compose.external-db.yaml` (plus the database-secret override if configured). Do not switch Compose configurations during routine restarts or upgrades.

Do not add -v during an ordinary restart or update.

## Development image publishing

To test a feature branch before merging, push the branch and use **Actions → Publish Guild Operations Image → Run workflow**, selecting that branch. A manual run against a branch publishes `ghcr.io/gameweenies/guild-operations:dev` and a commit-SHA image tag. Development deployments may opt into `GUILD_OPERATIONS_VERSION=dev`; this mutable tag represents the most recently manually published branch, not necessarily `main`, and must not be used for pinned production deployments. A push to `main` does not overwrite `:dev`. Publishing an image does not restart any deployment: operators explicitly pull and recreate services when ready. Version-tagged releases continue to publish independently. The original installation's full development deployment and health-check procedure is documented in [docs/infrastructure/development-deployment.md](docs/infrastructure/development-deployment.md).

## Development and architecture

Customer installation and development topology are intentionally different. Development-only authority facilities are not part of customer installation and must not be used to establish a real deployment.

Implementation and architecture documentation begins at docs/README.md. Core doctrine lives under docs/doctrine/. Repository documentation and implementation are authoritative for development behavior.
