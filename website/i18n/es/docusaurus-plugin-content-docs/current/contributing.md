---
title: "Contribuir"
sidebar_position: 14
---

AstraRocketJs es una **interfaz web ligera sobre el motor real de OpenRocket**: la física es de OpenRocket, compilada a WebAssembly y JavaScript; la aplicación que la rodea es nuestra. La mayoría de las contribuciones están en la aplicación web. (Para ahorrar pulsaciones, abreviaremos el proyecto como **ARJ**.)

Al participar aceptas nuestro **[Código de conducta](https://github.com/thzero/AstraRocketJs/blob/HEAD/CODE_OF_CONDUCT.md)**: sé amable y constructivo.

Si quieres tomar una incidencia, **coméntala primero** («me gustaría trabajar en esto») para que dos personas no dupliquen el esfuerzo.

Compilar y ejecutar el proyecto (estructura, instalación, el motor, las herramientas de catálogo, commits, pull requests y pruebas) es la **[Guía del desarrollador](./developer-guide.md)**.

#### Contenido

- [Pruebas](#testing) — [Informar de fallos](#reporting-bugs) · [Sugerir funciones](#suggesting-new-features)
- [Tareas de mantenimiento](#maintainer-tasks)
- [Traducción](#translation)
- [Documentación](#documentation)

## Pruebas {#testing}

### Informar de fallos {#reporting-bugs}

Abre una incidencia en GitHub con un título breve y concreto (con el prefijo **[Bug]**). Incluye por favor:

- Qué **esperabas** que ocurriera y qué ocurrió **en su lugar**.
- Los **pasos** para reproducirlo.
- Tu **navegador y sistema operativo** (por ejemplo, «Chrome 120 en Windows 11») y la **versión de ARJ** (junto al título en la cabecera, o en **Menú → Acerca de**).
- Si está ligado a un diseño concreto, adjunta el **archivo `.ork`**: suele ser el camino más rápido a una solución.

Una captura o una grabación de pantalla ayudan mucho.

### Sugerir funciones nuevas {#suggesting-new-features}

Abre una incidencia con el prefijo **[Feature Request]**. Explica el comportamiento que te gustaría y por qué importa. Ten en cuenta que ARJ es intencionadamente una interfaz _centrada_, no una recreación completa de la aplicación de escritorio de OpenRocket: las funciones que encajan en ese alcance son las más fáciles de defender.

## Tareas de mantenimiento {#maintainer-tasks}

Tareas ocasionales y avanzadas: no las necesitarás para un cambio típico.

### Pruebas de validación y fidelidad {#validation--fidelity-tests}

Dos bancos de pruebas protegen el motor (ambos necesitan Node 22+; ejecútalos desde la raíz del repositorio):

```bash
# 1. Prueba de paridad — demuestra que AMBOS motores del navegador (TeaVM WASM-GC y JS)
#    devuelven números idénticos a los de la JVM de referencia. Compila una variante de
#    paridad del motor (-Pparity), ejecuta los mismos escenarios en cada uno y los compara
#    línea a línea. Ambos destinos de forma predeterminada; --js / --wasm limitan a uno.
node engine-java/test/parity/parity.mjs

# 2. Validación aerodinámica — puntúa el motor frente a anclajes de túnel de viento
#    (ARCAS / Basic Finner / HB-2).
node engine-java/validation/score.mjs               # Barrowman extendido clásico
node engine-java/validation/score.mjs --supersonic  # con el modelo aerodinámico supersónico activado
node engine-java/validation/score.mjs --strict      # sale con 1 ante cualquier fallo en un punto de control
```

Desde dentro de `engine-java/` tienen nombres más cortos: `npm run parity`, `npm run validate`, `npm run build`. Son los mismos scripts y no hay dependencias que instalar — ver `engine-java/README.md`.

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

La referencia para desarrolladores es la **[Guía del desarrollador](./developer-guide.md)** para compilar y enviar cambios, y **[Arquitectura e interioridades](./architecture.md)** para entender cómo encaja la aplicación.

Esta documentación es un **sitio Docusaurus bajo `website/`**, publicado junto a la aplicación por el despliegue de Pages. Las páginas en inglés son `website/docs/*.md`; el español vive en `website/i18n/es/docusaurus-plugin-content-docs/current/` con los mismos nombres de archivo, y cualquier página sin copia en español recurre al inglés en lugar de dar un 404.

```bash
cd website
npm install
npm start      # compila ambos idiomas y los sirve — el selector de idioma funciona
npm run dev    # solo inglés, con recarga en caliente (Docusaurus sirve un idioma cada vez)
```

Si tu cambio afecta a un comportamiento —o a la arquitectura— que quienes contribuyen o usan la aplicación deberían conocer, actualiza la página correspondiente en el mismo PR (o indícalo para que alguien del mantenimiento pueda hacerlo). La compilación falla ante un enlace o un ancla internos rotos, así que una referencia cruzada obsoleta no puede publicarse.

> Cuando traduzcas un encabezado, fíjalo al ancla en inglés: `## Vuelo (tras una simulación) {#flight-after-a-simulation}`. De lo contrario, los enlaces desde páginas que siguen en inglés se rompen.
