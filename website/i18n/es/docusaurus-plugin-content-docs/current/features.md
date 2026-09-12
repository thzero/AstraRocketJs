---
title: "Características"
sidebar_position: 2
---
## Física {#physics}
- Ejecuta el **núcleo de física real** de OpenRocket — aerodinámica Barrowman extendido (+ correcciones supersónicas de estilo RASAero), masa y CG, y vuelo RK4/RK6 — compilado a **WebAssembly** (con JavaScript como alternativa), validado como idéntico bit a bit al OpenRocket original.
- Las simulaciones de vuelo se ejecutan en un **Web Worker**, fuera del hilo principal, así que la interfaz sigue respondiendo durante el cálculo.

## Diseño y análisis {#design--analysis}
- **Editor de árbol de componentes** (ramas plegables y lista) con **CG / CP / estabilidad** en vivo mientras editas —en calibres y % de la longitud—, además de la relación de finura, el **peso de recuperación** (masa de descenso), el **coeficiente de resistencia** y la **pendiente de fuerza normal** (CNα) a Mach 0,3, y los **momentos de inercia de balanceo y cabeceo** con el cohete cargado, en la franja de estadísticas.
- **Cohetes de varias etapas** — añade etapas propulsoras, cápsulas y propulsores en paralelo (adosados); configura la **separación** de etapas (ignición / fin de combustión / eyección / apogeo / altitud / nunca) y el momento de **ignición de las etapas superiores**.
- **Dimensionado del descenso en paracaídas** — selecciona una campana para ver la velocidad de descenso que proporciona (frente a las bandas de principal y piloto) y el diámetro necesario para alcanzar cada una, a partir de la masa de descenso y la densidad del aire del campo de vuelo.
- **Escala todo el cohete** por un factor o hasta un diámetro de fuselaje objetivo, en un solo paso reversible: cada longitud, diámetro, pared, planta de aleta y posición, dejando intacto el herraje de tamaño fijo (botones de raíl, carenados de cámara, diámetros de guía).
- **Deshacer / rehacer** en todo el espacio de trabajo: añadir, quitar y editar componentes **y** los cambios de simulación (motor, ignición, condiciones de lanzamiento, añadir/renombrar/eliminar simulaciones) en una sola línea temporal, con `Ctrl/⌘+Z` y `Ctrl+Mayús+Z` (o las flechas de la barra). Una edición = un paso, incluso al arrastrar un deslizador.
- **Esquema 2D** con **calibres** de arrastrar y medir, reglas de longitud y sección, zoom y desplazamiento, giro sobre el eje y una vista posterior (de frente).
- Vista de **modelo 3D**, y una **trayectoria de vuelo 3D** tras una simulación. Los marcadores de **CG / CP** y una tarjeta de vistazo rápido con **longitud · masa · CG · CP · estabilidad** se pueden activar en las vistas 2D y 3D.
- **Vista aerodinámica**: Cd frente a Mach, desglose de la resistencia (fricción / presión / base) y CP frente a Mach.
- **Gráficas de vuelo**: altitud, velocidad, aceleración, Mach, empuje, masa, resistencia y estabilidad a lo largo del tiempo. En un vuelo por etapas, la trayectoria de cada etapa se superpone como su propia línea, con un selector para elegir cuáles mostrar.

- **Varios cohetes a la vez** — la aplicación mantiene una biblioteca de tus diseños en el navegador; cambia entre ellos desde **Abrir…**, renómbralos o elimínalos, y usa **Guardar como…** para ramificar una copia. Todo se guarda solo mientras trabajas. Consulta **[Archivos y exportaciones](./files-and-exports.md)**.
- **Funciona sin conexión y se instala** — la aplicación, el motor y los catálogos se conservan en tu dispositivo tras la primera visita, así que puedes diseñar y simular sin conexión; tu navegador también te ofrecerá añadirla a tu pantalla de inicio o escritorio. Consulta **[Sin conexión e instalación](./offline-and-installing.md)**.

## Datos y entrada/salida {#data--io}
- **Compatibilidad total con `.ork`** — importación y exportación de ida y vuelta con total fidelidad (los archivos se reabren en OpenRocket de escritorio).
- **Selector de motores** con **curvas de empuje** reales de [thrustcurve.org](https://www.thrustcurve.org) (~800 motores), descargadas una vez y guardadas en caché para uso sin conexión. Filtra por código de motor, clase de impulso, fabricante y un **rango de diámetros** que por defecto es el del soporte del motor; las selecciones se recuerdan.
- Elige entre las **varias curvas de empuje** de un motor (la elegida es la que simula el motor de física), define el **retardo de eyección** a partir de las cargas del propio motor o con un valor manual, o **tapona** cualquier motor. Una tarjeta por motor muestra la curva y el retardo, con una **ventana emergente de la curva de empuje**; los cohetes con varios soportes reciben **una tarjeta por tubo de motor**. Además, **importación de `.eng`** y motores personalizados.
- **Materiales** de OpenRocket (los incorporados y los tuyos) y un catálogo de **preajustes de componentes** (~2.900 piezas reales de Estes / Apogee / LOC / …).
- **Exportaciones**: un **informe de diseño** completo (resumen, detalle de piezas, motores y plantillas 1:1 de aletas, ojivas y transiciones) a **PDF**, o el resumen del diseño a **CSV**; el diseño a **RASAero II (`.CDX1`)** para análisis aerodinámico; componentes individuales a **modelos 3D (STL / OBJ / GLB)** para impresión y CAD, y las piezas planas (aletas, anillos, mamparos) a hojas de corte **DXF**; datos de vuelo y tablas de resistencia a **CSV**; la **trayectoria de vuelo** a **KML / GPX / CSV de puntos de paso** (Google Earth / cartografía GPS) con **plantillas Mustache** personalizadas importables; y el esquema 2D a **SVG / PNG / JPG**.
- Varias **simulaciones** con nombre, cada una con una configuración de lanzamiento completa (varilla, campo de vuelo, atmósfera, viento multinivel, modelo terrestre).

## Plataforma {#platform}
- **Solo en el cliente** — sin servidor, sin cuentas, sin subir nada. Tus cohetes se guardan en el navegador y puedes exportar un `.ork` a tu disco.
- **Adaptable** — un banco de trabajo de tres paneles en escritorio que se pliega en una sola columna con pestañas en el móvil.
- **Navegación por teclado** — el árbol de componentes se recorre completamente con las flechas (una accesibilidad más amplia es un trabajo en curso).
- Disponible en **inglés y español**.

## Aún no compatible {#not-yet-supported}
- **Solo unidades métricas/SI** — todavía no hay opción imperial ni preferencia de unidades.
- **Las trayectorias de vuelo por etapas aún no están validadas** — los cohetes de varias etapas se pueden crear y simular (cada propulsor vuela su propia rama), y su masa, CG y estabilidad estáticos coinciden con OpenRocket, pero la trayectoria volada por etapas no se ha comprobado de principio a fin contra OpenRocket de escritorio. Considera los resultados de vuelo por etapas como preliminares.
- Un único tema (oscuro).

Consulta las [Preguntas frecuentes](./faq.md) para más detalles sobre los límites actuales.
