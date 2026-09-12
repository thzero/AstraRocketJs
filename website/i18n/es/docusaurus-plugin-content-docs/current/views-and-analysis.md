---
title: "Vistas y análisis"
sidebar_position: 10
---
La barra de herramientas del panel central cambia entre vistas. **2D**, **3D** y **Aero** están siempre disponibles; **Vuelo** y **Trayectoria 3D** aparecen en cuanto ejecutas una simulación.

## Esquema 2D {#2d-schematic}

Una vista lateral a escala del cohete con los marcadores de **CG** (▲) y **CP** (●) y el margen de estabilidad indicado.

- **Calibres** — herramientas de medición que se arrastran. El calibre horizontal mide la distancia entre dos líneas verticales (longitudes); el vertical mide en transversal (diámetros y envergaduras). Las líneas se **ajustan** a los bordes de los componentes.
- **Reglas** — un marco de medición alrededor del dibujo, con un **interruptor por lado** (arriba / abajo / izquierda / derecha) junto a los botones de CG/CP e Información.
- **Zoom y desplazamiento** — los botones +/− o la rueda para acercar, arrastrar para desplazar.
- **Giro** — el deslizador lateral gira el cohete sobre su eje longitudinal, para ver los juegos de aletas de canto o de frente.
- **Lateral / Posterior** — cambia entre el perfil lateral y una vista posterior (de frente); **Restablecer** recupera el encuadre por defecto.

## Interruptores de vista (2D y 3D) {#view-toggles-2d-and-3d}

Dos botones de la barra controlan lo que se superpone en las vistas **2D** y **3D**:

- **CG / CP** — muestra u oculta los marcadores de **CG / CP / estabilidad** y sus etiquetas.
- **Información** — muestra u oculta la tarjeta de vistazo rápido con **longitud · masa · CG · CP · estabilidad** en la esquina superior izquierda (el mismo resumen que la [franja de estadísticas](#reading-the-stats-strip), útil cuando la franja queda fuera de pantalla en un móvil).

## Modelo 3D {#3d-model}

Un modelo 3D interactivo del cohete: órbita a su alrededor para inspeccionar la geometría desde cualquier ángulo.

## Aerodinámica (Aero) {#aerodynamics-aero}

Resistencia y estabilidad frente al número de Mach, para analizar el comportamiento a alta velocidad:

- **Cd frente a Mach** — coeficiente de resistencia total en todo el rango de Mach.
- **Desglose de la resistencia** — contribuciones de fricción, presión y base.
- **CP frente a Mach** — cómo se desplaza el centro de presión con la velocidad.

Puedes exportar estos datos como **CSV** (consulta [Archivos y exportaciones](./files-and-exports.md)).

## Vuelo (tras una simulación) {#flight-after-a-simulation}

Un panel de **gráficas de vuelo** a lo largo del tiempo: altitud, velocidad, aceleración, Mach, empuje, masa, resistencia y estabilidad. Los eventos del vuelo (fin de combustión, apogeo, apertura, aterrizaje) están marcados. Elige qué magnitudes se muestran desde la barra de fichas, pasa el cursor para obtener una retícula sincronizada y la lectura de valores en todas las gráficas, y amplía o desplaza el eje temporal (los botones +/−, arrastrando, o con Ctrl / pellizco).

**Cohetes por etapas** — cuando un vuelo se separa en más de una etapa, aparece un **selector de etapas** sobre las gráficas. Cada etapa seleccionada se dibuja con su propia línea de color —el ascenso, descenso y aterrizaje propios de un propulsor agotado— compartiendo la escala de cada gráfica, y con la lectura al pasar el cursor y los marcadores de eventos cubriendo todas las etapas mostradas. Deselecciona una etapa para centrarte en el resto.

## Trayectoria 3D (tras una simulación) {#3d-path-after-a-simulation}

La **trayectoria del vuelo en 3D**: el recorrido del cohete por el espacio, incluida la deriva por el viento.

Un botón **⬇ Exportar** guarda la trayectoria para herramientas cartográficas —**KML** (Google Earth), **GPX** o un **CSV de puntos de paso**— con opciones sobre qué puntos y líneas incluir, y soporte para tus propias plantillas. Consulta [Archivos y exportaciones](./files-and-exports.md#exporting-the-flight-path-kml--gpx--csv).

## Leer la franja de estadísticas {#reading-the-stats-strip}

La franja inferior resume el diseño actual como una cuadrícula de fichas (se pliega con el galón de su cabecera):

- **Longitud**, **diámetro máximo** y **relación de finura** (longitud / diámetro).
- **Masa** y **CG**, cada uno mostrado **vacío / cargado** (en seco y con el motor) en una sola ficha.
- **CP** (centro de presión).
- **Peso de recuperación** — la masa de descenso (masa cargada menos el propelente que se quema). Se muestra cuando hay un motor cargado; es la masa que el paracaídas baja realmente.
- **Estabilidad** — en **calibres** (en la rampa) y como **% de la longitud**.
- **Coef. de resistencia** — el coeficiente de resistencia en planeo (sin empuje) a Mach 0,3.
- **Pendiente de fuerza normal** — CNα (por radián), la pendiente del coeficiente de fuerza normal de Barrowman a Mach 0,3.
- **Momento de inercia** en **cabeceo** y **balanceo** (cargado), en kg·m².

Una estabilidad de aproximadamente **1–2 calibres** es el rango sano habitual; la ficha de estabilidad se colorea para señalar diseños poco o demasiado estables.
