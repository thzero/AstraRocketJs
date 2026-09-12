---
title: "Contribuir"
sidebar_position: 13
---
¡Hola, y gracias por tu interés en AstraRocketJs! 😊 Tanto si quieres escribir código, cazar fallos, traducir o ayudar de cualquier otra forma, esta guía te pondrá en marcha.

AstraRocketJs es una **interfaz web ligera sobre el motor real de OpenRocket**: la física es de OpenRocket, compilada a WebAssembly y JavaScript; la aplicación que la rodea es nuestra. La mayoría de las contribuciones están en la aplicación web. (Para ahorrar pulsaciones, abreviaremos el proyecto como **ARJ**.)

Al participar aceptas nuestro **[Código de conducta](https://github.com/thzero/AstraRocketJs/blob/HEAD/CODE_OF_CONDUCT.md)**: sé amable y constructivo.

#### Contenido
- [Pruebas](#testing) — [Informar de fallos](#reporting-bugs) · [Sugerir funciones](#suggesting-new-features)
- [Desarrollo](#development) — [Estructura del proyecto](#project-layout) · [Primeros pasos](#getting-started) · [Trabajar en el motor](#working-on-the-engine) · [Herramientas de catálogo](#catalog-tools) · [Etiqueta de commits](#commit-etiquette) · [Pull requests](#pull-requests)
- [Tareas de mantenimiento](#maintainer-tasks)
- [Traducción](#translation)
- [Documentación](#documentation)

## Pruebas {#testing}

ARJ no es perfecto: necesitamos gente que encuentre y documente con claridad las asperezas. Quienes prueban descubren fallos, proponen funciones y ensayan cambios. 📝

### Informar de fallos {#reporting-bugs}

Abre una incidencia en GitHub con un título breve y concreto (con el prefijo **[Bug]**). Incluye por favor:

- Qué **esperabas** que ocurriera y qué ocurrió **en su lugar**.
- Los **pasos** para reproducirlo.
- Tu **navegador y sistema operativo** (por ejemplo, «Chrome 120 en Windows 11») y la **versión de ARJ** (junto al título en la cabecera, o en **Menú → Acerca de**).
- Si está ligado a un diseño concreto, adjunta el **archivo `.ork`**: suele ser el camino más rápido a una solución.

Una captura o una grabación de pantalla ayudan mucho.

### Sugerir funciones nuevas {#suggesting-new-features}

Abre una incidencia con el prefijo **[Feature Request]**. Explica el comportamiento que te gustaría y por qué importa. Ten en cuenta que ARJ es intencionadamente una interfaz *centrada*, no una recreación completa de la aplicación de escritorio de OpenRocket: las funciones que encajan en ese alcance son las más fáciles de defender.

## Desarrollo {#development}

Si quieres tomar una incidencia, **coméntala primero** («me gustaría trabajar en esto») para que dos personas no dupliquen el esfuerzo.

### Estructura del proyecto {#project-layout}

Es un monorepo con dos mitades:

- **`web/`** — la aplicación: **Vite + React + TypeScript + Tailwind CSS**. Aquí ocurre la gran mayoría de las contribuciones (interfaz, vistas 2D/3D, importación y exportación de `.ork`, editor, configuración de simulación).
- **`engine-java/`** — el `core` de física de OpenRocket, extraído y compilado por **TeaVM** a **WebAssembly + JavaScript**. La aplicación carga la compilación versionada (WASM por defecto, JS como alternativa) mediante el envoltorio tipado `web/src/engine/openRocketEngine.ts`.

Para la arquitectura completa —canalización de compilación del motor, selección de motor WASM/JS, hilos (el Web Worker de simulación) y los flujos de datos de motores, materiales y `.ork`— consulta la página de **[Arquitectura e interioridades](./architecture.md)** (o la [Guía del desarrollador](./developer-guide.md) para la versión corta).

### Primeros pasos {#getting-started}

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
npm run test         # pruebas unitarias con Vitest (servicios del motor: analizadores, transformaciones, almacenes)
npm run test:watch   # Vitest en modo observación mientras desarrollas
npm run e2e          # pruebas de humo de extremo a extremo con Playwright (descarga Chromium la primera vez)
```

Por favor, **verifica los cambios de interfaz en un navegador real**, no solo que compilen.

Unas cuantas normas de la casa que mantienen la coherencia del código:

- **Todo el texto visible para la persona usuaria pasa por i18n.** Añade claves a `web/src/i18n/locales/en.json` **y** a `es.json`; nunca escribas cadenas fijas en los componentes. Consulta [Traducción](#translation).
- **Nunca fijes a mano el nombre de la aplicación, la versión ni la URL de ayuda o documentación.** Vienen de `web/src/services/appInfo.ts`: el nombre de i18n, la versión de `package.json` y `HELP_URL` de la clave `wiki.url` de `package.json` (sustituible en tiempo de compilación con `HELP_URL=…`).
- **Imita el código que lo rodea**: su nomenclatura, su densidad de comentarios y su estilo.

### Trabajar en el motor {#working-on-the-engine}

La mayoría de las contribuciones no tocan el motor. Si la tuya lo hace:

- **No edites directamente las fuentes extraídas de OpenRocket bajo `engine-java/src/java/`**: son el núcleo de OpenRocket casi literal (una compilación de desarrollo posterior a la 24.12). Los retoques necesarios pasan por una modificación documentada en `engine-java/patches/` (consulta también `engine-java/ATTRIBUTION.md`).
- El pegamento propio de ARJ —la fachada `@JSExport`, el constructor del árbol de componentes, las sobrescrituras, etc.— vive en `engine-java/src/api/`. Eso sí es terreno libre.
- Cambiar el motor requiere un **JDK** (consulta **Requisitos** más arriba) y recompilar **ambos** destinos (WASM-GC es el motor por defecto, JS la alternativa):

  ```bash
  cd engine-java
  node build-engine.mjs           # JS   → web/src/engine/vendor/openrocket-engine.mjs
  node build-engine.mjs --wasm    # WASM → web/public/engine/openrocket-engine.wasm (+ runtime)
  ```

- **Sube el cambio de Java y *ambos* artefactos regenerados (`.mjs` + `.wasm`) juntos**: deben mantenerse sincronizados, o la aplicación ejecutará física obsoleta (y los dos motores deben coincidir).

### Herramientas de catálogo {#catalog-tools}

Los catálogos de referencia —motores y componentes— son **artefactos de compilación** bajo `web/public/data/`, regenerados por scripts en `web/scripts/` y versionados. La aplicación los descarga en tiempo de ejecución en lugar de incluirlos en el paquete, así que una actualización puede publicarse sin recompilar (consulta **Publicación de catálogos** más abajo). Ejecútalos desde `web/` (solo necesitan Node):

```bash
cd web
npm run sync:motors                  # barre thrustcurve.org → public/data/motors.generated.json (~800 motores)
npm run sync:components              # analiza la BD de OpenRocket-Components → public/data/components.generated.json (~2.900 piezas)
#   sync:components lee OPENROCKET_PRESETS (o --src <ruta-a>/openrocket-database/orc) si la BD no está en la ruta local por defecto
npm run sync:contributors            # personas contribuyentes de GitHub → src/data/contributors.generated.json (diálogo Acerca de)
#   los avatares se incrustan como URI de datos; define GITHUB_TOKEN para evitar el límite de 60 peticiones/hora sin autenticar
```

### Publicación de catálogos {#catalog-publishing}

Los catálogos ya no viajan con un despliegue. `.github/workflows/sync-catalogs.yml` (semanal, más **Run workflow**) los regenera y envía el JSON a una rama huérfana **`data`**, que sirve jsDelivr. La aplicación compilada lee esa rama mediante `VITE_DATA_BASE` (definida en `deploy-pages.yml`), así que **una actualización de catálogo entra en producción sin recompilar ni redesplegar la aplicación**.

La copia versionada bajo `web/public/data/` permanece en la compilación como alternativa, usada siempre que la CDN no esté accesible o antes de que exista la rama `data`: así la aplicación siempre funciona, en el peor caso con los catálogos congelados en el último despliegue. Actualiza ese suelo ejecutando los scripts de arriba y haciendo commit.

Ejecuta una sincronización en local contra la copia publicada solo si quieres tenerla al día en una compilación de desarrollo; `sync-components.mjs` reutiliza la marca de tiempo `generated` anterior cuando las piezas no han cambiado, así que una ejecución sin cambios deja el archivo (y su hash de manifiesto) intacto.

La lista de personas contribuyentes es la excepción: el despliegue de Pages vuelve a ejecutar `sync-contributors.mjs` antes de `npm run build`, así que quien acaba de integrar una contribución aparece automáticamente en el siguiente despliegue a `master`. Ese paso es de mejor esfuerzo (`continue-on-error`): si la API de GitHub no está disponible, la compilación recurre al JSON versionado, que es la razón por la que el archivo permanece en el repositorio. Ejecuta `npm run sync:contributors` en local solo si quieres la lista al día en una compilación de desarrollo.

### Etiqueta de commits {#commit-etiquette}

- Usa **commits atómicos**: un cambio lógico por commit. ¿Arreglas un fallo *y* detectas una errata en otro sitio? Dos commits.
- Dales **nombres útiles**. Si hay una incidencia, ponla de prefijo: `[#123] Fix stability when fins are swept aft`. El `#123` enlaza automáticamente con la incidencia.
- Un asunto breve más un cuerpo que explique el *porqué y el cómo* es lo ideal.

### Pull requests {#pull-requests}

Abre un PR desde tu rama hacia **`master`**. En la descripción:

1. Qué incidencia aborda, por ejemplo «Soluciona #123, donde …».
2. La causa de fondo.
3. Cómo lo has arreglado.

Asegúrate de que `npm run build` y `npm run test` pasan, y de que has comprobado el cambio en el navegador. Añade o actualiza pruebas unitarias para cualquier lógica que toques bajo `web/src/services` o `web/src/engine`. Mantén las regeneraciones de `.mjs`/`.wasm` del motor en el mismo PR que sus cambios de Java.

## Tareas de mantenimiento {#maintainer-tasks}

Tareas ocasionales y avanzadas: no las necesitarás para un cambio típico.

### Pruebas de validación y fidelidad {#validation--fidelity-tests}

Dos bancos de pruebas protegen el motor (ambos necesitan Node 22+; ejecútalos desde la raíz del repositorio):

```bash
# 1. Prueba de paridad — demuestra que el motor del navegador (TeaVM-JS) devuelve
#    números idénticos a los de la JVM de referencia. Compila una variante de paridad
#    del motor (-Pparity), ejecuta los mismos escenarios en ambos y los compara línea a línea.
node engine-java/test/parity/parity.mjs

# 2. Validación aerodinámica — puntúa el motor frente a anclajes de túnel de viento
#    (ARCAS / Basic Finner / HB-2).
node engine-java/validation/score.mjs               # Barrowman extendido clásico
node engine-java/validation/score.mjs --supersonic  # con el modelo aerodinámico supersónico activado
node engine-java/validation/score.mjs --strict      # sale con 1 ante cualquier fallo en un punto de control
```

El banco de paridad compila **solo** bajo `-Pparity`, así que el motor que se distribuye no lleva código de prueba. Ejecuta la prueba de paridad después de cualquier cambio en el motor.

### Reextracción / actualizar OpenRocket {#re-extraction--upgrading-openrocket}

Las fuentes extraídas de OpenRocket son una instantánea versionada: esto solo se toca al adoptar un OpenRocket más nuevo. `engine-java/extract/extract.mjs` regenera `src/java/` a partir de un árbol de fuentes de OpenRocket (un clon del repositorio, un árbol de fuentes simple o un `-sources.jar` extraído) y superpone los parches de `patches/`:

```bash
cd engine-java
node extract/extract.mjs --check --src /ruta/a/openrocket   # solo verificar: informa de desviaciones y archivos ausentes
node extract/extract.mjs --src /ruta/a/openrocket           # regenera src/java/
# (o define OPENROCKET_SRC en lugar de --src)
```

`--check` no escribe nada; informa de cualquier archivo del manifiesto que falte en el original (desajuste de versión) y de cualquier archivo extraído que difiera de `original (+parche)`. Al subir de versión, vuelve a comparar cada archivo de `patches/` con el nuevo original, y después reextrae y recompila.

## Traducción {#translation}

ARJ es multilingüe. Las traducciones viven en `web/src/i18n/locales/<lang>.json` (actualmente `en` y `es`, con el inglés como fuente de verdad). A medida que llegan funciones, a veces se añaden claves nuevas en inglés antes de que los demás idiomas se pongan al día; quienes traducen rellenan esos huecos.

Para añadir o actualizar una traducción:

- Copia la estructura de `en.json` y traduce los valores (mantén intactas las claves y cualquier `{{marcador}}`).
- Para añadir un **idioma nuevo**, añade su `<lang>.json` y regístralo en `web/src/i18n/index.ts`.

## Documentación {#documentation}

La referencia para desarrolladores es la página de **[Arquitectura e interioridades](./architecture.md)** (o la [Guía del desarrollador](./developer-guide.md) para la versión corta): empieza ahí para entender cómo encaja la aplicación.

Esta documentación es un **sitio Docusaurus bajo `website/`**, publicado junto a la aplicación por el despliegue de Pages. Las páginas en inglés son `website/docs/*.md`; el español vive en `website/i18n/es/docusaurus-plugin-content-docs/current/` con los mismos nombres de archivo, y cualquier página sin copia en español recurre al inglés en lugar de dar un 404.

```bash
cd website
npm install
npm start      # compila ambos idiomas y los sirve — el selector de idioma funciona
npm run dev    # solo inglés, con recarga en caliente (Docusaurus sirve un idioma cada vez)
```

Si tu cambio afecta a un comportamiento —o a la arquitectura— que quienes contribuyen o usan la aplicación deberían conocer, actualiza la página correspondiente en el mismo PR (o indícalo para que alguien del mantenimiento pueda hacerlo). La compilación falla ante un enlace o un ancla internos rotos, así que una referencia cruzada obsoleta no puede publicarse.

> Cuando traduzcas un encabezado, fíjalo al ancla en inglés: `## Vuelo (tras una simulación) {#flight-after-a-simulation}`. De lo contrario, los enlaces desde páginas que siguen en inglés se rompen.

---

*¿Se te dan bien los tutoriales, el diseño o la difusión? Adelante: se agradece la ayuda en cualquier forma. 🙃 ¿No sabes por dónde empezar? Abre una discusión o pregunta en una incidencia.*
