---
title: "Guía del desarrollador"
sidebar_position: 15
---
AstraRocketJs es un monorepo: una **aplicación web** (`web/`) y el **motor de OpenRocket** (`engine-java/`) compilado a WebAssembly y JavaScript por TeaVM. Esta página explica cómo compilarlo, ejecutarlo y enviar un cambio.

- **[Arquitectura e interioridades](./architecture.md)** — cómo encaja todo: el motor extraído, la canalización de compilación WASM/JS y la selección de motor, los hilos (el Web Worker de simulación) y los flujos de datos de motores, materiales, componentes y `.ork`.
- **[Contribuir](./contributing.md)** — informar de fallos, sugerir funciones, las tareas de mantenimiento, traducir y la documentación.
- **[Dependencias](./dependencies.md)** — la política de versiones de npm y por qué un paquete se mantiene deliberadamente por debajo de su última versión (léelo antes de «arreglar» nada de lo que señale `npm outdated`).

## Estructura del proyecto {#project-layout}

Es un monorepo con dos mitades:

- **`web/`** — la aplicación: **Vite + React + TypeScript + Tailwind CSS**. Aquí ocurre la gran mayoría de las contribuciones (interfaz, vistas 2D/3D, importación y exportación de `.ork`, editor, configuración de simulación).
- **`engine-java/`** — el `core` de física de OpenRocket, extraído y compilado por **TeaVM** a **WebAssembly + JavaScript**. La aplicación carga la compilación versionada (WASM por defecto, JS como alternativa) mediante el envoltorio tipado `web/src/engine/openRocketEngine.ts`.

Para la arquitectura completa —canalización de compilación del motor, selección de motor WASM/JS, hilos (el Web Worker de simulación) y los flujos de datos de motores, materiales y `.ork`— consulta la página de **[Arquitectura e interioridades](./architecture.md)**.

## Primeros pasos {#getting-started}

**Requisitos**

- **Node 22+** (npm viene con Node) — para la aplicación web y las herramientas de catálogo.
- **Solo si recompilas el motor:** un **JDK** (Temurin **21** funciona bien; el motor apunta a Java 17). No necesitas instalar Gradle: viene incluido mediante el envoltorio (`engine-java/gradlew`). La mayoría de quienes contribuyen nunca lo necesitan; el motor compilado está versionado.

**Instalación** — solo `web/` tiene dependencias de npm. `engine-java/` **no** tiene `npm install` (usa el envoltorio de Gradle incluido y scripts de Node puros):

```bash
cd web
npm install
```

**Ejecutar la aplicación** (desde `web/`):

```bash
npm run dev          # servidor de desarrollo con recarga en caliente — imprime una URL local
npm run build        # comprobación de tipos (tsc) + compilación de producción — debe pasar antes de un PR
npm run preview      # sirve la compilación de producción en local
npm run test         # Vitest: pruebas unitarias (.test.ts) y de componentes (.test.tsx)
npm run test:watch   # Vitest en modo observación mientras desarrollas
npm run e2e          # pruebas de humo de extremo a extremo con Playwright (descarga Chromium la primera vez)
npm run verify       # todas las comprobaciones que CI ejecuta sobre la app web: formato, ortografía, tipos, lint, knip, pruebas
```

Por favor, **verifica los cambios de interfaz en un navegador real**, no solo que compilen.

Unas cuantas normas de la casa que mantienen la coherencia del código:

- **Todo el texto visible para la persona usuaria pasa por i18n.** Añade claves a `web/src/i18n/locales/en.json` **y** a `es.json`; nunca escribas cadenas fijas en los componentes. Consulta [Traducción](./contributing.md#translation).
- **Nunca fijes a mano el nombre de la aplicación, la versión ni la URL de ayuda o documentación.** Vienen de `web/src/services/appInfo.ts`: el nombre de i18n, la versión de `package.json` y `HELP_URL` de la clave `wiki.url` de `package.json` (sustituible en tiempo de compilación con `HELP_URL=…`).
- **Imita el código que lo rodea**: su nomenclatura, su densidad de comentarios y su estilo.

## Trabajar en el motor {#working-on-the-engine}

La mayoría de las contribuciones no tocan el motor. Si la tuya lo hace:

- **No edites directamente las fuentes extraídas de OpenRocket bajo `engine-java/src/java/`**: siguen la rama **unstable** de OpenRocket. Los retoques necesarios pasan por una modificación documentada en `engine-java/patches/` (consulta también `engine-java/ATTRIBUTION.md`).
- El pegamento propio de ARJ —la fachada `@JSExport`, el constructor del árbol de componentes, las sobrescrituras, etc.— vive en `engine-java/src/api/`. Eso sí es terreno libre.
- Cambiar el motor requiere un **JDK** (consulta **Requisitos** más arriba) y recompilar **ambos** destinos (WASM-GC es el motor por defecto, JS la alternativa):

  ```bash
  cd engine-java
  node build-engine.mjs           # compila y copia AMBOS destinos (opción predeterminada)
  ```

- **Sube el cambio de Java y _ambos_ artefactos regenerados (`.mjs` + `.wasm`) juntos**: deben mantenerse sincronizados, o la aplicación ejecutará física obsoleta (y los dos motores deben coincidir).

## Herramientas de catálogo {#catalog-tools}

Los catálogos de referencia —motores y componentes— son **artefactos de compilación** bajo `web/public/data/`, regenerados por scripts en `web/scripts/` y versionados. La aplicación los descarga en tiempo de ejecución en lugar de incluirlos en el paquete, así que una actualización puede publicarse sin recompilar (consulta **Publicación de catálogos** más abajo). Ejecútalos desde `web/` (solo necesitan Node):

```bash
cd web
npm run sync:motors                  # barre thrustcurve.org → public/data/motors.generated.json (~800 motores)
npm run sync:components              # analiza la BD de OpenRocket-Components → public/data/components.generated.json (~2.900 piezas)
#   sync:components lee OPENROCKET_PRESETS (o --src <ruta-a>/openrocket-database/orc) si la BD no está en la ruta local por defecto
npm run sync:materials               # los materiales de OpenRocket y los nuestros → public/data/materials.generated.json (97 materiales)
#   lee el propio .openrocket-src del extractor, o --src <copia de openrocket>. Los materiales PROPIOS de la
#   aplicación (adhesivos y correcciones de valores erróneos) están en scripts/data/materials.app.json, se
#   mantienen a mano; esto los fusiona pero nunca escribe en ese archivo. Cada fila guarda un `kind` que dice
#   de qué fuente vino, y `extract --check` mantiene las filas de OpenRocket iguales a las suyas.
npm run sync:examples                # cohetes de ejemplo de OpenRocket → public/examples/ (16 diseños, ~330 kB)
#   descarga del commit que fija engine-java/extract/UPSTREAM y elimina los datos de vuelo guardados de cada
#   archivo (el 96% de los bytes). Usa --src <checkout-completo-de-openrocket> para trabajar sin conexión; el
#   .openrocket-src disperso del extractor NO los tiene (se limita a core/src/main/java).
npm run sync:contributors            # personas contribuyentes de GitHub → public/data/contributors.generated.json (diálogo Acerca de)
#   los avatares se incrustan como URI de datos; define GITHUB_TOKEN para evitar el límite de 60 peticiones/hora sin autenticar
```

Los ejemplos son el único artefacto de esta lista que **no** se publica en la rama `data`: están anclados a la referencia de upstream del motor, así que cambian con una recompilación y no según un calendario, y se precachean para que un ejemplo se abra sin conexión. Vuelve a ejecutar `sync:examples` al actualizar `extract/UPSTREAM`; `exampleLibrary.test.ts` falla si la referencia del índice y la de `UPSTREAM` no coinciden.

## Publicación de catálogos {#catalog-publishing}

Los catálogos ya no viajan con un despliegue. `.github/workflows/sync-catalogs.yml` (semanal, más **Run workflow**) los regenera y envía el JSON a una rama huérfana **`data`**, que sirve jsDelivr. La aplicación compilada lee esa rama mediante `VITE_DATA_BASE` (definida en `deploy.yml`), así que **una actualización de catálogo entra en producción sin recompilar ni redesplegar la aplicación**.

La copia versionada bajo `web/public/data/` permanece en la compilación como alternativa, usada siempre que la CDN no esté accesible o antes de que exista la rama `data`: así la aplicación siempre funciona, en el peor caso con los catálogos congelados en el último despliegue. Actualiza ese suelo ejecutando los scripts de arriba y haciendo commit.

Ejecuta una sincronización en local contra la copia publicada solo si quieres tenerla al día en una compilación de desarrollo; `sync-components.mjs` reutiliza la marca de tiempo `generated` anterior cuando las piezas no han cambiado, así que una ejecución sin cambios deja el archivo (y su hash de manifiesto) intacto.

La lista de personas contribuyentes es la excepción: el despliegue de Pages vuelve a ejecutar `sync-contributors.mjs` antes de `npm run build`, así que quien acaba de integrar una contribución aparece automáticamente en el siguiente despliegue a `master`. Ese paso es de mejor esfuerzo (`continue-on-error`): si la API de GitHub no está disponible, la compilación recurre al JSON versionado, que es la razón por la que el archivo permanece en el repositorio. Ejecuta `npm run sync:contributors` en local solo si quieres la lista al día en una compilación de desarrollo.

## Etiqueta de commits {#commit-etiquette}

- Usa **commits atómicos**: un cambio lógico por commit. ¿Arreglas un fallo _y_ detectas una errata en otro sitio? Dos commits.
- Dales **nombres útiles**. Si hay una incidencia, ponla de prefijo: `[#123] Fix stability when fins are swept aft`. El `#123` enlaza automáticamente con la incidencia.
- Un asunto breve más un cuerpo que explique el _porqué y el cómo_ es lo ideal.

## Pull requests {#pull-requests}

Abre un PR desde tu rama hacia **`master`**. En la descripción:

1. Qué incidencia aborda, por ejemplo «Soluciona #123, donde …».
2. La causa de fondo.
3. Cómo lo has arreglado.

Asegúrate de que `npm run build` y `npm run test` pasan, y de que has comprobado el cambio en el navegador. Añade o actualiza pruebas para cualquier lógica que toques bajo `web/src/services` o `web/src/engine`. Mantén las regeneraciones de `.mjs`/`.wasm` del motor en el mismo PR que sus cambios de Java.

Lo que CI comprueba en el propio PR:

| Flujo de trabajo | Ejecuta                                                                           | Cuándo                   |
| ---------------- | --------------------------------------------------------------------------------- | ------------------------ |
| `parity`         | `npm run parity` y luego una recompilación comparada con los binarios versionados | primero                  |
| `reproducible`   | `npm run extract:check` contra el OpenRocket fijado                               | primero                  |
| `build-and-test` | `npm run verify` con cobertura, luego `vite build`                                | en paralelo con `parity` |
| `e2e`            | Playwright, repartido en tres fragmentos                                          | en paralelo con `parity` |

El sitio Docusaurus **no** se compila en un PR. Se comprueban sus tipos y se compila en `deploy.yml` al fusionar en `master`, así que una página MDX rota o un `sidebars.ts` roto aparecen como un despliegue fallido y no como una comprobación de PR fallida.

Esos cuatro trabajos viven en `.github/workflows/gates.yml`, un flujo de trabajo reutilizable. `ci.yml` lo invoca en un PR y `deploy.yml` invoca el mismo archivo al fusionar en `master`, así que master se somete exactamente a lo mismo que el PR y solo hay una definición que mantener. Añade una comprobación a `gates.yml` y ambos la reciben.

Al fusionar, `deploy.yml` ejecuta esas comprobaciones y solo entonces revisa los tipos y compila la documentación, compila la aplicación y publica en Pages. No se publica nada si alguna comprobación falla.

## Qué tipo de prueba {#which-kind-of-test}

|                                                         | Para                                                                                                             | Ejemplo                               |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| **`.test.ts`** (Vitest, node)                           | Lógica pura: analizadores, transformaciones, conversiones, almacenes. La mayoría son de este tipo.               | `prefs/units.test.ts`                 |
| **`.test.tsx`** (Vitest + React Testing Library, jsdom) | Una regla que vive en un componente y no tiene un servicio donde probarse.                                       | `components/common/UnitChip.test.tsx` |
| **`e2e/*.spec.ts`** (Playwright)                        | Recorridos completos, y todo lo que necesite el motor real, el diseño en pantalla o persistencia entre recargas. | `e2e/units.spec.ts`                   |

Las pruebas de componentes se renderizan con `src/testing/renderWithProviders.tsx`, que envuelve el componente en los proveedores de la aplicación e inicializa las traducciones reales: así las comprobaciones usan los textos que ve una persona usuaria, y una clave i18n renombrada hace fallar una prueba en vez de mostrar la clave en crudo. Prepara las preferencias con `seedSettings({ … })` antes de renderizar y lee lo que el componente escribió con `readSettings()`.

**Prefiere una `.test.ts`.** Si la lógica es difícil de alcanzar sin renderizar, suele ser señal de que debería mudarse a su propio módulo, como hizo el puente de unidades de las condiciones de lanzamiento (`prefs/launchUnits.ts`), que era inalcanzable dentro de un `.tsx` y por tanto no se probaba.
