---
title: "Ajustes"
sidebar_position: 6
---
Abre **Ajustes** desde el menú de la aplicación (☰, arriba a la derecha). Los ajustes son **globales**: se aplican a todos los diseños y simulaciones, y se recuerdan en tu navegador.

## Unidades {#units}

Cada magnitud tiene su propia unidad, configurable en la pestaña **Unidades**. Los botones **Valores métricos** y **Valores imperiales** las cambian todas de una vez; debajo, cada magnitud tiene su propio desplegable:

| Magnitud | Qué abarca | Métrico | Imperial |
| --- | --- | --- | --- |
| Dimensiones de componentes | longitudes, diámetros, espesores, CG / CP, las reglas del 2D | cm | in |
| Dimensiones del motor | el diámetro y la longitud del propio motor | mm | in |
| Altitud / distancia | apogeo, alcance, altitudes de despliegue, altitud del campo | m | ft |
| Masa | masas de componentes y del cohete | g | oz |
| Velocidad | salida del raíl, velocidad máxima, despliegue y aterrizaje | m/s | ft/s |
| Velocidad del viento | viento y rachas de las condiciones de lanzamiento | m/s | mph |
| Aceleración | aceleración máxima | m/s² | ft/s² |
| Ángulo | ángulos de aletas y de la varilla, dirección del viento | ° | ° |
| Densidad (volumen) | materiales sólidos, por volumen | g/cm³ | oz/in³ |
| Densidad (tela) | material de paracaídas y cintas, por superficie | kg/m² | oz/yd² |
| Densidad (cuerda) | cordón de choque y cuerdas de suspensión, por longitud | kg/m | oz/ft |
| Temperatura | temperatura del aire en el campo | °C | °F |
| Presión | presión del aire en el campo | hPa | psi |
| Empuje / fuerza | empuje del motor | N | lbf |
| Impulso | impulso total | N·s | lbf·s |

Una instalación nueva arranca con los **valores métricos**, y eso es exactamente lo que restauran también los botones de restablecer: solo hay un conjunto métrico, así que nada puede sorprenderte con un «métrico» distinto.

Todo sigue tu elección: los campos donde escribes, el árbol de componentes, la tira de estadísticas, las reglas y los calibres del 2D, las anotaciones del 3D, las gráficas de vuelo y de resistencia, el explorador de motores y las exportaciones a PDF y CSV (que indican la unidad utilizada y pueden fijarse en métricas o imperiales por su cuenta; consulta [Archivos y exportaciones](./files-and-exports.md)).

### Cambiar la unidad de un solo campo

La unidad impresa junto a un valor también es un selector: haz clic y elige otra. Eso cambia **ese campo y nada más**: si pones la *Longitud* de una ojiva en pulgadas, su *Espesor*, el árbol de componentes, las reglas y la tira de estadísticas siguen en tu unidad por defecto. El cambio se mantiene al recargar.

Un campo que muestra algo distinto de tu valor por defecto aparece **en ámbar**, para que una medida en pulgadas entre centímetros se lea como algo que elegiste y no como un fallo. Al pasar el ratón por encima te dice cuál es tu valor por defecto.

Los selectores aparecen en **valores concretos con nombre**: los campos donde escribes, las fichas de estadísticas, las condiciones de lanzamiento o la densidad de un material. Deliberadamente no aparecen en tablas, ejes de gráficas, escalas de las reglas ni filas del árbol de componentes: ahí hay muchos valores a la vez, y siempre se muestran en tus valores por defecto.

Esta pestaña sigue siendo el único sitio que lo mueve todo a la vez. Un campo que nunca hayas tocado la sigue usando, así que cambiar aquí un valor por defecto también actualiza todos los campos que dejaste en paz.

Como una elección por campo vive en un solo campo, es fácil olvidar dónde la hiciste. Tres controles lo deshacen, del más concreto al más amplio:

| Control | Qué hace |
| --- | --- |
| **Restablecer N campos a estas unidades** (solo aparece si existe alguna) | Borra todas las elecciones por campo. Tus valores por defecto se quedan como están. |
| **Valores métricos** / **Valores imperiales** | Fija todos los valores por defecto *y* borra todas las elecciones por campo, para que un preajuste siempre surta pleno efecto. |
| **Restablecer Unidades** (abajo en el diálogo) | Vuelve a los valores métricos sin elecciones por campo: solo unidades, sin tocar tus colores, la simulación ni el resto de ajustes. |

Una elección por campo se *borra* en vez de reescribirse, así que el campo vuelve a **seguir** tus valores por defecto: si cambias uno más adelante, el campo lo sigue.

### Dónde viven tus elecciones de unidades

Las unidades pertenecen **al navegador donde las configuras**, no a un diseño ni a un archivo. En la práctica:

- Se aplican a todos los diseños que abras aquí y se mantienen hasta que las cambies.
- **No** viajan dentro de un `.ork`. Si abres uno de tus archivos en OpenRocket de escritorio, lo verás en las unidades *de OpenRocket*, definidas en sus propias preferencias; y un archivo de OpenRocket se abre aquí en las tuyas. El cohete es idéntico en ambos casos: solo cambia la presentación.
- **No** te siguen a otro ordenador, a otro navegador ni a una ventana privada, y borrar los datos del sitio en tu navegador las restablece junto con el resto de los ajustes.

### Sombreado de las tablas aerodinámicas

**Colores ▸ Sombreado de las tablas aerodinámicas** elige cómo tiñen sus celdas las tablas por componente de [Aero](./views-and-analysis.md). *Por magnitud* es un solo color que se intensifica con el valor, escalado respecto al mayor de la tabla. *Por calor* reproduce exactamente el verde-rojo de OpenRocket de escritorio: su fórmula, su escala fija de 0 a 1,5 Cd y texto oscuro sobre celdas claras. Ninguno es más correcto; elige el que leas más rápido. *Por calor* se aplica solo a la tabla de **resistencia**: su escala es absoluta de Cd, y ni el CNα ni los coeficientes de alabeo están en ella —un CNα de 15 en unas aletas se saturaría en el mismo rojo que el 2 de una ojiva y no diría nada—, así que esas tablas quedan sin sombrear con esta opción, igual que OpenRocket de escritorio solo colorea su pestaña de resistencia. El mismo conmutador está junto a la leyenda bajo la tabla, así que puedes cambiarlo sin salir de la vista.

### Lo que las unidades no cambian

Las unidades son una preferencia de **visualización y entrada**. Tu diseño se guarda siempre en SI, así que cambiar de unidades nunca modifica un cohete ni vuelve a guardar un archivo:

- Los archivos `.ork` se mantienen en metros y kilogramos, byte a byte como los escribe OpenRocket de escritorio.
- Las exportaciones con unidades propias del formato conservan las suyas: RASAero (`.CDX1`) en pulgadas y libras, y las hojas de corte DXF y las mallas 3D en milímetros.
- Las plantillas 1:1 del informe PDF y su regla impresa siguen en mm/cm: esa regla mide la **página**, así que debe coincidir con una regla real. (Por lo demás, el informe y el CSV de diseño siguen tus unidades, o pueden fijarse en métricas o imperiales desde el diálogo de exportación; consulta [Archivos y exportaciones](./files-and-exports.md).)
- Las cifras sin unidad tampoco cambian: la estabilidad en calibres o en % de la longitud, los coeficientes de resistencia, el Mach, CNα y los tiempos en segundos.
- Los diámetros de los porta-motores y del filtro de motores siguen en mm, porque 18 mm / 24 mm / 29 mm son en la práctica **nombres** de motor.

## Valores por defecto de la simulación

Estos valores inicializan cada nueva simulación (aún puedes ajustar las condiciones de lanzamiento de cada una — consulta [Ejecutar una simulación](./running-a-simulation.md)):

- **Paso de tiempo** — el tamaño de paso del integrador. Más pequeño es más preciso pero más lento.
- **Tiempo máximo** — un límite de seguridad sobre el tiempo de vuelo simulado.
- **Semilla aleatoria** — fija la aleatoriedad del viento y la turbulencia para que una simulación sea reproducible; déjala sin definir para obtener resultados variados.
- **Método de cálculo** — el modelo aerodinámico (el clásico Barrowman extendido, y las correcciones supersónicas de estilo RASAero, que son opcionales).

## Avisos de seguridad

Umbrales que colorean las fichas de resultados para que los problemas destaquen:

- **Velocidad mínima de salida de la guía** — la velocidad de salida de la varilla o el raíl por debajo de la cual el cohete puede no ir lo bastante rápido para volar recto; los resultados por debajo se marcan.
- **Aviso de velocidad de apertura** — si la recuperación se despliega por encima de esta velocidad, la ficha se marca (una apertura rápida puede dañar el paracaídas); una velocidad de apertura segura se muestra en verde.

## Restablecer

Abajo en el diálogo hay dos botones: **Restablecer ‹pestaña›** repone solo la pestaña en la que estás (así que **Restablecer Unidades** toca las unidades y nada más), y **Restablecer todo** devuelve cada ajuste de cada pestaña a su valor por defecto.
