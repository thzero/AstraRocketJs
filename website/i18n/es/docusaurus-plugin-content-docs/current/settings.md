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
| Área | el área de la tira de una cinta | cm² | in² |
| Masa | masas de componentes y del cohete | g | oz |
| Velocidad | salida del raíl, velocidad máxima, despliegue y aterrizaje | m/s | ft/s |
| Velocidad del viento | viento y rachas de las condiciones de lanzamiento | m/s | mph |
| Aceleración | aceleración máxima | m/s² | ft/s² |
| Ángulo | ángulos de aletas y de la varilla, dirección del viento | ° | ° |
| Densidad (volumen) | materiales sólidos, por volumen | g/cm³ | oz/in³ |
| Densidad (tela) | material de paracaídas y cintas, por superficie | g/m² | oz/ft² |
| Densidad (cuerda) | cordón de choque y cuerdas de suspensión, por longitud | g/m | oz/ft |
| Temperatura | temperatura del aire en el campo | °C | °F |
| Presión | presión del aire en el campo | hPa | psi |
| Empuje / fuerza | empuje del motor | N | lbf |
| Impulso | impulso total | N·s | lbf·s |
| Velocidad de alabeo | la velocidad de alabeo del vuelo | r/s | r/s |

Una instalación nueva arranca con los **valores métricos**, y los botones de restablecer restauran ese mismo conjunto.

Todo sigue tu elección: los campos donde escribes, el árbol de componentes, la tira de estadísticas, las reglas y los calibres del 2D, las anotaciones del 3D, las gráficas de vuelo y de resistencia, el explorador de motores y las exportaciones a PDF y CSV (que indican la unidad utilizada y pueden fijarse en métricas o imperiales por su cuenta; consulta [Archivos y exportaciones](./files-and-exports.md)).

### Cambiar la unidad de un solo campo {#changing-a-unit-on-one-field}

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

### Dónde viven tus elecciones de unidades {#where-your-unit-choices-live}

Las unidades pertenecen **al navegador donde las configuras**, no a un diseño ni a un archivo. En la práctica:

- Se aplican a todos los diseños que abras aquí y se mantienen hasta que las cambies.
- **No** viajan dentro de un `.ork`. Si abres uno de tus archivos en OpenRocket de escritorio, lo verás en las unidades *de OpenRocket*, definidas en sus propias preferencias; y un archivo de OpenRocket se abre aquí en las tuyas. El cohete es idéntico en ambos casos: solo cambia la presentación.
- **No** te siguen a otro ordenador, a otro navegador ni a una ventana privada, y borrar los datos del sitio en tu navegador las restablece junto con el resto de los ajustes.

### Sombreado de las tablas aerodinámicas {#aero-table-shading}

**Colores ▸ Sombreado de las tablas aerodinámicas** elige cómo tiñen sus celdas las tablas por componente de [Aero](./views-and-analysis.md). *Por magnitud* es un solo color que se intensifica con el valor, escalado respecto al mayor de la tabla. *Por calor* reproduce exactamente el verde-rojo de OpenRocket de escritorio: su fórmula, su escala fija de 0 a 1,5 Cd y texto oscuro sobre celdas claras. Ninguno es más correcto; elige el que leas más rápido. *Por calor* se aplica solo a la tabla de **resistencia**: su escala es absoluta de Cd, y ni el CNα ni los coeficientes de alabeo están en ella (un CNα de 15 en unas aletas se saturaría en el mismo rojo que el 2 de una ojiva y no diría nada), así que esas tablas quedan sin sombrear con esta opción, igual que OpenRocket de escritorio solo colorea su pestaña de resistencia. El mismo conmutador está junto a la leyenda bajo la tabla, así que puedes cambiarlo sin salir de la vista.

### Lo que las unidades no cambian {#what-units-dont-change}

Las unidades son una preferencia de **visualización y entrada**. Tu diseño se guarda siempre en SI, así que cambiar de unidades nunca modifica un cohete ni vuelve a guardar un archivo:

- Los archivos `.ork` se mantienen en metros y kilogramos, byte a byte como los escribe OpenRocket de escritorio.
- Las exportaciones con unidades propias del formato conservan las suyas: RASAero (`.CDX1`) en pulgadas y libras, y las hojas de corte DXF y las mallas 3D en milímetros.
- Las plantillas 1:1 del informe PDF y su regla impresa siguen en mm/cm: esa regla mide la **página**, así que debe coincidir con una regla real. (Por lo demás, el informe y el CSV de diseño siguen tus unidades, o pueden fijarse en métricas o imperiales desde el diálogo de exportación; consulta [Archivos y exportaciones](./files-and-exports.md).)
- Las cifras sin unidad tampoco cambian: la estabilidad en calibres o en % de la longitud, los coeficientes de resistencia, el Mach, CNα y los tiempos en segundos.
- Los diámetros de los porta-motores y del filtro de motores siguen en mm, porque 18 mm / 24 mm / 29 mm son en la práctica **nombres** de motor.

## Colores {#colors}

La pestaña **Colores** tiene tres ajustes:

- **Colores de piezas (modelo 3D)**: el color con el que se dibuja cada tipo de pieza en el modelo 3D. Cada fila tiene su propio botón de restablecer.
- **Colores de fase de la trayectoria**: los colores de los tramos de **Empuje**, **Inercia** y **Descenso** de la trayectoria de vuelo 3D.
- **Sombreado de las tablas aerodinámicas**: consulta [más arriba](#aero-table-shading).

## Materiales {#materials}

De qué está hecha una **pieza recién añadida**. Una fila por hueco de material: los catorce tipos de pieza estructural, más la tela y las cuerdas de un paracaídas, una cinta y un cordón de choque, porque una pieza puede llevar más de un tipo de material a la vez.

La elección se gasta al añadir la pieza: el material se escribe en ella en ese momento, así que aparece en el panel de propiedades y viaja con el diseño en el `.ork`. Las piezas que ya están en el cohete no se tocan, ni tampoco un diseño que abras. Si dejas una fila sin poner, la pieza recibe el material de serie del motor para ese hueco (Cardboard, Ripstop nylon o Elastic cord), así que una pieza nueva siempre dice de qué está hecha.

Eso no es como funciona la preferencia equivalente de OpenRocket de escritorio, y es a propósito. El escritorio deja la pieza sin asignar y aplica tu preferencia al calcular la masa, lo que significa que el mismo archivo pesa una cosa en la máquina que lo creó y otra en la máquina a la que se lo enviaste. Aquí lo que elegiste está en el archivo.

Los materiales personalizados también pueden ser predeterminados, y los adhesivos igual. La primera opción de la lista de cada fila no fija ningún valor predeterminado para ese hueco, y ese tipo de pieza sigue recibiendo el material de serie indicado arriba.

No hay fila para los filetes de las aletas. Un filete que añadas empieza como West System Six10, un epoxi espesado; un filete de un archivo que no indica material se lee como Cardboard, igual que lo lee OpenRocket de escritorio.

## Valores por defecto de la simulación {#simulation-defaults}

Estos valores están en la pestaña **Simulación** e inicializan cada nueva simulación (aún puedes ajustar las condiciones de lanzamiento de cada una: consulta [Ejecutar una simulación](./running-a-simulation.md)):

- **Confirmar el borrado de simulaciones**: pregunta antes de eliminar una simulación. Activado por defecto, porque una simulación borrada se lleva sus resultados con ella.
- **Ejecutar automáticamente las simulaciones desactualizadas**: cuando la pestaña Resultados muestra una simulación que nunca se ha ejecutado o cuyo resultado está desactualizado, la ejecuta. Desactivado por defecto.

- **Paso de tiempo**: el tamaño de paso del integrador. Más pequeño es más preciso pero más lento.
- **Tiempo máx. de sim.**: un límite de seguridad sobre el tiempo de vuelo simulado, que corta una ejecución que nunca aterriza.
- **Paso angular máximo**: lo máximo que el cohete puede girar en un paso de integración. Más pequeño es más preciso en un cabeceo rápido, y más lento.
- **Semilla aleatoria**: fija la aleatoriedad del viento y la turbulencia para que una simulación sea reproducible; déjala sin definir para obtener resultados variados.
- **Método de cálculo** y **método de simulación**: se muestran como referencia, no se eligen: todo vuelo usa aerodinámica de Barrowman extendido con un integrador Runge-Kutta 4 de 6 grados de libertad.

Cada simulación puede sobrescribir cualquiera de estos valores. Una sobrescritura **vacía** no está ausente: significa *seguir el valor global*, y el campo muestra ese valor global como marcador de posición. Por eso las opciones de ejecución nunca bloquean un vuelo: siempre hay un valor por defecto debajo. **Restablecer valores predeterminados** borra las sobrescrituras de una simulación; **Guardar como predeterminado** lleva lo que esa simulación usa ahora a estos valores globales.

## Lanzamiento {#launch}

La pestaña **Lanzamiento** guarda las condiciones de lanzamiento con las que empieza una simulación nueva, en las mismas tarjetas que el panel de lanzamiento de una simulación (consulta [Ejecutar una simulación](./running-a-simulation.md)). Cambiarlas no afecta a las simulaciones que ya existen; edítalas en su propio panel de lanzamiento.

### Condiciones de lanzamiento obligatorias {#required-launch-conditions}

Siete campos de lanzamiento no tienen un valor por defecto razonable, así que no pueden quedarse en blanco: **longitud de la guía**, **ángulo de la guía**, **velocidad del viento**, **desviación estándar del viento**, **altitud del sitio**, **latitud** y **longitud**. Se marcan con un **\*** rojo allá donde aparezcan, y se comportan igual que las [dimensiones obligatorias](./designing-a-rocket.md#required-dimensions) de un componente: borrar uno no guarda nada, y una simulación a la que le falte uno se nombra y se omite en lugar de volarse.

Ten en cuenta que estos siete son *obligatorios*, no *distintos de cero*: aire en calma, sin ráfagas, nivel del mar, el ecuador, el meridiano de Greenwich y una guía totalmente vertical son ajustes reales, y todos ellos valen cero. Solo la longitud de la guía tiene que ser positiva en la práctica.

En este diálogo esos campos nunca pueden acabar en blanco: inicializan cada nueva simulación, así que borrar uno aquí simplemente conserva el valor que tenía.

### Clave de API de Open-Meteo {#open-meteo-key}

Al final de la tarjeta Atmósfera de la pestaña Lanzamiento hay un campo para una clave de API de Open-Meteo, que usa [el tiempo de Open-Meteo](./running-a-simulation.md#weather). Déjalo vacío para usar el servicio gratuito de Open-Meteo, que es para uso no comercial. Una clave de un plan de pago de Open-Meteo envía las solicitudes a su servicio de pago. La clave se guarda solo en este navegador, fuera de estos ajustes, así que **Restablecer** no la toca y ningún diseño ni `.ork` que guardes la lleva.

## Reproducción {#playback}

- **Velocidad predeterminada**: la velocidad a la que empieza a reproducirse la trayectoria de vuelo 3D, de 0,25× a 4×. Es un punto de partida, no un bloqueo: el control de velocidad de la vista cambia la reproducción actual sin tocar este ajuste.

## Boceto {#sketch}

Valores predeterminados para la vista 2D. También puedes alternarlos en la propia vista.

- **Centro de gravedad / presión**: muestra los marcadores de CG y CP.
- **Reglas**: un interruptor por lado (arriba, abajo, izquierda, derecha).

## Avisos de seguridad {#safety-warnings}

También en la pestaña **Simulación**: cinco umbrales, en las unidades que hayas elegido para la velocidad. Colorean las fichas de resultados *y* llegan al motor de vuelo, así que deciden qué avisos informa una simulación y no solo cómo se pintan los números.

- **Velocidad mínima de salida de la guía**: por debajo de esto las aletas reciben muy poco flujo de aire para gobernar el cohete, así que puede orientarse hacia el viento o volverse inestable al salir de la guía. La ficha de salida de la guía está en verde a partir de este valor y avisa por debajo.
- **Aviso de vel. de despliegue sobre**: despliegue simple (sin piloto): por encima de esta velocidad, abrir el paracaídas arriesga rasgar el fuselaje o desgarrar la vela.

Los tres últimos solo se aplican al **despliegue dual** (una etapa que lleva un piloto), donde se juzgan el principal y el piloto en lugar del umbral simple anterior:

- **Velocidad de apertura del principal (máx)**: por encima de esto el principal sale demasiado rápido, normalmente por un piloto demasiado pequeño para frenar el cohete, o por un principal configurado para abrirse demasiado alto.
- **Velocidad de apertura del principal (mín)**: por debajo de esto el principal se abre cuando el cohete apenas desciende, lo que normalmente significa que se desplegó cerca del apogeo: un descenso lento y con mucha deriva desde toda la altitud.
- **Velocidad de apertura del piloto (mín)**: por debajo de esto el piloto sale demasiado lento en el apogeo para inflarse correctamente.

Los tres dependen de que el cohete diga qué paracaídas es cuál. Eso se elige en la etapa: marca **Despliegue dual** en **Tipo de despliegue de recuperación** y escoge como **Dispositivo piloto** el paracaídas o la cinta que se abre en el apogeo, y el vuelo se juzga como despliegue dual. Con **Despliegue único**, toda la etapa se juzga solo contra **Aviso de vel. de despliegue sobre**.

Cada uno de estos también se puede sobrescribir por simulación, en las opciones de esa simulación.

Al cambiar cualquiera de ellos, todas las simulaciones que ya se han ejecutado se marcan como **desactualizadas**, de modo que un resultado guardado nunca afirma describir unos ajustes con los que no se voló. Una simulación que fija el ajuste por su cuenta no se toca, porque su propio valor sigue aplicándose. Vuelve a ejecutarla para actualizar los números.

## Modelo de vuelo {#flight-model}

También en la pestaña **Simulación**. Todo lo anterior decide cuándo *avisa* un vuelo. Esto cambia lo que hace el vuelo.

- **Salida según las guías**: desactivado por defecto, que es el comportamiento propio de OpenRocket: el cohete permanece en el riel durante toda su longitud, estén donde estén las guías de lanzamiento o los botones de riel. OpenRocket calcula una longitud que tiene en cuenta las guías y luego no la usa, así que una guía montada por encima de la cola del cohete recibe un recorrido guiado que no tiene, y los botones de riel no se consideran en absoluto.

  Al activarlo, la fase guiada termina según una regla para cada tipo de guía. Una anilla de lanzamiento guía hasta que su extremo posterior sale de la varilla. Un raíl necesita dos botones de raíl y solo guía hasta que sale el penúltimo, así que un único botón de raíl no da ningún recorrido guiado. El cohete se libera en ese momento además de informarse allí, así que cambia el vuelo en sí, no solo el número. Espera que el cohete salga algo antes y con una velocidad de salida algo menor. Un diseño sin ninguna guía es una torre de lanzamiento y vuela igual en ambos casos.

  Es un ajuste y no una corrección porque el motor se comprueba contra OpenRocket de escritorio vuelo a vuelo. Desactivado, una ejecución coincide exactamente con OpenRocket.

## General {#general}

- **Tema**: Oscuro, Claro, Según el sistema (claro u oscuro según esté configurado tu dispositivo, y cambia cuando él cambia) o Luz de día (alto contraste), un tema claro con texto negro y colores más oscuros para leer la pantalla al sol en el campo. Oscuro por defecto. Las vistas 3D y el esquema siguen el tema; un esquema descargado o impreso conserva sus propios colores de impresión sea cual sea el tema. El botón ☀ de la cabecera cambia a Luz de día con un toque, y un segundo toque vuelve al tema que tenías.
- **Guardar la información de diseño (estadísticas) en el archivo**: escribe las cifras derivadas del diseño (masa, CG, CP, estabilidad) en un `.ork` guardado, como puede hacerlo OpenRocket de escritorio. Desactivado por defecto.
- **Preguntar dónde guardar cada archivo**: abre el diálogo de guardado del propio navegador en cada exportación, para que elijas el nombre y la carpeta. Activado por defecto, y solo aparece en los navegadores que tienen ese diálogo (Chrome y Edge). Desactivado, o en Firefox y Safari, los archivos van directamente a tu carpeta de descargas.

## Restablecer {#reset}

Abajo en el diálogo hay dos botones: **Restablecer ‹pestaña›** repone solo la pestaña en la que estás (así que **Restablecer Unidades** toca las unidades y nada más), y **Restablecer todo** devuelve cada ajuste de cada pestaña a su valor por defecto. Restablecer todo pregunta antes, porque no se puede deshacer.
