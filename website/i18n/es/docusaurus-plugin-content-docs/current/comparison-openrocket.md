---
title: "Comparación con OpenRocket"
sidebar_position: 18
---

import AppVersion from '@site/src/components/AppVersion';
import UpstreamPin from '@site/src/components/UpstreamPin';

:::info Instantánea, y cómo leerla

Escrito el **2026-09-29**, comparando **AstraRocketJs <AppVersion />** (motor compilado a partir de OpenRocket <UpstreamPin />) con **OpenRocket de escritorio**: la versión **24.12**, la versión numerada actual, y la línea de desarrollo `unstable` en la que se sitúa el commit fijado.

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
| **Apariencia, calcomanías y Photo Studio** (texturas sobre los componentes, imágenes renderizadas) | No disponible. Las clases `appearance` del núcleo sí se extraen, así que la apariencia de un archivo sobrevive a la ida y vuelta, pero nada en la interfaz la edita ni la dibuja. La vista 3D es un modelo sólido. |
| **Guardar tus propios componentes en una biblioteca** | En parte. **Guardar como pieza** almacena un componente que hayas construido y lo vuelve a ofrecer en el selector en todos los diseños, entero: geometría, material, acabado y color, y no solo las dimensiones que publica una fila del catálogo. **Menú → Mis piezas** las enumera, las edita y las elimina. Lo que falta es la mitad de archivo: los preajustes de OpenRocket son archivos `.orc` que se pueden compartir y cargar, y aquí una pieza guardada vive solo en tu navegador. Los conjuntos también quedan fuera: un tubo se guarda sin sus aletas. |
| **Carenados de cámara y otras protuberancias** | No disponible. Tampoco son componentes del modelo base de OpenRocket, así que incluso allí aportan masa y dibujo en vez de aerodinámica de primera clase. |
| **Impresión** | Distinta forma. OpenRocket imprime desde un diálogo de impresión; aquí el informe de diseño se escribe como un **PDF** que luego imprimes, y sus plantillas son 1:1. |
| **Idiomas** | OpenRocket se distribuye en más idiomas que esta aplicación. |

## Lo que tiene esta aplicación y OpenRocket de escritorio no

| Función | Notas |
| --- | --- |
| **Funciona en el navegador, se instala y funciona sin conexión** | Sin JDK y sin descarga. Tras la primera visita, la aplicación, el motor y ambos catálogos se quedan en tu dispositivo, así que una simulación completa se ejecuta en un campo sin cobertura. Consulta [Sin conexión e instalación](./offline-and-installing.md). |
| **Una disposición pensada para el móvil** | El banco de trabajo de escritorio se convierte en pestañas en la parte inferior, y las vistas del cohete giran un cuarto de vuelta para que el fuselaje ocupe el lado largo de la pantalla. |
| **Configuraciones de vuelo** (varias preparaciones con nombre por diseño, cada una con sus motores, su recuperación, sus etapas y las etapas activas) | Una pestaña **Configuraciones** propia: las filas son configuraciones, las columnas son los soportes, paracaídas o etapas que configuran, y cada simulación nombra la que vuela. Todas las configuraciones de un `.ork` entran conservando los identificadores del archivo, cada una con una simulación que la vuela. Consulta [Configuraciones de vuelo](./flight-configurations.md). |
| **Vista de traza sobre el terreno** | El vuelo visto desde arriba, con el norte arriba y la rampa en el centro, con anillos de distancia y la distancia y el rumbo de aterrizaje de cada etapa. |
| **Exportación de la trayectoria a KML / GPX / CSV de waypoints** | Abre el vuelo en Google Earth o en una aplicación GPS, con un color por etapa, un nombre de misión, globos de resumen con los números del vuelo y plantillas Mustache propias importables. |
| **3MF del cohete entero, y STL / GLB / 3MF por pieza** | Un archivo con un objeto con nombre por pieza, listo para el laminador. OpenRocket exporta OBJ, que esta aplicación también; el resto es adicional. |
| **Hojas de corte DXF** | Las piezas planas (aletas, anillos, mamparos) como archivos de corte 2D. |
| **Exportación a RASAero II (`.CDX1`)** | Entrega el diseño a RASAero II para su propio análisis aerodinámico. |
| **Exportación a RockSim `.rkt`** | OpenRocket abre archivos de RockSim; no los escribe. Aquí funcionan ambos sentidos, y cada uno nombra lo que deja atrás. Consulta [Archivos y exportaciones](./files-and-exports.md#rocksim-rkt). |
| **Ubicaciones de lanzamiento guardadas, sobre un mapa** | Da nombre al campo desde el que vuelas y recupera sus coordenadas y su elevación, con un mapa de satélite o de calles para contrastarlas con el terreno, y clic para fijarlas cuando el campo no tiene números publicados. Algo parecido está [abierto como pull request en el proyecto original](https://github.com/openrocket/openrocket/pull/3211) y no se ha publicado. |
| **El tiempo de un pronóstico, para una fecha elegida** | Rellena la temperatura, la presión, la humedad, un perfil de viento y la atmósfera en altura desde [Open-Meteo](./running-a-simulation.md#weather), con un registro del pronóstico usado. La versión de escritorio (PR #3211) aún no está integrada y solo consulta las condiciones actuales. |
| **Una atmósfera pronosticada en altura** | Temperatura, presión y humedad por altura, voladas en lugar de la atmósfera estándar por encima del sitio. El escritorio solo tiene la atmósfera estándar; la incidencia #2737 propone esto. Un `.ork` la lleva como una extensión que el escritorio ignora. |
| **Vista de entorno** | El aire que realmente encontró el vuelo, leído del vuelo registrado: las condiciones en el lanzamiento y cuatro perfiles frente a la altura. Consulta [Vistas y análisis](./views-and-analysis.md#environment-after-a-simulation). |
| **El aterrizaje a lo largo de las horas del pronóstico** | Tras una ejecución bajo un pronóstico, la vista Entorno vuela el mismo diseño bajo cada hora desde dos antes hasta dos después y sitúa en un mapa dónde aterrizó cada una, con una elipse 2σ alrededor. Consulta [Vistas y análisis](./views-and-analysis.md#where-it-landed). |
| **Estimador de aterrizaje** | Una herramienta que no necesita un diseño: un sitio, una hora del pronóstico, un apogeo y unas velocidades de descenso dan un aterrizaje sobre el suelo real y una zona de aterrizaje 2σ. Consulta [Herramientas](./tools.md#landing-estimator). |
| **Comprobación de la salida del raíl** | Una herramienta que no necesita un diseño: un motor del catálogo, la masa del cohete y la longitud del raíl dan la relación empuje-peso, la velocidad de salida del raíl y el ángulo de veleteo con un viento escrito o pronosticado. Consulta [Herramientas](./tools.md#off-the-rail). |
| **Dimensionado del descenso en paracaídas** | Elige una vela y mira la velocidad de descenso que da frente a las bandas de principal y piloto, y el diámetro necesario para alcanzar cada una o una velocidad propia, con un botón para aplicarlo. También en la pestaña Herramientas, sin diseño. |
| **Límites NAR / Tripoli, aplicados** | La rampa se mantiene dentro de 20 grados respecto a la vertical y el viento en superficie en 20 mph o menos, y una simulación fuera de eso se **rechaza** en lugar de volarse. Cada conjunto de resultados lleva una tarjeta "Antes de volar". Consulta [Seguridad](./safety.md). |
| **Deshacer que también cubre las simulaciones** | Las ediciones de componentes y los cambios de simulación (motor, encendido, condiciones de lanzamiento, añadir o borrar una simulación) están en una única línea temporal. |
| **Un selector de unidades en cada valor** | La unidad impresa junto a cualquier número es también un control para ese campo concreto, además de los perfiles métrico e imperial. Consulta [Ajustes](./settings.md#units). |
| **Nada que guardar y nada que se suba** | La edición se guarda sola, la barra superior dice cuándo se escribió por última vez, y no hay servidor ni cuentas. |

## Para qué usar cada uno

Si necesitas optimización, expresiones personalizadas, extensiones de simulación, renderizados fotorrealistas o un idioma que no sea inglés o español, usa el programa de escritorio. Si quieres los mismos números en el móvil y en el campo, sin instalar nada y sin red, usa este. Los archivos viajan en ambos sentidos, así que no es una elección definitiva.
