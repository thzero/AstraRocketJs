---
title: "Primeros pasos"
sidebar_position: 5
---
## Abre la aplicación

AstraRocketJs se ejecuta en tu navegador: **no hay nada que instalar**. Abre **[https://thzero.github.io/AstraRocketJs/](https://thzero.github.io/AstraRocketJs/)** y ya está. Funciona en ordenador y en móvil; solo necesitas un navegador moderno (Chrome, Firefox, Safari, Edge).

Tras esa primera visita sigue funcionando **sin conexión**, así que puedes diseñar y simular en el campo de vuelo aunque no haya cobertura, y tu navegador te ofrecerá **instalarla** junto a tus demás aplicaciones — consulta **[Sin conexión e instalación](./offline-and-installing.md)**.

Al cargar verás una breve pantalla de inicio mientras se carga el motor de física, y después un cohete de ejemplo. La cabecera muestra una pequeña insignia **`WASM`** o **`JS`** que indica qué motor se ha cargado (WebAssembly es el rápido por defecto; JavaScript es la alternativa).

## La disposición

En un ordenador la pantalla es un **banco de trabajo de tres paneles**:

- **Izquierda — Componentes.** El árbol de componentes del cohete. Aquí añades, seleccionas y editas piezas.
- **Centro — Vista del cohete.** Tu cohete, con una barra para cambiar de vista (2D · 3D · Aero · y, tras una simulación, Vuelo · Trayectoria 3D), interruptores para los marcadores **CG / CP** y la tarjeta de **información** rápida, y —en 2D— preajustes, calibres y zoom. Una **franja de estadísticas** en la parte inferior muestra longitud, masa, CG, CP, estabilidad y más.
- **Derecha — Simulaciones.** Tus simulaciones, el botón **Simular**, la configuración de lanzamiento y los resultados.

En un **teléfono**, las mismas áreas se apilan en una sola columna con una barra de pestañas; el panel de componentes se oculta para mantener grande la vista del cohete.

La barra superior tiene el **menú de la aplicación** (Nuevo / Abrir / Guardar / Importar / Exportar / Ajustes / Acerca de) y un selector de idioma (English · Español).

## Tu primer cohete

1. **Empieza con el cohete por defecto**, o usa **Nuevo** (menú) para uno en blanco, o **Importa** un archivo `.ork` existente.
2. **Edita los componentes** en el panel izquierdo: selecciona una pieza y ajusta sus dimensiones; la vista 2D y las estadísticas de estabilidad se actualizan en vivo. Consulta [Diseñar un cohete](./designing-a-rocket.md).
3. **Elige un motor** en el panel derecho. Consulta [Motores](./motors.md).
4. **Define las condiciones de lanzamiento** y pulsa **Simular vuelo**. Consulta [Ejecutar una simulación](./running-a-simulation.md).
5. **Explora los resultados** — el apogeo y las demás fichas, además de las vistas de Vuelo y Trayectoria 3D. Consulta [Vistas y análisis](./views-and-analysis.md).
6. Tu cohete **se guarda solo mientras trabajas**, y menú → **Abrir…** cambia entre cohetes guardados. Para conservar una copia en tu disco o abrirlo en OpenRocket de escritorio, usa menú → **Exportar → OpenRocket**. Consulta [Archivos y exportaciones](./files-and-exports.md).

## Dónde viven tus datos

Tus cohetes se guardan **en este navegador, en este dispositivo**, junto con tus motores y materiales personalizados y tus [ajustes](./settings.md). Exporta un `.ork` para conservar una copia en tu disco, llevarla a otro equipo o compartirla. No se sube nada a ningún sitio.
