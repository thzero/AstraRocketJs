---
title: "Comparación con OpenRocket"
sidebar_position: 18
---

import AppVersion from '@site/src/components/AppVersion';
import UpstreamPin from '@site/src/components/UpstreamPin';

:::info Instantánea, y cómo leerla

Escrito el **2026-09-22**, comparando **AstraRocketJs <AppVersion />** (motor compilado a partir de OpenRocket <UpstreamPin />) con **OpenRocket de escritorio**: la versión **24.12**, la versión numerada actual, y la línea de desarrollo `unstable` en la que se sitúa el commit fijado.

Una página de comparación se queda obsoleta sin que nada falle, así que trata la fecha de arriba como la caducidad de lo que se afirma aquí. Si una fila es incorrecta, es un error como cualquier otro: [avísanos](./contributing.md).

Esto es un mapa de funciones, no un argumento de venta. Las filas que merece la pena leer son aquellas en las que OpenRocket de escritorio tiene algo que esta aplicación no tiene, y cada una de ellas dice **por qué**, porque una carencia sin un motivo detrás es solo una disculpa.

:::

## Lo único que no es una diferencia

La [Descripción general](./overview.md) dice que AstraRocketJs cubre "lo esencial en lugar de todas las funciones del escritorio".

La aerodinámica, el cálculo de masa y CG, y la integración del vuelo son **el propio código de OpenRocket**, extraído del commit indicado arriba y compilado a WebAssembly y JavaScript. No son una reimplementación ni una aproximación, y se comprueba que son idénticos bit a bit frente al mismo núcleo ejecutándose sobre una JVM. Por eso no hay ninguna fila que diga "OpenRocket calcula la resistencia con más precisión": para el mismo diseño, el mismo motor y las mismas condiciones, salen los mismos números.

Todo lo que sigue trata, por tanto, del **programa que rodea al motor**: qué puedes crear, qué puedes mirar y qué puedes sacar de ahí.

## Lo que tiene OpenRocket de escritorio y esta aplicación no

| Función del escritorio | Situación aquí, y por qué |
| --- | --- |
| **Optimización de cohetes** (buscar el valor de un parámetro del diseño que maximiza el apogeo, la altitud o la velocidad) | No disponible. El paquete `optimization` de OpenRocket no forma parte de la extracción (`engine-java/extract/manifest.txt`), así que la maquinaria de búsqueda ni siquiera está en el núcleo incluido. Habría que reconstruirla del lado de JavaScript. |
| **Expresiones personalizadas** (definir tu propia variable de vuelo a partir de las simuladas y graficarla) | No disponible, por el mismo motivo: el paquete `customexpression` no se extrae. La exportación del vuelo a CSV te da las series en bruto para calcular por tu cuenta. |
| **Extensiones de simulación y scripting** (encendido en el aire, control de alabeo, la extensión de scripting en JavaScript) | No disponible. El paquete `simulation/extension` no se extrae, así que una extensión no puede ejecutarse. Se nota en los ejemplos incluidos: los dos diseños de "extensión de simulación" se abren y vuelan como fuselajes normales, que es justo lo que dicen sus descripciones. |
| **Configuraciones de vuelo en la interfaz** (varios conjuntos de motores con nombre por diseño, elegidos desde un desplegable) | A medias. Un `.ork` que lleva varias configuraciones las **conserva** al ir y volver, y al importar se avisa cuando una configuración que no abriste usa un motor que falta en el catálogo. Pero la aplicación abre **una** como una única simulación, y no hay forma de crearlas ni de cambiar entre ellas. |
| **Apariencia, calcomanías y Photo Studio** (texturas sobre los componentes, imágenes renderizadas) | No disponible. Las clases `appearance` del núcleo sí se extraen, así que la apariencia de un archivo sobrevive a la ida y vuelta, pero nada en la interfaz la edita ni la dibuja. La vista 3D es un modelo sólido. |
| **Guía de marcado de aletas** (la plantilla de papel que se enrolla en el tubo y dice dónde va cada aleta) | No disponible todavía. El informe de diseño ya imprime plantillas 1:1 de aletas, ojivas y transiciones, así que es un dibujo nuevo y no maquinaria nueva. Importa sobre todo para las **aletas tubulares**, que no tienen ninguna plantilla de corte. |
| **Guardar tus propios componentes en una biblioteca** | No disponible. Los **motores** y los **materiales** personalizados tienen su propio almacén y persisten entre diseños; los componentes no tienen equivalente, así que una ojiva que hayas modelado no se puede reutilizar en el siguiente cohete. Elegir del catálogo de ~2.900 piezas de fabricantes sí funciona. |
| **Archivos de motor `.rse` (RockSim)** | No disponible: solo `.eng`. Se echa de menos sobre todo en los híbridos, cuyos datos suelen distribuirse en `.rse`. |
| **Dimensiones del dispositivo de recuperación plegado** | No disponible. Los materiales de la vela y de las cuerdas, el número y la longitud de las bridas, y el Cd de la cinta sí se editan, pero la longitud y el radio *plegados* no los lee la fábrica de componentes del núcleo incluido, así que no pueden afectar a la masa ni al CG. Una ida y vuelta por `.ork` escribe constantes en su lugar. |
| **Carenados de cámara y otras protuberancias** | No disponible. Tampoco son componentes del modelo base de OpenRocket, así que incluso allí aportan masa y dibujo en vez de aerodinámica de primera clase. |
| **Impresión** | Distinta forma. OpenRocket imprime desde un diálogo de impresión; aquí el informe de diseño se escribe como un **PDF** que luego imprimes, y sus plantillas son 1:1. |
| **Idiomas** | OpenRocket se distribuye en más idiomas que esta aplicación. |
| **Vuelo por etapas validado** | Aquí los cohetes multietapa se pueden crear y simular como ramas independientes, y su masa, CG y estabilidad estáticos coinciden con OpenRocket de escritorio. La trayectoria volada por etapas (el momento de la separación y del encendido de la etapa superior, el descenso del propulsor) **no** se ha comprobado de principio a fin contra el escritorio. Trata esos resultados como preliminares. Consulta [Seguridad](./safety.md). |

## Lo que tiene esta aplicación y OpenRocket de escritorio no

| Función | Notas |
| --- | --- |
| **Funciona en el navegador, se instala y funciona sin conexión** | Sin JDK y sin descarga. Tras la primera visita, la aplicación, el motor y ambos catálogos se quedan en tu dispositivo, así que una simulación completa se ejecuta en un campo sin cobertura. Consulta [Sin conexión e instalación](./offline-and-installing.md). |
| **Una disposición pensada para el móvil** | El banco de trabajo de escritorio se convierte en pestañas en la parte inferior, y las vistas del cohete giran un cuarto de vuelta para que el fuselaje ocupe el lado largo de la pantalla. |
| **Aerodinámica supersónica al estilo RASAero** | Correcciones opcionales al Barrowman extendido por encima de Mach 1,5 aproximadamente, donde el modelo original congela el CP del cuerpo en su valor de Mach 1. **No** forman parte de OpenRocket: son obra del proyecto mmrocket-sim, incorporada aquí bajo GPL-3.0. Consulta [Comparación con mmrocket-sim](./comparison-mmrocket-sim.md). |
| **Vista de traza sobre el terreno** | El vuelo visto desde arriba, con el norte arriba y la rampa en el centro, con anillos de distancia y la distancia y el rumbo de aterrizaje de cada etapa. |
| **Exportación de la trayectoria a KML / GPX / CSV de waypoints** | Abre el vuelo en Google Earth o en una aplicación GPS, con un color por etapa, un nombre de misión, globos de resumen con los números del vuelo y plantillas Mustache propias importables. |
| **3MF del cohete entero, y STL / GLB / 3MF por pieza** | Un archivo con un objeto con nombre por pieza, listo para el laminador. OpenRocket exporta OBJ, que esta aplicación también; el resto es adicional. |
| **Hojas de corte DXF** | Las piezas planas (aletas, anillos, mamparos) como archivos de corte 2D. |
| **Exportación a RASAero II (`.CDX1`)** | Entrega el diseño a RASAero II para su propio análisis aerodinámico. |
| **Exportación a RockSim `.rkt`** | OpenRocket abre archivos de RockSim; no los escribe. Aquí funcionan ambos sentidos, y cada uno nombra lo que deja atrás. Consulta [Archivos y exportaciones](./files-and-exports.md#rocksim-rkt). |
| **Ubicaciones de lanzamiento guardadas, sobre un mapa** | Da nombre al campo desde el que vuelas y recupera sus coordenadas y su elevación, con un mapa de satélite o de calles para contrastarlas con el terreno, y clic para fijarlas cuando el campo no tiene números publicados. Algo parecido está [abierto como pull request en el proyecto original](https://github.com/openrocket/openrocket/pull/3211) y no se ha publicado. |
| **Dimensionado del descenso en paracaídas** | Elige una vela y mira la velocidad de descenso que da frente a las bandas de principal y piloto, y el diámetro necesario para alcanzar cada una. |
| **Límites NAR / Tripoli, aplicados** | La rampa se mantiene dentro de 20 grados respecto a la vertical y el viento en superficie en 20 mph o menos, y una simulación fuera de eso se **rechaza** en lugar de volarse. Cada conjunto de resultados lleva una tarjeta "Antes de volar". Consulta [Seguridad](./safety.md). |
| **Deshacer que también cubre las simulaciones** | Las ediciones de componentes y los cambios de simulación (motor, encendido, condiciones de lanzamiento, añadir o borrar una simulación) están en una única línea temporal. |
| **Un selector de unidades en cada valor** | La unidad impresa junto a cualquier número es también un control para ese campo concreto, además de los perfiles métrico e imperial. Consulta [Ajustes](./settings.md#units). |
| **Nada que guardar y nada que se suba** | La edición se guarda sola, la barra superior dice cuándo se escribió por última vez, y no hay servidor ni cuentas. |

## En qué están a la par

Edición del árbol de componentes con CG, CP y estabilidad en vivo. Creación de etapas múltiples y paralelas con separación y tiempos de encendido. Edición de aletas de forma libre. Anulaciones de masa y CG. El catálogo de ~2.900 piezas y la base de materiales de OpenRocket. Materiales y motores personalizados. Selección de motores con curvas de empuje reales, elección del retardo de eyección y motores taponados, además de importación de `.eng`. Análisis de componentes: resistencia por pieza desglosada, la contribución de cada una a la estabilidad y su propio CP, y el forzado y amortiguamiento de alabeo de cada juego de aletas, a lo largo de un barrido de Mach con ángulo de ataque y dirección de viento elegidos. Gráficas de vuelo. Trayectoria 3D con reproducción, desplazamiento por la línea temporal y control de velocidad. Informe de diseño, plantillas 1:1 y resúmenes en CSV. Ida y vuelta de `.ork` con fidelidad completa en ambos sentidos.

## Para qué usar cada uno

Si necesitas optimización, expresiones personalizadas, extensiones de simulación, renderizados fotorrealistas o un idioma que no sea inglés o español, usa el programa de escritorio. Si quieres los mismos números en el móvil y en el campo, sin instalar nada y sin red, usa este. Los archivos viajan en ambos sentidos, así que no es una elección definitiva.
