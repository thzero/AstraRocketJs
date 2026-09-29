---
title: "Comparación con mmrocket-sim"
sidebar_position: 20
---

import AppVersion from '@site/src/components/AppVersion';
import UpstreamPin from '@site/src/components/UpstreamPin';

:::info Instantánea, y cómo leerla

Escrito el **2026-09-22**, comparando **AstraRocketJs <AppVersion />** (motor compilado a partir de OpenRocket <UpstreamPin />) con **[mmrocket-sim](https://github.com/mtnmanak/mmrocket-sim)** en v0.137 (2026-09-21), la versión revisada aquí cuando se escribió esta página. `engine-java/extract/MMROCKET-SIM` registra esa revisión y las posteriores.

Esta página es más corta que las otras dos a propósito: la documentación pública de mmrocket-sim cubre su compilación y su estructura, no su interfaz, y una tabla de funciones montada adivinando sobre la aplicación de otro es peor que no tener tabla.

:::

## Esta no es una comparación entre desconocidos

mmrocket-sim, de Mountain Man Rockets, es el pariente más cercano que tiene AstraRocketJs. Ambos son aplicaciones de navegador que ejecutan el núcleo real de OpenRocket, compilado desde Java con TeaVM, sin instalación y con soporte sin conexión. Llegaron a esa forma de manera independiente, y se solapan mucho más de lo que cualquiera de los dos se solapa con un programa de escritorio.

El tema de mmrocket-sim es la **aerodinámica supersónica al estilo RASAero**: las correcciones que necesita el modelo de Barrowman extendido de OpenRocket por encima de Mach 1,5 aproximadamente, calibradas con datos publicados de túnel de viento y de vuelo libre.

## Lo que sí se puede comparar con pruebas

| | AstraRocketJs | mmrocket-sim |
| --- | --- | --- |
| **Forma** | Aplicación de navegador, instalable, funciona sin conexión | Aplicación de navegador, instalable, funciona sin conexión (según su README) |
| **Motor** | Núcleo de OpenRocket compilado con TeaVM | Núcleo de OpenRocket compilado con TeaVM |
| **Commit de OpenRocket** | La rama **unstable** | OpenRocket 24.12, según su README |
| **Destino de compilación** | **WebAssembly (WASM-GC)** con JavaScript como alternativa; una etiqueta en la cabecera dice cuál se cargó | JavaScript, según su README |
| **Integrador de vuelo** | La compilación fijada incluye `RK4SimulationStepper` y `RK6SimulationStepper`, y ambos están en el manifiesto de extracción | RK4 con paso de tiempo adaptativo, según su README |
| **Idiomas** | Multilingüe | No se indica |

La diferencia de commit es la que tiene consecuencias prácticas: un núcleo más reciente es otro conjunto de correcciones del proyecto original, y dos aplicaciones sobre commits distintos de OpenRocket pueden discrepar legítimamente en un número sin que ninguna esté rota.
