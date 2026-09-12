---
title: "Sin conexión e instalación"
sidebar_position: 7
---
AstraRocketJs funciona **sin conexión a internet** una vez que la has abierto, y se puede **instalar** para que quede junto a tus demás aplicaciones. No hace falta configurar nada —la primera visita se encarga—, pero esto es lo que puedes esperar.

## Por qué puede funcionar sin conexión {#why-it-can-work-offline}

La física no se ejecuta en un servidor. El motor de OpenRocket está compilado a WebAssembly y se ejecuta dentro de tu navegador, así que una vez que la aplicación y sus datos están en tu dispositivo no queda nada a lo que llamar. Eso hace que el uso sin conexión sea realmente útil: puedes diseñar, editar y ejecutar simulaciones de vuelo completas en un campo de vuelo sin cobertura.

## Qué se guarda para el uso sin conexión {#what-gets-saved-for-offline-use}

En tu primera visita, el navegador almacena discretamente, en segundo plano:

- la propia aplicación,
- el **motor de física** (~2,3 MB),
- el **catálogo de motores** (~800 motores con curvas de empuje) y el **catálogo de componentes** (~2.900 piezas).

Unos 8 MB en total. No tienes que hacer nada para activarlo: basta con dejar que termine la primera carga.

El catálogo de motores lleva consigo la **curva de empuje** de cada motor, así que simular sin conexión funciona incluso con motores que nunca has abierto: 781 de los 815. Los 34 restantes no tienen curva publicada que incluir; el selector los señala y necesitan conexión para descargarla de thrustcurve.org (y queda en caché una vez lo hagas).

**Tus diseños siempre fueron locales.** Tu biblioteca de cohetes guardados, tus motores y materiales personalizados y tus ajustes viven en el almacenamiento de tu navegador, en tu dispositivo: eso no ha cambiado y nunca dependió de una conexión.

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

Cuando se publica una versión nueva, aparece un pequeño mensaje que ofrece **recargar**. No se recargará por su cuenta, porque eso podría interrumpir un diseño a medias. Ciérralo y seguirás usando la versión actual hasta que recargues, cuando te venga bien.

Los catálogos de motores y componentes se actualizan aparte de la propia aplicación, en segundo plano, así que los motores nuevos te llegan sin necesidad de actualizarla.

## Cómo borrarla {#clearing-it}

Borrar los datos del sitio de AstraRocketJs en tu navegador elimina la copia sin conexión y, lo que es más importante, **también elimina tus cohetes guardados, tus motores y tus materiales personalizados**, porque viven en el mismo almacenamiento del navegador. Exporta antes como `.ork` todo lo que quieras conservar: en una carpeta sincronizada (iCloud Drive, OneDrive, Google Drive, Dropbox) sirve además como copia de seguridad que puedes reabrir en cualquier sitio (consulta **[Archivos y exportaciones](./files-and-exports.md)**).

Si instalaste la aplicación, desinstálala como quitarías cualquier otra aplicación de tu dispositivo.
