# **Examples of requests**

These requests work with Speedis deployed in a local enviroment using Docker Compose.
But they can be easyly adapted to works with Speedis deployed in a Kubernetes environment.

## **Request to the Mocked origin server**
```sh
curl -vXGET 'http://127.0.0.1:3030/mocks/items/RealBetis?delay=300&cc=public,max-age=10&a=alfa&b=beta&c='
```
## **Request to Speedis**
```sh
curl -vXGET 'http://127.0.0.1:3001/mocks/mocks/items/RealBetis?delay=300&cc=public,max-age=10&a=alfa&b=beta&c='
```
Repeat the request several times to observe how the response headers (Age, X-Speedis-Cache-Status) indicate the cache status.
## **HTTP Request to Speedis via HAProxy**
```sh
curl -vXGET -H 'Host: mocks' 'http://127.0.0.1/mocks/items/RealBetis?delay=300&cc=public,max-age=10&a=alfa&b=beta&c='
```
## **HTTP Request to Speedis via HAProxy**
```sh
curl -vkXGET -H 'Host: mocks' 'https://127.0.0.1/mocks/items/RealBetis?delay=300&cc=public,max-age=10&a=alfa&b=beta&c='
```
## **HTTP Request to DELETE a cache entry**
```sh
curl -vkXDELETE -H 'Host: mocks' 'https://127.0.0.1/purge/items/RealBetis'
```
## **HTTP Request to DELETE cache entries using asterisk **
```sh
curl -vkXDELETE -H 'Host: mocks' 'https://127.0.0.1/purge/*/items/*'
```
## **HTTP Request to Speedis via HAProxy de DELETE all the cache entries (of this origin) **
```sh
curl -vkXDELETE -H 'Host: mocks' 'https://127.0.0.1/purge/*'
```
