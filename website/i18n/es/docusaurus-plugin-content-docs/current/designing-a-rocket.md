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

### Despliegue dual

Un paracaídas o una cinta lleva una casilla **Piloto (despliegue dual)**. Márcala en el dispositivo que se abre en el apogeo y el vuelo se simula como despliegue dual: primero un piloto pequeño que baja el cohete de forma controlada y después el principal, más abajo.

No es solo una etiqueta. La simulación juzga cada apertura de forma distinta según esa casilla, y avisa si el principal sale demasiado rápido o demasiado lento, y si el piloto sale demasiado lento en el apogeo para inflarse, según los umbrales de **[Ajustes ▸ Avisos de seguridad](./settings.md#avisos-de-seguridad)**. Si no marcas ninguno, toda la etapa es despliegue simple y se juzga contra un único umbral.

### Qué cabe dentro de un componente de masa

Un componente de masa no es solo un lastre: puede contener estructura interior propia, así que una bahía de altímetro o una bandeja de carga útil se modela como la bandeja más los anillos, mamparos, electrónica y equipo de recuperación anidados dentro. Se le añaden piezas igual que a un tubo de cuerpo.

## Dimensiones obligatorias {#required-dimensions}

Algunas dimensiones definen lo que una pieza *es*. Un tubo de fuselaje sin radio no es un tubo estrecho: no es nada. Por eso esos campos están marcados, y un diseño al que le falte uno no se puede volar.

Un campo obligatorio lleva un pequeño **\*** rojo tras su etiqueta, siempre, esté relleno o no. Está ahí para que veas qué necesita una pieza *antes* de dejar algo en blanco.

Si una dimensión obligatoria vale **cero**, el campo escala el aviso: la etiqueta se enmarca en rojo y el recuadro recibe un contorno rojo. La ayuda emergente explica el motivo.

**No puedes dejar uno vacío por accidente.** Al borrar el recuadro se ve vacío mientras escribes, pero no se guarda nada: sal del campo y el valor anterior sigue ahí. (El foco nunca queda atrapado; siempre puedes salir del campo.) Escribir un **0** explícito *sí* se guarda, porque es una decisión y no un descuido, y se marca y se rechaza en lugar de volarse en silencio.

### ¿Qué dimensiones son obligatorias? {#which-dimensions-are-required}

| Componente | Obligatorio |
| --- | --- |
| Ojiva | longitud, radio, espesor |
| Tubo de fuselaje | longitud, radio, espesor |
| Transición | longitud, radio anterior, radio posterior, espesor |
| Juego de aletas trapezoidales / elípticas | número de aletas, cuerda raíz, altura, espesor |
| Juego de aletas de forma libre | número de aletas, espesor |
| Juego de aletas tubulares | número de tubos, longitud, radio del tubo, espesor |
| Tubo interior | longitud, radio, espesor |
| Acoplador, tope de motor | longitud, espesor |
| Anillo centrador | espesor |
| Mamparo | espesor |
| Guía de lanzamiento | longitud, radio |
| Botón de riel | diámetro exterior |
| Paracaídas | diámetro, coeficiente de arrastre |
| Cinta | longitud, anchura, coeficiente de arrastre |
| Componente de masa | masa |
| Conjunto de cápsulas / etapa paralela | número de instancias |

**Los radios que se ajustan a la pieza que los contiene se dejan en blanco.** Un acoplador, un tope de motor, un anillo centrador o un mamparo toman su radio exterior de la pieza en la que van montados, y un anillo centrador toma su radio interior del soporte del motor que lo atraviesa, así que dejarlos vacíos es una respuesta real y no un hueco: es lo que los archivos `.ork` llaman *auto*, y el valor se ajusta solo cuando cambias el tubo de tamaño. Si escribes un número, se usa ese. El tubo interior es la excepción: él *es* el soporte del motor, así que su tamaño es justo lo que se está declarando.

Todo lo demás puede valer cero legítimamente, y por eso no está marcado. Una **cuerda de punta** de 0 es una aleta delta; una **flecha** o un **ángulo de calado** de 0 es una aleta recta; un **hombro** o una **lengüeta** de 0 simplemente no existe; un **voladizo del motor** de 0 está enrasado; un **radio interior** de 0 en un anillo centrador es un disco macizo; una **longitud** de 0 en un componente de masa es una masa puntual; y todos los **retardos** y **desplazamientos angulares** parten de 0. Una etapa no tiene ningún campo obligatorio: sus ajustes son disparadores y retardos.


## Filetes de las aletas {#fin-fillets}

La sección **Filete** de un juego de aletas toma el radio del cordón de cola a lo largo de la raíz de la aleta y el material del que está hecho. Los dos cuentan: el volumen del filete se suma a la masa de cada aleta y su centroide tira del CG hacia atrás, igual que lo calcula OpenRocket de escritorio.

El material importa porque un filete rara vez es del mismo material que la aleta. Un cordón de 6 mm en tres aletas alrededor de un tubo de 26 mm son unos 1,1 g en cartón y 2,0 g en algo con la densidad de la resina epoxi, y el CG se desplaza un par de milímetros con ello. Si dejas el material sin elegir, el cordón se pesa como cartón (680 kg/m³), que es a lo que recurren tanto el núcleo como el escritor de `.ork`. No hay resina epoxi integrada: la lista de materiales es la propia de OpenRocket, que no la tiene, así que añade una con **＋ Añadir personalizado…** si quieres el número real.

**Los tubos como aletas no tienen filete.** Un juego de tubos como aletas es un tubo, no una aleta, así que el núcleo no tiene ningún filete que darle y la sección no aparece.

**Los adhesivos solo se ofrecen donde tienen sentido.** La lista de materiales de una pieza estructural los omite, porque nada se construye con pegamento, y la lista de un filete solo tiene adhesivos, por la razón contraria. Eso no deja fuera un cordón de algo poco común: una mezcla espesada o una masilla es un material personalizado, y **＋ Añadir personalizado…** pregunta a qué grupo pertenece, así que archivarlo en Adhesivos lo pone en la lista del filete. Y un material que una pieza ya usa sigue en su lista en cualquier caso, para que el panel siga describiendo de qué está hecha de verdad.

Los filetes se conservaron en la importación, la exportación y el escalado de `.ork` durante un tiempo antes de volar, así que un diseño importado de OpenRocket de escritorio puede ganar algo de masa la primera vez que lo abras tras este cambio.


## Aletas de forma libre {#freeform-fins}

Un juego de aletas **de forma libre** se modela punto por punto en lugar de a partir de las dimensiones de un trapecio. Selecciona una y el panel de propiedades muestra un editor de **Perfil de la aleta**.

- **Arrastra un punto ámbar** para moverlo.
- **Toca un punto azul intermedio** de una arista para insertar un punto ahí.
- **Selecciona un punto** para borrarlo o para escribir sus coordenadas exactas.

Los ejes son los de la propia aleta: **X recorre el cuerpo**, del frente de la raíz a la parte trasera, e **Y es la altura sobre la superficie del cuerpo**. La arista de la raíz cierra el perfil en Y = 0, así que das forma al borde de ataque, a la punta y al borde de salida, no a la raíz.

El perfil gobierna la pieza real y no solo el dibujo: la masa, el CG y la aerodinámica lo siguen, y [escalar todo el cohete](#scaling-the-whole-rocket) mueve los puntos con todo lo demás. Viaja de ida y vuelta en los archivos `.ork` y de RockSim.

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

- la **velocidad de descenso** que produce realmente esta campana, en [tu unidad de velocidad](./settings.md#units), coloreada frente a las bandas aceptadas de **principal** (15–20 ft/s) y **piloto** (50–75 ft/s), y
- el **diámetro de campana** que necesitarías para alcanzar cada banda, con el propio coeficiente de resistencia de esta campana.

Necesita un motor cargado (para conocer la masa de descenso). Es solo una ayuda en pantalla: no se escribe nada en el diseño.

## Materiales {#materials}

Todo componente estructural tiene un **material**, que el motor de física usa (por su **densidad**) para calcular la masa y el CG:

- **Materiales incorporados** — la lista completa de OpenRocket (volumen / superficie / línea, con sus densidades). Cada tipo tiene su propia [unidad de densidad](./settings.md#units) — el material sólido por volumen, la tela del paracaídas por superficie y la cuerda por longitud — y la densidad de un material personalizado se lee en la unidad que esté mostrándose.
- **Materiales personalizados** — define los tuyos (nombre, densidad y a qué grupo pertenece); se guardan en tu navegador y se reutilizan en todos los diseños. Un material personalizado va **dentro de ese grupo**, marcado con una ★, y no en un grupo aparte: casi siempre es una variante de algo que ya está en la lista y se lee mejor a su lado. Si le das el **mismo nombre que a uno incorporado**, lo reemplaza con tu densidad en vez de aparecer dos veces.

> Nota: el **nombre y la densidad** de un material sobreviven al viaje de ida y vuelta por `.ork`, incluso los de un material que esta aplicación tiene y OpenRocket de escritorio no. Lo que no viaja es su pertenencia a tu lista personalizada; ver las [preguntas frecuentes](./faq.md).

La lista de materiales es **la propia de OpenRocket, portada literalmente** desde su `Databases.java`: los 32 materiales de volumen, los 8 de superficie y los 42 de línea, con los mismos nombres, densidades y grupos. Eso es deliberado y no es negociable. El motor de física aplica un material por su densidad, así que un nombre o un número que esta aplicación tenga y OpenRocket de escritorio no, es un diseño que los dos programas pesan de forma distinta, que es justo la clase de divergencia que la portación existe para evitar. La lista no se escribe a mano: `web/scripts/sync-materials.mjs` los lee directamente de `Databases.java` a `web/public/data/materials.generated.json`, y `engine-java/extract/extract.mjs --check` compara las dos entrada por entrada y falla ante cualquier diferencia. Así se encontraron los veintidós materiales de línea que faltaron durante un tiempo.

Hay una excepción, y esta sección es su justificación.

### Dos cordones elásticos corregidos {#corrected-materials}

Los cordones elásticos planos de OpenRocket son 0,0018, 0,0043 y 0,008 kg/m para 2, 6 y 12 mm, y luego **0,0012 para 19 mm y 0,0016 para 25 mm**. Los dos más anchos pesan menos que el de 6 mm, por un factor de diez. Es un dígito perdido, no una medida, y hace que un cordón de choque de 3 m de elástico plano de 3/4 de pulgada marque 3,6 g en vez de unos 37.

La aplicación ofrece **Elastic cord, corrected** en ambos anchos, a 0,0123 y 0,016. mmrocket-sim encontró el error y publicó esos valores; interpolar las propias entradas de 6 y 12 mm de OpenRocket da 0,0127 y 0,0167, que es la misma respuesta.

Las entradas erróneas siguen ahí, sin tocar. Un diseño que nombre una tiene que seguir leyendo la densidad con la que se guardó, y volver a pesar el cohete de alguien en silencio es peor que un número malo que se puede ver. En un diseño nuevo, elige la corregida.

### Adhesivos {#adhesives}

**Arriba no hay ningún adhesivo.** Ni una resina epoxi, ni cola de carpintero. Eso no importaba mientras nada en la aplicación estuviera hecho de pegamento, y dejó de no importar cuando los filetes de las aletas empezaron a contar para la masa y el CG: el selector de material del filete podía ofrecer treinta y un materiales, ninguno de los cuales se usa jamás en un filete. Así que la aplicación añade un grupo **Adhesivos** propio, en `web/scripts/data/materials.app.json`, la mitad de la tabla que se mantiene a mano y que ninguna herramienta regenera. Cada densidad de abajo está leída de un documento del fabricante, citado aquí y guardado en los campos `source` y `note` de la propia entrada.

| Material | kg/m³ | Qué es la cifra | Fuente |
|---|---|---|---|
| West System 105/205 Fast | 1180 | densidad relativa curada 1,18 | [TDS](https://www.westsystem.com/app/uploads/2022/09/105_205-207-Combined.pdf) |
| West System 105/206 Slow | 1180 | curada 1,18 | [TDS](https://www.westsystem.com/app/uploads/2022/09/105_205-207-Combined.pdf) |
| West System 105/207 Clear | 1150 | curada 1,15 | [TDS](https://www.westsystem.com/app/uploads/2022/09/105_205-207-Combined.pdf) |
| West System 105/209 Extra Slow | 1160 | curada 1,16 | [TDS](https://www.westsystem.com/app/uploads/2022/09/105_205-207-Combined.pdf) |
| West System Six10 | 1180 | curada 1,18 (resina 1,17, endurecedor 1,04) | [TDS](https://www.westsystem.com/app/uploads/2022/12/Six10-Technical-Data-Sheet.pdf) |
| West System G/5 Five-Minute | 1210 | curada 1,21 | [TDS](https://eu.westsystem.com/app/uploads/2022/12/G5-Five-Minute-Epoxy-Adhesive-2024.pdf) |
| AeroPoxy PR2032/PH3660 | 1110 | curada 1,11 | [Boletín PTM&W](https://web.archive.org/web/20220626225252/https://www.ptm-w.com/aeropoxy/AEROPOXY%20Product%20Bulletins/AEROPOXY%20PR2032%20Bulletin%20w-4%20Hardeners%2024Jun08.pdf) |
| AeroPoxy ES6209 | 1090 | curada 1,09 (resina 1,10, endurecedor 0,98) | [Boletín PTM&W](https://web.archive.org/web/20240712145738/https://www.ptm-w.com/aeropoxy/AEROPOXY%20Product%20Bulletins/AEROPOXY%20ES6209%20Bulletin.pdf) |
| RocketPoxy G5000 | 1500 | «densidad relativa mezclada 1,50» | [Ficha de Glenmarc](https://www.glenmarc.com/datasheets/EPOXY/RP_G5000_DATASHEET.pdf) |
| TotalBoat High Performance | 1080 | **líquido mezclado**: resina 1,11, endurecedor ~1,00, 2:1 en volumen | [SDS](https://portal.sdsguru.com/SDS/Download/26223), [proporciones](https://www.totalboat.com/products/high-performance-epoxy-resin) |
| BSI Quik / Mid / Slow-Cure | 1060 | **líquido mezclado**: par del SDS 0,97 / 1,15, 1:1 en volumen | [SDS](https://bsi-inc.com/sds_pdf/sds_slow_cure.pdf) |
| J-B Weld Original | 1840 | **líquido mezclado**: parte A 1,78, parte B 1,902, 1:1 en volumen | [SDS parte A](https://cecas.clemson.edu/cedar/wp-content/uploads/2016/10/J-B-Weld.pdf), [SDS parte B](https://media.napaonline.com/is/content/GenuinePartsCompany/2118182pdf) |
| Cola de carpintero (PVA, seca) | 1190 | película seca; ver abajo | [TDS de Titebond III](https://ardec.ca/media/catalog/specs/tds-titebond-III-ultimate-wood-glue.pdf) |

Conviene saber cuatro cosas antes de fiarse de estas cifras con tres dígitos.

**Curado no es mezclado.** West System, AeroPoxy y RocketPoxy publican la densidad del *sólido curado*, que es exactamente lo que es un filete. El resto solo publica sus componentes líquidos, así que esas filas son los componentes mezclados en la proporción del propio fabricante. La resina epoxi encoge entre un 2 y un 3 por ciento al curar, así que un cordón curado pesa alrededor de eso más que el número de la tabla.

**La cola de carpintero es un caso aparte.** Titebond III son 9,22 lb/gal (1105 kg/m³) con un **52% de sólidos**, así que un cordón de cola pierde más o menos la mitad de su volumen al secarse y lo que queda es acetato de polivinilo a unos 1,19. La tabla lleva la cifra seca, lo que significa que debes modelar el cordón que tienes *después* de que seque, no el que echaste.

**Un filete espesado es otro material.** La sílice coloidal o la fibra molida mueven poco la resina, pero las microesferas la bajan de 1180 a unos 600-800. Si espesas, pesa un volumen conocido de tu mezcla real y añádela con **＋ Añadir personalizado…** en vez de usar la tabla.

**Algunos productos no publican nada.** ProLine 4500 es el ejemplo notable en cohetería: el fabricante no publica densidad, y los hilos de comparación de la comunidad que recogen sus demás propiedades tampoco la tienen, así que está ausente a propósito en vez de inventada. Para añadirla tú, mezcla un poco, llena una jeringa de 10 mL o un vaso marcado, pésalo y divide: gramos por mililitro por 1000 son los kg/m³ que la aplicación quiere.

**Y la diferencia importa menos de lo que parece.** Cambiar la resina sin carga más pesada de aquí por la más ligera mueve un juego de filetes de 6 mm en tres aletas bastante menos de un gramo. J-B Weld es la única fila que cambia una respuesta, y es porque lleva carga de acero.

## Soporte del motor {#motor-mount}

Para volar, un cohete necesita un soporte de motor (un tubo interior, o cualquier tubo del cuerpo o interior con su casilla **Soporte de motor** marcada) con un motor asignado. La elección y configuración de motores se trata en **[Motores](./motors.md)**.

Los soportes y los motores se mantienen sincronizados automáticamente: añade un soporte y viene con un motor por defecto; elimina uno y su motor se limpia. Como un diseño no se puede simular sin él, eliminar (o desmarcar) tu **único** soporte de motor pide confirmación primero.

## Estabilidad de un vistazo {#stability-at-a-glance}

La **franja de estadísticas** inferior muestra siempre la longitud del diseño actual, su diámetro máximo, la relación de finura, la masa y el CG vacío/cargado, el CP, el peso de recuperación (masa de descenso), la estabilidad (en calibres en la rampa y como % de la longitud), el coeficiente de resistencia y la pendiente de fuerza normal a Mach 0,3, y los momentos de inercia de balanceo y cabeceo con el cohete cargado. Hay más detalle en **[Vistas y análisis](./views-and-analysis.md)**.
