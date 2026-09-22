---
title: "Descripción general"
sidebar_position: 1
slug: /
---

import UpstreamPin from '@site/src/components/UpstreamPin';

## ¿Qué es AstraRocketJs?

**AstraRocketJs** es una aplicación web para diseñar cohetes de modelismo y simular sus vuelos. Es una interfaz ligera y adaptada a móviles construida sobre el **motor de física real de OpenRocket**: el mismo núcleo de simulación de confianza que usa el programa de escritorio OpenRocket, compilado para ejecutarse directamente en tu navegador.

Hay dos cosas que puedes hacer con ella:

- **Diseñar** — construye un cohete a partir de componentes (ojiva, tubos, aletas, soporte del motor, recuperación, …) y observa cómo su **centro de gravedad, centro de presión y estabilidad** se actualizan en vivo mientras editas.
- **Simular** — elige un motor, define las condiciones de lanzamiento y ejecuta una simulación de vuelo completa. Verás el apogeo, la velocidad y aceleración máximas, y todo el perfil de vuelo en gráficas y en una trayectoria 3D.

Todo se ejecuta **en tu dispositivo**. No hay servidor, no hay cuentas y no se sube nada: tus diseños `.ork` son archivos en tu propio disco.

## Su relación con OpenRocket

AstraRocketJs **no** es una recreación de la aplicación de escritorio de OpenRocket. Es una interfaz web simplificada sobre el **mismo núcleo de física**:

- La aerodinámica (Barrowman extendido), la masa y el CG, y la integración del vuelo (RK4/RK6) son el propio código de OpenRocket, compilado a WebAssembly (con JavaScript como alternativa).
- Abre y guarda archivos **`.ork`** estándar, así que los diseños viajan en ambos sentidos entre AstraRocketJs y OpenRocket de escritorio.
- Cubre deliberadamente **lo esencial** — estabilidad en vivo, vistas 2D/3D, motores, materiales, piezas y simulación de vuelo — en lugar de todas las funciones del escritorio.
- El motor se compila a partir de **un único commit fijado de OpenRocket**, no de una versión numerada: <UpstreamPin />. Ese es el build con el que comparar resultados, y una función de una versión concreta solo está aquí si está en ese commit. El diálogo **Acerca de** de la aplicación indica el mismo commit, y el anclaje vive en [`engine-java/extract/UPSTREAM`](https://github.com/thzero/AstraRocketJs/blob/master/engine-java/extract/UPSTREAM).

Para los modelos físicos subyacentes, la referencia es la [documentación de OpenRocket](https://openrocket.readthedocs.io). AstraRocketJs es un proyecto independiente y no está afiliado a OpenRocket.

## Cómo se organiza esta documentación

- **Introducción** — esta página, [Características](./features.md) y las [Preguntas frecuentes](./faq.md).
- **Primeros pasos** — [abre la aplicación y crea tu primer cohete](./getting-started.md), y los [Ajustes](./settings.md).
- **Guía de uso** — diseño, motores, las vistas, simulación, archivos/exportaciones y [Seguridad](./safety.md).
- **Desarrollo** — la [Guía del desarrollador](./developer-guide.md) para compilar y contribuir.
- **Apéndice** — mapas de funciones fechados frente a [OpenRocket](./comparison-openrocket.md), [ZenRockets](./comparison-zenrockets.md) y [mmrocket-sim](./comparison-mmrocket-sim.md), incluido lo que cada uno hace y esta aplicación no.

## Antes de volar {#before-you-fly}

Una simulación es una estimación, no una hoja de vuelo. Antes de volar cualquier cosa que hayas diseñado aquí, lee **[Seguridad](./safety.md)**: cuánto vale realmente un resultado, qué cosas el modelo no sabe (el flutter de las aletas, las cargas estructurales, el inflado del paracaídas, tu motor el día del lanzamiento) y qué medir en el cohete real antes de fiarte del margen.
