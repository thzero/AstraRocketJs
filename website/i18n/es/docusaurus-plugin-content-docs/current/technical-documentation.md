---
title: "Documentación técnica"
sidebar_position: 3
---
AstraRocketJs ejecuta **el propio núcleo de física de OpenRocket**: la aerodinámica, la masa y el CG y la integración del vuelo son código de OpenRocket, no una reimplementación (consulta [Arquitectura e interioridades](./architecture.md)). Así que, para *cómo funciona la física*, la referencia es la documentación técnica de OpenRocket, y aquí no se repite nada de ella.

## Documentación técnica de OpenRocket {#openrocket-technical-documentation}

OpenRocket empezó como la tesis de máster de **Sampo Niskanen** en la Universidad Tecnológica de Helsinki. La tesis se amplió y actualizó después hasta convertirse en la documentación técnica de OpenRocket, que es la descripción autorizada de los modelos que usa el simulador: aerodinámica de Barrowman y Barrowman extendido, composición de la resistencia, cálculo de masa y momentos de inercia, la simulación de vuelo y sus integradores, y la recuperación.

- **[Documentación técnica de OpenRocket](https://github.com/openrocket/openrocket/releases/download/OpenRocket_technical_documentation-v13.05/OpenRocket_technical_documentation-v13.05.pdf)** (2013-05-10, PDF ~1,2 MB) — el documento actual; empieza aquí.
- **[Development of an Open Source model rocket simulation software](https://github.com/openrocket/openrocket/releases/download/Development_of_an_Open_Source_model_rocket_simulation-thesis-v20090520/Development_of_an_Open_Source_model_rocket_simulation-thesis-v20090520.pdf)** (tesis de máster, 2009-05-20, PDF ~1,3 MB) — el trabajo original del que surgió la documentación.

Ambos están enlazados desde la [página de documentación](https://openrocket.info/documentation.html) de OpenRocket.

> **Licencias.** La documentación técnica está bajo una licencia **Creative Commons Atribución-CompartirIgual**; la tesis de máster, bajo **Atribución-NoComercial-SinObraDerivada**. Son documentos de OpenRocket, no nuestros.

## Documentación de uso {#user-documentation}

- **[Guía de usuario de OpenRocket](https://openrocket.readthedocs.io)** — el manual de la aplicación de escritorio. Buena parte describe funciones de escritorio que AstraRocketJs no tiene, pero las secciones sobre diseño del cohete, estabilidad y parámetros de simulación se aplican al mismo motor subyacente.

## Recursos de cohetería {#rocketry-resources}

La **[página de recursos del wiki](https://github.com/openrocket/openrocket/wiki/Resources)** de OpenRocket reúne la literatura primaria: el informe y la tesis originales de Barrowman, extensiones del método de Barrowman, datos experimentales de cohetes y referencias relacionadas.

## Qué es propio de AstraRocketJs {#what-is-specific-to-astrarocketjs}

Dos cosas son nuestras y no de OpenRocket, y se documentan aquí:

- **[Arquitectura e interioridades](./architecture.md)** — qué partes del núcleo de OpenRocket se extrajeron, la compilación con TeaVM a WebAssembly y JavaScript, y el puñado de parches de compatibilidad aplicados al núcleo.
- **La extensión de aerodinámica supersónica** — las correcciones opcionales de estilo RASAero (consulta [Ajustes](./settings.md)) son obra original del proyecto mmrocket-sim, no forman parte de OpenRocket. Su física, los diffs de código y su validación están en [`docs/rasaero/`](https://github.com/thzero/AstraRocketJs/tree/HEAD/docs/rasaero) y en [`engine-java/ATTRIBUTION.md`](https://github.com/thzero/AstraRocketJs/blob/HEAD/engine-java/ATTRIBUTION.md).

AstraRocketJs es un proyecto independiente y no está afiliado a OpenRocket.
