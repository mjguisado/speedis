#!/bin/bash

# Script para construir y publicar imágenes de desarrollo
# Uso: ./build-dev.sh
#
# Este script se usa en la rama dev para publicar imágenes de prueba
# con el tag 'dev' en lugar de versiones específicas

set -e

# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Verificar que estamos en la rama dev
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "dev" ]; then
    echo -e "${YELLOW}Advertencia: No estás en la rama 'dev'${NC}"
    echo -e "${YELLOW}Rama actual: ${CURRENT_BRANCH}${NC}"
    echo ""
    echo -e "${YELLOW}¿Deseas continuar de todas formas? (y/n)${NC}"
    read -r CONTINUE
    if [[ ! "$CONTINUE" =~ ^[Yy]$ ]]; then
        echo "Build cancelado"
        exit 1
    fi
fi

echo -e "${BLUE}════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Construyendo imágenes de desarrollo (dev)${NC}"
echo -e "${BLUE}════════════════════════════════════════════════${NC}"
echo ""

# Obtener versión actual + commit hash para trazabilidad
CURRENT_VERSION=$(node -p "require('./package.json').version")
COMMIT_HASH=$(git rev-parse --short HEAD)
DEV_TAG="dev-${CURRENT_VERSION}-${COMMIT_HASH}"

echo -e "${YELLOW}Versión base: ${CURRENT_VERSION}${NC}"
echo -e "${YELLOW}Commit: ${COMMIT_HASH}${NC}"
echo -e "${YELLOW}Tag de desarrollo: ${DEV_TAG}${NC}"
echo ""

# Speedis
echo -e "${BLUE}Building speedis:dev...${NC}"
docker buildx build --pull \
    -f 'Dockerfile' \
    -t "mjguisado/speedis:dev" \
    -t "mjguisado/speedis:${DEV_TAG}" \
    --platform 'linux/amd64,linux/arm64' \
    --push '.'

# Mocks
echo -e "${BLUE}Building mocks:dev...${NC}"
docker buildx build --pull \
    -f 'Dockerfile.mocks' \
    -t "mjguisado/mocks:dev" \
    -t "mjguisado/mocks:${DEV_TAG}" \
    --platform 'linux/amd64,linux/arm64' \
    --push '.'

echo ""
echo -e "${GREEN}════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✓ Imágenes de desarrollo publicadas${NC}"
echo -e "${GREEN}════════════════════════════════════════════════${NC}"
echo ""
echo -e "${BLUE}Imágenes creadas:${NC}"
echo "  - mjguisado/speedis:dev"
echo "  - mjguisado/speedis:${DEV_TAG}"
echo "  - mjguisado/mocks:dev"
echo "  - mjguisado/mocks:${DEV_TAG}"
echo ""
echo -e "${YELLOW}Nota:${NC} Estas son imágenes de desarrollo."
echo "Para crear una release oficial, mergea a master y ejecuta:"
echo "  git checkout master"
echo "  git merge dev"
echo "  ./release.sh [patch|minor|major]"
echo ""

