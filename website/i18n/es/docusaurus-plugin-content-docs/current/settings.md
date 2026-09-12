---
title: "Ajustes"
sidebar_position: 6
---
Abre **Ajustes** desde el menú de la aplicación (☰, arriba a la derecha). Los ajustes son **globales**: se aplican a todos los diseños y simulaciones, y se recuerdan en tu navegador.

## Unidades

AstraRocketJs usa actualmente **solo unidades métricas / SI**: longitudes en mm/cm/m, masas en g/kg, etc. Todavía no hay una opción de unidades imperiales.

## Valores por defecto de la simulación

Estos valores inicializan cada nueva simulación (aún puedes ajustar las condiciones de lanzamiento de cada una — consulta [Ejecutar una simulación](./running-a-simulation.md)):

- **Paso de tiempo** — el tamaño de paso del integrador. Más pequeño es más preciso pero más lento.
- **Tiempo máximo** — un límite de seguridad sobre el tiempo de vuelo simulado.
- **Semilla aleatoria** — fija la aleatoriedad del viento y la turbulencia para que una simulación sea reproducible; déjala sin definir para obtener resultados variados.
- **Método de cálculo** — el modelo aerodinámico (el clásico Barrowman extendido, y las correcciones supersónicas de estilo RASAero, que son opcionales).

## Avisos de seguridad

Umbrales que colorean las fichas de resultados para que los problemas destaquen:

- **Velocidad mínima de salida de la guía** — la velocidad de salida de la varilla o el raíl por debajo de la cual el cohete puede no ir lo bastante rápido para volar recto; los resultados por debajo se marcan.
- **Aviso de velocidad de apertura** — si la recuperación se despliega por encima de esta velocidad, la ficha se marca (una apertura rápida puede dañar el paracaídas); una velocidad de apertura segura se muestra en verde.

## Restablecer

**Restablecer todo** devuelve cada ajuste a su valor por defecto.
