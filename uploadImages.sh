docker build --pull -f 'Dockerfile' -t 'mjguisado/speedis:latest' '.'
docker build --pull -f 'Dockerfile.mocks' -t 'mjguisado/mocks:latest' '.'
docker build --pull -f 'Dockerfile.keycloak' -t 'mjguisado/keycloak:latest' '.'
docker push mjguisado/speedis:latest
docker push mjguisado/mocks:latest
docker push mjguisado/keycloak:latest
