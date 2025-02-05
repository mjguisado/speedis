# Speedis - HTTP Cache based on Redis

## Overview

Speedis is a high-performance HTTP caching layer that leverages Redis for storage.
It optimizes response times by reducing direct requests to the origin server.
It implements mechanisms to protect origin servers against overloading.
 
## Features
- **Redis-based caching**: Leveraging `Redis` to store and retrieve cached responses efficiently.
- **Fast and lightweight**: Built with `fastify` to ensure high performance and efficient request handling.
- **Request coalescing**: Consolidate multiple similar requests into a single request.
- **Circuit breaker mechanism**: Implements `opossum` to prevent cascading failures.
- **Prometheus metrics**: Exposes application metrics via `prom-client`.

## Installation

```sh
# Clone the repository
git clone https://github.com/mjguisado/speedis.git
cd speedis

# Install dependencies
npm install
```

## Usage
### Running the server
```sh
npm start
```

### Running in development mode
```sh
npm run dev
```

### Environment Variables
| Variable | Description | Default |
|----------|-------------|---------|
| `REDIS_URL` | Redis server connection URL | `redis://localhost:6379` |

## API Endpoints
### Caching a response
```http
GET /cache/:key
```
Retrieves a cached value by key.

### Storing a response in cache
```http
POST /cache/:key
```
Stores a new response under the given key.

### Invalidating a cache entry
```http
DELETE /cache/:key
```
Removes a cache entry by key.

## Docker Support
You can run Speedis using Docker:
```sh
docker build -t speedis .
docker run -p 3000:3000 -e REDIS_URL=redis://your-redis speedis
```

## Generate Autosigned SSL Certificates
openssl genpkey -algorithm RSA -out domain.key -aes256
openssl req -new -key domain.key -out domain.csr
openssl x509 -req -in domain.csr -signkey domain.key -out domain.crt -days 365
cat domain.crt domain.key > domain.pem

## Monitoring with Prometheus
Speedis exposes metrics at `/metrics`, which can be scraped by Prometheus for performance monitoring.

## Contributing
Contributions are welcome! Feel free to submit issues or pull requests.

## License
TBD
