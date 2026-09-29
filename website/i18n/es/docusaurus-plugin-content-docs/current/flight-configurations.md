---
title: "Configuraciones de vuelo"
sidebar_position: 10
---
Una **configuración de vuelo** es una forma de preparar el cohete para volar: un motor en cada soporte, cuándo se abre cada dispositivo de recuperación, cuándo se suelta cada propulsor y qué etapas van en el aire. Cada simulación vuela una, y varias simulaciones pueden compartir la misma.

Es el modelo del propio OpenRocket, y es lo que hace que «el mismo cohete con un C6 y con un D12» sean dos preparaciones y no dos diseños. La pestaña **Configuraciones** es donde se crean; la pestaña **Simulaciones** es donde cada ejecución elige una.

## La tabla

Una fila por configuración, una columna por pieza que configura. Leer una fila dice qué hace esa preparación en todas partes; leer una columna dice qué hace el mismo soporte o el mismo paracaídas en cada preparación, que es la comparación para la que se diseña un cohete por etapas o con racimo de motores.

- **Nueva** añade una configuración con los motores por defecto, aunque ya exista una idéntica: dos configuraciones con los mismos motores son una decisión, no un descuido.
- **Copiar** duplica la seleccionada, motores incluidos, y coloca la copia junto a ella. La copia de una configuración con nombre lo dice; una sin nombre sigue sin nombre, porque su etiqueta son sus motores.
- **Eliminar** la quita. Las simulaciones que la vuelan pasan a la primera que quede, así que la aplicación pregunta antes cuando hay alguna. La última configuración no se puede eliminar: cada simulación nombra la que vuela.
- **Vuelos** cuenta las simulaciones que vuelan cada configuración.

Una configuración sin nombre se etiqueta con sus motores, igual que en el escritorio. Ponle nombre en el editor junto a la tabla cuando los motores no sean lo importante, por ejemplo *Concurso* o *Solo sustentador*.

Por debajo del punto de ruptura de escritorio las columnas de piezas desaparecen y el editor pasa debajo de la tabla, de modo que un teléfono llega a todo desde un solo panel.

## Motores

Una tarjeta por soporte de motor, de cola a punta. **Cambiar…** abre el [selector de motores](./motors.md), 📈 muestra la curva de empuje del motor colocado y **Encendido** indica cuándo se enciende ese motor:

- **Automático** es el patrón de baja y media potencia: la etapa de lanzamiento enciende al despegar y una etapa superior con la carga de eyección de la etapa inferior.
- **Lanzamiento**, **Eyección de la etapa superior**, **Fin de combustión de la etapa superior** y **Nunca**, cada uno con un retardo en segundos, son lo que necesita un sustentador con electrónica o un encendido en vuelo. Los disparadores de sustentador solo aparecen en un soporte que tenga una etapa por debajo, porque ninguna otra cosa puede activarlos.

Cambiar un motor aquí lo cambia para **todas** las simulaciones que vuelan esta configuración. Eso es lo que significa compartir una preparación, y por eso los motores se editan aquí y en ningún otro sitio: dos sitios escribiendo el mismo conjunto de motores con reglas distintas es como acaban por no coincidir.

## Recuperación

Cuándo se abre cada dispositivo de recuperación **en este vuelo**. Cada campo recae en el diseño: si lo dejas vacío se aplica el valor de la propia pieza, que se muestra como marcador de posición para que el control diga el número que el vuelo va a usar de verdad.

La anulación es por campo, así que una configuración puede mover la altitud y dejar el disparador donde lo puso el diseño: «abrir el principal a 150 m en este vuelo» es un campo, no una segunda copia del paracaídas.

Una pieza que alguna configuración abre de otra forma lo indica en el [panel de propiedades](./designing-a-rocket.md) del diseño, nombrando esas configuraciones, de modo que la altitud en pantalla nunca es un número que el vuelo ignoró en silencio.

## Etapas

Una tarjeta por etapa, se separe o no.

- **Vuela en esta configuración** decide si la etapa va en el vuelo. Una etapa en tierra no aporta masa, ni resistencia, ni motor: el resto del cohete vuela sin ella, que es como se vuela un diseño de dos etapas como su propio sustentador sin borrar el propulsor. Algo tiene que volar, así que la última etapa que queda en el aire no se puede dejar en tierra.
- **Separación de etapas**, **Retardo de separación** y **Altitud de separación** dicen cuándo se suelta un propulsor, con la misma vuelta al diseño que tienen los campos de recuperación. La etapa superior no tiene nada encima de lo que soltarse, así que solo muestra la casilla de vuela.

## Elegir una para una simulación

Cada fila de la tabla de [Simulaciones](./running-a-simulation.md) tiene un selector de **Configuración**, y el editor de la simulación tiene el mismo con los motores detallados debajo y un botón hacia esta pestaña. Apuntar una fila a otra configuración envejece sus números, igual que cualquier otro cambio en lo que vuela.

## En el archivo

Un `.ork` lleva sus configuraciones, y esta aplicación también: entran todas las que declara el archivo con sus motores, su recuperación, sus etapas y las que deja en tierra, y cada una llega como una simulación propia para que haya una ejecución a la que asociar números. Cada una conserva el identificador de configuración del archivo, así que un diseño abierto aquí y guardado de vuelta es el mismo conjunto de configuraciones y no una reescritura. Consulta [Archivos y exportaciones](./files-and-exports.md).
