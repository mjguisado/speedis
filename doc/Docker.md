# Getting Started
This repository includes a Docker Compose configuration file to easy the deploy and test of Redis.
## **Prerequisites**  
Ensure you have the following installed:
- [Docker](https://docs.docker.com/get-docker/)  
- [Docker Compose](https://docs.docker.com/compose/)
- [OpenSSL](https://www.openssl.org/)
## **Clone the repository**  
```sh
git clone https://github.com/mjguisado/speedis.git
cd speedis
```
## **Generate self signed certificate**
Generate self signed certificate to test HAProxy TLS termination
The test domain is mocks.speedis
```sh
./conf/haproxy/generate_self_signed_cert.sh
```
## **Start the environment**  
Run the following command to start all services:  
```sh
docker compose up --build -d
```
This will start:
- **Redis**: In-memory shared data storage
- **HAProxy**: Reverse Proxy
- **Speedis**: The main caching service
- **Mocks**: Mocked origin server
- **Prometheus**: Monitoring system
- **Grafana**: Visualization tool
## **Verify the setup**  
Check the running containers:  
```sh
docker ps
```
You should see all containers (`redis-stack-server`, `speedis`, `haproxy`, etc.) running.
## **Access Services**  
- **HAProxy** → `http(s)://localhost`  
- **Speedis** → `http://localhost:3001`
- **Speedis (Metrics)** → `http://localhost:3003/metrics`
- **Mocks** → `http://localhost:3030`
- **Grafana** → `http://localhost:3000` (User: `admin`, Password: `grafana`)  
- **Prometheus** → `http://localhost:9090`
You can find examples of request to the different services in [./Requests.md](./Requests.md)
## **Stopping the environment**  
To stop all containers, run:  
```sh
docker compose down
```
or to stop all containers and delete the Prometheus data volumen, run:  
```sh
docker compose down -v
```
