# Getting Started
This repository includes a Docker Compose configuration file to easy the deploy and test of Redis.
## **Prerequisites**  
Ensure you have the following installed:
- [Docker](https://docs.docker.com/get-docker/)  
- [Docker Compose](https://docs.docker.com/compose/)
- [OpenSSL](https://www.openssl.org/)
- [Redis-Cli](https://redis.io/docs/latest/develop/tools/cli/)
## **Clone the repository**  
```sh
git clone https://github.com/mjguisado/speedis.git
cd speedis
```
## **Generate self signed certificate**
Some Speedis components require or support HTTPS traffic, which requires generating SSL certificates.
You can generate all the necessary self-signed certificates with a single command.
```sh
./generate_self_signed_certs.sh
```
or create them individually if needed.
### Mocks Server
The mock server can run over HTTP/2 when started with the environment variable MOCKS_HTTP2=true.
In practice, HTTP/2 is effectively tied to HTTPS, since browsers only support HTTP/2 over secure connections.
The supported domains are mocks, mocks.localhost, mocks2 & mocks2.localhost
```sh
./mocks/generate_self_signed_cert.sh
```
### Speedis
The speedis server can run over HTTPS & HTTP/2.
In practice, HTTP/2 is effectively tied to HTTPS, since browsers only support HTTP/2 over secure connections.
The supported domains are speedis and speedis.localhost.
```sh
./docs/generate_self_signed_cert.sh
```
### HAProxy
The supported domains are: speedis, speedis.localhost, mocks, mocks.localhost, mocks2 & mocks2.localhost
```sh
./3rparties/haproxy/generate_self_signed_cert.sh
```
### Keycloak
Keycloak requires TLS. 
The supported domains are keycloak & keycloak.localhost.
```sh
./3rparties/keycloak/generate_self_signed_cert.sh
```
## **Start the environment**  
Run the following command to start all services:  
```sh
docker compose --profile develop up --watch --build
```
This will start:
- **Redis**: In-memory shared data storage
- **HAProxy**: Reverse Proxy
- **Speedis**: The main caching service
- **Mocks**: Mocked origin server (HTTP/1)
- **Mocks2**: Mocked origin server (HTTP/2)
- **Keycloack**: Identity and Access Management (IAM)
- **Prometheus**: Monitoring system
- **Grafana**: Visualization tool
## **Verify the setup**  
Check the running containers:  
```sh
docker ps
```
You should see all containers (`speedis`, `haproxy`, etc.) running.

## **Access Services**  

To access the different services deployed in Docker from the local environment, it is needed to define the following DNS resolutions.

```
127.0.0.1	mocks.localhost
127.0.0.1	mocks2.localhost
127.0.0.1	speedis.localhost
127.0.0.1	haproxy.localhost
127.0.0.1	redis.localhost
127.0.0.1	prometheus.localhost
127.0.0.1	grafana.localhost
127.0.0.1	keycloak.localhost
```

These URLs provide access to the consoles of certain tools and their associated metrics.
- **HAProxy** → `http://haproxy.localhost:8405/metrics`
- **Speedis (Metrics)** → `http://speedis.localhost:3003/metrics`
- **Grafana** → `http://grafana.localhost:3000` (User: `admin`, Password: `grafana`)  
- **Prometheus** → `http://prometheus.localhost:9090`
- **Keycloack**  → `https://keycloak.localhost:8443` (User: `admin`, Password: `admin`)  

You can find examples of request to the different services in [./Requests.md](./Requests.md)
## **Load origin configuration**  
Speedis can load origin configurations from either local files or a Redis database.
If the database is used, the origin configuration must be inserted into it before running Speedis.
Start Redis.
```sh
docker compose up redis -d
```
Load the origin configurations
```sh
./conf/loadRemoteOriginsConfigs.sh
```
Start the rest of the service including Speedis
```sh
docker compose --profile develop up --watch --build
```
## **Configure Keycloak**  
Keycloak, an Identity and Access Management (IAM) server, is included to support OAuth2 integration within Speedis.
In the sample mocks configuration, Keycloak is used, and it must be properly configured before running Speedis.
To configure it correctly, start Keycloak
```sh
docker compose up keycloak -d
```
and follow the steps detailed in [./Keycloak.md](./Keycloak.md)
The configuration is stored in a persistent volume, so it only needs to be set up the first time — unless that volume is deleted.
## **Stopping the environment**  
To stop all containers, run:  
```sh
docker compose down
```
or to stop all containers and delete the Prometheus data volumen, run:  
```sh
docker compose down -v
```
## **Running speedis in local**  
The project includes configurations that allow you to debug Speedis while it runs inside a Docker environment.
However, in some cases, it can be useful to run Speedis locally while keeping the rest of the components running in Docker.
To do this, you need to stop the Speedis instance running in Docker.
```sh
docker down speedis
```
and sart Speedis locally. 
If you make requests to the mock server using HTTP/2, note that because self-signed certificates are used, you must start Speedis with an option that tells it to trust those certificates.
```sh
NODE_TLS_REJECT_UNAUTHORIZED=0 ./node_modules/nodemon/bin/nodemon.js ./src/index.js
```
