---
title: "Comparación con mmrocket-sim"
sidebar_position: 20
---

import AppVersion from '@site/src/components/AppVersion';
import UpstreamPin from '@site/src/components/UpstreamPin';
import MmrocketPin from '@site/src/components/MmrocketPin';

:::info Instantánea, y cómo leerla

Escrito el **2026-09-22**, comparando **AstraRocketJs <AppVersion />** (motor compilado a partir de OpenRocket <UpstreamPin />) con **[mmrocket-sim](https://github.com/mtnmanak/mmrocket-sim)** en <MmrocketPin />, la versión que `engine-java/extract/MMROCKET-SIM` registra como la última revisada aquí.

Esta página es más corta que las otras dos a propósito, y la sección sobre [lo que deliberadamente no compara](#lo-que-esta-pagina-no-tabula) explica por qué. En resumen: la documentación pública de mmrocket-sim cubre su compilación y su estructura, no su interfaz, y una tabla de funciones montada adivinando sobre la aplicación de otro es peor que no tener tabla.

:::

## Esta no es una comparación entre desconocidos

mmrocket-sim, de Mountain Man Rockets, es el pariente más cercano que tiene AstraRocketJs. Ambos son aplicaciones de navegador que ejecutan el núcleo real de OpenRocket, compilado desde Java con TeaVM, sin instalación y con soporte sin conexión. Llegaron a esa forma de manera independiente, y se solapan mucho más de lo que cualquiera de los dos se solapa con un programa de escritorio.

El tema de mmrocket-sim es la **aerodinámica supersónica al estilo RASAero**: las correcciones que necesita el modelo de Barrowman extendido de OpenRocket por encima de Mach 1,5 aproximadamente, calibradas con datos publicados de túnel de viento y de vuelo libre. En eso trabaja el proyecto, y esta aplicación incorpora su resultado bajo GPL-3.0 con atribución:

- el modelo de aerodinámica supersónica (`supersonicAero`), que es el grande: corrige el CP y la CNα del cuerpo por encima de Mach 1,5 aproximadamente, donde el Barrowman extendido original los congela en sus valores de Mach 1, y repara una pendiente de fuerza normal supersónica de las aletas que de otro modo sale a alrededor de la mitad de la teoría lineal;
- el acarreo cuerpo-aleta de Barrowman modificado por Rogers (`rogersKbf`);
- el suelo de resistencia de presión subsónica para ojivas achatadas (`stubbyNoseFloor`);
- el término de resistencia de base con motor encendido, gobernado por el diámetro de salida de la tobera;
- las secciones de perfil de aleta al estilo RASAero (`airfoilSection`);
- el banco de validación en túnel de viento con el que se puntúan las extensiones;
- y, fuera del motor, el componente **carenado** y su elemento de extensión de `.ork`.

Todas ellas están **desactivadas por defecto y condicionadas a su entrada**: con el indicador desactivado, los números son idénticos bit a bit a los de OpenRocket original. El crédito completo y el linaje de licencias están en [`engine-java/ATTRIBUTION.md`](https://github.com/thzero/AstraRocketJs/blob/master/engine-java/ATTRIBUTION.md), y la explicación de la física con las diferencias respecto a OpenRocket original está en `docs/rasaero/`.

Así que en aerodinámica supersónica esta aplicación va por detrás de mmrocket-sim, no compitiendo con ella. Si ese modelo es lo que buscas, ese es el proyecto que lo desarrolla.

## Lo que sí se puede comparar con pruebas

| | AstraRocketJs | mmrocket-sim |
| --- | --- | --- |
| **Forma** | Aplicación de navegador, instalable, funciona sin conexión | Aplicación de navegador, instalable, funciona sin conexión (según su README) |
| **Motor** | Núcleo de OpenRocket compilado con TeaVM | Núcleo de OpenRocket compilado con TeaVM |
| **Commit de OpenRocket** | <UpstreamPin />, una compilación de desarrollo posterior a 24.12 | OpenRocket 24.12, según su README |
| **Destino de compilación** | **WebAssembly (WASM-GC)** con JavaScript como alternativa; una etiqueta en la cabecera dice cuál se cargó | JavaScript, según su README |
| **Integrador de vuelo** | La compilación fijada incluye `RK4SimulationStepper` y `RK6SimulationStepper`, y ambos están en el manifiesto de extracción | RK4 con paso de tiempo adaptativo, según su README |
| **Extensiones supersónicas** | Incorporadas de mmrocket-sim, desactivadas por defecto, opcionales por indicador | Obra propia, desarrollada allí |
| **Idiomas** | Multilingüe | No se indica |

La diferencia de commit es la que tiene consecuencias prácticas: un núcleo más reciente es otro conjunto de correcciones del proyecto original, y dos aplicaciones sobre commits distintos de OpenRocket pueden discrepar legítimamente en un número sin que ninguna esté rota.

## Lo que esta página no tabula {#lo-que-esta-pagina-no-tabula}

Aquí no hay una tabla de "ellos lo tienen y nosotros no", y el motivo importa más que el hueco que deja.

En las comparaciones con OpenRocket y con ZenRockets, la otra parte publica una referencia de funciones, así que una fila se puede citar y comprobar. El README de mmrocket-sim documenta la estructura del repositorio, su compilación y las invariantes de su motor; no enumera su interfaz. Escribir filas a partir de una aplicación en funcionamiento que nadie de aquí se ha sentado a auditar produciría exactamente el tipo de afirmación segura e incomprobable que este apéndice pretende evitar, y sería una afirmación sobre un proyecto cuyo trabajo ya estamos incorporando.

Así que ve y úsala. Está en **[mmrsim.mountainmanrockets.com](https://mmrsim.mountainmanrockets.com)**, y el código está [en GitHub](https://github.com/mtnmanak/mmrocket-sim). Si conoces las dos lo bastante bien como para completar esta sección, [tu corrección es bienvenida](./contributing.md).

## Cómo se mantiene al día la relación

`engine-java/extract/MMROCKET-SIM` registra el commit contra el que se revisaron por última vez sus extensiones, de modo que "¿qué han cambiado desde la última vez que miramos?" es una pregunta con una respuesta calculable, y no una que dependa de que siga habiendo una copia antigua en el disco de alguien. Revisar significa descargar su repositorio, comparar ese commit con su cabeza actual, leer solo lo que llega al Java compartido y después dejar escrito qué se tomó y qué se descartó.

La revisión de <MmrocketPin /> es un buen ejemplo del tráfico habitual: dieciséis commits, cinco archivos Java compartidos tocados y todas las ediciones solo de comentarios. Se tomó una corrección (su arreglo de una nota que describía un desplazamiento del CP hacia atrás como un margen estático más conservador, cuando mover el CP hacia atrás *aumenta* el margen mostrado). Se descartaron dos cambios por no ser aplicables aquí, cada uno con su motivo por escrito. Conviene señalar que hoy es un canal de un solo sentido: las extensiones fluyen de ellos hacia aquí, y nada vuelve automáticamente.

El mismo archivo es cuidadoso con lo que no es. No condiciona nada, ninguna herramienta lo clona, y a `extract --check` ni le consta ni le importa. El único commit que condiciona algo aquí es el de OpenRocket, en la [Descripción general](./overview.md).
