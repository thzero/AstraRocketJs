---
title: "Ejecutar una simulación"
sidebar_position: 11
---
Las simulaciones están en el panel de la derecha. Puedes mantener **varias simulaciones con nombre** para un mismo diseño (por ejemplo, distintos motores o campos de vuelo), **duplicar** una como punto de partida y eliminarlas. El botón rojo **Eliminar simulación** (junto al nombre de la simulación actual) la borra tras una confirmación; el espacio de trabajo siempre conserva al menos una, así que se desactiva cuando solo queda una.

## Configura el lanzamiento

Cada simulación tiene su propia configuración de lanzamiento, agrupada en tarjetas:

- **Varilla / raíl de lanzamiento** — longitud, ángulo respecto a la vertical y dirección (o «lanzar contra el viento»).
- **Campo de vuelo** — altitud, latitud y longitud.
- **Atmósfera** — estándar ISA, o temperatura y presión personalizadas.
- **Viento** — velocidad media, rachas (desviación estándar) y dirección; o un perfil de viento **multinivel** que varía con la altitud.
- **Modelo terrestre** — plano, esférico o WGS84 (afecta a los vuelos largos o muy altos).

Las simulaciones nuevas parten de los valores por defecto de tus [Ajustes](./settings.md) globales.

## Ejecútala

Pulsa **Simular vuelo**. El vuelo se calcula en un **Web Worker** en segundo plano, así que la interfaz sigue respondiendo: se muestra un indicador mientras calcula (normalmente bastante menos de un segundo). Al terminar, se desbloquean las vistas de **Vuelo** y **Trayectoria 3D** y aparecen los resultados.

Si el diseño no puede volar —**sin soporte de motor** o **sin motor cargado**— el botón de simular se desactiva y explica el motivo, así que añade primero un soporte de motor (consulta [Diseñar un cohete](./designing-a-rocket.md)) o elige un motor.

## Interpreta los resultados

Los resultados se muestran como fichas, en orden aproximadamente cronológico del vuelo, e incluyen:

- **Velocidad de salida del raíl** (marcada si está por debajo de tu mínimo de seguridad)
- **Retardo óptimo** y **tiempo hasta el apogeo**
- **Apogeo** (altitud máxima) y **velocidad / aceleración / Mach máximos**
- **Velocidad de apertura** (marcada si supera tu umbral de aviso; en verde cuando es suficientemente baja)
- **Velocidad de aterrizaje**, **tiempo de vuelo** y **distancia recorrida**

Para el historial temporal completo, abre las **[vistas de Vuelo y Trayectoria 3D](./views-and-analysis.md)**. Para guardar los números, consulta **[Archivos y exportaciones](./files-and-exports.md)**.

## Editar invalida los resultados

Cambiar el diseño borra el resultado guardado de cada simulación (la física ya no coincide): solo tienes que pulsar **Simular** otra vez. Lo mismo ocurre con **deshacer/rehacer**: restaura tu diseño y los *datos de entrada* de la simulación, pero no los resultados de vuelo guardados, así que vuelve a simular para ver el vuelo.
