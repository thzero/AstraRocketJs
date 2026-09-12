---
title: "Diseñar un cohete"
sidebar_position: 8
---
El panel de **Componentes** (a la izquierda en escritorio) contiene el árbol de componentes de tu cohete. A medida que añades y editas piezas, la vista 2D y las **estadísticas de estabilidad** (la franja inferior) se actualizan en vivo, así que siempre ves el efecto de un cambio sobre el CG, el CP y la estabilidad.

## El árbol de componentes {#the-component-tree}

Un cohete es un árbol de componentes, de la ojiva a la cola, agrupados en etapas. Selecciona cualquier pieza (en el árbol **o** haciendo clic en ella en la vista 2D) para editar sus propiedades.

Las ramas con hijos se **pliegan** con sus galones **▾ / ▸** (o pliega y despliega todo desde la cabecera), y puedes **plegar la lista de componentes entera** —su cabecera mantiene a la vista la pieza seleccionada— para dar más espacio al editor de propiedades en un diseño alto. Al eliminar una pieza (el botón **Eliminar** de sus propiedades) se te pide confirmación.

El árbol se recorre por completo con el teclado: entra con **Tab**, después **↑ / ↓** (y **Inicio / Fin**) se mueven entre piezas, **← / →** pliegan o despliegan una rama, y **Intro / Espacio** selecciona — así un árbol largo es una sola parada de tabulación, no una por pieza.

Los componentes admitidos incluyen:

- **Componentes del cuerpo** — ojiva, tubo, transición (hombro/cola de bote).
- **Aletas** — trapezoidales, elípticas, de forma libre y aletas tubulares.
- **Estructura interior** — tubo interior (soporte del motor), anillos de centrado, mamparos, acopladores, topes de motor.
- **Recuperación** — paracaídas, cinta, cordón de choque.
- **Masa y exterior** — componente de masa, guía de lanzamiento, botón de raíl, carenados y cápsulas.

Cada pieza expone las dimensiones y opciones que el motor de física necesita (longitudes, radios, espesor, geometría de aletas, etc.). La edición está amortiguada: el modelo se reconstruye y las estadísticas se refrescan mientras escribes o arrastras.

## Etapas (cohetes de varias etapas) {#staging-multi-stage-rockets}

Un cohete puede tener más de una etapa. **+ Etapa** (en la cabecera del panel de Componentes) añade un **propulsor** debajo de la etapa inferior actual; sus piezas (cuerpo, aletas, soporte de motor, recuperación) se construyen y editan exactamente igual que las del sustentador. Selecciona un nodo de **etapa** para definir cómo abandona el conjunto:

- **Separación** — el evento que libera el propulsor: en la **ignición**, el **fin de combustión**, la **eyección**, el **apogeo**, a una **altitud** (ascendiendo o descendiendo), o **nunca**. Una etapa configurada como *nunca* permanece unida y baja con la etapa superior. Un **retardo** o una **altitud** opcionales afinan el disparo.
- **Ignición de la etapa superior** — el motor de una etapa superior se enciende con el **fin de combustión** o la **carga de eyección** del propulsor (o **nunca**); esto se define en la tarjeta del motor (consulta **[Motores](./motors.md)**).

También puedes añadir **cápsulas** (podsets) y propulsores en **paralelo** (adosados) como conjuntos. Tras un vuelo por etapas, las **[gráficas de vuelo](./views-and-analysis.md#flight-after-a-simulation)** dibujan la trayectoria propia de cada etapa.

> Los vuelos por etapas se **simulan** como ramas independientes —cada propulsor agotado vuela, despliega y aterriza por su cuenta— y la masa, el CG y la estabilidad estáticos coinciden con OpenRocket de escritorio. La *trayectoria de vuelo* por etapas todavía no está validada de principio a fin contra OpenRocket, así que trata los números de vuelo de varias etapas como preliminares.

## Deshacer / rehacer {#undo--redo}

Toda edición se puede deshacer. Usa los botones **↶ / ↷** de la barra superior, o `Ctrl/⌘+Z` para deshacer y `Ctrl+Mayús+Z` (o `Ctrl+Y`) para rehacer. Una interacción es un paso: el arrastre completo de un deslizador o un valor escrito se deshacen de una sola vez, no carácter a carácter.

Deshacer y rehacer abarcan **todo el espacio de trabajo** en una sola línea temporal: añadir, quitar, mover y editar componentes, **y** los cambios de simulación (motor, ignición, condiciones de lanzamiento, y añadir/renombrar/eliminar simulaciones). También restaura tu selección, así que vuelves a la pieza que cambió. Importar un `.ork` o empezar un diseño nuevo borra el historial (un documento nuevo no tiene nada que deshacer hacia atrás). Deshacer restaura tus *datos de entrada*; los resultados de vuelo guardados se borran, así que vuelve a simular para ver el vuelo.

## Escalar todo el cohete {#scaling-the-whole-rocket}

El botón **⤢ Escalar** (junto al nombre del cohete en el panel de Componentes) redimensiona el diseño entero con un solo factor: el flujo de trabajo de «construir este plano a mitad de tamaño» o «ampliarlo a un tubo mayor». Introduce un **factor** (con atajos de 0,5× / 2×), o escribe un **diámetro de fuselaje objetivo** y el factor se ajusta solo (los dos están enlazados, así que puedes escalar directamente al tubo con el que vas a construir). Un resumen en vivo muestra la longitud y el diámetro antes → después.

Multiplica cada longitud, diámetro, espesor de pared, planta de aleta (incluidos los puntos de forma libre), hombro, pestaña, filete, tamaño de paracaídas y cinta, longitud de cordón y posición axial. Deliberadamente **no** escala ángulos, número de aletas o instancias, densidades de materiales, coeficientes de resistencia, acabado, elección de motor ni ajustes de lanzamiento; el herraje de tamaño fijo (carenados de cámara, botones de raíl, el diámetro interior de una guía de lanzamiento) conserva su tamaño y simplemente se mueve a su nueva posición.

Las piezas macizas conservan su material, así que su masa crece con el **cubo** del factor. El tejido de recuperación no: una campana escala con su área, de modo que un diseño escalado ya no es exactamente semejante y su estabilidad se desplaza ligeramente; vuelve a comprobar el tamaño del paracaídas y que el motor siga cabiendo en su soporte. Todo el escalado queda como **un único paso de deshacer** (`Ctrl/⌘+Z`).

## Elegir piezas de un catálogo {#selecting-parts-from-a-catalog}

En lugar de introducir dimensiones a mano, usa los selectores contextuales **«Selecciona una pieza…»** para colocar **piezas reales de fabricante** (Estes / Apogee / LOC / …):

- Un selector de **ojiva** o de **tubo** rellena la geometría y el material.
- Un selector de **paracaídas** (Recuperación) rellena el diámetro y el coeficiente de resistencia.

Aplicar un preajuste solo rellena los campos del componente: puedes retocarlo después. El catálogo son datos de referencia incluidos (~2.900 piezas).

### Dimensionar un paracaídas {#sizing-a-parachute}

Al seleccionar un **paracaídas** aparece una lectura de **dimensionado del descenso** en su panel. A partir de la masa de descenso del diseño (consulta *peso de recuperación*) y la densidad del aire en el campo de vuelo, ofrece:

- la **velocidad de descenso** que produce realmente esta campana (m/s y ft/s), coloreada frente a las bandas aceptadas de **principal** (15–20 ft/s) y **piloto** (50–75 ft/s), y
- el **diámetro de campana** que necesitarías para alcanzar cada banda, con el propio coeficiente de resistencia de esta campana.

Necesita un motor cargado (para conocer la masa de descenso). Es solo una ayuda en pantalla: no se escribe nada en el diseño.

## Materiales {#materials}

Todo componente estructural tiene un **material**, que el motor de física usa (por su **densidad**) para calcular la masa y el CG:

- **Materiales incorporados** — la lista completa de OpenRocket (volumen / superficie / línea, con sus densidades).
- **Materiales personalizados** — define los tuyos (nombre + densidad); se guardan en tu navegador y se reutilizan en todos los diseños.

> Nota: la **densidad** de un material (y por tanto toda la física) se conserva en un viaje de ida y vuelta por `.ork`, pero el **nombre** de un material no predeterminado puede no sobrevivir todavía a guardar y recargar — consulta las [Preguntas frecuentes](./faq.md).

## Soporte del motor {#motor-mount}

Para volar, un cohete necesita un soporte de motor (un tubo interior, o cualquier tubo del cuerpo o interior con su casilla **Soporte de motor** marcada) con un motor asignado. La elección y configuración de motores se trata en **[Motores](./motors.md)**.

Los soportes y los motores se mantienen sincronizados automáticamente: añade un soporte y viene con un motor por defecto; elimina uno y su motor se limpia. Como un diseño no se puede simular sin él, eliminar (o desmarcar) tu **único** soporte de motor pide confirmación primero.

## Estabilidad de un vistazo {#stability-at-a-glance}

La **franja de estadísticas** inferior muestra siempre la longitud del diseño actual, su diámetro máximo, la relación de finura, la masa y el CG vacío/cargado, el CP, el peso de recuperación (masa de descenso), la estabilidad (en calibres en la rampa y como % de la longitud), el coeficiente de resistencia y la pendiente de fuerza normal a Mach 0,3, y los momentos de inercia de balanceo y cabeceo con el cohete cargado. Hay más detalle en **[Vistas y análisis](./views-and-analysis.md)**.
