---
title: "Motores"
sidebar_position: 9
---
Un motor se asigna al **soporte de motor** (tubo interior) del cohete. Los motores viven en una [configuración de vuelo](./flight-configurations.md), y la pestaña **Configuraciones** es donde se eligen: una tarjeta por soporte, cada una con el motor que lleva y un botón **Cambiar…** para elegir otro.

## El selector de motores

El selector busca en un catálogo incluido de **~1.150 motores reales** de [thrustcurve.org](https://www.thrustcurve.org): filtra por fabricante, diámetro, clase de impulso y designación. Al seleccionar un motor se muestran sus dimensiones y su impulso total.

Tres filtros más funcionan como en el selector de motores de OpenRocket de escritorio:

- **Ocultar motores fuera de producción regular**: el catálogo incluye unos 340 motores fuera de producción, para quien aún tenga uno. Quedan ocultos hasta que desmarcas esta casilla, y el detalle de un motor dice **Fuera de producción**. La elección se recuerda.
- **Ocultar motores ya usados en el soporte**: deja fuera los motores que este soporte ya vuela en sus otras configuraciones de vuelo. Aparece cuando hay alguno.
- **Ocultar curvas de empuje muy parecidas**: muchos motores tienen más de una curva (certificada, del fabricante, enviada por usuarios). Con esto activado, la lista de curvas deja fuera las que se parecen más de un 95 % a la mostrada, según la medida del propio OpenRocket. Activado por defecto, y se recuerda.

- El **catálogo** (las especificaciones de cada motor) viene con la aplicación, así que no hace falta ninguna consulta para explorarlo.
- La **curva de empuje** viene incluida en el catálogo para la mayoría de los motores, así que elegir uno se resuelve al instante y funciona sin conexión. Los motores sin curva publicada se señalan en el selector; su curva se descarga de thrustcurve.org la primera vez que los eliges y luego se guarda en caché (se revalida de vez en cuando y recurre a la copia en caché si la descarga falla).

## Retardo de eyección

Cuando un motor ofrece varios retardos de eyección, elige el que vas a volar (o la opción **taponado** para motores usados sin carga de eyección). El retardo alimenta el momento de apertura de la recuperación en la simulación.

## Importar tus propios motores

### Archivos `.eng` (RASP)
Importa un archivo de curva de empuje **`.eng`** estándar: lleva su propia curva, así que no hace falta ninguna consulta. Los motores importados aparecen en el selector (señalados y eliminables) y se guardan en tu navegador. Puedes elegir varios archivos a la vez; un archivo que no se puede leer se nombra y los demás se importan.

### Archivos `.rse` (RockSim)
El mismo botón acepta **`.rse`**, que es el formato indicado para un **híbrido**: RASP no tiene forma de registrar QUÉ es un motor, así que un motor importado desde `.eng` es de tipo desconocido, mientras que uno importado desde `.rse` aparece como híbrido (o recargable, o de un solo uso) en el panel de detalle del motor. Es también el único que puede indicar que un motor se vende **taponado**, que es lo que busca el filtro correspondiente del selector.

Es el formato más rico en otro aspecto que cambia lo que vuelas. `.eng` da un único peso de propelente y deja que la curva de masa se reconstruya a partir de la curva de empuje; `.rse` registra la masa en cada muestra, y la simulación usa esas cifras medidas directamente cuando el archivo las aporta. También lleva el CG real del motor en el despegue, en lugar de la aproximación a media longitud que obliga a usar un archivo RASP. Un archivo que pide que se recalculen su masa o su CG (`auto-calc-mass`, `auto-calc-cg`) recibe la misma reconstrucción que `.eng`, que es lo que hace OpenRocket con él.

Un `.rse` puede contener un motor o toda la gama de un fabricante; se importan todos los motores del archivo y el selector indica cuántos han entrado. El formato se detecta por el contenido del archivo y no por su nombre, así que un `.rse` guardado como `.eng` se lee igualmente bien.

### Motores personalizados
Los motores personalizados o importados se conservan localmente junto a tus materiales personalizados, así que están disponibles en todos tus diseños en ese navegador.

## Varios soportes

Un diseño puede tener más de un soporte de motor (por ejemplo, en clúster o por etapas). Cada soporte tiene su propia tarjeta en la pestaña Configuraciones, de cola a punta, y cada configuración lleva un motor para todos ellos. Los soportes conservan los motores con los que se importaron o abrieron, y un soporte recién añadido empieza con un **motor por defecto** para que el diseño siempre esté listo para volar: solo tienes que pulsar **Cambiar…** en su tarjeta para elegir el real. Si eliminas un soporte, su motor se descarta automáticamente. Consulta [Configuraciones de vuelo](./flight-configurations.md) para la ignición, las etapas y cómo una preparación se comparte entre simulaciones.
