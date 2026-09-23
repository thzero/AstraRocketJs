---
title: "Archivos y exportaciones"
sidebar_position: 12
---
## Importar y exportar `.ork` {#opening-and-saving-ork}

AstraRocketJs lee y escribe archivos **`.ork` de OpenRocket** estándar, así que los diseños viajan en ambos sentidos entre esta aplicación y OpenRocket de escritorio.

- **Importar** (menú → Importar → OpenRocket) carga un `.ork` existente con total fidelidad: etapas, transiciones, acopladores, anillos, mamparos y más, no solo la disposición sencilla del editor. Un aviso señala lo que no se haya podido resolver del todo (por ejemplo, un motor desconocido). El cohete importado pasa a ser su propia entrada en tus diseños guardados. Si uno de tus cohetes guardados ya tiene ese nombre — que es lo que ocurre cuando retocas un diseño en OpenRocket y vuelves a importarlo — la aplicación pregunta si quieres **sobrescribirlo** o **conservar ambos**, y propone un nombre libre para el nuevo.
- **Ejemplos** (menú → Importar → Ejemplos) abre uno de los [cohetes de ejemplo](./getting-started.md#example-rockets) que acompañan a la aplicación. Es una importación como cualquier otra, así que lo que obtienes es tu propia copia sin guardar, incluida la pregunta anterior si ya habías abierto ese ejemplo antes.
- **Exportar** (menú → Exportar → OpenRocket) escribe el diseño actual en un archivo `.ork` de tu dispositivo.

Se ha verificado que un viaje de ida y vuelta por exportación e importación conserva la física (masa, CG, CP, estabilidad), y los archivos se vuelven a abrir en OpenRocket de escritorio.

## RockSim (`.rkt`) {#rocksim-rkt}

Los diseños de RockSim también se abren y se guardan, desde **menú → Importar → RockSim** y **menú → Exportar → RockSim**. El lector se guía por el contenido del archivo y no por su nombre, así que un `.rkt` elegido en el diálogo de OpenRocket también se abre.

Lo que sí viaja: ojivas, tubos y transiciones; tubos interiores y soportes de motor; anillos de centrado, mamparos, topes de motor y acopladores; juegos de aletas trapezoidales, elípticas y de forma libre con su inclinación, su giro y sus lengüetas pasantes; aletas tubulares; guías de lanzamiento; paracaídas y cintas; objetos de masa y cuerdas de choque; pods externos; y hasta tres etapas. Con ellos van las dimensiones, los materiales, los acabados, la colocación y la masa y el CG medidos.

Lo que no:

- **Los motores y las condiciones de lanzamiento.** RockSim los guarda con sus *simulaciones*, que son un objeto distinto del diseño, así que un cohete importado llega sin motor y uno exportado sale sin el tuyo. Elige un motor después de importar.
- **Las colas anulares (ring tails)**, que aquí no tienen equivalente.
- **Los pods desmontables**, que se importan como fijos: el diseño vuela igual, con el pod puesto todo el trayecto.
- **Los subconjuntos**, cuyo contenido se fusiona en el diseño en lugar de mantenerse como grupo.

En el otro sentido, RockSim no tiene elemento para los **botones de raíl** ni para las **etapas en paralelo**. Esas piezas se quedan fuera del archivo, y la aplicación te dice cuáles se han omitido en lugar de dejar que lo descubra quien lo abra.

> **Menú → Abrir y Guardar como trabajan sobre los diseños guardados dentro de la aplicación** (consulta [Diseños guardados](#saved-designs) más abajo); los archivos `.ork` van y vienen de tu disco mediante **Importar** y **Exportar**.

## Diseños guardados {#saved-designs}

La aplicación mantiene una biblioteca de tus cohetes en el navegador, así que puedes trabajar en varios y cambiar entre ellos sin exportar un archivo cada vez.

- **Abrir…** lista tus cohetes guardados («Mis cohetes»), el más reciente primero. Elige uno para cambiar a él; desde la misma lista puedes renombrarlos o eliminarlos.
- **Guardar como…** almacena una copia con un nombre nuevo y deja el original tal cual. No hay un **Guardar** a secas: editar guarda automáticamente cada medio segundo y la barra superior indica cuándo se guardó por última vez, así que lo único que queda por pedir es un nombre.
- **Nuevo** empieza un cohete en blanco como entrada aparte, sin tocar el que tenías abierto.

> **Los diseños guardados son por navegador y por dispositivo.** La biblioteca vive en este navegador en esta máquina: no se sincroniza, y borrar los datos del navegador la elimina (consulta [Sin conexión e instalación](./offline-and-installing.md)).
>
> **Los archivos `.ork` son la forma de sincronizar.** Exporta a una carpeta que tu sistema ya sincronice —iCloud Drive, OneDrive, Google Drive, Dropbox— y el diseño estará en tus otros equipos, respaldado y listo para compartir; impórtalo allí para continuar. Eso funciona también con OpenRocket de escritorio, porque es el mismo formato de archivo.

## Exportar a RASAero II (`.CDX1`) {#exporting-to-rasaero-ii-cdx1}

**Menú → Exportar → RASAero II (.CDX1)** escribe el diseño como un archivo `.CDX1` de RASAero II, para que puedas abrirlo en **[RASAero II](https://www.rasaero.com/)** y hacer su propio análisis aerodinámico y de vuelo.

RASAero modela únicamente la **forma aerodinámica exterior**, así que la exportación lleva el fuselaje —ojiva, tubos, transiciones y colas de bote, aletas y guías de lanzamiento— además del **peso y el CG** cargados (escritos en el bloque de simulación de RASAero). Las piezas internas sin efecto aerodinámico (anillos de centrado, mamparos, cordones de choque, topes de motor) se descartan; los paracaídas se convierten en entradas de recuperación de RASAero. Las dimensiones se convierten a las unidades de RASAero (pulgadas, libras, pies, °F).

Como RASAero no puede representar todas las formas, la exportación **se detiene con un mensaje claro** en lugar de escribir un archivo que RASAero rechazaría: por ejemplo, aletas tubulares o elípticas, una transición no cónica, más de un juego de aletas en un tubo, o una aleta de forma libre que no sea un trapecio simple. En esos casos, usa `.ork`.

## Exportar el cohete entero para impresión 3D (`.3mf`) {#exporting-the-whole-rocket-for-3d-printing-3mf}

**Menú → Exportar → Impresión 3D (.3mf)** escribe de una vez todas las piezas imprimibles del diseño. El diálogo lista lo que el diseño realmente puede imprimir, todo marcado; desmarca lo que no quieras. Los paracaídas, los cordones de choque, los componentes de masa y los botones de raíl ni siquiera aparecen, porque no tienen un cuerpo sólido que imprimir.

Dos opciones:

- **Un archivo por pieza (un .zip)** — desactivado por defecto. Desactivado obtienes un único `.3mf` con **un objeto con nombre por pieza**, que es la gracia del formato: la lista de objetos del laminador dice *Ojiva*, *Tubo*, *Anillo de centrado*, y no `part1`, `part2`, `part3`. Activado obtienes un zip con un archivo por pieza, para un flujo de trabajo que las quiera separadas.
- **Colocar cada pieza sobre la base de impresión** — activado por defecto; cada pieza se mueve para quedar centrada y apoyada en Z = 0 en lugar de donde estaba dentro del cohete.

Las piezas conservan la **orientación que tienen en el diseño**: el eje del cohete va a lo largo de X, así que los cuerpos llegan tumbados. Es deliberado: ponerlos de pie sería correcto para los tubos y equivocado para cada aleta y cada anillo, y haría que el 3MF difiriera del STL de la misma pieza. La función de apoyar o rotar de tu laminador está a un clic.

El 3MF también se ofrece por componente, junto a STL/OBJ/GLB, en el botón **⬇** del árbol.

> **Por qué 3MF y no STL.** El STL son triángulos desnudos: sin nombre, sin color, sin unidad declarada y con un solo objeto por archivo. El 3MF lleva las cuatro cosas, así que un cohete entero llega al laminador ya identificado.

## Exportar un componente como modelo 3D o archivo de corte {#exporting-a-component-as-a-3d-model-or-cut-file}

La exportación es **por componente**, no del cohete entero: en el árbol de **Componentes**, cada pieza con una forma real lleva un pequeño botón **⬇** que ofrece los formatos adecuados a *esa* pieza. Las piezas sin objeto imprimible —paracaídas, cintas, cordones de choque, componentes de masa, botones de raíl— no llevan botón.

- **Modelos 3D — STL, OBJ, GLB, 3MF.** Un **sólido estanco** único de la pieza, pensado para impresión 3D y CAD (STL/OBJ se importan en cualquier laminador o modelador; GLB además lleva color para los visores; el **3MF** lleva el nombre de la pieza, su color y la unidad, y es el que conviene elegir si tu laminador lo admite). Disponible para ojivas, transiciones, tubos, tubos interiores, guías de lanzamiento, aletas tubulares, juegos de aletas, anillos de centrado, mamparos, acopladores y topes de motor. Para obtener el cohete entero de una vez, consulta [imprimir el cohete entero en 3D](#exporting-the-whole-rocket-for-3d-printing-3mf) más arriba.
- **DXF — hoja de corte 2D.** El contorno plano de una pieza **cortada en plancha**, para cortadora láser o fresadora CNC (AutoCAD R12, en milímetros, capas CUT / REFERENCE). Disponible solo para las piezas que realmente se cortan de plancha: **aletas, anillos de centrado y mamparos**. Los contornos de aleta incluyen cualquier pestaña pasante; los discos llevan el taladro y una cruz de centrado.

Notas sobre la geometría 3D:

- Todo se escala a **milímetros** (la unidad que asumen los laminadores y el CAD) y cada pieza es un **sólido estanco y variedad cerrada**: un laminador no lo rechazará.
- Los **tubos son huecos** (con espesor de pared real), no varillas macizas; las ojivas y transiciones incluyen sus **hombros**; una ojiva, transición o mamparo es un cuerpo macizo.
- Un **juego de aletas** exporta una aleta; un **juego de aletas tubulares** exporta un tubo: imprimes o cortas tantos como tenga el diseño.
- Los nombres de archivo salen del nombre del componente (o de su tipo).

## Informe de diseño del cohete (PDF / CSV) {#rocket-design-report-pdf--csv}

**Menú → Informe de diseño del cohete** abre un diálogo de **Imprimir o exportar** para producir un informe de diseño completo, con el mismo contenido que la impresión de OpenRocket.

Marca los elementos que quieras incluir:

- **Informe de diseño** — un esquema del cohete más los números de resumen (longitud, diámetro máximo, masa y CG vacío/cargado, CP, finura, estabilidad en calibres y %, coeficiente de resistencia a Mach 0,3, pendiente de fuerza normal e inercias de cabeceo y balanceo), para el cohete entero y para cada etapa.
- **Detalle de piezas** — por etapa, cada componente con su material, dimensiones y masa.
- **Plantillas de aletas**, **de ojivas** y **de transiciones** — contornos **1:1** para cortar o calcar (las aletas incluyen cualquier pestaña pasante), con una regla en cm/pulgadas para verificar la escala de impresión. Imprime al **100 % / tamaño real** (sin ajuste de página).

Además de algunas opciones:

- **Resumen de motores** — por simulación, un resumen del vuelo (apogeo, tiempos y velocidades de salida de la varilla, máxima, de apertura y de aterrizaje) y una tabla de motores (empuje medio y máximo, tiempo de combustión, impulso total, relación empuje-peso, peso y tamaño).
- **Actualizar datos de simulación** — vuelve a ejecutar la simulación antes para que los números del vuelo estén al día (no cambia lo que ves en pantalla).
- **Mostrar por etapa** — agrupa el resumen y las piezas por etapa.

Después elige una salida:

- **Guardar como PDF** — un archivo PDF de verdad (texto vectorial, tablas y plantillas 1:1; el esquema se dibuja a escala).
- **Guardar como CSV** — el resumen del diseño como una tabla ordenada `Ámbito, Campo, Valor, Unidad` (bloques de Diseño / Cohete / por etapa, más la posición de raíz de cada juego de aletas), para una hoja de cálculo.

**Unidades** (se recuerda, junto a las demás opciones) elige en qué se escriben el PDF y el CSV: **Mis unidades por defecto** sigue a [Ajustes ▸ Unidades](./settings.md#units), o fija el documento en **Métricas** o **Imperiales** para que se lea igual sea cual sea la unidad en la que estés trabajando, útil cuando el informe es para otra persona. Ten en cuenta que «mis unidades por defecto» se refiere a los valores de esa pestaña y *no* a la unidad que hayas puesto en un campo concreto: un informe mitad en pulgadas y mitad en centímetros según dónde hayas hecho clic no le sirve a nadie. Las plantillas 1:1 y la regla impresa siguen siempre en mm/cm, porque miden la página.

El botón de **Ajustes** (que se recuerda) controla los **colores de relleno y borde de las plantillas**, el **tamaño de papel** (Carta / A4) y la **orientación** (Vertical / Horizontal).

## Exportar datos {#exporting-data}

Los **datos de vuelo y de resistencia** se pueden exportar como **CSV** para usarlos en una hoja de cálculo o en tu propio análisis. Las columnas están en [las unidades que hayas elegido](./settings.md#units) y cada encabezado indica la unidad que lleva, así que el archivo se explica solo; los números usan siempre `.` como separador decimal, sea cual sea el idioma de la aplicación:

### Elegir qué va en el CSV de vuelo

El botón **CSV** de la vista de vuelo abre un diálogo de exportación en lugar de descargar directamente:

- **Variables a exportar** — todo lo que la ejecución registró, cada una con la unidad en la que se escribirá. Una simulación registra todas las series que el motor calcula, así que este es el conjunto completo y no una selección; las series para las que la aplicación no tiene nombre aparecen con su símbolo del núcleo. **Seleccionar todo** y **No seleccionar nada** cubren los extremos, y el contador te dice dónde estás.
- **Ajustes de formato** — el separador de campos (coma, punto y coma, TAB o ESPACIO), cuántos decimales y si usar notación exponencial para las series que abarcan muchos órdenes de magnitud.
- **Comentarios** — si encabezar el archivo con el nombre de la simulación, una línea por columna describiéndola y una línea por evento del vuelo; además del carácter que marca un comentario.
- **Etapa a exportar** — en un vuelo por etapas, qué rama escribir.

Tus elecciones se recuerdan para la siguiente exportación.

- **Datos de vuelo** — el historial temporal simulado (desde la vista de Vuelo).
- **Tabla de resistencia** — los datos de Cd, desglose y CP frente a Mach (desde la vista Aero).

## Exportar la trayectoria de vuelo (KML / GPX / CSV) {#exporting-the-flight-path-kml--gpx--csv}

Tras una simulación, la vista de **Trayectoria 3D** tiene un botón **⬇ Exportar** que guarda la trayectoria del vuelo y su traza sobre el terreno para herramientas cartográficas:

- **KML** — se abre en **Google Earth**: la línea de la trayectoria, la traza sobre el terreno y puntos de paso etiquetados.
- **GPX** — una traza GPS estándar (puntos de paso + traza) para herramientas GPS y aplicaciones de mapas.
- **CSV de puntos de paso** — una fila por punto de interés (rampa, apogeo, aterrizaje, …) con latitud y longitud.

En el diálogo de exportación eliges qué **puntos de paso** incluir (rampa, despegue, fin de combustión, apogeo, apertura de la recuperación, aterrizaje, velocidad máxima, aceleración máxima), si incluir la **línea de la trayectoria** y la **traza sobre el terreno**, cuánto adelgazar la trayectoria (**conservar uno de cada N puntos**) y las **unidades de altitud y distancia**.

Los **ajustes rápidos** —*Deriva*, *Trayectoria* y *Aterrizajes*— configuran las tres cosas a la vez, porque los puntos de paso, las líneas y la colocación tienen que concordar para que un archivo responda bien a una pregunta. Solo mueven los controles, así que lo que contendrá el archivo es siempre lo que muestra el diálogo, y cualquiera de ellos es un punto de partida que puedes ajustar. Cada uno declara su selección completa, puntos de paso incluidos, de modo que ninguno es un camino sin retorno: *Aterrizajes* reduce los puntos de paso al aterrizaje, y volver a *Deriva* los restituye todos.

El que coincide con los controles aparece resaltado, y un diálogo recién abierto parte de *Trayectoria*. Como un ajuste rápido solo mueve los controles, el resaltado se borra en cuanto cambias algo que ese ajuste abarca, y vuelve cuando los controles lo declaran de nuevo: nunca afirma una forma de la que el diálogo ya se ha apartado.

**Colocación** controla cómo se sitúa la traza en el mapa:

- **Altitud de la traza desde** y **Altitud de los puntos desde** — dos elecciones separadas, porque la línea y los marcadores quieren cosas distintas. *Automático* usa el nivel del mar cuando el campo de vuelo tiene una altitud real definida, y el suelo cuando sigue en 0. Ese valor por defecto importa: un vuelo medido desde la rampa pero colocado contra el nivel del mar queda enterrado bajo el terreno, que es lo que daría un campo a 1200 m. *Pegado al suelo* apoya la traza sobre el terreno: la opción adecuada cuando lo que importa es por encima de **qué** deriva el cohete y no a qué altura llegó. Una combinación habitual es la traza al nivel del mar con los marcadores pegados al suelo: el vuelo suspendido en el aire donde le corresponde, y sus etiquetas legibles sobre el terreno que sobrevuelan.
- **Dibujar la sombra hasta el suelo** — una cortina bajo la traza y una plomada bajo cada marcador, para leer dónde se sitúa en el mapa un punto que está en el aire. Se desactiva solo cuando ambas mitades están pegadas al suelo, porque ya no hay nada desde donde dibujarla. Ningún ajuste rápido la activa: bajo un solo marcador se lee como una posición, pero bajo toda la longitud de una trayectoria en arco es un muro macizo que entierra el vuelo que pretende explicar. Actívala para aquello en lo que es buena: situar un punto concreto en el mapa.
- **Dibujar los nombres de los puntos en el mapa** — un vuelo casi vertical amontona sus puntos en unos cientos de metros de pantalla; desactiva los nombres para dejar marcadores limpios en los que puedas hacer clic.
- **Colorear los marcadores por etapa** — los marcadores de color cargan un icono desde los servidores de Google, así que desactívalos para un archivo que deba verse sin conexión.

El grupo **Trayectoria de vuelo** incluye dos controles más, que pertenecen a las propias líneas:

- **La traza de cada etapa empieza** (solo vuelos por etapas) — los datos de una etapa separada empiezan como una copia de los de toda la pila, así que por defecto su traza empieza **en la separación** y el ascenso compartido se dibuja una sola vez. Elige **en la rampa** para que cada etapa se lea como un vuelo completo. Esto también decide desde dónde se miden la *velocidad máxima* y la *aceleración máxima* de una etapa, para que un propulsor agotado informe de sus propios picos y no de los de la pila.
- **Colores por etapa…** — una muestra de color por etapa. Cada etapa parte del mismo color de paleta que le dan OpenRocket de escritorio y las [gráficas de vuelo](./views-and-analysis.md#flight-after-a-simulation), para que conserve su identidad entre la gráfica y el mapa; elige otro para sustituirlo. Un solo color rige las tres marcas de esa etapa: la línea de la trayectoria a plena intensidad, la traza sobre el terreno oscurecida (vista desde arriba, una traza sobre el terreno queda justo debajo de su trayectoria, y dos líneas del mismo brillo se leen como una sola) y los marcadores. **Restablecer** devuelve todas las etapas a la paleta, y **Cancelar** deja intacta tu elección anterior.

### Globos de resumen {#summary-balloons}

Google Earth muestra la **descripción** de un elemento en un globo al hacer clic en él, y el KML rellena tres:

- **El documento** lleva el resumen del vuelo: el cohete, la configuración de motores, las coordenadas y la elevación del campo de vuelo, la altitud, la velocidad y la aceleración máximas, el alcance máximo desde la rampa, el tiempo hasta el apogeo, la duración del vuelo y una línea por etapa con las coordenadas, la distancia, el rumbo y la hora de aterrizaje de esa etapa.
- **La carpeta de cada etapa** lleva el alcance máximo de esa etapa y su aterrizaje en una sola línea, con la misma forma que usa el resumen: primero las coordenadas, luego la distancia y el rumbo desde la rampa, y luego la hora.
- **Cada punto de paso** lleva el tiempo desde el despegue, la altitud sobre la rampa y sobre el nivel del mar en una sola línea, la posición como distancia y rumbo desde la rampa, sus propias coordenadas y, en una eyección, el dispositivo de recuperación que se desplegó.

**Todas las coordenadas se escriben `latitud, longitud`, y lo indican.** Un par sin etiqueta es ambiguo, y en un archivo KML lo es de una forma que tiene una respuesta equivocada esperando: las ternas de coordenadas del propio KML se escriben con la *longitud* primero, así que quien conoce el formato tiene un motivo real para leer el par al revés, y en un campo de vuelo real ambas lecturas son lugares plausibles. Por eso cada par lleva la etiqueta `(lat, lon)` y se escribe con seis decimales (unos 10 cm) en grados decimales con signo, que es justo lo que aceptan los campos de latitud y longitud de la aplicación: una coordenada leída en un globo se puede pegar tal cual de vuelta.

Las coordenadas de aterrizaje son las que de verdad vas a usar. Una distancia y un rumbo desde la rampa sirven para leer el mapa; el par es lo que tecleas en un GPS de mano para ir a buscar el cohete, así que toda línea de aterrizaje empieza por él:

```
Aterrizaje de Sod Blaster: 30.615051, -97.496600 (lat, lon); 50,0 m a 0° desde la rampa; T+3.0 s
```

Las cláusulas se separan con punto y coma porque la coordenada lleva su propia coma, y todos los tiempos del archivo se escriben con `T+` y un decimal, para que una magnitud tenga una sola notación.

**El alcance máximo no es la distancia de aterrizaje.** Un cohete puede derivar a favor del viento bajo el paracaídas y volver luego parte del camino, así que el punto más lejano de la rampa a menudo no es donde aterriza. El alcance es la cifra que importa para la seguridad del campo; dónde cayó es un dato aparte, y se exportan los dos. El alcance de una etapa se mide sobre todo su vuelo, incluido el ascenso que las etapas volaron unidas, porque la excursión de la pila cuenta para todas las etapas que formaban parte de ella.

Una línea que no tiene nada que decir desaparece en lugar de quedar vacía: no hay línea de configuración si el cohete no tiene una con nombre, ni altitud «sobre el nivel del mar» cuando el campo de vuelo sigue a 0 (esa altura sería en realidad la altura sobre la rampa), ni dispositivo de recuperación en un marcador que no es una eyección, ni aterrizaje alguno en una simulación que terminó con el cohete todavía en el aire.

**Globos de resumen** desactiva todo el conjunto, para un archivo en el que las descripciones solo estorben. La geometría, los nombres y los colores no se ven afectados.

Un marcador de eyección lleva el nombre del evento, matizado con el del dispositivo cuando se lo pusiste: *Drogue Eyección* y *Main Eyección*. Así se distinguen los dos en un vuelo de doble despliegue sin perder el vocabulario de eventos que usan los demás marcadores, y en un vuelo por etapas se acumula con la etapa hasta *Booster Drogue Eyección*: largo, y exactamente lo que es ese marcador. Un dispositivo que dejaste con su nombre por defecto no añade nada que no diga ya la línea **Dispositivo** del globo, así que su marcador es solo **Eyección**.

Cada línea lleva una etiqueta en negrita, para que el globo se lea como una lista de datos y no como un párrafo. Google Earth añade encima el nombre del elemento como título, y debajo un par **Cómo llegar: Hasta aquí / Desde aquí**, a partir de su propia plantilla de globo y no del archivo.

Dónde se abre un globo depende del visor. Google Earth Pro abre el globo de un punto de paso al hacer clic en el marcador en la vista 3D, pero los del documento y las carpetas solo desde sus nombres en el panel **Lugares**. Google Earth para web abre los tres desde el panel del proyecto.

### Dar nombre a la exportación {#naming-the-export}

Varias exportaciones abiertas a la vez en Google Earth son, si no, indistinguibles: cualquier diseño de dos etapas aporta una carpeta llamada *Sustentador* y una traza llamada *Sustentador trayectoria de vuelo*, y dos diseños pueden tener cada uno su *Simulación 1*. La casilla **Misión** da nombre a esta: el texto se antepone al nombre del documento, a cada carpeta y a cada traza, de modo que *Sod Blaster* te da *Sod Blaster Sustentador trayectoria de vuelo*. Un nombre que ya empieza por la misión se deja tal cual, sin repetirla.

**Anteponerlo también a los nombres de los puntos** lo extiende a los marcadores, y está desactivado por defecto: un vuelo casi vertical amontona todos sus marcadores en unos pocos píxeles de pantalla, donde las etiquetas ya se solapan lo suficiente como para tener su propio interruptor (*Dibujar los nombres de los puntos en el mapa*, arriba), y unos nombres más largos solo lo empeoran. Actívalo cuando los marcadores de dos vuelos se superpongan de verdad.

El nombre de la misión **no** se recuerda entre exportaciones: uno caducado etiquetaría mal el siguiente archivo sin avisar, que es peor que volver a escribirlo. La casilla de los marcadores sí se recuerda, porque eso es una costumbre de trabajo y no una propiedad de un vuelo concreto. Ninguno de los dos se guarda en el diseño, y los colores por etapa se eligen igualmente para cada exportación.

Las coordenadas se sitúan alrededor de la **latitud y longitud de lanzamiento** de la simulación (definidas en las condiciones de lanzamiento) y siguen la deriva del viento, proyectadas con las longitudes de grado del WGS84, de modo que una traza exportada aquí cae en el mismo punto que ese mismo vuelo exportado desde OpenRocket de escritorio.

Si ambas coordenadas siguen en cero, la posición nunca se rellenó y la exportación se ancla en el **Centro Espacial Kennedy**: el diálogo te avisa. Solo cuenta (0, 0), porque es mar abierto; un campo de vuelo sobre el meridiano de Greenwich o sobre el ecuador es un lugar real y se exporta donde lo pusiste. Tu diseño no se modifica nunca; esto solo decide qué coordenadas van al archivo.

### El idioma del archivo {#the-language-of-the-file}

La casilla **Idioma**, junto a las unidades, escribe la exportación en un idioma distinto de aquel en el que estás leyendo la aplicación. Por defecto es *El mismo que la app*.

Pertenece al archivo por la misma razón que las unidades: un KML destinado a otra persona puede querer su idioma, sea cual sea el que tú tengas puesto. La elección se recuerda entre exportaciones, y *El mismo que la app* también se recuerda: elegir español una vez y volver atrás no deja en español el archivo siguiente sin avisar.

Abarca todo lo que escribe la exportación: los nombres de los puntos de paso, los nombres de traza *trayectoria de vuelo* y *traza en el suelo*, todas las líneas de los globos y el nombre por defecto de un dispositivo de recuperación al que no cambiaste el nombre: un paracaídas que dejaste tal cual aparece en el idioma de la exportación, no en inglés. Lo que no puede abarcar es el texto que escribiste tú: el nombre de la misión, los nombres que les diste a tus propios componentes y cualquier texto fijo de una plantilla importada, que se queda en el idioma en que lo tecleó su autor.

### Plantillas de exportación personalizadas {#custom-export-templates}

Los tres formatos incorporados son **plantillas [Mustache](https://mustache.github.io/)**, y puedes aportar las tuyas:

- **Descargar plantilla** — guarda la plantilla del formato seleccionado como punto de partida.
- **Importar plantilla…** — añade un archivo `.mustache` llamado `<nombre>.<ext>.mustache` (por ejemplo, `mi-traza.kml.mustache`, `puntos.csv.mustache`). La extensión determina el tipo de archivo de salida. Tu plantilla aparece en la lista de formatos, se procesa con los mismos datos de vuelo y se puede eliminar. Las plantillas importadas se guardan en tu navegador (no se sube nada).

Las plantillas ven el vuelo como un modelo con los mismos nombres de campo que la exportación de escritorio de OpenRocket (por ejemplo `{{title}}`, `{{#branches}}`, `{{#waypoints}}`, `{{latitude}}`, `{{longitude}}`, `{{altitudeMslMeters}}`, `{{#path}}`), así que las plantillas escritas para OpenRocket de escritorio funcionan también aquí.

`{{labels.*}}` contiene las cadenas propias de las plantillas integradas en el idioma de exportación (`{{labels.peakAltitude}}`, `{{labels.landing}}`, `{{labels.flightPath}}` y las demás), que es como esas plantillas siguen la casilla **Idioma**. Una frase cuyo orden de palabras cambia entre idiomas no está ahí: `{{rangeText}}` en un punto de paso, y `{{landingText}}` y `{{landingHeading}}` en una etapa, llegan ya compuestas, porque una plantilla que pega fragmentos traducidos en orden inglés produce orden inglés en todos los idiomas. Los valores que hay detrás siguen todos en el modelo, así que una plantilla que quiera componer su propia frase puede hacerlo.

Los valores del resumen también están en el modelo. En el nivel superior: `{{maxRange}}` (lo más lejos que llegó cualquier etapa desde la rampa, en la unidad de distancia), `{{timeToApogee}}` y `{{flightTime}}` (segundos, un decimal), `{{velocityUnit}}` y `{{accelerationUnit}}` (etiquetas de `{{maxVelocity}}` y `{{maxAcceleration}}`, que siempre van en SI), `{{launchLatitudeStr}}`, `{{launchLongitudeStr}}` y `{{launchAltitude}}`, y `{{#includeDescriptions}}` para el interruptor de los globos. Por etapa: `{{maxRangeMeters}}` y `{{maxRange}}`, y `{{#hasLanding}}` que condiciona `{{landingDistance}}`, `{{landingBearing}}`, `{{landingTime}}`, `{{landingLatitudeStr}}` y `{{landingLongitudeStr}}`. Cada punto de paso ya llevaba `{{latitudeStr}}` y `{{longitudeStr}}`, las mismas cadenas de seis decimales.

Dos cosas que conviene saber si escribes tus propios globos. **Escribe el HTML ya escapado** —`&lt;b&gt;`, no `<b>`— y no lo envuelvas en `CDATA`. Todo valor que una plantilla sustituye se escapa, porque el nombre de un cohete podría romper el XML, y dentro de un bloque `CDATA` esos escapes no se decodifican: un cohete llamado `Bill & Ted` llegaría al globo como el texto literal `Bill &amp; Ted`. Ya escapado, el marcado y el valor se escapan exactamente una vez cada uno y el analizador los decodifica juntos. (Un nombre que contenga `]]>` cerraría además el bloque `CDATA` antes de tiempo y produciría un archivo inválido.) Segundo, **una cadena vacía y un cero son falsos**, así que `{{#launchAltitudeMeters}}…{{/launchAltitudeMeters}}` hace desaparecer la línea que lo rodea cuando no hay nada que decir, en lugar de imprimir una etiqueta seguida de un hueco.

## Exportar imágenes {#exporting-images}

El **esquema 2D** se puede exportar como dibujo:

- **SVG** — un dibujo vectorial a escala real con los datos del diseño (se imprime a escala 100 %).
- **PNG / JPG** — una imagen de mapa de bits de alta resolución; eliges el formato y el ancho.

## Nada sale de tu dispositivo {#nothing-leaves-your-device}

Toda la importación y exportación ocurre localmente en tu navegador: los archivos se leen y se escriben en tu propio dispositivo, sin ninguna subida a ningún servidor.
