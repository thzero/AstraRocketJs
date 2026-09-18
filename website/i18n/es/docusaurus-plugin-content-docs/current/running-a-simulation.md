---
title: "Ejecutar una simulación"
sidebar_position: 11
---
Las simulaciones están en el panel de la derecha. Puedes mantener **varias simulaciones con nombre** para un mismo diseño (por ejemplo, distintos motores o campos de vuelo), **duplicar** una como punto de partida y eliminarlas. El botón rojo **Eliminar simulación** (junto al nombre de la simulación actual) la borra tras una confirmación; el espacio de trabajo siempre conserva al menos una, así que se desactiva cuando solo queda una.

## Configura el lanzamiento

Cada simulación tiene su propia configuración de lanzamiento, agrupada en tarjetas:

- **Varilla / raíl de lanzamiento** — longitud, ángulo respecto a la vertical y dirección (o «lanzar contra el viento»).
- **Campo de vuelo** — altitud, latitud y longitud.
- **Atmósfera** — estándar ISA, o temperatura y presión personalizadas.
- **Viento** — velocidad media, rachas (desviación estándar) y dirección; o un perfil de viento **multinivel** que varía con la altitud.
- **Modelo terrestre** — plano, esférico o WGS84 (afecta a los vuelos largos o muy altos).

Las simulaciones nuevas parten de los valores por defecto de tus [Ajustes](./settings.md) globales.

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

## Interpreta los resultados

Los resultados se muestran como fichas, en orden aproximadamente cronológico del vuelo, e incluyen:

- **Velocidad de salida del raíl** (marcada si está por debajo de tu mínimo de seguridad)
- **Retardo óptimo** y **tiempo hasta el apogeo**
- **Apogeo** (altitud máxima) y **velocidad / aceleración / Mach máximos**
- **Velocidad de apertura** (marcada si supera tu umbral de aviso; en verde cuando es suficientemente baja)
- **Velocidad de aterrizaje**, **tiempo de vuelo** y **distancia recorrida**

Para el historial temporal completo, abre las **[vistas de Vuelo y Trayectoria 3D](./views-and-analysis.md)**. Para guardar los números, consulta **[Archivos y exportaciones](./files-and-exports.md)**.

## Editar invalida los resultados

Cambiar el diseño borra el resultado guardado de cada simulación (la física ya no coincide): solo tienes que pulsar **Simular** otra vez. Lo mismo ocurre con **deshacer/rehacer**: restaura tu diseño y los *datos de entrada* de la simulación, pero no los resultados de vuelo guardados, así que vuelve a simular para ver el vuelo.
