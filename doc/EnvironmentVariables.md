# Environment variables

Speedis is configured primarily through JSON files (see [Configuration.md](./Configuration.md)). A small set of environment variables controls a stage that happens **before** any JSON is read: where the main configuration comes from, how Speedis connects to the Redis instance that holds it, and a couple of runtime/development toggles.

The defaults documented below are picked up directly from `src/index.js`.

## Reference

| Variable | Default | Stage | Purpose |
|----------|---------|-------|---------|
| `USE_REDIS_CONFIG` | unset | Bootstrap | When set to any truthy value, Speedis loads its main configuration from Redis instead of `./conf/speedis.json`. Origin configurations are then loaded from the Redis keys listed in `main.originsConfigsKeys`. |
| `SPEEDIS_CONFIG_KEY` | `speedis:config:main` | Bootstrap | Redis key holding the main configuration JSON document. Only used when `USE_REDIS_CONFIG` is set. |
| `REDIS_URL` | — | Bootstrap | Full Redis connection string for the **configuration store**, e.g. `redis://user:pass@host:6379/0`. Cannot contain `@` or `:` inside the credentials — use the individual variables below if you need to. |
| `REDIS_HOST` | `127.0.0.1` | Bootstrap | Alternative to `REDIS_URL` (allows special characters in credentials). |
| `REDIS_PORT` | `6379` | Bootstrap | TCP port for the configuration store. |
| `REDIS_DB` | — | Bootstrap | Database number for the configuration store. |
| `REDIS_USER` | — | Bootstrap | Username for ACL-protected Redis. |
| `REDIS_PASS` | — | Bootstrap | Password for the configuration store. |
| `NODE_ENV` | — | Runtime | When equal to `development`, each worker opens the Node.js inspector on `9229 + workerId`. The Compose file maps the range `9229-9249` to the host so you can attach a debugger. |
| `NODE_TLS_REJECT_UNAUTHORIZED` | — | Runtime | Set to `0` to bypass certificate verification when Speedis talks to upstreams or mocks using self-signed certificates. The bundled `compose.yml` already exports this for the `speedis` service. |

> **Important:** the `REDIS_*` variables above only configure where Speedis fetches the **main configuration** from. The Redis instance used as the cache backend is configured per-origin under `redis.redisOptions` (see [Configuration.md → Redis configuration object](./Configuration.md#redis-configuration-object)) and is fully independent.

## Choosing where the configuration comes from

```
USE_REDIS_CONFIG not set  →  read ./conf/speedis.json
                              and ./conf/origins/*.json
USE_REDIS_CONFIG  set     →  read JSON from Redis key  $SPEEDIS_CONFIG_KEY
                              and from each Redis key listed in
                              main.originsConfigsKeys (loaded in order)
```

When `USE_REDIS_CONFIG` is unset and a custom path is needed for the origin files, point at it with the top-level `localOriginsConfigs` field in `speedis.json`. When `USE_REDIS_CONFIG` is set, `localOriginsConfigs` is ignored and `originsConfigsKeys` becomes mandatory.

To populate Redis with the contents of the local `conf/` tree (handy for first-time setup or for keeping a single source of truth in CI), use the helper script described in [Configuration.md → Loading configurations into Redis](./Configuration.md#loading-configurations-into-redis).

## Two ways to point at Redis

### Option 1 — single connection string

```bash
REDIS_URL="redis://{user}:{password}@{host}:{port}/{database}"
```

Simple and easy to inject from secrets managers. **Limitation:** `@` and `:` cannot appear inside the user or password fields because they delimit the URL components.

### Option 2 — individual variables

```bash
REDIS_HOST="localhost"
REDIS_PORT="6379"
REDIS_DB="0"
REDIS_USER="myuser"
REDIS_PASS="my:p@ssword"
```

Use this form when credentials contain characters that would break the URL parser, or when the deployment platform already exposes Redis settings as discrete variables.

If both `REDIS_URL` and the individual variables are present, `REDIS_URL` wins.

## See also

- [Configuration.md](./Configuration.md) — the full configuration reference.
- [Docker.md](./Docker.md) — how the bundled `compose.yml` wires these variables for local development.
