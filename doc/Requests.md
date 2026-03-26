# **Examples of requests**

These requests work with Speedis deployed in a local enviroment using Docker Compose.
But they can be easyly adapted to works with Speedis deployed in a Kubernetes environment.

## **Request to the Mocked origin server (HTTP/1)**
```sh
curl -vk --http1.1 --resolve mocks.localhost:3030:127.0.0.1 'https://mocks.localhost:3030/mocks/public/items/real-betis?delay=300&cc=public,max-age=10'
```

## **Request to the Mocked origin server (HTTP/2)**
```sh
curl -vk --http2 --resolve mocks.localhost:3030:127.0.0.1 'https://mocks.localhost:3030/mocks/public/items/real-betis?delay=300&cc=public,max-age=10'
```
## **Request to Speedis**
```sh
curl -v --resolve speedis.localhost:3001:127.0.0.1 'http://speedis.localhost:3001/cache/mocks/public/items/real-betis?delay=300&cc=public,max-age=10'
```
Repeat the request several times to observe how the response headers (Age, X-Speedis-Cache-Status) indicate the cache status.
## **HTTP Request to Speedis via HAProxy (Public)**
```sh
curl -vk --resolve mocks.localhost:443:127.0.0.1 'https://mocks.localhost/mocks/public/items/real-betis?delay=300&cc=public,max-age=10'
```
## **HTTP Request to Speedis via HAProxy (Private without authentication)**
```sh
curl -vk --resolve mocks.localhost:443:127.0.0.1 'https://mocks.localhost/mocks/private/items/real-betis?delay=300&cc=public,max-age=10'
```
## **HTTP Request to Speedis via HAProxy (Private with Basic authentication)**
```sh
curl -vk --resolve mocks.localhost:443:127.0.0.1 -H 'Authorization: Basic dXNlc3BlZWRpc191c2VyOnNlY3JldA==' 'https://mocks.localhost/mocks/private/items/real-betis?delay=300&cc=public,max-age=10'
```
## **HTTP Request to Speedis via HAProxy (Private with Bearer authentication)**
```sh   
curl -vk --resolve mocks.localhost:443:127.0.0.1 -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.ew0KICAic3ViIjogInNwZWVkaXNfdXNlciIsDQogICJuYW1lIjogIlNwZWVkaXMgVXNlciIsDQogICJpYXQiOiAxNTE2MjM5MDIyDQp9.1YuOJY2ooJ1KMy_DqxJwLeIO_khJ1_aFCy7JhON26wo' 'https://mocks.localhost/mocks/private/items/real-betis?delay=300&cc=public,max-age=10'
```

## **HTTP Request to DELETE a cache entry via Speedis**
```sh
curl -vXDELETE --resolve speedis.localhost:3001:127.0.0.1 'http://speedis.localhost:3001/cache/purge/mocks/public/items/real-betis?delay=300&cc=public,max-age=10'
```
## **HTTP Request to DELETE a cache entry via HAProxy**
```sh
curl -vkXDELETE --resolve mocks.localhost:443:127.0.0.1 'https://mocks.localhost/purge/mocks/public/items/real-betis?delay=300&cc=public,max-age=10'
```
## **HTTP Request to DELETE cache entries using asterisk via Speedis**
```sh
curl -vXDELETE --resolve speedis.localhost:3001:127.0.0.1 'http://speedis.localhost:3001/cache/purge/*'
```
## **HTTP Request to DELETE all the cache entries (of this origin) via HAProxy**
```sh
curl -vkXDELETE --resolve mocks.localhost:443:127.0.0.1 'https://mocks.localhost/purge/*'
```
