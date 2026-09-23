---
title: "Ejecutar una simulación"
sidebar_position: 11
---
Las simulaciones están en el panel de la derecha. Puedes mantener **varias simulaciones con nombre** para un mismo diseño (por ejemplo, distintos motores o campos de vuelo), **duplicar** una como punto de partida y eliminarlas. El botón rojo **Eliminar simulación** (junto al nombre de la simulación actual) la borra tras una confirmación; el espacio de trabajo siempre conserva al menos una, así que se desactiva cuando solo queda una.

## Configura el lanzamiento

Cada simulación tiene su propia configuración de lanzamiento, agrupada en tarjetas:

- **Varilla / raíl de lanzamiento** — longitud, ángulo respecto a la vertical y dirección (o «lanzar contra el viento»).
- **Campo de vuelo** — altitud, latitud y longitud, además de las [ubicaciones guardadas](#saved-locations) y un [mapa](#the-map).
- **Atmósfera** — estándar ISA, o temperatura y presión personalizadas.
- **Viento** — velocidad media, rachas (desviación estándar) y dirección; o un perfil de viento **multinivel** que varía con la altitud.
- **Modelo terrestre** — plano, esférico o WGS84 (afecta a los vuelos largos o muy altos).

Las simulaciones nuevas parten de los valores por defecto de tus [Ajustes](./settings.md) globales.

### Ubicaciones guardadas {#saved-locations}

El lugar de lanzamiento es una propiedad del **campo**, no de un vuelo, así que no hace falta volver a teclearlo cada vez. La fila superior de la tarjeta de lugar de lanzamiento los guarda y los recupera:

- **💾 Guardar esta ubicación** almacena los tres campos del lugar con un nombre. Guardar con un nombre que ya usaste actualiza esa ubicación en lugar de añadir una segunda que no podrías distinguir en la lista.
- El **desplegable** aplica la latitud, la longitud y la altitud de una ubicación guardada. Es una edición normal, así que se deshace como cualquier otra. Muestra **Ubicación personalizada** siempre que los campos no coincidan con ninguna ubicación guardada, reconocido a partir de los propios números, así que sigue siendo correcto tanto si los escribiste, como si los importaste de un `.ork` o usaste 📍 **Usar mi ubicación**. Si eliges tú **Ubicación personalizada**, los tres campos del lugar vuelven a los valores por defecto de lanzamiento de tus [Ajustes](./settings.md): el **Centro Espacial Kennedy**, salvo que los hayas cambiado. Sirve para cuando estás en un sitio nuevo y prefieres partir de un lugar conocido a ir corrigiendo los números de una ubicación guardada uno a uno: el mapa tiene dónde abrirse y los tres campos siguen rellenos, así que la ejecución nunca se rechaza por un hueco. También es una edición normal, así que deshacer recupera el lugar anterior.
- **⚙ Gestionar ubicaciones guardadas** las lista con sus coordenadas, para poder distinguir dos campos de nombre parecido. **Editar** abre la ubicación entera —nombre, latitud, longitud y altitud—, porque una coordenada mal escrita es lo que más veces hay que corregir, y **Nueva ubicación** crea una escribiendo los números. La misma lista está en **menú → Ubicaciones de lanzamiento**, junto al panel de motores, así que puedes consultar tus ubicaciones sin abrir antes una simulación; al elegir una allí se aplica a la simulación que tengas abierta, y **Nueva ubicación** es la forma de añadir una desde ahí, donde no hay campos de lanzamiento en pantalla que capturar.

La altitud se muestra y se edita en la unidad que uses en la tarjeta de lugar de lanzamiento, así que un campo a 6.004 ft se lee igual en los dos sitios. La latitud y la longitud van siempre en grados, y las dos son obligatorias: 0°, 0° es un punto del golfo de Guinea, no «sin definir».

### El mapa {#the-map}

Cuatro dígitos de latitud y cuatro de longitud no son algo que puedas comprobar leyéndolos. Un signo menos que se pierde lleva un campo de Colorado al oeste de China y nada en pantalla se ve distinto, así que el lugar tiene un mapa: **🗺 Ver en el mapa**, en la tarjeta de lugar de lanzamiento, lo abre, y el editor de ubicaciones lleva uno junto a sus campos.

- **Satélite o callejero.** Las imágenes vienen por defecto y suelen ser las que responden a la pregunta, porque un campo de club es una franja segada en un henar: invisible en un callejero, inconfundible desde el aire. La capa de calles sirve para leer los caminos de acceso y el pueblo más cercano. Las dos vienen de los servicios de mapas de Esri; la capa de calles está construida sobre datos de OpenStreetMap y los acredita, pero la aplicación no usa a propósito los servidores de teselas de OpenStreetMap, que se sostienen con donaciones y no están ahí para que las aplicaciones se apoyen en ellos.
- **Al hacer clic en el mapa se fijan las coordenadas**, con cuatro decimales (unos 10 m, la misma precisión que escribe 📍 Usar mi ubicación). Es la única forma de introducir un campo sin coordenadas publicadas, y es una edición normal, así que se deshace como cualquier otra. Arrastra para desplazarte, y usa la rueda o **+** / **−** para acercar; un arrastre nunca cuenta como un clic.
- **Al escribir se mueve el marcador**, así que el mapa y los campos son dos vistas de una misma cosa y no dos sitios donde equivocarse.

Las teselas que ya has mirado quedan guardadas en la aplicación, así que una ubicación que consultaste en casa se dibuja igual en el campo sin cobertura. Un sitio que nunca has visto no se puede dibujar sin conexión: el mapa lo dice y pasa a una cuadrícula de coordenadas, que sigue situando el punto por hemisferios. Las teselas vienen de Esri, y solo se piden las de lo que estás mirando — consulta **[Sin conexión e instalación](./offline-and-installing.md)**.

Una ubicación guarda **solo el lugar**. La guía, el viento y la atmósfera son condiciones del día, y una ubicación que restaurara el viento del mes pasado sería peor que una que no restaurara nada: parecería fiable. Las ubicaciones viven en este navegador y en este dispositivo, como tus motores y materiales personalizados; no se sube nada.

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

Los resultados se muestran como fichas, en orden aproximadamente cronológico del vuelo, e incluyen:

- **Velocidad de salida del raíl** (marcada si está por debajo de tu mínimo de seguridad)
- **Retardo óptimo** y **tiempo hasta el apogeo**
- **Apogeo** (altitud máxima) y **velocidad / aceleración / Mach máximos**
- **Velocidad de apertura** (marcada si supera tu umbral de aviso; en verde cuando es suficientemente baja). En un diseño de [despliegue dual](./designing-a-rocket.md#despliegue-dual) el motor de vuelo juzga el principal y el piloto contra sus propios umbrales, y devuelve un aviso por cada uno.
- **Velocidad de aterrizaje**, **tiempo de vuelo** y **distancia recorrida**

Debajo de las fichas hay una tarjeta **Antes de volar**: qué son estos números (estimaciones de un modelo, no una hoja de vuelo), qué cosas el modelo nunca tuvo (el flutter de las aletas, las cargas estructurales, el inflado del paracaídas y su golpe de apertura, el comportamiento de tu motor ese día) y el recordatorio de pesar y equilibrar el cohete que realmente construiste e introducir esas medidas como invalidaciones antes de fiarte del margen. Enlaza con **[Seguridad](./safety.md)**, y aparece en cada ejecución porque se aplica a todas.

Para el historial temporal completo, abre las **[vistas de Vuelo y Trayectoria 3D](./views-and-analysis.md)**. Para guardar los números, consulta **[Archivos y exportaciones](./files-and-exports.md)**.

## Editar invalida los resultados

Cambiar el diseño borra el resultado guardado de cada simulación (la física ya no coincide): solo tienes que pulsar **Simular** otra vez. Lo mismo ocurre con **deshacer/rehacer**: restaura tu diseño y los *datos de entrada* de la simulación, pero no los resultados de vuelo guardados, así que vuelve a simular para ver el vuelo.
