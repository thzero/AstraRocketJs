---
title: "Motores"
sidebar_position: 9
---
Un motor se asigna al **soporte de motor** (tubo interior) del cohete. El panel de Simulaciones de la derecha muestra el motor actual de la simulación seleccionada y un botón **Cambiar…** para elegir otro.

## El selector de motores

El selector busca en un catálogo incluido de **~800 motores reales** de [thrustcurve.org](https://www.thrustcurve.org): filtra por fabricante, diámetro, clase de impulso y designación. Al seleccionar un motor se muestran sus dimensiones y su impulso total.

- El **catálogo** (las especificaciones de cada motor) viene con la aplicación, así que no hace falta ninguna consulta para explorarlo.
- La **curva de empuje** viene incluida en el catálogo para 781 de los 815 motores, así que elegir uno se resuelve al instante y funciona sin conexión. Los 34 motores sin curva publicada se señalan en el selector; su curva se descarga de thrustcurve.org la primera vez que los eliges y luego se guarda en caché (se revalida de vez en cuando y recurre a la copia en caché si la descarga falla).

## Retardo de eyección

Cuando un motor ofrece varios retardos de eyección, elige el que vas a volar (o la opción **taponado** para motores usados sin carga de eyección). El retardo alimenta el momento de apertura de la recuperación en la simulación.

## Importar tus propios motores

### Archivos `.eng` (RASP)
Importa un archivo de curva de empuje **`.eng`** estándar: lleva su propia curva, así que no hace falta ninguna consulta. Los motores importados aparecen en el selector (señalados y eliminables) y se guardan en tu navegador.

### Motores personalizados
Los motores personalizados o importados se conservan localmente junto a tus materiales personalizados, así que están disponibles en todos tus diseños en ese navegador.

## Varios soportes

Un diseño puede tener más de un soporte de motor (por ejemplo, en clúster o por etapas). El soporte **principal** (el primero, de la ojiva a la cola) toma el motor que se muestra en la parte superior del panel de Simulaciones; cada soporte adicional tiene su propia tarjeta debajo. Los soportes adicionales conservan los motores con los que se importaron o abrieron, y un soporte recién añadido empieza con un **motor por defecto** para que el diseño siempre esté listo para volar: solo tienes que pulsar **Cambiar…** en su tarjeta para elegir el real. Si eliminas un soporte, su motor se descarta automáticamente. Consulta [Ejecutar una simulación](./running-a-simulation.md) para el uso de etapas y la ignición.
