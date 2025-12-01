docker buildx build --pull -f 'Dockerfile' -t 'mjguisado/speedis:latest' --platform 'linux/amd64' --push '.'
docker buildx build --pull -f 'Dockerfile.mocks' -t 'mjguisado/mocks:latest' --platform 'linux/amd64' --push '.'
docker buildx build --pull -f 'Dockerfile.keycloak' -t 'mjguisado/keycloak:latest' --platform 'linux/amd64' --push '.'
docker build --pull -f 'Dockerfile' -t 'mjguisado/speedis:latest' '.' --push
docker build --pull -f 'Dockerfile.mocks' -t 'mjguisado/mocks:latest' '.'
docker build --pull -f 'Dockerfile.keycloak' -t 'mjguisado/keycloak:latest' '.'
