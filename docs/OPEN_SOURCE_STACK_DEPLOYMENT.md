# DAX Open-Source Stack Deployment Guide

This guide covers deploying DAX with the open-source stack components enabled. Three deployment profiles are documented: local development, secured substrate, and evented/observed production.

## Deployment Profiles

### Profile 1: Local Development

Minimal setup for local development. No external dependencies required.

```bash
# Core DAX (no substrate, no NATS, no OTel)
DAX_SUBSTRATE_ENABLED=false
DAX_NATS_ENABLED=false
OTEL_ENABLED=false
```

All platform integrations gracefully degrade — DAX operates in standalone mode.

### Profile 2: Secured Substrate

External API control via FastMCP with token auth and ZITADEL identity.

```bash
# Substrate (FastMCP)
DAX_SUBSTRATE_ENABLED=true
DAX_SUBSTRATE_PORT=4730

# Token auth — static token for simple deployments
DAX_SUBSTRATE_TOKEN=your-secret-token

# Or ZITADEL for JWT-based identity (preferred in production)
ZITADEL_DOMAIN=https://your-org.zitadel.cloud
ZITADEL_ISS=https://your-org.zitadel.cloud
ZITADEL_AUD=https://your-org.zitadel.cloud

# Infisical for secrets (optional — falls back to env vars)
INFISICAL_CLIENT_ID=your-client-id
INFISICAL_CLIENT_SECRET=your-client-secret
INFISICAL_PROJECT_ID=your-project-id
INFISICAL_ENVIRONMENT=dev
```

#### ZITADEL Setup

1. Create a ZITADEL instance at [zitadel.com](https://zitadel.com) or self-host.
2. Create a service account with a private key.
3. Download the private key JSON file.
4. Set the private key contents as `ZITADEL_SERVICE_ACCOUNT_KEY` or store in Infisical.
5. Set `ZITADEL_DOMAIN` to your ZITADEL instance domain.
6. Clients authenticate by obtaining a JWT from ZITADEL and passing it as a Bearer token:

```bash
# Obtain a token from ZITADEL (service account JWT flow)
curl -X POST https://your-org.zitadel.cloud/oauth/v2/token \
  -d "grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer" \
  -d "assertion=$JWT_ASSERTION" \
  -d "scope=openid"

# Use the token with FastMCP
curl -X POST http://localhost:4730/ \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"run.create","arguments":{"intent":{"input":"analyze this repo"}}}}'
```

#### Infisical Setup

1. Create an Infisical project.
2. Generate machine credentials (client ID + client secret) under Project Settings > Machine Identities.
3. Add secrets to Infisical:
   - `DAX_SUBSTRATE_TOKEN` — Bearer token for FastMCP auth
   - `DAX_SERVER_USERNAME` / `DAX_SERVER_PASSWORD` — Basic auth for the HTTP API
   - `DAX_NATS_CREDS_PATH` — Path to NATS credentials file (optional)
4. Set `INFISICAL_CLIENT_ID`, `INFISICAL_CLIENT_SECRET`, `INFISICAL_PROJECT_ID`, `INFISICAL_ENVIRONMENT`.

Secrets from Infisical take precedence over environment variables. If Infisical is unavailable or a secret is not found, DAX falls back to the corresponding environment variable.

### Profile 3: Evented and Observed

Full deployment with NATS event transport, secrets management, identity, and telemetry.

```bash
# NATS / JetStream
DAX_NATS_ENABLED=true
DAX_NATS_URL=nats://localhost:4222
DAX_NATS_STREAM=DAX_EVENTS

# NATS credentials (from Infisical or path)
INFISICAL_NATS_CREDS_PATH=/secrets/nats-creds.json
# Or: DAX_NATS_CREDS=/path/to/nats-creds.json

# OpenTelemetry
OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_SERVICE_NAME=dax

# All secrets from Infisical
INFISICAL_CLIENT_ID=...
INFISICAL_CLIENT_SECRET=...
INFISICAL_PROJECT_ID=...
INFISICAL_ENVIRONMENT=production

# ZITADEL identity
ZITADEL_DOMAIN=https://your-org.zitadel.cloud
```

## Environment Variables Reference

### Core

| Variable                | Default | Description                          |
| ----------------------- | ------- | ------------------------------------ |
| `DAX_SUBSTRATE_ENABLED` | `false` | Enable FastMCP substrate             |
| `DAX_SUBSTRATE_PORT`    | `4730`  | FastMCP HTTP server port             |
| `DAX_SUBSTRATE_TOKEN`   | —       | Static bearer token for FastMCP auth |

### Secrets (Infisical)

| Variable                  | Default | Description                                |
| ------------------------- | ------- | ------------------------------------------ |
| `INFISICAL_CLIENT_ID`     | —       | Infisical universal auth client ID         |
| `INFISICAL_CLIENT_SECRET` | —       | Infisical universal auth client secret     |
| `INFISICAL_PROJECT_ID`    | —       | Infisical project ID                       |
| `INFISICAL_ENVIRONMENT`   | `dev`   | Infisical environment slug                 |
| `INFISICAL_TOKEN`         | —       | Infisical personal access token (fallback) |

Infisical secrets used by DAX:

- `DAX_SUBSTRATE_TOKEN` — FastMCP bearer token
- `DAX_SERVER_USERNAME` / `DAX_SERVER_PASSWORD` — HTTP API basic auth
- `DAX_NATS_CREDS_PATH` — Path to NATS credentials file

### Identity (ZITADEL)

| Variable                      | Default     | Description                                                      |
| ----------------------------- | ----------- | ---------------------------------------------------------------- |
| `ZITADEL_DOMAIN`              | —           | ZITADEL instance domain (e.g., `https://your-org.zitadel.cloud`) |
| `ZITADEL_ISS`                 | `<domain>`  | Expected JWT issuer (defaults to `ZITADEL_DOMAIN`)               |
| `ZITADEL_AUD`                 | `<domain>/` | Expected JWT audience                                            |
| `ZITADEL_SERVICE_ACCOUNT_ID`  | —           | Service account user ID (for service-to-service)                 |
| `ZITADEL_SERVICE_ACCOUNT_KEY` | —           | Private key JSON or contents (store in Infisical)                |

### Transport (NATS/JetStream)

| Variable           | Default                 | Description                   |
| ------------------ | ----------------------- | ----------------------------- |
| `DAX_NATS_ENABLED` | `false`                 | Enable NATS event transport   |
| `DAX_NATS_URL`     | `nats://localhost:4222` | NATS server URL               |
| `DAX_NATS_CREDS`   | —                       | Path to NATS credentials file |
| `DAX_NATS_STREAM`  | `DAX_EVENTS`            | JetStream stream name         |

### Observability (OpenTelemetry)

| Variable                              | Default                 | Description                 |
| ------------------------------------- | ----------------------- | --------------------------- |
| `OTEL_ENABLED`                        | `false`                 | Enable OpenTelemetry export |
| `OTEL_EXPORTER_OTLP_ENDPOINT`         | `http://localhost:4318` | OTLP collector base URL     |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`  | —                       | Override traces endpoint    |
| `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` | —                       | Override metrics endpoint   |
| `OTEL_SERVICE_NAME`                   | `dax`                   | Service name in telemetry   |

## NATS JetStream Subjects

| Subject                   | Purpose                                 |
| ------------------------- | --------------------------------------- |
| `dax.runs.<runId>.events` | All events for a specific run           |
| `dax.runs.lifecycle`      | Lifecycle events for all runs (fan-out) |
| `dax.approvals.<runId>`   | Approval events for a run               |
| `dax.recovery.<runId>`    | Recovery events for a run               |

## FastMCP Tools

| Tool                    | Description                 |
| ----------------------- | --------------------------- |
| `health`                | Health check                |
| `run.create`            | Create a governed run       |
| `run.get`               | Get run snapshot            |
| `run.approvals.list`    | List pending approvals      |
| `run.approvals.resolve` | Approve or deny an approval |
| `run.recovery.get`      | Get recovery summary        |
| `run.recovery.execute`  | Recover a non-terminal run  |

## Start DAX

```bash
# Full stack (all integrations)
DAX_SUBSTRATE_ENABLED=true \
DAX_SUBSTRATE_TOKEN=secret \
DAX_NATS_ENABLED=true \
DAX_NATS_URL=nats://localhost:4222 \
OTEL_ENABLED=true \
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 \
bun run packages/dax/src/index.ts
```

## Health Checks

```bash
# Substrate health
curl http://localhost:4730/ -H "Authorization: Bearer secret"

# NATS connectivity
nats server report jetstream

# OTel collector
curl http://localhost:4318/health
```

## Graceful Degradation

Each integration degrades independently when unavailable:

| Integration | Degradation Behavior                                   |
| ----------- | ------------------------------------------------------ |
| Infisical   | Falls back to environment variables                    |
| ZITADEL     | Falls back to `DAX_SUBSTRATE_TOKEN` static token       |
| NATS        | Continues without event fan-out; events stored locally |
| OTel        | Continues without telemetry export                     |

No integration causes a hard failure if its dependency is unavailable.
