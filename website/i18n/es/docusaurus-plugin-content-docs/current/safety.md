---
title: "Seguridad"
sidebar_position: 13
---
AstraRocketJs es una herramienta de diseño y simulación. No es una autoridad en seguridad, y una simulación no es una hoja de vuelo. Esta página dice con claridad cuánto valen los números, qué cosas el modelo no sabe, y qué comprobar antes de volar.

## Qué es un resultado de simulación {#what-a-simulation-result-is}

Toda cifra que produce la aplicación es **educativa y especulativa**. Responde a la pregunta "qué haría este modelo bajo estas suposiciones". No es una predicción, ni una evaluación de seguridad, ni un certificado de aptitud para el vuelo.

Trata el apogeo, el margen de estabilidad, la velocidad de apertura, la velocidad de descenso y la distancia de aterrizaje como estimaciones *contra las que* diseñar, y luego verifícalas con el cohete que realmente construiste y con el campo en el que realmente estás. Un margen calculado a partir de un plano es el margen de un plano.

## Qué hace el modelo {#what-the-model-does}

La física es el propio núcleo de OpenRocket, compilado para ejecutarse en tu navegador y validado bit a bit contra el programa de escritorio. Calcula:

- La **aerodinámica** por el método Barrowman extendido (con extensiones supersónicas), que da el CP, la resistencia y la estabilidad.
- La **masa y el CG** a partir de la geometría de cada pieza por la densidad de su material, más cualquier [invalidación](#before-you-fly) que introduzcas.
- El **vuelo** como movimiento de cuerpo rígido integrado con RK4/RK6, gobernado por la curva de empuje real del motor que elegiste.
- La **atmósfera** como el modelo estándar ISA, o con tu propia temperatura y presión, con un modelo de gravedad WGS o constante y una Tierra plana, esférica o WGS84.
- El **viento** como una media única con una desviación estándar de ráfagas, o como un perfil multinivel que cambia con la altitud, ambos con turbulencia de ruido rosa.

La aplicación también muestra los avisos de vuelo del propio núcleo: apertura a alta velocidad, un principal que se abre demasiado rápido o demasiado lento, un piloto sin principal, ausencia de sistema de recuperación, una apertura estando aún en la guía, un ángulo de ataque grande, y vuelo supersónico donde el método aerodinámico pasa a ser aproximado. Léelos: son el modelo diciéndote que no está cómodo.

## Qué no sabe el modelo {#what-the-model-does-not-know}

Ser explícito sobre las carencias es más útil que una advertencia genérica:

- **El aleteo (flutter) de las aletas.** No hay ningún modelo aeroelástico en el motor de física. Una aleta puede ser perfectamente estable en la simulación y desprenderse a Mach 0,8 en la realidad. La rigidez de las aletas, su fijación y su margen de flutter quedan enteramente en tus manos.
- **La resistencia estructural.** El cohete es un cuerpo rígido. Nada comprueba si el fuselaje sobrevive al max-Q, a una apertura brusca o a un desgarro del tubo.
- **El inflado del paracaídas.** La resistencia de un dispositivo de recuperación se activa en su evento de apertura, tras el retardo que hayas fijado. Ni el transitorio de inflado del velamen ni la carga de choque de apertura se calculan. La aplicación te avisa de una apertura rápida en lugar de decirte qué le hace al tubo.
- **La variación del motor.** La curva de empuje es una curva de certificación, no tu motor el día del lanzamiento. La dispersión entre lotes, la temperatura del propelente, la edad y el almacenamiento mueven el número real.
- **La diferencia entre el modelo y lo que construiste.** Los filetes de cola, la pintura, una ojiva más pesada de lo que supone la tabla de materiales, un juego de aletas dos grados torcido, un paracaídas plegado más apretado de lo que admite la bahía. La simulación vuela el plano.
- **El suelo.** Sin terreno, sin obstáculos, sin árboles, sin térmicas, sin efecto suelo, y sin la fricción del lanzador ni un cohete que se atasque en la guía.

## Antes de volar {#before-you-fly}

El panel de resultados encabeza sus números con una tarjeta **Antes de volar** que lleva la versión corta de esta página. Se pliega: pulsa su encabezado y la explicación se recoge, aunque antes te pide confirmar que has leído las notas, porque el pliegue se recuerda y ese clic es la última vez que se ofrecen en este navegador. El encabezado nunca se pliega, así que el aviso sigue sobre los números elijas lo que elijas.

Lo más valioso que puedes hacer es dejar de simular un plano y empezar a simular el cohete que tienes sobre la mesa:

1. **Pesa el cohete terminado**, listo para volar pero sin el motor. Selecciona su etapa en el editor de componentes (en un cohete de una sola etapa esa es la totalidad), activa la **invalidación de masa** e introduce la cifra medida con "aplicar a todos los subcomponentes" activado.
2. **Encuentra el punto de equilibrio.** Equilibra el cohete sobre el canto de una regla, mide desde la punta de la ojiva e introdúcelo como **invalidación del CG**.
3. **Vuelve a leer el margen de estabilidad** con esos números puestos. Ese es el margen que importa. Si se movió, tu modelo estaba equivocado en algo, y vale la pena averiguar en qué.
4. **Comprueba la velocidad de salida de la guía** en los resultados de vuelo. Un cohete que sale despacio se orienta hacia el viento, y ahí es donde la simulación es menos fiable.
5. **Comprueba la velocidad de descenso y la de aterrizaje**, y la traza sobre el suelo para ver cuánto te aleja a sotavento. Luego mira el tamaño real del campo.
6. **Vuelve a ejecutar tras cualquier cambio**, incluido un cambio de motor. Los resultados solo valen para el diseño y las condiciones con los que se ejecutaron.

La sección de invalidaciones ofrece masa, CG y coeficiente de resistencia, cada una con un interruptor de "aplicar a todos los subcomponentes", igual que en OpenRocket. Consulta [Diseñar un cohete](./designing-a-rocket.md).

## Los límites que impone la aplicación {#the-limits-the-app-enforces}

Dos condiciones de lanzamiento se contrastan con los códigos de seguridad de la **NAR** y **Tripoli**, y la aplicación se niega a volar una simulación fuera de ellos en lugar de darte un número que no está dispuesta a respaldar:

- **Ángulo de la guía de lanzamiento** dentro de **20 grados** de la vertical.
- **Viento en superficie** igual o inferior a **20 mph** (32 km/h).

Solo se juzga el viento en la rampa, y las ráfagas deliberadamente no se comprueban. El razonamiento, y qué ocurre con un archivo `.ork` que llega fuera de los límites, está en [Ejecutar una simulación](./running-a-simulation.md#safety-limits).

Estas son las dos únicas reglas que la aplicación impone. No sustituyen a los códigos, que cubren mucho más de lo que la aplicación puede ver: dimensiones mínimas del campo, sistemas de recuperación, certificación de motores, ignición, distancias al público y bastante más.

## Tus responsabilidades {#your-responsibilities}

La aplicación no sabe nada de dónde estás ni de qué te está permitido hacer allí. Eres responsable de:

- Conocer y seguir el **código de seguridad** bajo el que vuelas. En EE. UU. son los [códigos de seguridad de la NAR](https://www.nar.org/safety-codes/) (modelismo y alta potencia) o el [Código de Seguridad Unificado de Tripoli](https://www.tripoli.org/safetycode). En otros países, el equivalente de tu organización nacional.
- Las **normas de espacio aéreo y las autorizaciones** para la altitud que pretendes alcanzar. Una cifra de apogeo de esta aplicación no es una autorización.
- La **ley sobre compra, certificación, transporte y almacenamiento de motores** donde vivas, y tener el nivel de certificación que el motor exige.
- El **permiso para lanzar** en el terreno que vayas a usar.
- Las **normas del campo** y el **responsable de seguridad de vuelo** (RSO). Lo que decida el RSO está por encima de cualquier cosa en tu pantalla.

## Motores experimentales y de investigación {#experimental-and-research-motors}

La aplicación modela motores a partir de curvas de empuje publicadas, y puede importar una curva que hayas medido tú. No es una guía para diseñar, fabricar ni encender un motor, y nada en ella evalúa si un motor es seguro de construir o de encender. El trabajo con motores experimentales es peligroso y, en la mayoría de los sitios, está estrictamente regulado. Corresponde a una organización de investigación y a las personas cualificadas para supervisarlo.

## Si un número parece equivocado {#if-a-number-looks-wrong}

Si la aplicación discrepa del OpenRocket de escritorio, o de un vuelo que realmente hiciste, merece la pena informarlo: las diferencias frente al programa de escritorio se tratan como errores, porque el motor está pensado para coincidir con él. Consulta [Contribuir](./contributing.md).
