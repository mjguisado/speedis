# **Examples of requests**

These requests work with Speedis deployed in a local enviroment using Docker Compose.
But they can be easyly adapted to works with Speedis deployed in a Kubernetes environment.

## **Request to the Mocked origin server (HTTP/1)**
```sh
curl -v -H 'Host: mocks.localhost' 'http://127.0.0.1:3030/mocks/items/public-real-betis'
```
## **Request to the Mocked origin server (HTTP/2)**
```sh
curl -vk -http2 -H 'Host: mocks2.localhost' 'https://127.0.0.1:3032/mocks/items/public-real-betis'
```
## **Request to Speedis**
```sh
curl -v -H 'Host: speedis.localhost' 'http://127.0.0.1:3001/mocks/mocks/items/public-real-betis?delay=300&cc=public,max-age=10'
```
Repeat the request several times to observe how the response headers (Age, X-Speedis-Cache-Status) indicate the cache status.
## **HTTP Request to Speedis via HAProxy**
```sh
curl -vk -H 'Host: mocks.localhost' 'https://127.0.0.1/mocks/items/public-real-betis?delay=300&cc=public,max-age=10'
```
## **HTTP Request to DELETE a cache entry via Speedis**
```sh
curl -vXDELETE -H 'Host: speedis.localhost' 'http://127.0.0.1:3001/mocks/purge/mocks/items/public-real-betis?delay=300&cc=public,max-age=10'
```
## **HTTP Request to DELETE a cache entry via HAProxy**
```sh
curl -vkXDELETE -H 'Host: mocks.localhost' 'https://127.0.0.1/purge/mocks/items/public-real-betis'
```
## **HTTP Request to DELETE cache entries using asterisk via Speedis**
```sh
curl -vkXDELETE -H 'Host: mocks.localhost'  'https://127.0.0.1/purge/*/items/*'
```
## **HTTP Request to DELETE all the cache entries (of this origin) via HAProxy**
```sh
curl -vkXDELETE -H 'Host: mocks.localhost'  'https://127.0.0.1/purge/*'
```
