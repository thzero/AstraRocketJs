---
title: "Descripción general"
sidebar_position: 1
slug: /
---
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

Para los modelos físicos subyacentes, la referencia es la [documentación de OpenRocket](https://openrocket.readthedocs.io). AstraRocketJs es un proyecto independiente y no está afiliado a OpenRocket.

## Cómo se organiza esta documentación

- **Introducción** — esta página, [Características](./features.md) y las [Preguntas frecuentes](./faq.md).
- **Primeros pasos** — [abre la aplicación y crea tu primer cohete](./getting-started.md), y los [Ajustes](./settings.md).
- **Guía de uso** — diseño, motores, las vistas, simulación y archivos/exportaciones.
- **Desarrollo** — la [Guía del desarrollador](./developer-guide.md) para compilar y contribuir.
