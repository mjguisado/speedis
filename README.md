# speedis
An HTTP cache based on Redis


docker build . -f ./Dockerfile.mockserver -t mock:test
docker run -ti -p 3100:3100 -p 3110:3110 mock:test
