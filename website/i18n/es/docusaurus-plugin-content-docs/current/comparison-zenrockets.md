---
title: "Comparación con ZenRockets"
sidebar_position: 19
---

import AppVersion from '@site/src/components/AppVersion';
import UpstreamPin from '@site/src/components/UpstreamPin';

:::info Instantánea, y cómo leerla

Escrito el **2026-09-23**, comparando **AstraRocketJs <AppVersion />** (motor compilado a partir de OpenRocket <UpstreamPin />) con **[ZenRockets](https://zenrockets.com)** en la versión **v0.2.0**, la última entrada de [su registro de cambios](https://zenrockets.com/docs/changelog) en esa fecha (fechada el 2026-09-15).

Dos advertencias honestas, porque cambian lo que vale esta página:

- Está escrita a partir de **[su documentación pública](https://zenrockets.com/docs)**, no del producto en funcionamiento. Su documentación puede ir por detrás de su aplicación, y una fila de aquí puede quedar obsoleta a la semana siguiente.
- La escribimos nosotros, sobre un proyecto que no es nuestro. Hemos procurado que la tabla de "ellos lo tienen y nosotros no" sea la más larga de la página, porque es la que de verdad le sirve a quien lee. Si alguna fila es injusta o incorrecta, [dínoslo](./contributing.md) y se corrige.

:::

## No son el mismo tipo de herramienta

Lo primero que conviene saber es que no comparten motor de física.

AstraRocketJs ejecuta **el propio núcleo de OpenRocket**, compilado a WebAssembly y JavaScript, y validado como idéntico bit a bit frente a ese mismo código sobre una JVM. ZenRockets [acredita](https://zenrockets.com/docs/acknowledgements) a **RocketPy** como "la base de simulación de vuelo que usa el servicio de trayectorias de ZenRockets", a **openMotor** por su trabajo de balística interna, y a OpenRocket por la compatibilidad de formatos de archivo y como referencia de validación.

Así que el mismo cohete, el mismo motor y las mismas condiciones no darán necesariamente el mismo apogeo en ambos. Ninguno de los dos resultados es automáticamente el correcto. Si te importa cuál lo es, vuela el cohete y compara los dos con el altímetro.

Lo segundo es la forma del producto. ZenRockets es un servicio con cuenta: los diseños son "privados por defecto, con enlaces públicos para compartir y clonar", con paneles para cohetes, motores, vuelos, preajustes y materiales, y previsiones meteorológicas en vivo por vuelo. AstraRocketJs se ejecuta solo en el cliente: sin cuenta, sin servidor, sin subir nada, y sigue funcionando con la red apagada.

## Lo que tiene ZenRockets y esta aplicación no

Esta es la tabla útil. Cada fila dice en qué punto estamos y, cuando lo hay, el motivo.

| Función de ZenRockets | Situación aquí, y por qué |
| --- | --- |
| **Diseñar el propio motor**: carcasas a medida, cinco geometrías de grano, toberas convergente-divergentes, propelentes propios con regímenes de velocidad de combustión dependientes de la presión, y una simulación de balística interna que da empuje, presión de cámara, Kn y flujo másico | No hay nada comparable, ni está previsto. Esta aplicación **elige** motores a partir de curvas de empuje publicadas; no los diseña. Eso es otro programa con otro núcleo físico, y ZenRockets va muy por delante en ello. |
| **Datos de ensayo estático**: importar la traza de empuje de un banco de pruebas y superponerla a una curva simulada, o volar la medida | No disponible. Importamos curvas `.eng` y permitimos elegir entre las curvas publicadas de un motor, pero no hay superposición de lo medido frente a lo previsto. |
| **Importación de registros de vuelo**: leer el CSV de un ordenador de vuelo como un vuelo grabado, con reconstrucción de la trayectoria por filtro de Kalman y detección automática de eventos | No disponible, y es la mayor carencia individual. Está [en la hoja de ruta como un "quizá"](https://github.com/thzero/AstraRocketJs/blob/master/TODO.md) por un motivo concreto: no existe un CSV de altímetro estándar. Cada fabricante escribe sus propias columnas, unidades y cabeceras, así que la única versión que merece la pena construir es un lector genérico más un perfil guardado de correspondencia de columnas por altímetro. La mitad posterior ya existe aquí (las gráficas, la trayectoria 3D y la traza sobre el terreno ya dibujan varios vuelos a la vez). |
| **Comparar hasta cinco vuelos con alineación temporal de una décima de segundo** | A medias. Varias simulaciones ya se superponen en las gráficas, en la traza sobre el terreno y en la vista 3D, con un color por serie. Lo que falta es el **desplazamiento temporal por vuelo**: un registro grabado empieza cuando el altímetro se despertó, así que sin él la superposición es ilegible. Llegará con la importación de registros, no antes. |
| **Dimensiones enlazadas**: un campo puede referenciar la dimensión de otra pieza en vez de escribirse, de modo que el diámetro exterior de un acoplador siga al interior del tubo | No disponible, y lo único que lo impide es el trabajo de hacerlo. Cada valor de ajuste se teclea a mano, así que al ensanchar un tubo su acoplador, sus anillos de centrado, su tope de motor y su soporte se quedan en el diámetro anterior, y nada lo señala. Hay una restricción de diseño real, y está en el archivo y no en la aplicación: `.ork` no tiene dónde guardar un enlace, así que un diseño guardado para el escritorio conserva los números resueltos y pierde la relación que hay detrás. |
| **Vista de corte**: un corte del modelo 3D que deja ver el interior (soporte de motor, anillos, mamparos, acopladores, la bahía del paracaídas) | No disponible. Hay un esquema 2D, un modelo 3D sólido, una vista aerodinámica y las vistas de vuelo, pero no hay forma de mirar dentro del 3D. Es un plano de recorte y no geometría nueva, así que es una carencia real pero no difícil. |
| **Una tabla de eventos que se lee de arriba abajo**, con el estado en cada instante (salida de rampa con velocidad, estabilidad, ángulo de ataque y relación empuje-peso; fin de combustión por motor; separaciones; aperturas con la velocidad a la que se dispararon; velocidad de toma de tierra) | Sí. La tabla **Eventos de vuelo**, junto a las gráficas, da a cada evento su tiempo, altitud y velocidad, con los números por los que se lee cada momento en las filas que los tienen: margen estático, relación empuje-peso y ángulo de ataque en la salida de rampa, y Mach en el fin de empuje. Una apertura nombra el paracaídas que se disparó, así que un drogue de doble apertura se distingue del principal, y una etapa con racimo obtiene una fila por motor. Todas las etapas están en la misma tabla, intercaladas en el mismo reloj de lanzamiento. Se exporta a CSV, donde cada uno de esos extras pasa a ser su propia columna. |
| **Max-Q** | Sí, como ficha de resumen y como fila de la tabla de eventos. El motor no registra la presión dinámica, pero sí registra sus dos mitades, así que q = ½ρv² se deriva en la aplicación a partir de la densidad del aire y la velocidad del sonido que cada simulación ya lleva. La velocidad empleada es la **velocidad aerodinámica**, no la velocidad respecto al suelo: ambas difieren con viento, y q es una propiedad del aire por el que vuela el cohete. |
| **Perfiles de atmósfera resueltos**: lo que la simulación voló realmente, como viento, presión y temperatura frente a la altitud, más las condiciones en la rampa | No disponible. Mostramos solo el lado de **entrada**: los campos de lanzamiento y el perfil de viento que hayas escrito. Una simulación que recurrió a la atmósfera estándar deja campos en blanco sin manera de ver qué se sustituyó. |
| **Previsiones meteorológicas en vivo de varios modelos, y campos de lanzamiento reales con consulta de elevación** | A medias. Las ubicaciones guardadas con mapa de satélite y clic para fijar coordenadas sí están; una **previsión** no. Sería la primera llamada de red saliente de la aplicación para algo que no sean los catálogos de motores y piezas, lo cual es una decisión de postura antes que de código, y lo que devolviera tendría que ajustarse igualmente a los límites NAR / Tripoli, porque el tiempo real es perfectamente capaz de desaconsejar el vuelo. |
| **Imágenes de mapa bajo la trayectoria** | Sí, cuando se piden. La traza en tierra puede dibujarse sobre imágenes de satélite o de callejero del campo de lanzamiento, y el plano del suelo de la trayectoria 3D toma las mismas imágenes bajo el vuelo. Ambas empiezan desnudas y no descargan nada hasta que pides el terreno. |
| **Suma de masas y aislamiento de etapa en el árbol de piezas**: un interruptor que cambia cada fila entre su propia masa y la de todo su subárbol, y un recálculo de masa, CG, CP y estabilidad para una sola etapa | No disponible. El aislamiento de etapa es el que más duele: es como se comprueba si un propulsor agotado es estable en su propio descenso, que es la pregunta que más necesita hacerse un diseño multietapa. Ambos son vistas de solo lectura sobre datos que la aplicación ya tiene. |
| **Enlaces para compartir, clonado y paneles** | No disponible, por diseño. No hay cuenta ni servidor que aloje un enlace. Los diseños son archivos en tu disco, así que compartir uno significa enviar el `.ork`. |

## Lo que tiene esta aplicación y ZenRockets no

Contrastado con su documentación en la fecha indicada arriba.

| Función | Notas |
| --- | --- |
| **El propio motor de OpenRocket, idéntico bit a bit** | No es un modelo construido sobre las mismas ideas: es el código real, validado contra el programa de escritorio. Si lo que buscas es coincidir con OpenRocket de escritorio, esa es la diferencia. |
| **Escribir `.ork` y `.rkt`, no solo leerlos** | Su asistente de importación lee diseños de OpenRocket y de RockSim; su exportación documentada es 3MF para impresión. Aquí ambos formatos también salen con fidelidad completa, así que un diseño no queda atrapado en la herramienta que lo abrió. Consulta [Archivos y exportaciones](./files-and-exports.md). |
| **Aletas tubulares, colas anulares y pods anidados al importar de RockSim** | Su documentación de importación los da por omitidos. Aquí las aletas tubulares se importan y se simulan. |
| **Funcionar del todo sin conexión, sin subir nada** | La aplicación, el motor y ambos catálogos se quedan en tu dispositivo tras la primera visita, y no hay cuenta. Un servicio que necesita sesión y una descarga de previsión es otra propuesta muy distinta en un campo sin cobertura. |
| **Análisis de componentes** | Resistencia por pieza desglosada en presión, base y fricción, la contribución de cada pieza a la estabilidad y su propio CP, y el forzado y amortiguamiento de alabeo de cada juego de aletas, a lo largo de un barrido de Mach con ángulo de ataque, dirección de viento y velocidad de alabeo elegidos, con un ajuste **Peor caso** que busca el ángulo de viento en el que el CP queda más adelantado. |
| **Aerodinámica supersónica al estilo RASAero** | Correcciones opcionales por encima de Mach 1,5 aproximadamente, calibradas con datos publicados de túnel de viento y de vuelo libre. Consulta [Comparación con mmrocket-sim](./comparison-mmrocket-sim.md). |
| **Todo lo que puedes sacar de ella** | Un informe de diseño completo en PDF con plantillas 1:1 de aletas, ojivas y transiciones; hojas de corte DXF; STL, OBJ, GLB y 3MF por pieza más 3MF del cohete entero; RASAero II `.CDX1`; datos de vuelo y tablas de resistencia en CSV; la trayectoria en KML, GPX o CSV de waypoints con plantillas propias; y el esquema en SVG, PNG o JPG. Su exportación documentada es 3MF. |
| **Límites NAR / Tripoli, aplicados** | Una simulación con la rampa a más de 20 grados de la vertical o con viento en superficie por encima de 20 mph se rechaza en lugar de volarse. Su validación previa al vuelo produce errores, avisos y alertas; no es lo mismo que negarse a volar. |
| **Multilingüe** | |

## En qué están a la par

Fuselajes paramétricos con el conjunto habitual de componentes y perfiles de ojiva. Editor de aletas de forma libre. Preajustes de piezas y biblioteca de materiales. Masa, CG, CP de Barrowman y estabilidad en calibres en vivo. Vuelos multietapa con separación y encendido por etapa. Recuperación en apogeo, a una altitud o por carga de eyección. Clústeres de motores con retardos por motor. Validación previa al vuelo en lenguaje claro. Gráficas de vuelo sincronizadas. Reproducción 3D con desplazamiento por la línea temporal y control de velocidad, más traza sobre el terreno. Cohetes de ejemplo. Borradores autoguardados y deshacer. Unidades métricas e imperiales por categoría, almacenadas en SI. Exportación 3MF para impresión.

## Para qué usar cada uno

Si quieres diseñar el motor además del cohete, o traer el registro de tu altímetro junto a la predicción, ZenRockets hace cosas que esta aplicación no hace en absoluto. Si quieres los números de OpenRocket en concreto, archivos que salgan en el formato en el que entraron, o una aplicación que funcione con la red apagada, usa esta.
