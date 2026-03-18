#!/bin/bash

# Script para crear releases versionadas de las imágenes Docker
# Uso: ./release.sh [major|minor|patch]
#
# IMPORTANTE: Este script debe ejecutarse SOLO desde la rama master
# después de haber mergeado y probado los cambios en dev

set -e

# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Función para mostrar uso
show_usage() {
    echo "Uso: $0 [major|minor|patch]"
    echo ""
    echo "Ejemplos:"
    echo "  $0 patch  # 1.0.0 -> 1.0.1"
    echo "  $0 minor  # 1.0.0 -> 1.1.0"
    echo "  $0 major  # 1.0.0 -> 2.0.0"
    echo ""
    echo -e "${YELLOW}IMPORTANTE:${NC}"
    echo "  - Este script debe ejecutarse SOLO desde la rama master"
    echo "  - Asegúrate de haber mergeado dev a master antes"
    echo "  - Asegúrate de haber probado todo en dev antes del merge"
    exit 1
}

# Verificar argumentos
if [ $# -ne 1 ]; then
    show_usage
fi

VERSION_TYPE=$1

if [[ ! "$VERSION_TYPE" =~ ^(major|minor|patch)$ ]]; then
    echo -e "${RED}Error: El tipo de versión debe ser 'major', 'minor' o 'patch'${NC}"
    show_usage
fi

# Verificar que estamos en la rama master
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "master" ]; then
    echo -e "${RED}Error: Debes estar en la rama 'master' para crear una release${NC}"
    echo -e "${YELLOW}Rama actual: ${CURRENT_BRANCH}${NC}"
    echo ""
    echo "Flujo recomendado:"
    echo "  1. git checkout dev"
    echo "  2. # Mergea tus ramas de feature a dev"
    echo "  3. # Prueba todo en dev"
    echo "  4. git checkout master"
    echo "  5. git merge dev"
    echo "  6. ./release.sh patch"
    exit 1
fi

# Verificar que no hay cambios sin commitear
if ! git diff-index --quiet HEAD --; then
    echo -e "${RED}Error: Tienes cambios sin commitear${NC}"
    echo "Por favor, commitea o descarta los cambios antes de crear una release"
    git status --short
    exit 1
fi

# Verificar que master está actualizado con origin
echo -e "${BLUE}Verificando estado del repositorio...${NC}"
git fetch origin master --quiet

LOCAL=$(git rev-parse master)
REMOTE=$(git rev-parse origin/master)

if [ "$LOCAL" != "$REMOTE" ]; then
    echo -e "${YELLOW}Advertencia: Tu rama master local no está sincronizada con origin/master${NC}"
    echo -e "${YELLOW}¿Deseas continuar de todas formas? (y/n)${NC}"
    read -r CONTINUE
    if [[ ! "$CONTINUE" =~ ^[Yy]$ ]]; then
        echo "Release cancelada"
        exit 1
    fi
fi

# Obtener versión actual del package.json
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo -e "${YELLOW}Versión actual: ${CURRENT_VERSION}${NC}"

# Incrementar versión usando npm
echo -e "${YELLOW}Incrementando versión (${VERSION_TYPE})...${NC}"
npm version $VERSION_TYPE --no-git-tag-version

# Obtener nueva versión
NEW_VERSION=$(node -p "require('./package.json').version")
echo -e "${GREEN}Nueva versión: ${NEW_VERSION}${NC}"

# Solicitar release notes
echo ""
echo -e "${YELLOW}Por favor, describe los cambios de esta versión:${NC}"
echo "(Escribe tus cambios y presiona Ctrl+D cuando termines)"
echo ""

RELEASE_NOTES=$(cat)

# Actualizar CHANGELOG.md
DATE=$(date +%Y-%m-%d)
TEMP_FILE=$(mktemp)

# Crear entrada en el changelog
{
    # Copiar hasta [Unreleased]
    sed -n '1,/## \[Unreleased\]/p' CHANGELOG.md
    
    # Limpiar sección Unreleased
    echo ""
    echo "### Added"
    echo ""
    echo "### Changed"
    echo ""
    echo "### Fixed"
    echo ""
    
    # Añadir nueva versión
    echo "## [$NEW_VERSION] - $DATE"
    echo ""
    echo "$RELEASE_NOTES"
    echo ""
    
    # Copiar el resto del changelog (versiones anteriores)
    sed -n '/## \[Unreleased\]/,$ {/## \[Unreleased\]/d; /^$/d; p}' CHANGELOG.md | sed -n '/^## \[/,$ p'
} > "$TEMP_FILE"

mv "$TEMP_FILE" CHANGELOG.md

echo -e "${GREEN}CHANGELOG.md actualizado${NC}"

# Construir y publicar imágenes Docker
echo ""
echo -e "${YELLOW}Construyendo y publicando imágenes Docker...${NC}"
echo ""

# Speedis
echo -e "${YELLOW}Building speedis:${NEW_VERSION}...${NC}"
docker buildx build --pull \
    -f 'Dockerfile' \
    -t "mjguisado/speedis:${NEW_VERSION}" \
    -t "mjguisado/speedis:latest" \
    --platform 'linux/amd64' \
    --push '.'

# Mocks
echo -e "${YELLOW}Building mocks:${NEW_VERSION}...${NC}"
docker buildx build --pull \
    -f 'Dockerfile.mocks' \
    -t "mjguisado/mocks:${NEW_VERSION}" \
    -t "mjguisado/mocks:latest" \
    --platform 'linux/amd64' \
    --push '.'

# Keycloak
echo -e "${YELLOW}Building keycloak:${NEW_VERSION}...${NC}"
docker buildx build --pull \
    -f 'Dockerfile.keycloak' \
    -t "mjguisado/keycloak:${NEW_VERSION}" \
    -t "mjguisado/keycloak:latest" \
    --platform 'linux/amd64' \
    --push '.'

echo ""
echo -e "${GREEN}✓ Imágenes publicadas exitosamente${NC}"
echo ""
echo -e "${YELLOW}Imágenes creadas:${NC}"
echo "  - mjguisado/speedis:${NEW_VERSION}"
echo "  - mjguisado/speedis:latest"
echo "  - mjguisado/mocks:${NEW_VERSION}"
echo "  - mjguisado/mocks:latest"
echo "  - mjguisado/keycloak:${NEW_VERSION}"
echo "  - mjguisado/keycloak:latest"
echo ""

# Crear git tag y commit automáticamente
echo ""
echo -e "${BLUE}Creando commit y tag de release...${NC}"

git add package.json CHANGELOG.md
git commit -m "chore: release v${NEW_VERSION}

Release notes:
${RELEASE_NOTES}"

git tag -a "v${NEW_VERSION}" -m "Release v${NEW_VERSION}

${RELEASE_NOTES}"

echo -e "${GREEN}✓ Git tag v${NEW_VERSION} creado${NC}"

# Preguntar si hacer push
echo ""
echo -e "${YELLOW}¿Deseas hacer push a origin (master + tag)? (y/n)${NC}"
read -r DO_PUSH

if [[ "$DO_PUSH" =~ ^[Yy]$ ]]; then
    echo -e "${BLUE}Pushing to origin...${NC}"
    git push origin master
    git push origin "v${NEW_VERSION}"

    echo -e "${GREEN}✓ Cambios publicados en origin${NC}"

    # Preguntar si mergear de vuelta a dev
    echo ""
    echo -e "${YELLOW}¿Deseas mergear master de vuelta a dev para sincronizar versiones? (y/n)${NC}"
    read -r MERGE_TO_DEV

    if [[ "$MERGE_TO_DEV" =~ ^[Yy]$ ]]; then
        git checkout dev
        git merge master -m "chore: sync version from master (v${NEW_VERSION})"
        git push origin dev
        git checkout master

        echo -e "${GREEN}✓ Rama dev sincronizada con master${NC}"
    fi
else
    echo ""
    echo -e "${YELLOW}Para publicar los cambios manualmente ejecuta:${NC}"
    echo "  git push origin master"
    echo "  git push origin v${NEW_VERSION}"
    echo ""
    echo -e "${YELLOW}Y para sincronizar dev:${NC}"
    echo "  git checkout dev"
    echo "  git merge master"
    echo "  git push origin dev"
    echo "  git checkout master"
fi

echo ""
echo -e "${GREEN}════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✓ Release ${NEW_VERSION} completado exitosamente${NC}"
echo -e "${GREEN}════════════════════════════════════════════════${NC}"
echo ""
echo -e "${BLUE}Resumen:${NC}"
echo "  • Versión: ${NEW_VERSION}"
echo "  • Imágenes Docker publicadas con tags: ${NEW_VERSION} y latest"
echo "  • CHANGELOG.md actualizado"
echo "  • Git tag: v${NEW_VERSION}"
echo ""

