---
title: "Sin conexión e instalación"
sidebar_position: 7
---
AstraRocketJs funciona **sin conexión a internet** una vez que la has abierto, y se puede **instalar** para que quede junto a tus demás aplicaciones. No hace falta configurar nada (la primera visita se encarga), pero esto es lo que puedes esperar.

## Por qué puede funcionar sin conexión {#why-it-can-work-offline}

La física no se ejecuta en un servidor. El motor de OpenRocket está compilado a WebAssembly y se ejecuta dentro de tu navegador, así que una vez que la aplicación y sus datos están en tu dispositivo no queda nada a lo que llamar. Así puedes diseñar, editar y ejecutar simulaciones de vuelo completas en un campo de vuelo sin cobertura.

## Qué se guarda para el uso sin conexión {#what-gets-saved-for-offline-use}

En tu primera visita, el navegador almacena discretamente, en segundo plano:

- la propia aplicación,
- el **motor de física** (~2,7 MB),
- estas **páginas de ayuda** (~4,2 MB), para que **Ayuda** se abra sin conexión,
- el **catálogo de motores** (~1.150 motores con curvas de empuje) y el **catálogo de componentes** (~5.200 piezas),
- los **[cohetes de ejemplo](./getting-started.md#example-rockets)** (~330 kB los dieciséis), para que uno se abra en una primera carga sin conexión y no solo si estabas conectado cuando fuiste a buscarlo.

Unos 16 MB en total. No tienes que hacer nada para activarlo: basta con dejar que termine la primera carga.

El catálogo de motores lleva consigo la **curva de empuje** de cada motor, así que simular sin conexión funciona incluso con motores que nunca has abierto: 1.063 de los 1.156. Los 93 restantes no tienen curva publicada que incluir; el selector los señala y necesitan conexión para descargarla de thrustcurve.org (y queda en caché una vez lo hagas).

**Las imágenes de mapa son la excepción.** Se descargan según las miras, no de antemano, y las teselas que ya has visto se conservan, así que un campo que consultaste en casa sigue dibujándose en el lanzamiento sin cobertura. Un terreno que no has visto nunca no se puede dibujar sin conexión: el mapa del lugar de lanzamiento recurre a una retícula de coordenadas, y la traza en tierra y la trayectoria 3D a sus gráficos simples, que de todos modos llevan la medida.

**El tiempo necesita conexión.** [El tiempo de Open-Meteo](./running-a-simulation.md#weather) se consulta cuando lo pides y no se guarda para usarlo sin conexión. Lo que hayas aplicado se queda en la simulación.

**Tus diseños son locales.** Tu biblioteca de cohetes guardados, tus motores y materiales personalizados y tus ajustes viven en el almacenamiento de tu navegador, en tu dispositivo, y nunca dependen de una conexión.

## Cómo instalarla {#installing-it}

Tu navegador te ofrecerá instalar la aplicación. Dónde encontrarlo:

| | |
|---|---|
| **Android (Chrome)** | Menú **⋮** → *Añadir a pantalla de inicio* / *Instalar aplicación* |
| **iPhone / iPad (Safari)** | Compartir **↑** → *Añadir a pantalla de inicio* |
| **Escritorio (Chrome / Edge)** | El icono de instalar en la barra de direcciones, o Menú → *Instalar AstraRocketJs* |
| **Escritorio (Safari)** | Archivo → *Añadir al Dock* |

Instalarla le da su propio icono y su propia ventana, sin pestañas ni barra de direcciones. Es la misma aplicación en cualquier caso: instalar no desbloquea nada, y el uso sin conexión funciona la instales o no.

> **Firefox** no ofrece instalación en el escritorio. El uso sin conexión sigue funcionando ahí; simplemente la abres como una pestaña o un marcador normal.

## Actualizaciones {#updates}

Cuando se publica una versión nueva, aparece un aviso bajo la cabecera que ofrece **recargar**. Nunca recarga mientras estás mirando la pestaña, porque eso podría interrumpir un diseño a medias, y por la misma razón no es un diálogo: dice lo suyo y te deja terminar lo que estabas escribiendo. Cuando la pestaña lleva unos treinta segundos en segundo plano, sin ningún vuelo, barrido de viento ni diálogo en curso, la actualización se aplica ahí sin preguntar.

**Más tarde** lo guarda y lo vuelve a mostrar al cabo de un par de horas. La **✕** solo oculta el aviso: la actualización se aplica igualmente la próxima vez que la pestaña pase esos treinta segundos en segundo plano, o cuando recargues.

**Buscar actualizaciones**, en el menú de la aplicación (☰, arriba a la derecha), pregunta en el momento y da una de tres respuestas: que tienes la versión más reciente; que hay una nueva lista, y entonces el aviso vuelve aunque lo hubieras cerrado; o «No se pudieron buscar actualizaciones. Puede que no tengas conexión.»

La aplicación busca versiones nuevas más o menos cada diez minutos, y de nuevo cada vez que vuelves a la pestaña o se restablece la conexión, así que una pestaña abierta todo el día también se entera de que se ha publicado algo. Una recarga normal también trae la versión nueva directamente, así que nunca hace falta una recarga forzada; el sitio se sirve a través de una CDN que conserva los archivos hasta diez minutos, que es lo máximo que tarda una publicación en llegarte.

Los catálogos de motores y componentes se actualizan aparte de la propia aplicación, en segundo plano, así que los motores nuevos te llegan sin necesidad de actualizarla.

Sin conexión, los botones que la necesitan aparecen atenuados y lo indican al señalarlos: consultar el tiempo, obtener el viento pronosticado en Salida del raíl, buscar un lugar por nombre, la estimación del aterrizaje, volar las horas del pronóstico y buscar actualizaciones. Todo lo demás funciona como siempre.

## Cómo borrarla {#clearing-it}

Borrar los datos del sitio de AstraRocketJs en tu navegador elimina la copia sin conexión y **también elimina tus cohetes guardados, tus motores y tus materiales personalizados**, porque viven en el mismo almacenamiento del navegador. Exporta antes como `.ork` todo lo que quieras conservar. Guardado en una carpeta sincronizada (iCloud Drive, OneDrive, Google Drive, Dropbox), sirve además como copia de seguridad que puedes reabrir en cualquier sitio (consulta **[Archivos y exportaciones](./files-and-exports.md)**).

Si instalaste la aplicación, desinstálala como quitarías cualquier otra aplicación de tu dispositivo.
