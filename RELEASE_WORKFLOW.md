# Flujo de Trabajo de Releases

Este documento describe el flujo de trabajo para desarrollo y releases de Speedis.

## 📋 Estructura de Ramas

```
feature/nueva-funcionalidad  →  dev  →  master (releases)
feature/bug-fix              ↗      ↘
feature/otra-cosa           ↗        ↘ (tags: v1.0.0, v1.1.0, etc.)
```

### Ramas:

- **`feature/*`**: Ramas de desarrollo de nuevas funcionalidades o fixes
- **`dev`**: Rama de integración y pruebas
- **`master`**: Rama de producción (solo releases estables)

## 🔄 Flujo de Desarrollo

### 1. Desarrollo en rama de feature

```bash
# Crear rama de feature desde dev
git checkout dev
git pull origin dev
git checkout -b feature/mi-nueva-funcionalidad

# Desarrollar y commitear
git add .
git commit -m "feat: mi nueva funcionalidad"
```

### 2. Merge a dev para pruebas

```bash
# Asegurarse de que dev está actualizado
git checkout dev
git pull origin dev

# Mergear tu feature
git merge feature/mi-nueva-funcionalidad

# Publicar a dev
git push origin dev
```

### 3. Construir imágenes de desarrollo (opcional)

Si necesitas probar las imágenes Docker en dev:

```bash
# Desde la rama dev
./build-dev.sh
```

Esto creará imágenes con tags:
- `mjguisado/speedis:dev`
- `mjguisado/speedis:dev-1.0.0-abc1234` (versión + commit hash)

### 4. Probar en dev

Prueba exhaustivamente todos los cambios en la rama `dev`:
- Ejecuta tests: `npm test`
- Prueba manualmente
- Verifica que todo funciona correctamente

## 🚀 Crear una Release

### 1. Mergear dev a master

```bash
# Asegurarse de que dev está completamente probado
git checkout dev
npm test  # Verificar que todos los tests pasan

# Cambiar a master y mergear
git checkout master
git pull origin master
git merge dev
```

### 2. Ejecutar el script de release

```bash
# Para un bug fix (1.0.0 → 1.0.1)
./release.sh patch

# Para nuevas funcionalidades (1.0.0 → 1.1.0)
./release.sh minor

# Para cambios que rompen compatibilidad (1.0.0 → 2.0.0)
./release.sh major
```

### 3. Escribir Release Notes

El script te pedirá que escribas las release notes. Ejemplo:

```
### Added
- Soporte para autenticación JWE
- Tests completos para el módulo de autenticación

### Changed
- Mejorado el manejo de errores en el módulo de cache

### Fixed
- Corregido bug en la desencriptación de tokens JWE
```

Presiona `Ctrl+D` cuando termines.

### 4. El script automáticamente:

✅ Incrementa la versión en `package.json`  
✅ Actualiza `CHANGELOG.md`  
✅ Construye y publica imágenes Docker con:
   - Tag de versión específica (ej: `1.0.1`)
   - Tag `latest`  
✅ Crea commit de release  
✅ Crea git tag (ej: `v1.0.1`)  
✅ Te pregunta si hacer push  
✅ Te pregunta si sincronizar dev con master  

## 📦 Imágenes Docker Publicadas

Después de una release, tendrás:

```
mjguisado/speedis:1.0.1      # Versión específica
mjguisado/speedis:latest     # Última versión estable

mjguisado/mocks:1.0.1
mjguisado/mocks:latest

mjguisado/keycloak:1.0.1
mjguisado/keycloak:latest
```

## 🔖 Versionado Semántico

Seguimos [Semantic Versioning](https://semver.org/):

- **MAJOR** (1.0.0 → 2.0.0): Cambios que rompen compatibilidad
- **MINOR** (1.0.0 → 1.1.0): Nuevas funcionalidades compatibles
- **PATCH** (1.0.0 → 1.0.1): Bug fixes compatibles

## 📝 CHANGELOG

El archivo `CHANGELOG.md` se actualiza automáticamente con cada release.

Formato:
```markdown
## [1.0.1] - 2024-03-18

### Added
- Nueva funcionalidad X

### Changed
- Mejorado Y

### Fixed
- Corregido bug Z
```

## 🛠️ Scripts Disponibles

| Script | Uso | Descripción |
|--------|-----|-------------|
| `./build-dev.sh` | En rama `dev` | Construye imágenes de desarrollo con tag `dev` |
| `./release.sh patch` | En rama `master` | Crea release patch (bug fix) |
| `./release.sh minor` | En rama `master` | Crea release minor (nueva funcionalidad) |
| `./release.sh major` | En rama `master` | Crea release major (breaking change) |
| `./uploadImages.sh` | ⚠️ Obsoleto | Usar `build-dev.sh` o `release.sh` |

## ⚠️ Importante

- ❌ **NO** ejecutes `release.sh` desde ramas que no sean `master`
- ❌ **NO** hagas commits directamente en `master` (solo merges desde `dev`)
- ✅ **SÍ** prueba todo exhaustivamente en `dev` antes de mergear a `master`
- ✅ **SÍ** ejecuta `npm test` antes de crear una release

## 🔄 Sincronización dev ↔ master

Después de una release, es recomendable sincronizar `dev` con `master` para que ambas ramas tengan la misma versión en `package.json`:

```bash
git checkout dev
git merge master
git push origin dev
```

El script `release.sh` te ofrece hacer esto automáticamente.

