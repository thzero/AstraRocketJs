---
title: "Guía del desarrollador"
sidebar_position: 14
---
AstraRocketJs es un monorepo: una **aplicación web** (`web/`) y el **motor de OpenRocket** (`engine-java/`) compilado a WebAssembly y JavaScript por TeaVM. La documentación completa para desarrolladores está en el repositorio:

- **[Arquitectura e interioridades](./architecture.md)** — cómo encaja todo: el motor extraído, la canalización de compilación WASM/JS y la selección de motor, los hilos (el Web Worker de simulación) y los flujos de datos de motores, materiales, componentes y `.ork`.
- **[Contribuir](./contributing.md)** — requisitos, instalación, ejecutar la aplicación, recompilar el motor, las herramientas de catálogo, las pruebas, y cómo informar de fallos, traducir y enviar cambios.
- **[Dependencias](./dependencies.md)** — la política de versiones de npm y por qué un paquete se mantiene deliberadamente por debajo de su última versión (léelo antes de «arreglar» nada de lo que señale `npm outdated`).

## La versión corta {#the-short-version}

- **Requisitos** — Node 22+ para la aplicación; un JDK solo si recompilas el motor (Gradle viene incluido).
- **Ejecutar la aplicación** — `cd web && npm install && npm run dev`.
- **Recompilar el motor** (rara vez necesario; la compilación está versionada) — `cd engine-java && node build-engine.mjs` (JS) y `node build-engine.mjs --wasm` (WASM).
- **Motor** — el núcleo de OpenRocket extraído, parcheado mínimamente para TeaVM (`engine-java/`), expuesto a la aplicación mediante un envoltorio tipado (`web/src/engine/openRocketEngine.ts`).

## Atribución {#attribution}

El motor deriva de OpenRocket (GPL-3.0); las extensiones opcionales de aerodinámica supersónica (estilo RASAero) son obra original del proyecto mmrocket-sim. Los créditos completos y el linaje de licencias están en [`engine-java/ATTRIBUTION.md`](https://github.com/thzero/AstraRocketJs/blob/HEAD/engine-java/ATTRIBUTION.md).
