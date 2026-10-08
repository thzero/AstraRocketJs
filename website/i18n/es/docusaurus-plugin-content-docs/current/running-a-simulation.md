---
title: "Ejecutar una simulación"
sidebar_position: 12
---
Las simulaciones están en el panel de la derecha. Una simulación es una [configuración de vuelo](./flight-configurations.md) —los motores, la recuperación y las etapas— volada bajo unas condiciones de lanzamiento, así que lo que cada fila lleva de propio es su nombre, la configuración que vuela, las condiciones y el último resultado. Puedes mantener **varias simulaciones con nombre** para un mismo diseño (por ejemplo, distintos motores o campos de vuelo), **duplicar** una como punto de partida y eliminarlas. El botón rojo **Eliminar simulación** (junto al nombre de la simulación actual) la borra tras una confirmación; el espacio de trabajo siempre conserva al menos una, así que se desactiva cuando solo queda una.

**⬇ CSV**, en la barra de herramientas, descarga la **tabla de simulaciones**: cada simulación en una fila, con su configuración, motores, estado y resultados (apogeo, velocidades, tiempos, Max-Q, q·α máx. y alabeo máx.) en tus unidades. Una simulación que no ha volado aparece con las cifras en blanco, y una desactualizada aparece marcada como tal, porque sus cifras describen el diseño anterior a tus últimos cambios.

## Elige qué vuela

La columna **Configuración** de la tabla, y el selector en la parte superior del editor, eligen qué [configuración de vuelo](./flight-configurations.md) vuela esa fila; los motores que lleva se detallan debajo. **Editar motores…** abre la pestaña Configuraciones en esa configuración.

Varias filas pueden volar la misma configuración, que es justo para lo que están: cambia un motor una vez y todos los vuelos que la usan quedan marcados para volver a ejecutarse. Dos filas que deban diferir en el motor quieren dos configuraciones, una para cada una.

## Configura el lanzamiento

Cada simulación tiene su propia configuración de lanzamiento, agrupada en tarjetas:

- **Raíl de lanzamiento**, **Varilla de lanzamiento** o **Guía de lanzamiento**: longitud, ángulo respecto a la vertical y dirección (o «lanzar contra el viento»). La tarjeta toma el nombre de las guías del diseño: los botones de raíl van en un raíl, las anillas de lanzamiento en una varilla, y un diseño sin ninguna de las dos, o con ambas, dice guía. La misma palabra se usa en los resultados, los eventos de vuelo, los avisos y el informe.
- **Campo de vuelo** — altitud, latitud y longitud, además de las [ubicaciones guardadas](#saved-locations) y un [mapa](#the-map).
- **Atmósfera** — estándar ISA, o temperatura, presión y humedad personalizadas, o rellenarlas junto con el viento a partir de un [pronóstico del tiempo](#weather). La **presión** es la presión *en el sitio*, no la cifra reducida al nivel del mar que suelen dar las aplicaciones del tiempo y los partes de aeropuerto. Una presión escrita muy por encima de la presión estándar para la altitud del sitio muestra una nota en ámbar bajo el campo que lo indica, porque así se ve una cifra a nivel del mar en un campo alto. La nota nunca impide simular: el valor puede ser correcto.
- **Viento** — velocidad media, rachas (desviación estándar) y dirección; o un perfil de viento **multinivel** que varía con la altitud.
- **Modelo terrestre** — plano, esférico o WGS84 (afecta a los vuelos largos o muy altos).

Las simulaciones nuevas parten de los valores por defecto de tus [Ajustes](./settings.md) globales.

### Ubicaciones guardadas {#saved-locations}

El lugar de lanzamiento es una propiedad del **campo**, no de un vuelo, así que no hace falta volver a teclearlo cada vez. La fila superior de la tarjeta de lugar de lanzamiento los guarda y los recupera:

- **🔍 Buscar un lugar** fija el sitio a partir de un nombre de lugar, un código postal, unas coordenadas pegadas o un enlace de mapa. Un nombre o código postal se busca con el buscador de lugares de Open-Meteo, igual que se consulta el tiempo, y muestra las coincidencias con su altitud; elegir una fija la latitud, la longitud y la altitud en una sola edición. Las coordenadas y los enlaces de Google, Apple, OpenStreetMap o Bing se leen en la aplicación y no se envían a ninguna parte; solo se consulta la altitud de ese punto. Un enlace acortado (`maps.app.goo.gl/…`) oculta el lugar tras una redirección, así que ábrelo y pega la dirección completa. Los nombres de lugares son de GeoNames, con licencia CC BY 4.0.
- **💾 Guardar esta ubicación** almacena los tres campos del lugar con un nombre. Guardar con un nombre que ya usaste actualiza esa ubicación en lugar de añadir una segunda que no podrías distinguir en la lista.
- El **desplegable** aplica la latitud, la longitud y la altitud de una ubicación guardada. Es una edición normal, así que se deshace como cualquier otra. Muestra **Ubicación personalizada** siempre que los campos no coincidan con ninguna ubicación guardada, reconocido a partir de los propios números, así que sigue siendo correcto tanto si los escribiste, como si los importaste de un `.ork` o usaste 📍 **Usar mi ubicación**. Si eliges tú **Ubicación personalizada**, los tres campos del lugar vuelven a los valores por defecto de lanzamiento de tus [Ajustes](./settings.md): el **Centro Espacial Kennedy**, salvo que los hayas cambiado. Sirve para cuando estás en un sitio nuevo y prefieres partir de un lugar conocido a ir corrigiendo los números de una ubicación guardada uno a uno: el mapa tiene dónde abrirse y los tres campos siguen rellenos, así que la ejecución nunca se rechaza por un hueco. También es una edición normal, así que deshacer recupera el lugar anterior.
- **⚙ Gestionar ubicaciones guardadas** es una biblioteca de dos paneles: las ubicaciones a la izquierda con sus coordenadas, para poder distinguir dos campos de nombre parecido, y la seleccionada abierta a la derecha. El editor es la ubicación entera —nombre, latitud, longitud, altitud y el mapa—, porque una coordenada mal escrita es lo que más veces hay que corregir. **Guardar** la escribe y la deja seleccionada, **Descartar** la devuelve a como estaba almacenada, y pasar a otra ubicación con cambios sin guardar pregunta antes. **Usar** aplica la ubicación seleccionada a la simulación que tengas abierta, y se rechaza mientras haya cambios sin guardar, porque lo que ofrece es uno de los lugares que has *guardado*. **Nueva ubicación** crea una escribiendo los números. La misma biblioteca está en **menú → Ubicaciones de lanzamiento**, junto al panel de motores, así que puedes consultar tus ubicaciones sin abrir antes una simulación, y **Nueva ubicación** es la forma de añadir una desde ahí, donde no hay campos de lanzamiento en pantalla que capturar.

La altitud se muestra y se edita en la unidad que uses en la tarjeta de lugar de lanzamiento, así que un campo a 6.004 ft se lee igual en los dos sitios. La latitud y la longitud van siempre en grados, y las dos son obligatorias: 0°, 0° es un punto del golfo de Guinea, no «sin definir». Junto a cada una, la unidad indica el hemisferio en el que el signo pone el sitio (**° N** o **° S**, **° E** o **° W**) mientras escribes, así que un signo menos olvidado se ve al momento.

### El mapa {#the-map}

Cuatro dígitos de latitud y cuatro de longitud no son algo que puedas comprobar leyéndolos. Un signo menos que se pierde lleva un campo de Colorado al oeste de China y nada en pantalla se ve distinto, así que el lugar tiene un mapa: **🗺 Ver en el mapa**, en la tarjeta de lugar de lanzamiento, lo abre, y el editor de ubicaciones lleva uno junto a sus campos.

- **Satélite o callejero.** Las imágenes vienen por defecto y suelen ser las que responden a la pregunta, porque un campo de club es una franja segada en un henar: invisible en un callejero, inconfundible desde el aire. La capa de calles sirve para leer los caminos de acceso y el pueblo más cercano. Las dos vienen de los servicios de mapas de Esri; la capa de calles está construida sobre datos de OpenStreetMap y los acredita, pero la aplicación no usa a propósito los servidores de teselas de OpenStreetMap, que se sostienen con donaciones y no están ahí para que las aplicaciones se apoyen en ellos.
- **Al hacer clic en el mapa se fijan las coordenadas**, con cuatro decimales (unos 10 m, la misma precisión que escribe 📍 Usar mi ubicación). Es la única forma de introducir un campo sin coordenadas publicadas, y es una edición normal, así que se deshace como cualquier otra. Arrastra para desplazarte, y usa la rueda o **+** / **−** para acercar; un arrastre nunca cuenta como un clic.
- **Al escribir se mueve el marcador**, así que el mapa y los campos son dos vistas de una misma cosa y no dos sitios donde equivocarse.

Las teselas que ya has mirado quedan guardadas en la aplicación, así que una ubicación que consultaste en casa se dibuja igual en el campo sin cobertura. Un sitio que nunca has visto no se puede dibujar sin conexión: el mapa lo dice y pasa a una cuadrícula de coordenadas, que sigue situando el punto por hemisferios. Las teselas vienen de Esri, y solo se piden las de lo que estás mirando — consulta **[Sin conexión e instalación](./offline-and-installing.md)**.

Una ubicación guarda **solo el lugar**. La guía, el viento y la atmósfera son condiciones del día, y una ubicación que restaurara el viento del mes pasado sería peor que una que no restaurara nada: parecería fiable. Las ubicaciones viven en este navegador y en este dispositivo, como tus motores y materiales personalizados; no se sube nada.

### El tiempo de Open-Meteo {#weather}

**Obtener el tiempo…**, en la tarjeta Atmósfera, rellena las condiciones de lanzamiento con un pronóstico de [Open-Meteo](https://open-meteo.com/) para el sitio de lanzamiento. Indica primero la latitud y la longitud del sitio, elige una fecha y una hora en la hora local del sitio y pulsa **Consultar**.

El diálogo muestra lo que ha encontrado, cada cosa con su casilla, y no cambia nada hasta que pulsas **Aplicar**:

- **Temperatura**, **Presión** y **Humedad** en la plataforma. La presión es la presión a la altitud del sitio, no la cifra a nivel del mar que da un parte meteorológico.
- **Viento**: el viento a 10 m sobre la plataforma, los vientos a 80, 120 y 180 m por encima, y el viento en cada uno de los niveles de presión de Open-Meteo más arriba, escritos como un perfil de viento multinivel medido desde el nivel del mar. La turbulencia en la plataforma se estima a partir de las ráfagas, y los niveles superiores reciben un 10 %. Los campos de viento medio también se rellenan con el viento de la plataforma.
- **Atmósfera en altura**: temperatura, presión y humedad en cada nivel de presión por encima de la plataforma. Si la aplicas, el vuelo usa esta atmósfera en lugar del estándar ISA por encima del sitio. La tarjeta Atmósfera la muestra como **Atmósfera pronosticada hasta** una altura, con **Quitar** para volver a la estándar.

Las fechas desde unos tres meses atrás hasta 15 días por delante usan el pronóstico. Las fechas anteriores, hasta 1940, usan el registro histórico de Open-Meteo, que solo tiene valores de superficie, así que no se ofrecen ni el perfil de viento ni la atmósfera en altura. Cuando la altitud del sitio y la altura del terreno de Open-Meteo difieren en más de 30 m, el diálogo ofrece usar la altura del terreno como altitud del sitio, y los valores que muestra siguen esa elección.

El diálogo indica cuándo se consultó la respuesta. Una respuesta se reutiliza durante 30 minutos para el mismo lugar y las mismas fechas, ya que el modelo de pronóstico más rápido publica una nueva pasada cada hora; el diálogo indica cuándo se ha reutilizado, y **Consultar de nuevo** vuelve a preguntar a Open-Meteo de todos modos.

Debajo, para la misma hora, el diálogo muestra la **nubosidad** pronosticada (total y baja) y la **visibilidad** (solo en fechas de pronóstico; el registro histórico no la tiene). Son información para decidir si se vuela, no datos de entrada: nada en un vuelo las lee, así que no tienen casilla y nunca se aplican. El permiso del campo y el RSO deciden si el cielo es adecuado.

Un pronóstico es una estimación de un modelo. Aplicarlo es una edición normal que se deshace como cualquier otra, y los resultados volados con las condiciones anteriores aparecen como desactualizados.

Después, la tarjeta Atmósfera indica de dónde salieron los valores, por ejemplo *Pronóstico de Open-Meteo para 5 oct 2026, 12:00 MDT en 39,739°, -104,990°, consultado 4 oct 2026, 9:14 MDT*, con el crédito de Open-Meteo, y añade una nota cuando ocurre algo de esto:

- **Editado después de aplicarlo**: se ha cambiado un valor que había rellenado el pronóstico.
- **El sitio de lanzamiento ha cambiado**: la latitud o la longitud ya no son las del lugar del pronóstico.
- **Consultado hace más de 3 horas**: el pronóstico es para un momento que aún no ha llegado, y Open-Meteo probablemente ya ha publicado uno más reciente.

**Actualizar…** abre el diálogo en la misma fecha y hora con las mismas casillas marcadas y consulta de inmediato; no cambia nada hasta que pulsas Aplicar. Una actualización que devuelve los mismos valores deja tus resultados vigentes. El registro se guarda con la simulación y en un `.ork`.

**El servicio.** Las solicitudes van de tu navegador a Open-Meteo solo cuando pulsas Consultar, y llevan las coordenadas y la altitud del sitio y la fecha elegida. No identifican esta aplicación ni el sitio desde el que se sirve. Sin clave de API, la aplicación usa el servicio gratuito de Open-Meteo, que es para uso no comercial y tiene límites diarios. Si tienes un plan de pago de Open-Meteo, introduce su clave en [Ajustes](./settings.md#open-meteo-key), al final de la tarjeta Atmósfera de la pestaña Lanzamiento. La clave solo se guarda en este navegador y nunca se guarda en un diseño ni en un `.ork`. Los datos meteorológicos son de Open-Meteo.com con licencia CC BY 4.0, y el diálogo lo acredita.

La atmósfera pronosticada es un añadido de esta aplicación. OpenRocket de escritorio usa el estándar ISA por encima del sitio, y un `.ork` guardado aquí lleva los niveles como una extensión que OpenRocket de escritorio ignora.

## Ejecútala

Pulsa **Simular vuelo**. El vuelo se calcula en un **Web Worker** en segundo plano, así que la interfaz sigue respondiendo: se muestra un indicador mientras calcula (normalmente bastante menos de un segundo). Al terminar, se desbloquean las vistas de **Vuelo** y **Trayectoria 3D** y aparecen los resultados.

### Cuándo se rechaza una ejecución {#when-a-run-is-refused}

AstraRocketJs prefiere no darte ningún número antes que uno equivocado con buena pinta, así que un vuelo que no se puede calcular con honestidad no se vuela. El botón de simular explica el motivo y nombra la pieza, el campo o la simulación culpable.

Hay dos tipos de problema, y se comportan de forma distinta:

**Los fallos del diseño** detienen todo, porque todas las simulaciones comparten un mismo cohete:

- **Sin soporte de motor** — no hay dónde alojar un motor. Añade uno (consulta [Diseñar un cohete](./designing-a-rocket.md#motor-mount)).
- **Una dimensión obligatoria vale cero** — se nombra la pieza y cuál de sus dimensiones falla. Consulta [Dimensiones obligatorias](./designing-a-rocket.md#required-dimensions).

**Los fallos de una simulación** solo descartan esa fila. Selecciona seis y ejecútalas: las buenas vuelan, y el botón te dice cuáles se quedan fuera y por qué.

- **Sin motor utilizable** — no hay nada cargado en el soporte principal, o un `.ork` importado cuyo motor no se pudo emparejar con una curva de empuje.
- **Un campo de lanzamiento obligatorio está en blanco** — longitud de la guía, ángulo de la guía, velocidad del viento, desviación estándar del viento, altitud del sitio o latitud. No tienen un valor por defecto razonable, así que se nombran en lugar de adivinarse.
- **Condiciones de lanzamiento fuera de los códigos de seguridad** — guía a más de 20° de la vertical, o viento en superficie por encima de 20 mph. Consulta [Límites de seguridad](#safety-limits) más abajo.

El botón solo se desactiva cuando *nada* de lo seleccionado puede volar. Si no, sigue activo, cuenta las filas que realmente se van a ejecutar y nombra las que omite: una fila mala nunca te cuesta las otras once.

### Límites de seguridad {#safety-limits}

Las condiciones de lanzamiento se contrastan con los códigos de seguridad de la **NAR** y **Tripoli**, y por eso dos campos no admiten valores más allá de ellos:

- **Ángulo de la guía de lanzamiento** — dentro de **20°** de la vertical.
- **Velocidad del viento** — igual o inferior a **20 mph** (32 km/h).

Ambos códigos los expresan en unidades imperiales, así que las cifras métricas que muestra la aplicación son conversiones exactas y no números redondos. Los campos se recortan mientras escribes, y un archivo `.ork` que llegue fuera de estos límites aparece en el aviso de importación en lugar de volarse sin más.

Solo se juzga el viento **en la rampa**. En un perfil multinivel es la capa del suelo; los vientos en altura no son algo por lo que se cancele un lanzamiento, porque no son algo que nadie mida en el campo de vuelo. La desviación estándar de las ráfagas tampoco se comprueba a propósito: los códigos hablan de velocidad del viento, y una media dentro del límite con ráfagas por encima es un juicio que la aplicación no está en condiciones de hacer.

Son límites de vuelo, no de modelado. Tratan de si el lanzamiento debería ocurrir, así que, a diferencia de la geometría de tu cohete, no se conservan tal como se escribieron: las condiciones de un archivo fuera de límites se señalan, y la ejecución se rechaza hasta que vuelvan a estar dentro.

Estas dos comprobaciones son además las *únicas* reglas de seguridad que la aplicación impone. Qué modela y qué no modela la simulación, y qué verificar en el cohete real antes de volarlo, está en [Seguridad](./safety.md).

## Interpreta los resultados

Al ejecutar se abre la pestaña **Resultados** con el vuelo que acabas de ejecutar — una simulación o un lote —, porque ejecutar es pedir ver la respuesta.

Una tarjeta **Antes de volar** encabeza los resultados: qué son estos números (estimaciones de un modelo, no una hoja de vuelo), qué cosas el modelo nunca tuvo (el flutter de las aletas, las cargas estructurales, el inflado del paracaídas y su golpe de apertura, el comportamiento de tu motor ese día) y el recordatorio de pesar y equilibrar el cohete que realmente construiste e introducir esas medidas como invalidaciones antes de fiarte del margen. Enlaza con **[Seguridad](./safety.md)**, y va delante de los números en vez de detrás, porque lo que vale una lectura es algo que conviene saber antes de leerla.

Pulsa su encabezado para plegar la explicación. Plegarla te pide confirmar que has leído las notas, porque el pliegue se recuerda y ese clic es la última vez que se ofrecen en este navegador; cancelar deja la tarjeta abierta, y volver a abrirla no pregunta nada. Lo que nunca se pliega es el propio encabezado, así que el símbolo de aviso y las palabras siguen sobre los números en ambos casos.

Debajo, los resultados se muestran como fichas, en orden aproximadamente cronológico del vuelo, e incluyen:

- **Velocidad de salida del raíl** (marcada si está por debajo de tu mínimo de seguridad)
- **Retardo óptimo** y **tiempo hasta el apogeo**
- **Apogeo** (altitud máxima) y **velocidad / aceleración / Mach máximos**
- **Velocidad de apertura** (marcada si supera tu umbral de aviso; en verde cuando es suficientemente baja). En un diseño de [despliegue dual](./designing-a-rocket.md#despliegue-dual) el motor de vuelo juzga el principal y el piloto contra sus propios umbrales, y devuelve un aviso por cada uno.
- **Velocidad de aterrizaje**, **tiempo de vuelo** y **distancia recorrida**
- **Max-Q**, el pico de presión dinámica del impulso. El motor no lo registra, así que se deriva de la densidad del aire y la velocidad del sonido que la simulación ya lleva; es el número que decide si el fuselaje aguanta. Un resultado guardado antes de que las simulaciones conservaran el conjunto completo de series no tiene densidad del aire almacenada, y no informa Max-Q en vez de un cero que parecería una respuesta.
- **q·α máx.**, el mayor producto de presión dinámica por ángulo de ataque mientras el cohete aún vuela hacia delante (hasta la apertura, si no hasta el apogeo), en kPa·°. La carga lateral sobre aletas y acopladores lo sigue. Se deriva igual que Max-Q.
- **Alabeo máx.**, lo más rápido que giró el cohete durante el vuelo, leído de la serie de velocidad de alabeo del motor de simulación.

### Eventos de vuelo {#flight-events}

Bajo las fichas, la tabla **Eventos de vuelo** es el vuelo como una lista que se lee de arriba abajo: una fila por evento, con el momento en que ocurrió y el estado del cohete en ese instante. Las gráficas marcan los mismos eventos como etiquetas, lo que responde *cuándo* y nada más.

Se nombra cada evento que levanta el motor, no solo los cinco que etiquetan las gráficas, así que la salida de rampa, la ignición, la separación de etapa y el volteo aparecen aquí por primera vez. Cada fila lleva la **altitud** y la **velocidad** de su instante, en las unidades que elijas desde los encabezados de columna, y las filas por las que se lee algo más lo llevan en una línea propia:

- La **salida del raíl** (o de la varilla o de la guía, según las guías del diseño) da el margen estático, la relación empuje-peso y el ángulo de ataque con los que salió.
- El **fin de empuje** da su Mach.
- **Max-Q** da la presión dinámica y el Mach en el pico.

Una **apertura de recuperación** nombra el paracaídas que se disparó, así que un drogue de doble apertura se distingue del principal, y una etapa con racimo obtiene una fila por motor en vez de una por etapa. En un vuelo por etapas todas están en la misma tabla, etiquetadas e intercaladas en el mismo reloj de lanzamiento, porque ese es el orden en que ocurrió el vuelo: un propulsor gastado baja mientras el sustentador sigue en ascenso libre.

El botón **CSV** escribe la tabla como archivo. Consulta **[Archivos y exportaciones](./files-and-exports.md)**.

Para el historial temporal completo, abre las **[vistas de Vuelo y Trayectoria 3D](./views-and-analysis.md)**. Para guardar los números, consulta **[Archivos y exportaciones](./files-and-exports.md)**.

## Editar invalida los resultados

Cambiar el diseño borra el resultado guardado de cada simulación (la física ya no coincide): solo tienes que pulsar **Simular** otra vez. Lo mismo ocurre con **deshacer/rehacer**: restaura tu diseño y los *datos de entrada* de la simulación, pero no los resultados de vuelo guardados, así que vuelve a simular para ver el vuelo.
