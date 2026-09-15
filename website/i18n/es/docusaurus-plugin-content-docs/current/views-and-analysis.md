---
title: "Vistas y análisis"
sidebar_position: 10
---
La barra de herramientas del panel central cambia entre vistas. **2D**, **3D** y **Aero** están siempre disponibles; **Vuelo** y **Trayectoria 3D** aparecen en cuanto ejecutas una simulación.

En un teléfono las vistas de diseño viven en la pestaña **Croquis** y las de vuelo en **Resultados**, que aparece en cuanto una ejecución ha producido uno; elegir cualquiera desde la barra de herramientas te lleva a su pestaña. La barra gira junto con el dibujo, de modo que siempre queda en el lado largo de la pantalla. Consulta [Primeros pasos](./getting-started.md#the-layout).

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
- **Información** — muestra u oculta la tarjeta de vistazo rápido con **longitud · masa · CG · CP · estabilidad** en la esquina superior izquierda (el mismo resumen que la [franja de estadísticas](#reading-the-stats-strip), útil en un teléfono, donde la franja está en la otra pestaña).

## Modelo 3D {#3d-model}

Un modelo 3D interactivo del cohete: órbita a su alrededor para inspeccionar la geometría desde cualquier ángulo.

## Aerodinámica (Aero) {#aerodynamics-aero}

Resistencia y estabilidad frente al número de Mach, para analizar el comportamiento a alta velocidad:

- **Cd frente a Mach** — coeficiente de resistencia total en todo el rango de Mach. Aparece una segunda curva **con motor** solo si alguna etapa declara un diámetro de salida de tobera (una propiedad del `.ork` importado; no hay campo para ella en el editor). Es la única cifra de este panel que depende del motor —todo lo demás es geometría—, así que la barra indica para qué motor se calculó: el que tenga cargado la simulación activa.
- **Desglose de la resistencia** — contribuciones de fricción, presión y base, apiladas. Para el mismo desglose *por pieza*, consulta la pestaña **Por componente** de abajo.
- **CP frente a Mach** — cómo se desplaza el centro de presión con la velocidad.

Una fila de **condiciones de vuelo** define con qué se calcula todo el barrido:

- **AoA** — ángulo de ataque en grados. En 0 el cohete vuela recto; al subirlo, el CP se desplaza.
- **Dir. viento** — la dirección del viento alrededor del eje de alabeo. **Peor** la fija en el ángulo donde el CP de este cohete queda más adelantado, es decir, donde es *menos* estable: la pregunta de seguridad «¿es estable en cualquier orientación?». En un cohete simétrico de tres aletas el CP no depende de este ángulo y **Peor** devuelve 0; en un diseño de dos aletas o asimétrico importa mucho.
- **Vel. alabeo** — en rad/s. El *amortiguamiento* de alabeo se opone a un alabeo existente, así que esa columna es cero hasta que defines uno.

Un conmutador **Gráficas / Por componente** elige qué muestra el panel: las tres curvas o las tablas de abajo. Las tablas informan para un único Mach: en la pestaña **Gráficas** lo elige la retícula del cursor, y en **Por componente** lo hace un deslizador que solo se detiene en los Mach que el barrido calculó de verdad. Ambos comparten el mismo valor, así que al cambiar de pestaña aterrizas en el punto que estabas mirando.

**Resistencia por componente** tabula la resistencia de cada pieza para ese Mach, dividida en **presión / base / fricción**: las mismas cifras que OpenRocket de escritorio muestra en *Component Analysis ▸ Drag characteristics*. Las filas se ordenan de mayor a menor y suman el total del cohete. Las celdas se **sombrean en proporción a su valor**, de modo que las piezas que más resistencia cuestan destacan sin tener que leer todos los números, con la escala debajo de la tabla. Hay dos estilos, que se cambian con los botones junto a la leyenda (o desde **Ajustes ▸ Colores**: es una sola preferencia, así que se define desde cualquiera de los dos sitios y se conserva): *Por magnitud* (el predeterminado) es un solo color que se intensifica con el valor, escalado respecto al mayor de la tabla; *Por calor* es el verde-rojo del escritorio en su propia escala fija de 0 a 1,5 Cd, con texto oscuro sobre celdas claras, para quien lo lea más rápido por costumbre. *Por calor* sombrea solo esta tabla de resistencia: su escala es absoluta de Cd, y ni el CNα ni los coeficientes de alabeo están en ella, así que esas tablas quedan sin sombrear con esa opción (el escritorio colorea solo su pestaña de resistencia por el mismo motivo).

Una pieza que existe más de una vez —normalmente un juego de aletas— tiene además una columna **Por unidad** que indica `0,251 × 3`: la resistencia de una aleta y cuántas hay. La columna **Cd** es siempre el total de todas.

**Contribución a la estabilidad** es la tabla complementaria, y la que responde a *por qué el CP está donde está*: el **CNα** de cada pieza (su parte de la pendiente de fuerza normal del cohete) y su propio **CP**. El juego de aletas suele aportar la gran mayoría del CNα —eso es lo que mantiene el CP hacia atrás—, mientras que el cono aporta un par de unidades que tiran de él hacia delante. El CP del cohete es la media de las filas ponderada por CNα. Las piezas que no generan fuerza normal, como un tubo recto, se omiten en vez de aparecer como ceros. Cada fila lleva además la **masa** de la pieza —una unidad, todas las unidades y el CG del conjunto—, de modo que las dos mitades de una cuestión de estabilidad quedan juntas.

**Dinámica de alabeo** lista todos los juegos de aletas con sus coeficientes de **forzamiento** y **amortiguamiento** de alabeo. Ambos son cero en un cohete que ni está calado ni gira: esa es la respuesta correcta, no una tabla que falta. Da un **ángulo de calaje** a un juego de aletas y el forzamiento sube; es el único sitio de la aplicación que confirma que ese calaje hace lo que pretendías. El amortiguamiento se opone a un alabeo existente, así que necesita el control **Vel. alabeo** de arriba.

**Mach máximo** define hasta dónde llega el barrido: **M1** (el valor por defecto; la mayoría de los cohetes de afición nunca llegan a supersónico, y un barrido más amplio aplasta la parte subsónica de la curva contra el borde izquierdo) o **M2 / M3 / M5** para uno que sí lo haga.

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
