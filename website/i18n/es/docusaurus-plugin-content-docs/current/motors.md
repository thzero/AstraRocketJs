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

### Archivos `.rse` (RockSim)
El mismo botón acepta **`.rse`**, que es el formato indicado para un **híbrido**: RASP no tiene forma de registrar QUÉ es un motor, así que un motor importado desde `.eng` es de tipo desconocido, mientras que uno importado desde `.rse` aparece como híbrido (o recargable, o de un solo uso) en el panel de detalle del motor. Es también el único que puede indicar que un motor se vende **taponado**, que es lo que busca el filtro correspondiente del selector.

Es el formato más rico en otro aspecto que cambia lo que vuelas. `.eng` da un único peso de propelente y deja que la curva de masa se reconstruya a partir de la curva de empuje; `.rse` registra la masa en cada muestra, y la simulación usa esas cifras medidas directamente cuando el archivo las aporta. También lleva el CG real del motor en el despegue, en lugar de la aproximación a media longitud que obliga a usar un archivo RASP. Un archivo que pide que se recalculen su masa o su CG (`auto-calc-mass`, `auto-calc-cg`) recibe la misma reconstrucción que `.eng`, que es lo que hace OpenRocket con él.

Un `.rse` puede contener un motor o toda la gama de un fabricante; se importan todos los motores del archivo y el selector indica cuántos han entrado. El formato se detecta por el contenido del archivo y no por su nombre, así que un `.rse` guardado como `.eng` se lee igualmente bien.

### Motores personalizados
Los motores personalizados o importados se conservan localmente junto a tus materiales personalizados, así que están disponibles en todos tus diseños en ese navegador.

## Varios soportes

Un diseño puede tener más de un soporte de motor (por ejemplo, en clúster o por etapas). El soporte **principal** (el primero, de la ojiva a la cola) toma el motor que se muestra en la parte superior del panel de Simulaciones; cada soporte adicional tiene su propia tarjeta debajo. Los soportes adicionales conservan los motores con los que se importaron o abrieron, y un soporte recién añadido empieza con un **motor por defecto** para que el diseño siempre esté listo para volar: solo tienes que pulsar **Cambiar…** en su tarjeta para elegir el real. Si eliminas un soporte, su motor se descarta automáticamente. Consulta [Ejecutar una simulación](./running-a-simulation.md) para el uso de etapas y la ignición.
