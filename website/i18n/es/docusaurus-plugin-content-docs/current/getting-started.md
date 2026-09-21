---
title: "Primeros pasos"
sidebar_position: 5
---
## Abre la aplicación

AstraRocketJs se ejecuta en tu navegador: **no hay nada que instalar**. Abre **[https://thzero.github.io/AstraRocketJs/](https://thzero.github.io/AstraRocketJs/)** y ya está. Funciona en ordenador y en móvil; solo necesitas un navegador moderno (Chrome, Firefox, Safari, Edge).

Tras esa primera visita sigue funcionando **sin conexión**, así que puedes diseñar y simular en el campo de vuelo aunque no haya cobertura, y tu navegador te ofrecerá **instalarla** junto a tus demás aplicaciones — consulta **[Sin conexión e instalación](./offline-and-installing.md)**.

Al cargar verás una breve pantalla de inicio mientras se carga el motor de física, y después un cohete de ejemplo. La cabecera muestra una pequeña insignia **`WASM`** o **`JS`** que indica qué motor se ha cargado (WebAssembly es el rápido por defecto; JavaScript es la alternativa).

## La disposición {#the-layout}

En un ordenador el banco de trabajo son tres **pestañas**, en la barra superior junto al nombre de la aplicación. Cada una organiza la ventana como su propia tarea necesita, en vez de compartir las tres una única cuadrícula fija:

- **Diseño.** El árbol de componentes a la izquierda, la vista del cohete en el centro y el editor de la pieza seleccionada a la derecha.
- **Simulaciones.** La tabla de ejecuciones a todo lo ancho, con el editor de la simulación seleccionada (motor, ignición, configuración de lanzamiento, opciones) a la derecha.
- **Resultados.** Las gráficas de vuelo, la traza en tierra y la trayectoria 3D en el centro, y los números de la ejecución a la derecha. Aparece en cuanto una simulación ha producido un resultado, y al terminar una ejecución te lleva directamente allí.

La **vista del cohete** del centro tiene una barra para cambiar de vista (2D · 3D · Aero · y, tras una simulación, Vuelo · Traza en tierra · Trayectoria 3D), interruptores para los marcadores **CG / CP** y la tarjeta de **información** rápida, y, en 2D, preajustes, calibres y zoom. Una franja de **estadísticas estáticas** en la parte inferior muestra longitud, masa, CG, CP, estabilidad y más.

### Ajustar el tamaño de los paneles {#sizing-the-panes}

Las columnas laterales las dimensionas tú. Arrastra el divisor entre una columna y la vista del cohete, o dale el foco del teclado y usa las flechas (Mayús para pasos mayores, Inicio y Fin para los extremos). Haz doble clic en un divisor para devolverlo a su sitio. Las tres columnas de la derecha comparten una misma anchura, así que ajustarla en cualquier pestaña la ajusta en todas, y ambas anchuras se recuerdan de una visita a otra.

El botón **⤢** del extremo derecho de la barra de la vista del cohete le da a la ventana entera al dibujo: las dos columnas laterales y la franja de estadísticas se apartan, lo que casi duplica el espacio disponible. Un fuselaje es de 15 a 25 veces más largo que ancho, así que ese espacio horizontal es el primero que se agota. Pulsa **Escape**, o el mismo botón, para recuperar los paneles.

En un **teléfono** las mismas áreas pasan a ser pestañas en la parte inferior, porque no hay sitio para mostrarlas una al lado de otra:

- **Cohete** — el aviso del diseño cargado y la franja de estadísticas.
- **Croquis** — la vista del cohete y su barra de herramientas (2D · 3D · Aero). Las vistas 2D y 3D se giran un cuarto de vuelta cuando sostienes el teléfono en vertical, para que el cohete recorra el lado largo de la pantalla en vez de quedar aplastado en su anchura; gira el teléfono y vuelven a su posición. Los diálogos también ocupan toda la pantalla allí.
- **Simular** — motor, configuración del lanzamiento, **Ejecutar** y el resumen de resultados.
- **Resultados** — los números de la ejecución (apogeo, salida del raíl, velocidad máxima, aterrizaje, alcance …) con las gráficas de vuelo y la trayectoria 3D debajo. Aparece en cuanto una simulación ha producido un resultado, y al terminar una ejecución te lleva directamente allí.

El panel de componentes es solo de escritorio, así que un teléfono sirve para leer y simular un diseño más que para construirlo.

La barra superior tiene **deshacer / rehacer**, un selector de idioma (English · Español) y el **menú de la aplicación**: Nuevo, Abrir… y Guardar… / Guardar como… (la biblioteca de diseños de la app), **Importar ▸ OpenRocket** y **Exportar ▸ OpenRocket / RASAero II** para los archivos `.ork` y demás en disco, **Informe de diseño**, **Panel de motores**, **Ajustes**, **Ayuda**, **Privacidad** y **Acerca de**.

## Tu primer cohete

1. **Empieza con el cohete por defecto**, o usa **Nuevo** (menú) para uno en blanco, o **Importa** un archivo `.ork` existente. También hay **[cohetes de ejemplo](#example-rockets)** incluidos, que son la forma más rápida de ver lo que puede hacer la aplicación.
2. **Edita los componentes** en el panel izquierdo: selecciona una pieza y ajusta sus dimensiones; la vista 2D y las estadísticas de estabilidad se actualizan en vivo. Consulta [Diseñar un cohete](./designing-a-rocket.md).
3. **Elige un motor** en el panel derecho. Consulta [Motores](./motors.md).
4. **Define las condiciones de lanzamiento** y pulsa **Simular vuelo**. Consulta [Ejecutar una simulación](./running-a-simulation.md).
5. **Explora los resultados** — el apogeo y las demás fichas, además de las vistas de Vuelo y Trayectoria 3D. Consulta [Vistas y análisis](./views-and-analysis.md).
6. Tu cohete **se guarda solo mientras trabajas**, y menú → **Abrir…** cambia entre cohetes guardados. Para conservar una copia en tu disco o abrirlo en OpenRocket de escritorio, usa menú → **Exportar → OpenRocket**. Consulta [Archivos y exportaciones](./files-and-exports.md).

## Cohetes de ejemplo {#example-rockets}

Menú → **Importar → Ejemplos** abre un selector con los diecisiete diseños de ejemplo que acompañan a OpenRocket de escritorio, traídos de la misma versión de OpenRocket con la que está construido el motor de esta aplicación. Entre todos cubren casi todo lo que la aplicación sabe hacer: clústeres de motores, pods y aletas auxiliares, aletas tubulares, etapas en paralelo y en serie, doble apertura, una sección de carga útil que se separa y baja con su propio paracaídas, y un par de piezas imprimibles en 3D.

La misma lista es también la segunda pestaña de menú → **Abrir…**, junto a **Mis cohetes**, para cuando estás echando un vistazo en lugar de empezar algo.

Abrir uno se comporta igual que importar un `.ork`: obtienes tu propia copia sin guardar, así que puedes desmontar un ejemplo sin tocar el original, y volver a abrirlo te da uno nuevo. Los ejemplos forman parte de la aplicación, así que funcionan sin conexión como todo lo demás.

## Dónde viven tus datos

Tus cohetes se guardan **en este navegador, en este dispositivo**, junto con tus motores y materiales personalizados y tus [ajustes](./settings.md). Exporta un `.ork` para conservar una copia en tu disco, llevarla a otro equipo o compartirla. No se sube nada a ningún sitio.
