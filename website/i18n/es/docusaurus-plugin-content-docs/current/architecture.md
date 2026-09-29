---
title: "Arquitectura e interioridades"
sidebar_position: 16
---
> Referencia de arquitectura para desarrolladores: la inmersión profunda tras la [Guía del desarrollador](./developer-guide.md), que cubre compilar, ejecutar y enviar cambios. El [README](https://github.com/thzero/AstraRocketJs/blob/HEAD/README.md) del repositorio es el resumen breve; [Contribuir](./contributing.md) cubre informar de fallos, traducir y las tareas de mantenimiento.

AstraRocketJs ejecuta el **núcleo de física de OpenRocket** en el navegador, compilado a **WebAssembly** (con **JavaScript como alternativa**). Es un monorepo:

- `engine-java/` — el núcleo de física de OpenRocket (de su rama **unstable**), extraído y parcheado mínimamente para TeaVM, compilado a **dos** destinos: un módulo WebAssembly (WASM-GC) y un módulo JavaScript (GPL-3.0; consulta `engine-java/ATTRIBUTION.md`).
- `web/` — la interfaz adaptable: Vite + React + TypeScript + Tailwind CSS. Consume el motor mediante un envoltorio tipado (`web/src/engine/openRocketEngine.ts`), que elige el motor al cargar y muestra cuál está activo en la cabecera.

## El motor extraído (`engine-java/src/java/`) {#the-extracted-engine-engine-javasrcjava}

El módulo `core` completo de OpenRocket son unos 700 archivos Java y arrastra Guice, JAXB, GraalVM-JS y classgraph, ninguno de los cuales puede manejar TeaVM (el compilador de Java a JavaScript/WASM). La **extracción** es una copia puntual de solo los ~270 archivos que la física y la simulación realmente necesitan, dejando atrás toda la maquinaria dependiente de la reflexión (cargadores de archivos, sistema de complementos, scripting, enganches de interfaz gráfica).

`src/java/` sigue la rama **unstable** de OpenRocket, con las sobrescrituras de compatibilidad con TeaVM de `patches/` aplicadas encima (`UUID`→`LongUUID`, un mapa concurrente cambiado por uno simple, una búsqueda del calculador aerodinámico sin reflexión, y un `ArrayList.clone()` de constructor de copia que exigen las conversiones estrictas de WASM-GC). **Esto es el motor**: cuando la interfaz llama a `staticInfo()` o `simulate()`, este es el código que se ejecuta. No edites los archivos extraídos directamente; los cambios pasan por una sobrescritura documentada en `patches/` (solo al actualizar la versión original de OpenRocket).

Fuentes extraídas por área:

| archivos | paquete | qué es |
|------:|---------|------------|
| 73 | `rocketcomponent` | modelo del cohete: ojiva, tubo, aletas, etapas, soportes de motor, configuraciones de vuelo |
| 60 | `util` | utilidades de matemáticas y geometría (Coordinate, cuaterniones, interpolación) |
| 41 | `simulation` | simulador de vuelo: integradores RK4/RK6, pasos, detección de volteo, eventos y datos de vuelo |
| 18 | `aerodynamics` | Barrowman extendido + RASAero: CP, resistencia y estabilidad (desglose de fuerzas) |
| 16 | `unit` | sistema de unidades (SI internamente) |
| 12 | `models` | atmósfera (ISA), modelos de gravedad, viento |
| 10 | `motor` | modelo de motor por curva de empuje |
| 4 | `masscalc` | CG, masa y momento de inercia |
| … | resto | registro, i18n, materiales, preajustes, apariencia |

(~270 archivos del núcleo bajo `src/java/`, más `src/shims/`, `src/jdkstubs/` y la fachada `src/api/`: 286 archivos Java en total.)

## Canalización de compilación → ejecución {#build--run-pipeline}

1. `engine-java/` (núcleo extraído + los reemplazos solo-JVM de `src/shims/` + un sustituto del `Collator` del JDK en `src/jdkstubs/` + la fachada @JSExport `src/api/OpenRocketEngine`) lo compila TeaVM a **dos destinos**: un módulo **WASM-GC** y un módulo **JavaScript**. Ambos salen de las mismas fuentes, y `node engine-java/build-engine.mjs` compila y copia los dos.
2. Los artefactos compilados están versionados para que la aplicación web compile sin un JDK:
   - JS → `web/src/engine/vendor/openrocket-engine.mjs`
   - WASM → `web/public/engine/openrocket-engine.wasm` (+ su `*.wasm-runtime.js`)
3. `web/` los importa mediante el envoltorio tipado `openRocketEngine.ts`; React nunca toca los módulos en bruto.

**Selección de motor.** `initEngine()` carga **WASM-GC por defecto** (más rápido) y recurre a la compilación **JS** cuando el navegador carece de soporte WASM o la carga falla. Ambos se cargan **dinámicamente** (un fragmento o descarga aparte), así que solo se descarga uno, nunca los dos. Se puede forzar con `?engine=js` / `?engine=wasm` (o `localStorage.setItem('engine', …)`); la insignia de la cabecera muestra cuál está activo. Se ha verificado que los dos motores son **idénticos bit a bit**.

TeaVM requiere `optimization = NONE` + `fastGlobalAnalysis = true` (consulta `engine-java/build.gradle`): su optimizador por defecto compila mal el núcleo (pone masas a cero y colapsa instancias de aletas). WASM-GC necesita además el parche del `ArrayList.clone()` de constructor de copia (sus conversiones estrictas rechazan el `(ArrayList) super.clone()` de la JVM).

**Hilos.** Las llamadas **interactivas** al motor —CG/CP/estabilidad en vivo en cada edición (`staticInfo`), el barrido aerodinámico (`getAeroSweep`), la información de componentes— se ejecutan **de forma síncrona en el hilo principal** (son rápidas, del orden de milisegundos, y deben ser instantáneas). La **simulación de vuelo** (`simulate`, ~500 ms) se ejecuta en un **Web Worker** con su propia instancia del motor, así que una ejecución nunca congela la interfaz (`engine/simClient.ts` + `engine/simWorker.ts`; el worker construye el cohete idéntico mediante el `services/buildRocket.ts` compartido). Ejecutar varias simulaciones usa un **grupo** de esos workers, hasta uno por núcleo menos uno y con un tope de cuatro, así que un lote vuela varias a la vez en lugar de una tras otra; las demás esperan en cola y los workers inactivos se cierran. `simulate()` dentro de un worker es una llamada síncrona al motor, así que una petición por worker es lo que permite matar una simulación colgada sin molestar a las demás. Esta es la fase 1 de un plan incremental para mover más trabajo del motor fuera del hilo principal; las dos opciones y la hoja de ruta completa están en [engine-worker-proposal.md](https://github.com/thzero/AstraRocketJs/blob/HEAD/docs/engine-worker-proposal.md).

## Sin conexión e instalabilidad (PWA) {#offline--installability-pwa}

Todo lo que la aplicación necesita es estático —el núcleo WASM ejecuta la física en el navegador y no hay backend—, así que puede funcionar sin conexión alguna. `vite-plugin-pwa` (configurado en `web/vite.config.ts`) emite un service worker que precachea el armazón de la aplicación, el motor WASM y los dos catálogos (~7,8 MB), además de un manifiesto de aplicación web que la hace instalable.

Dos exclusiones y adiciones deliberadas:

- El **motor JS alternativo** (~970 kB, emitido dos veces: hilo principal y worker de simulación) se deja *fuera* del precacheado y se guarda en caché en tiempo de ejecución la primera vez que se usa. WASM-GC es el camino que toma prácticamente todo navegador actual, así que precachear ~1,9 MB de alternativa sin usar en cada instalación es un mal trato.
- Los **catálogos de la rama `data`** reciben una regla `StaleWhileRevalidate`, así que se muestran al instante desde la caché y se refrescan en segundo plano: así es como una actualización semanal de catálogo llega a una copia instalada.

El worker se registra con `registerType: 'prompt'`, no `autoUpdate`: una activación silenciosa recarga la página, lo que interrumpiría una edición en curso. En su lugar, `components/layout/UpdateToast.tsx` pregunta. Un worker en espera solo se activa cuando la página envía `SKIP_WAITING`, así que una oferta que nadie responde dejaría la pestaña en la versión antigua mientras siga abierta; por eso el aviso aplica la actualización por su cuenta cuando la pestaña lleva oculta `UPDATE_APPLY_HIDDEN_MS` y no hay ninguna simulación en vuelo.

Los iconos se generan a partir de `web/public/favicon.svg` con `npm run gen:icons` (vuelve a ejecutarlo tras cambiar el favicon). La variante enmascarable se inserta con margen en la zona segura del ~80 % porque los lanzadores recortan a un círculo o cuadrado redondeado y, si no, cortarían las aletas.

## Datos de motores y caché de curvas de empuje {#motor-data--thrust-curve-caching}

Los motores vienen de [thrustcurve.org](https://www.thrustcurve.org), en dos niveles que reducen la carga recurrente sobre la API a esencialmente un trabajo programado:

1. **Catálogo (generado, descargado en ejecución).** `web/scripts/sync-motors.mjs` barre thrustcurve en busca de todos los motores disponibles con licencia limpia y escribe las especificaciones —y sus curvas de empuje incluidas— en `web/public/data/motors.generated.json` (~815 motores). `public/data` se copia literalmente en la compilación en lugar de compilarse dentro del paquete JS, y `services/remoteData.ts` lo descarga al primer uso. `.github/workflows/sync-catalogs.yml` ejecuta el barrido semanalmente y publica el resultado en la rama huérfana `data`, que la aplicación desplegada lee vía jsDelivr (`VITE_DATA_BASE`), así que una actualización no necesita recompilar; la copia versionada es la alternativa cuando ese servidor no está accesible. Para regenerarlo en local:

   ```bash
   cd web && npm run sync:motors            # regenera el catálogo alternativo versionado
   ```

   El catálogo **no** se replica en `localStorage` —ahora incluye sus curvas de empuje, demasiado grandes para eso—, pero se memoiza durante la sesión y se invalida en caché mediante el hash de contenido de `public/data/manifest.json`. A thrustcurve.org nunca se le llama para el catálogo en tiempo de ejecución.

2. **Curvas de empuje.** El barrido incluye las muestras de la curva de cada motor en el catálogo (781 de 815; el resto se marcan con `noCurve`, al no tener ninguna publicada), así que un motor elegido construye su `MotorSpec` **sin ninguna llamada en ejecución**. Solo un motor `noCurve` recae en `web/src/services/thrustcurve.ts`, que lo resuelve (`search.json`), descarga su curva (`download.json`) y construye la especificación (impulso trapezoidal → masa por muestra). Esas descargas se guardan en caché mediante el `MotorStore` (IndexedDB):

   | clave | contiene | se vuelve a descargar |
   |-----|-------|-----------|
   | `tc:v1:meta:<mfr>:<desig>` | metadatos resueltos (motorId, dimensiones, pesos) | tras el TTL |
   | `tc:v1:samples:<motorId>` | la curva de empuje | tras el TTL |
   | `tc:v1:motor:<mfr>:<desig>:<delay>` | el `MotorSpec` construido | tras el TTL |

   Las curvas **no son inmutables** (quienes contribuyen revisan los archivos de muestras), así que las cachés por motor llevan un **TTL de 90 días** (`CACHE_TTL_MS` en `thrustcurve.ts`) y se revalidan **de forma perezosa, stale-while-revalidate**: solo se vuelve a descargar para un motor que se elige *de nuevo* *después* de que su caché haya caducado, y un refresco fallido recurre a la curva antigua (seguro sin conexión). Sube `CACHE_VERSION` para invalidar todas las cachés por motor de una vez.

   **Motores importados.** Se puede importar un archivo `.eng` (RASP) o `.rse` (RockSim): cada uno lleva su propia curva de empuje, así que ninguno necesita una consulta a thrustcurve. `engParser.ts` y `rseParser.ts` los analizan, el `MotorStore` persiste el resultado (`motors:custom`), `loadCatalog()` lo fusiona en el selector (señalado y eliminable) y `fetchMotorSpec` construye su `MotorSpec` a partir de las muestras guardadas. `motorDb.importCustomMotors` elige el analizador por los bytes del archivo y no por su extensión, igual que hace `designFile.ts` con `.ork`/`.rkt`. Es contenido de la persona usuaria, simétrico a los materiales personalizados.

   **`.rse` es el más rico de los dos**, y `rseParser.ts` es un PORTE a TypeScript de `file/motor/RockSimMotorLoader.java`, no una extracción de él, por el mismo motivo que lo es el lector de `.rkt`: esa clase se basa en SAX y arrastra SimpleSAX, WarningSet, MotorDigest, Manufacturer y ThrustCurveMotor.Builder, que son la maquinaria de carga de archivos que la extracción deja fuera. Lo que el formato añade sobre RASP es el TIPO de motor (un híbrido se importa como híbrido), una lista de retardos que puede decir *taponado*, el CG real en el despegue y una columna de masa por muestra, de modo que `samplesToMotorSpec` vuela la curva de masa medida en lugar de reconstruir una a partir del impulso acumulado. Tres piezas de upstream quedan deliberadamente sin portar, cada una documentada al principio del archivo: `MotorDigest` (aquí nada deduplica motores entre archivos), la inferencia del tipo por fabricante (no hay tabla `Manufacturer` de este lado) y `AbstractMotorLoader.calculateMass`, esta última porque `samplesToMotorSpec` ya hace la misma aritmética para todo motor sin columna de masa, algo que `rseParser.test.ts` comprueba enfrentando las dos.

   La réplica del catálogo, las entradas por motor y los motores importados se persisten todos mediante el **`MotorStore`** intercambiable (`web/src/services/motorStore.ts`; por defecto `KeyValueMotorStore` sobre IndexedDB), que es dueño de la política de frescura (firma del catálogo, TTL por entrada). Sustitúyelo con `setMotorStore(...)` para llevar los datos de motores a otro sitio; consulta **Dónde viven los datos** más abajo.

## Materiales {#materials}

A diferencia de los motores, los materiales **no** son una fuente externa, pero se publican igual: un archivo generado bajo `public/data/`, descargado en tiempo de ejecución en vez de compilarse en el paquete. Nada dentro de `src/` guarda un material.

- **Incorporados** — `public/data/materials.generated.json` (97 entradas: volumen / superficie / línea, con densidades y grupos), escrito por `web/scripts/sync-materials.mjs` a partir de dos fuentes. Las filas marcadas `upstream` son la lista propia de OpenRocket, leída directamente de su `Databases.java` y sujeta a ella por `engine-java/extract/extract.mjs --check`; el resto viene de `web/scripts/data/materials.app.json`, mantenido a mano, que aporta los adhesivos (el original no tiene ninguno, y un filete de aleta no se hace de otra cosa) y correcciones a valores originales equivocados. Cada uno de los nuestros cita el documento del que salió su densidad. El selector de materiales del editor descarga el archivo fusionado; el motor reproduce la masa y el CG de OpenRocket porque aplica un material por su **densidad**.
- **Materiales personalizados** — definidos por la persona usuaria (nombre + densidad + grupo), persistidos bajo `materials:custom`, fusionados en el selector por `services/materials.mergeCustom` (un material personalizado reemplaza en su sitio a uno incorporado del mismo nombre y, si no, se une al grupo que indique) y reutilizables entre diseños. El núcleo acepta cualquier densidad directamente, así que un material personalizado no es más que una densidad con nombre. `services/materials.ts` es dueño de las reglas de dominio; `materialStore.ts` es un almacén tipado que se apoya en el almacén clave-valor compartido (más abajo).

La selección de material se aplica al núcleo como una sobrescritura de densidad (`materialDensity`), así que la **física es exacta**: la masa y el CG coinciden con OpenRocket en cualquier caso. Los **nombres** de material también viajan de ida y vuelta por `.ork`, incluidos los que el original no tiene, de modo que un diseño sigue diciendo de qué está hecho al reabrirlo aquí o en el escritorio (`services/ork/materialRoundTrip.test.ts` es lo que lo sostiene). La densidad viaja en el archivo, así que el shim del motor nunca necesita la tabla.

Como el catálogo es una descarga, puede no llegar. El selector lo dice en vez de mostrar una lista vacía, y sigue nombrando el material que la pieza ya tiene: una lista vacía y un nombre perdido se leen igual, como «esta pieza no tiene material», y ninguna de las dos cosas es cierta.

## Componentes {#components}

Piezas reales de fabricante (Estes/Apogee/LOC/BlueTube/…), extraídas de la **BD OpenRocket-Components** ([`dbcook/openrocket-database`](https://github.com/dbcook/openrocket-database)) —la base de datos comunitaria de piezas `.orc` de la que provienen los datos de componentes de OpenRocket—, el tercer y último catálogo de referencia (tras motores y materiales). (OpenRocket los llama «preajustes de componentes»; aquí es simplemente el catálogo de componentes, simétrico al de motores.)

- **`web/scripts/sync-components.mjs`** lee el XML `.orc`, resuelve el material de cada pieza a una densidad, normaliza las unidades a SI y escribe **`web/public/data/components.generated.json`** (~2.940 piezas, seis tipos: tubos, ojivas, paracaídas, acopladores, anillos de centrado y mamparos). Apunta `OPENROCKET_PRESETS` (o `--src`) al directorio `orc/` de un clon de la BD de componentes; por defecto es un clon local. Generarlo no necesita red, y el trabajo de CI tampoco más allá de clonar esa base de datos.

  **Para actualizar el catálogo** (incorporar piezas nuevas de la BD comunitaria):

  ```bash
  git -C <ruta-a>/openrocket-database pull      # actualiza la fuente .orc
  cd web && node scripts/sync-components.mjs     # regenera components.generated.json
  #   …o bien:  node scripts/sync-components.mjs --src <ruta-a>/openrocket-database/orc
  ```
- **`web/src/services/componentDb.ts`** lo carga (una unión discriminada por `type`) y lo filtra.
- **Interfaz:** selectores contextuales **«Selecciona una pieza…»** en el editor; la ojiva y el tubo rellenan su geometría y material; el selector de paracaídas de un grupo de **Recuperación** rellena el diámetro y el Cd. Aplicar una pieza es puramente del lado de la aplicación (rellena el `RocketSpec`); el motor no cambia.
- **Piezas guardadas:** un componente que ha construido la persona usuaria, persistido bajo `parts:custom` mediante el **`PresetStore`** intercambiable (`services/presetStore.ts`), el cuarto almacén con la misma forma que los de motores, materiales y plantillas. A diferencia de una fila del catálogo, que publica un puñado de dimensiones, una pieza guardada conserva el **nodo entero**: `services/customParts.ts` descarta solo lo que identifica al nodo del que salió (`id`, `type`, `name`, `position`, `children`) y guarda el resto, de modo que vuelven el hombro de una ojiva, las cuerdas de un paracaídas, el soporte de motor de un tubo y el color de la pieza. `customParts` además proyecta cada pieza guardada a una fila `Component` (la inversa de `treeEdit.catalogPatch`, sometida al propio `isComponentRow` del catálogo), así que el selector busca, filtra por facetas, ordena y puntúa el ajuste sobre una sola lista en lugar de dos; `catalogPatch` aplica entonces el nodo que la fila lleva consigo en vez del mapa por tipo. Las piezas guardadas se ordenan por delante del catálogo en todas las columnas, porque el selector dibuja una ventana limitada a 200 filas y una pieza que has guardado nunca debe quedar fuera de ella. Marcadas con una ★ y eliminables, como un motor importado.
- **La vista de gestión:** `components/design/SavedPartsDialog.tsx`, accesible desde el menú junto al panel de motores y a los lugares de lanzamiento guardados, por el mismo motivo por el que existen esos dos: el selector solo se dibuja cuando hay seleccionado un nodo de un tipo que corresponda (`treeEdit.hasCatalog`), así que no puede mostrar un mamparo guardado en un diseño que no lleva ninguno. Lee `customParts.listSavedParts`, que se diferencia de `customRowsForType` en una cosa: una pieza que ya no se proyecta a una fila se conserva, con la fila a null, porque la única lista desde la que se puede eliminar no debe ocultar las piezas que el selector ya descarta.
- **La edición:** el diálogo es maestro-detalle (`layout="fill"`, lista a la izquierda con 300 px, detalle a la derecha), la misma forma que ya usa el selector de motores, incluida su regla para el móvil: un panel cada vez por debajo de `md`, con un control para volver en el detalle. `SavedPartEditor.tsx` compone las PROPIAS piezas del panel de propiedades (`visibleFields` / `FieldRow`, `MaterialSection`, `AppearanceSection`), lo cual es posible porque todas reciben un nodo y un `onChange` y nada más; `RecoverySizingReadout` es la única sección acoplada al almacén y es la que se queda fuera. Por eso el `id` de una pieza guardada es opaco y estable (`custom:<tiempo en base36>:<aleatorio>`) en lugar del `custom:<type>:<mfr>:<partNo>` inicial: un id que codificaba la etiqueta hacía imposible expresar un cambio de nombre, porque producía otro id y copiaba la pieza en vez de moverla. La etiqueta es ahora con lo que `saveCustomPart` compara para que «guardarla de nuevo con el mismo fabricante y nombre la reemplace», y `updateCustomPart` conserva el id y rechaza una etiqueta que ya use otra pieza del mismo tipo.

Igual que el catálogo de motores, es un archivo generado bajo `public/data/` que se descarga al primer uso (véase más arriba) en lugar de compilarse en el paquete, así que no cuesta nada hasta que se abre un selector, y se publica en la rama `data` con la misma periodicidad semanal.

## Entrada/salida de RockSim (`.rkt`) {#rocksim-rkt-io}

Lo lee `services/rktImport.ts` y lo escribe `services/rktExport.ts`: un PORT a TypeScript del paquete `file/rocksim/` de OpenRocket, no una extracción. Ese paquete está basado en SAX y arrastra la maquinaria de documentos, apariencias y avisos del escritorio; el esquema que codifica es lo bastante pequeño como para leerlo directamente, y hacerlo aquí mantiene ambas direcciones del mismo lado de la frontera del motor que el par de `.ork`: DOM puro, comprobable con pruebas unitarias y sin pasar por el núcleo. El vocabulario de elementos, los factores de unidades y los cuatro enums están transcritos de `RockSimCommonConstants.java` y sus hermanos, así que una actualización de upstream se puede contrastar con esos archivos.

Hay tres conversiones presentes en todo, y equivocarse en una produce un diseño que se desvía por un factor de 2 o de 1000 en silencio, en lugar de uno que falla al cargar: RockSim usa **milímetros** y **gramos**, y toda dimensión circular del archivo es un **diámetro**. Las excepciones están documentadas donde se usan: el `Dia` de un paracaídas sí es un diámetro en ambos lados, y `ShroudLineMassPerMM` está en kg/m pese a su nombre.

`services/designFile.ts` elige el lector a partir de los bytes del archivo (un zip es un `.ork`; si no, decide el elemento raíz), así que `loadOrk` tiene un único camino para ambos formatos y todo lo que viene después —el aviso de notas, la comprobación de límites de seguridad, la semántica de copia sin guardar— se comparte en lugar de duplicarse por formato. La cabecera lleva un campo de archivo oculto por formato, que solo se diferencian en su `accept`.

Ninguno de los dos lados es lossless en general, y ambos lo dicen: RockSim tiene colas anulares, pods desmontables y subconjuntos que aquí no existen, y nosotros tenemos botones de raíl y etapas en paralelo que él no tiene. El importador reúne todo eso en las notas del diseño cargado; el exportador devuelve los tipos omitidos a quien lo llama, que los muestra en lugar de dejar que el usuario descubra la carencia cuando otra persona abra el archivo.

## Cohetes de ejemplo {#example-rockets}

Los dieciséis diseños que OpenRocket incluye y abre desde *Archivo → Abrir ejemplo*, empaquetados con la aplicación bajo `web/public/examples/` y listados por un `examples.generated.json` generado.

`web/scripts/sync-examples.mjs` (`npm run sync:examples`) los descarga del **mismo commit que `engine-java/extract/UPSTREAM` fija para el motor**, así que un ejemplo nunca puede demostrar una función que el núcleo incluido no tenga. Además **elimina el `<flightdata>` almacenado de cada archivo**: el 90% de los bytes — 2,9 MB de los 3,3 MB del conjunto — y peso muerto aquí, porque `orkImport` nunca lo lee (la aplicación ejecuta sus propias simulaciones). Ya depurado, el conjunto ocupa unos 330 kB. Los diseños, las apariencias, las calcomanías y las curvas de empuje incrustadas quedan intactos.

Deliberadamente en **`public/examples/`, no en `public/data/`**. Los catálogos de `public/data` se refrescan semanalmente mediante `sync-catalogs.yml` y se sirven desde la rama `data`, porque cambian sin la aplicación; los ejemplos solo cambian cuando la aplicación se recompila contra una versión más nueva de OpenRocket. En su lugar se precachean (`ork` está en los `globPatterns` de la PWA), así que un ejemplo se abre en una primera carga sin conexión.

`services/exampleLibrary.ts` descarga el índice y los bytes de un archivo; `store.openExample` entrega esos bytes a **`openOrkFile`**, de modo que un ejemplo recorre exactamente el mismo camino que un archivo elegido a mano: el mismo aviso de notas, la misma comprobación de límites de seguridad, la misma semántica de copia sin guardar, la misma pregunta cuando su nombre ya está en la biblioteca y ningún segundo camino de código. Se llega desde **Importar → Ejemplos** y desde la segunda pestaña de la biblioteca de diseños.

`src/services/exampleLibrary.test.ts` importa y construye **todos** los ejemplos con el núcleo real y resuelve sus motores contra el catálogo incluido, así que ni la depuración ni una actualización de upstream pueden colar uno roto sin que se note.

## Exportación de geometría (impresión 3D / CAD / archivos de corte) {#geometry-export-3d-print-cad-cut-files}

Toda salida imprimible empieza en `services/solidMesh.ts`, que construye un **sólido estanco** por componente y es el punto de control que rechaza el que no puede hacer variedad cerrada (`solidForNode` devuelve null en lugar de escribir un archivo que ningún laminador aceptaría). A partir de ahí:

- `services/meshExport.ts` envuelve los exportadores STL / OBJ / glTF de three.js y escala de metros a **milímetros** (`M_TO_MM`), porque esa es la unidad que asumen todos los laminadores y programas de CAD.
- `services/threeMf.ts` escribe **3MF** directamente: es un zip con tres miembros XML (los tipos de contenido OPC, una relación y el modelo), no un exportador de three.js, así que lee él mismo los búferes de vértices e índices de la geometría. El 3MF es el único de los cuatro que lleva el **nombre** de la pieza, un **color** y la **unidad declarada**, que es lo que hace útil exportar el cohete entero en vez de un montón de sólidos anónimos.
- `services/dxfExport.ts` escribe el contorno plano de una pieza cortada en plancha.
- `services/componentFormats.ts` dice qué formatos ofrece cada tipo de componente (el botón ⬇ del árbol se lo pregunta, y está deliberadamente libre de importaciones pesadas); `services/componentExport.ts` es el fragmento cargado bajo demanda que construye y descarga una pieza.
- `services/rocketPrintExport.ts` es el camino del cohete entero: recorre el diseño buscando piezas imprimibles, construye cada sólido por las dos mismas rutas que usa `componentExport` (un disco o anillo necesita resolver el diámetro interior de su tubo padre) y escribe o bien un 3MF con objetos con nombre, o bien un zip con un archivo por pieza.

**La orientación nunca se cambia.** Los sólidos se tornean alrededor de Y y se rotan hacia X (`solidMesh.ts`), así que el eje del cohete va a lo largo de X y los cuerpos se exportan tumbados. Por eso la opción de «colocar sobre la base de impresión» es una TRASLACIÓN pura: poner las piezas de pie sería correcto para los tubos y equivocado para cada aleta y cada anillo, y haría que el 3MF difiriera del STL de la misma pieza.

## Abrir archivos `.ork` {#opening-ork-files}

**Importar .ork** carga un diseño existente de OpenRocket con **total fidelidad**: cualquier diseño que soporte la API del árbol de componentes del motor (etapas, transiciones, acopladores, anillos, mamparos…), no solo la disposición fija del editor:

```
.ork (zip)  →  orkFile.importOrk()  →  RocketTree  →  OpenRocketDesign.buildTree()  →  staticInfo() / simulate()
```

- **`web/src/services/orkFile.ts`** descomprime con `fflate` y analiza el XML de OpenRocket con `DOMParser`. Sin cargador Java, sin red: el propio cargador de `.ork` de OpenRocket vive en *core* (`core/.../file/openrocket`), pero analizarlo en JS es mucho más ligero que arrastrarlo por TeaVM.
- **`web/src/services/loadOrk.ts`** orquesta: `importOrk` → `buildTree` → resolver el motor de cada soporte contra nuestro catálogo (`findCatalogMotor` → `fetchMotorSpec`) → `staticInfo`. Los motores sin resolver y los componentes no soportados aparecen como notas en el aviso del diseño cargado.

**Exportar .ork** exporta el diseño actual (`orkFile.exportOrk` → comprimido con `fflate` → descargado mediante `web/src/services/saveOrk.ts`). Exportar → volver a importar se ha verificado **idéntico bit a bit** (misma masa, CG, CP y estabilidad), y los archivos se reabren en OpenRocket de escritorio.

## Ubicaciones de lanzamiento guardadas {#saved-launch-locations}

Una ubicación de lanzamiento es un sitio con nombre: `latitudeDeg`, `longitudeDeg` y `launchAltitudeM`, almacenados en SI como todo lo demás. No guarda nada más. La guía, el viento y la atmósfera son condiciones del día, no propiedades de un campo.

`services/launchLocationStore.ts` es un `LaunchLocationStore` tipado sobre el almacén clave-valor compartido, intercambiable mediante `setLaunchLocationStore`. Su clave es `pads:custom`, el nombre anterior de la función, conservado porque los navegadores existentes guardan ahí los sitios. Los guardados se validan contra los mismos rangos con los que `LaunchPanel` acota sus campos, de modo que un blob editado a mano no puede meter una latitud más allá de ±90 en los términos de gravedad y Coriolis del kernel ni en un origen KML.

- `components/sim/LocationPicker.tsx` va arriba del grupo Sitio del panel de lanzamiento y escribe a través del `onChange` / `onCommit` del propio panel, así que aplicar una ubicación es una edición deshacible normal, sujeta a las mismas reglas de selección múltiple que teclear los números.
- `components/sim/LocationsDialog.tsx` es la lista. Carga del almacén y aplica mediante `patchLaunch`, así que un mismo componente sirve al ⚙ del panel de lanzamiento y a **menú → Ubicaciones de lanzamiento**, donde no hay ningún campo de sitio en pantalla en el que escribir.
- `components/sim/LocationEditDialog.tsx` edita una ubicación por completo y crea una desde cero, que es la única forma de añadir una desde el menú. Sus `min` / `max` son los rangos del almacén, así que `NumberInput` acota un valor que `isLocation` rechazaría en vez de rechazarlo después. Su campo de elevación se enlaza al ámbito de unidades del panel de lanzamiento.
- `components/sim/useLocationList.ts` numera sus lecturas y descarta una respuesta superada. La primera `list()` de la sesión es la más lenta en IndexedDB, así que una ubicación guardada entretanto se resuelve primero y luego queda sobrescrita por el resultado anterior, vacío.

Cuál es la ubicación actual se deduce comparando los números, no recordando un id seleccionado: los campos pueden cambiar por importación, por geolocalización o a mano, y un id seguiría nombrando un sitio que ya no está en pantalla.

### Mapas {#maps}

`components/sim/SiteMap.tsx` dibuja el sitio; `services/slippyMap.ts` contiene la proyección Web Mercator, las fuentes de teselas y el cálculo del viewport. No hay biblioteca de mapas: un punto, arrastrar, desplazar y hacer zoom es todo el requisito, así que las teselas son etiquetas `<img>` en desplazamientos calculados. Una proyección pura es lo que permite probarla contra cifras Mercator calculadas a mano.

- Las teselas vienen de Esri (`World_Imagery`, `World_Street_Map`), cuyas rutas son `{z}/{y}/{x}` en lugar del habitual `{z}/{x}/{y}`. Una regla `CacheFirst` de Workbox en `vite.config.ts` conserva hasta 1200, así que un sitio consultado en casa sigue dibujándose en un campo sin cobertura.
- **Nunca apuntes una capa de teselas a `openstreetmap.org`.** Esos servidores se financian con donaciones y la Política de Uso de Teselas de OSM los reserva para el uso propio de OpenStreetMap; las peticiones se bloquean. El mapa de calles de Esri lleva datos de OSM y los acredita en la atribución. Una prueba unitaria comprueba que ninguna URL de tesela nombra ese host y una prueba de extremo a extremo comprueba que nada llega a él por la red.
- Las teselas deben enviar un referente. `referrerPolicy="no-referrer"` elimina la única cabecera con la que un proveedor puede identificar a quien llama.
- Las teselas se piden con CORS, y también sus entradas en el service worker: una respuesta opaca no puede responder a una petición CORS. El lienzo 3D se crea con `preserveDrawingBuffer` para que la exportación de imagen pueda leerlo, y una sola textura cargada sin CORS contamina el lienzo y rompe esa exportación en silencio. La caché es `astra-map-tiles-v2`.
- Tres errores de tesela consecutivos sin ninguna cargada cambian a una retícula de coordenadas en vez de a un recuadro gris. Deliberadamente no es una costa dibujada: una aproximada pone el marcador en una forma que casi es un país, lo cual es peor que ninguna forma cuando la tarea es decirte si los números están donde querías.
- Los manejadores de desplazamiento y de clic para situar viven en la caja que también contiene los botones de capa, zoom y recentrar, e ignoran cualquier evento de puntero que empiece en un control. La captura del arrastre se toma sobre la caja, no sobre `e.target`, que suele ser una tesela y se desmonta en cuanto un desplazamiento pasa de largo.

`components/sim/SiteMapDialog.tsx` es el mismo mapa abierto sobre el panel de lanzamiento, cuya columna es demasiado estrecha para mostrar un campo y sus alrededores; `LocationEditDialog` tiene sitio para mantener uno en línea. Ambos escriben las coordenadas por la vía de cambio de quien los llama, así que un clic en el mapa es una sola edición deshacible.

### Las mismas teselas bajo las vistas de resultados {#the-same-tiles-under-the-results-views}

`components/canvas/GroundTrack.tsx` coloca teselas bajo la vista en planta y `components/canvas/FlightGroundMap.tsx` las aplica como textura al plano de suelo de la trayectoria 3D. `services/tileLayer.ts` guarda la elección satélite/calles y el estado de encendido de la sesión, así que la respuesta es la misma se cambie donde se cambie.

- Ambas vistas de resultados arrancan **apagadas** y no piden nada hasta que se les pide: los anillos de distancia y la trayectoria son la medida. `SiteMap` es al revés y dibuja imágenes por defecto, porque allí la imagen es la respuesta y no el contexto.
- Ninguna usa el `SITE_ZOOM` fijo de `SiteMap`; ambas se dimensionan al vuelo. `zoomForMetersPerPixel` elige el zoom de tesela más cercano a la resolución que se dibuja, redondeando en espacio logarítmico. Redondear hacia arriba deja un factor de escala en (0.5, 1] y extiende la capa hasta el doble de la caja en cada dirección, que son cuatro veces las teselas.
- La vista en planta escala su capa de teselas por la fracción restante, así que las imágenes se ajustan a los anillos de distancia y no los anillos a las imágenes. `trackExtent` tiene un suelo en `MIN_EXTENT_M` (50 m, o sea 100 m de lado): un vuelo sin viento aterriza a una décima de metro de la rampa, y una vista escalada a eso es una foto de hierba.
- La capa 3D dimensiona su suelo al alcance real de la trayectoria más un margen, en vez del plano fijo de 60 unidades.
- La textura 3D pone `flipY` en `false`. Un plano tumbado girando -90° sobre x manda su propio +y a -z, así que el volteo por defecto refleja el suelo norte por sur. `groundMapLayout` es puro y está probado para que las teselas del norte caigan al norte, porque una captura de pantalla no detecta una foto aérea reflejada.
- Las teselas `<img>` llevan `max-w-none` y un tamaño CSS explícito. El `img { max-width: 100% }` del reset es relativo al bloque contenedor, y la capa de teselas de la vista en planta es a propósito más estrecha que su caja cuando las imágenes se amplían; por debajo de 256px las teselas se dibujaban encogidas pero seguían separadas una tesela entera.

## Dónde viven los datos (almacenes intercambiables) {#where-user-data-lives-swappable-stores}

Los datos del lado del cliente viven tras **almacenes de dominio tipados e intercambiables de forma independiente** —uno para motores, otro para materiales y otro para las piezas guardadas—, así que cualquiera puede sustituirse por otra implementación sin tocar los servicios ni la interfaz:

```
keyValueStore.ts    KeyValueStore (get/set/remove) + LocalStorageKeyValueStore  — la interfaz
idbKeyValueStore.ts IndexedDbKeyValueStore — el backend POR DEFECTO de todos los almacenes

designLibrary.ts    DesignLibrary — getDesignLibrary() / setDesignLibrary(lib)
   list / read / write / create / rename / remove, más el puntero al diseño activo. Una
   clave por diseño (astrarrocketjs:designs:<id>) y un índice pequeño aparte de
   {id, name, updatedAt}: el guardado automático reescribe UN diseño cada 500 ms, así que un
   único documento con todos los diseños se reescribiría en cada pulsación y crecería con la
   biblioteca. workspaceStore.ts es una fachada estrecha sobre «el diseño que se está editando».

motorStore.ts       MotorStore   — getMotorStore() / setMotorStore(store)
   readCatalog / writeCatalog (réplica protegida por firma) · readEntry / writeEntry (por motor,
   TTL/frescura). El KeyValueMotorStore por defecto persiste mediante un KeyValueStore; lo usan
   motorDb.ts y thrustcurve.ts, que solo conservan la nomenclatura de claves y la lógica de descarga.

materialStore.ts    MaterialStore — getMaterialStore() / setMaterialStore(store)
   list / add / remove Material. El KeyValueMaterialStore por defecto persiste mediante un
   KeyValueStore; materials.ts es dueño de las reglas de dominio (validación, fusión de
   incorporados con personalizados).

presetStore.ts      PresetStore  — getPresetStore() / setPresetStore(store)
   list / add / remove CustomPart: los componentes que se han guardado para reutilizarlos, cada
   uno con un nodo entero en lugar de las dimensiones de una fila del catálogo. El
   KeyValuePresetStore por defecto persiste mediante un KeyValueStore; customParts.ts es dueño
   de las reglas de dominio (qué se guarda, la proyección a fila del selector y la señal de
   cambio a la que se suscribe el selector).
```

Todos ellos persisten por defecto mediante un **`IndexedDbKeyValueStore`**, y sus interfaces son asíncronas para que otra implementación (un backend, un almacén compartido) encaje sin reformar a quienes las llaman. Para sustituir uno en el cliente, implementa su interfaz e intercámbialo:

- **Motores:** `setMotorStore(new MyMotorStore())`
- **Materiales:** `setMaterialStore(new MyMaterialStore())`
- **Piezas guardadas:** `setPresetStore(new MyPresetStore())`

…o conserva la lógica de dominio por defecto sobre otro backend clave-valor:

- `setMotorStore(new KeyValueMotorStore(new MyKeyValueStore()))`
- `setMaterialStore(new KeyValueMaterialStore('materials:custom', new MyKeyValueStore()))`
- `setPresetStore(new KeyValuePresetStore('parts:custom', new MyKeyValueStore()))`

Intercambiar uno no afecta a los demás.

### Por qué IndexedDB, y los dos sitios donde queda localStorage {#why-indexeddb-and-the-two-places-localstorage-remains}

localStorage es síncrono —cada lectura y escritura bloquea el hilo principal— y está limitado a cerca de **5 MB por origen**, compartidos entre diseños, motores y materiales personalizados, plantillas importadas y las cachés de curvas de empuje. Que `workspaceStore.save()` lance `storage-full` es ese límite asomando. IndexedDB es asíncrono y prácticamente ilimitado.

Los datos existentes se migran **de forma perezosa, por clave, en la primera lectura**: una clave ausente en IndexedDB pero presente en localStorage se copia, y el original solo se borra una vez confirmada la escritura; una migración interrumpida se reintenta en la siguiente carga en lugar de destruir la única copia. Si IndexedDB no está disponible (bloqueado por política, algunos modos privados), toda operación recurre a localStorage, así que la aplicación degrada a su comportamiento anterior en vez de perder el almacenamiento.

`designLibrary.ts` hace los diseños direccionables, e incorpora un espacio de trabajo previo a la biblioteca, de blob único, como su primera entrada en el primer uso, con el nombre de su `.ork` importado si tenía uno. El diario de descarga registra **a qué** diseño pertenece, porque reproducirlo sobre el que resulte estar abierto sobrescribiría un cohete ajeno.

### Una importación, una entrada

Dos reglas evitan que la biblioteca se llene de copias del mismo cohete. Ambos fallos son indistinguibles desde la lista de Abrir y ninguno lo puede deshacer el usuario.

**Una importación se desvincula, y se nombra antes de aterrizar.** `openOrkFile` llama a `setActiveId(null)`, de modo que el siguiente guardado automático crea una entrada: un cohete importado es su propio diseño, no una edición del que estuviera en pantalla. `homeForImport`, en `store.ts`, resuelve el conflicto de nombre **antes** de `replaceWorkspace`, ofreciendo sobrescribir la entrada existente o nombrar esta otra (se propone el primer `… (2)` libre). Tiene que ocurrir antes del cambio, o el retardo de 500 ms se dispara con el diálogo abierto y crea justo la entrada por la que se está preguntando. La respuesta llega al guardado automático a través de `WorkspaceStore.setPendingName`, así que hay exactamente un `create`, hecho por el guardado automático, en vez de que quien llama compita con él con un segundo. El diálogo es `state/promptStore.ts` más `components/common/PromptDialog.tsx`, el hermano basado en promesas de `confirmStore`, para un store que necesita una respuesta a mitad de una acción y no puede renderizar.

**Solo puede haber un `create` en vuelo.** Los guardados solapados comparten un único `create` en `LibraryWorkspaceStore.save`, y uno que se resuelva después de haberse reemplazado el espacio de trabajo no adopta su id. La ventana es lo bastante ancha como para importar: el retardo es de 500 ms, el primer `create` en IndexedDB es la escritura más lenta de la aplicación, y el vaciado de `visibilitychange` guarda fuera del retardo por completo. `DesignLibrary.create` también deshace su escritura cuando se rechaza la del puntero activo, porque un `create` a medias deja el diseño indexado mientras quien llama sigue sin id activo.

No existe **Guardar** en el menú: editar guarda automáticamente con el retardo, y la descarga de la página escribe el diario. `components/layout/SaveStatus.tsx` informa de la última escritura a partir de `lastSavedAt`, que `useWorkspaceEffects` fija en la ruta de éxito del propio guardado y no donde se pidió uno, de modo que una escritura rechazada no puede reclamar un guardado.

Dos cosas se quedan en localStorage a propósito:

- **Los ajustes** (`settings.ts`) se leen **de forma síncrona** para que el primer renderizado ya tenga las unidades y preferencias de la persona usuaria; una lectura asíncrona haría parpadear los valores por defecto.
- **El diario de descarga.** Una escritura en IndexedDB no puede completarse mientras la página se está desmontando, así que `WorkspaceStore.saveSync()` escribe el espacio de trabajo en localStorage en `pagehide`/`beforeunload` y el siguiente `load()` lo reincorpora (es por definición la copia más reciente) y lo borra. Sin esto, una edición hecha dentro de los 500 ms de amortiguación del guardado automático se perdería en una recarga rápida. Un manejador de `visibilitychange → hidden` dispara además el guardado asíncrono normal, que en móvil suele ser la última oportunidad antes de que se descarte la pestaña.

Las preferencias pequeñas de interfaz (columnas del panel, filtros del selector) también se quedan en localStorage: son diminutas, y una lectura síncrona mantiene correcto el primer pintado.

## Unidades {#units}

El motor de física, el árbol de componentes y todos los archivos guardados están en **SI puro / radianes**. Las unidades son un asunto de visualización y entrada que vive únicamente en el borde de la interfaz: una unidad que se filtra hacia dentro es el origen de errores como el #2475 de OpenRocket, y los viajes de ida y vuelta de `.ork` deben seguir siendo idénticos byte a byte.

- **`web/src/prefs/units.ts`** — los grupos de unidades (que reflejan el `UnitGroup` del escritorio), sus factores SI y las funciones de conversión puras. La convención coincide con la del escritorio: `si = (ui + offset) * toSI`, donde `offset` solo lo usa la temperatura. `siToUiDelta` convierte una *diferencia* en lugar de una lectura, de modo que un paso de 1 K es 1 °C y no −272,15.
- **`web/src/prefs/useUnits.ts`** — el hook de React por el que pasa todo lo que pone un número en pantalla: `sym / toUi / fromUi / fmt / step / factor` para las unidades de las preferencias, más `at(scope, quantity)` para la unidad propia de un campo. `at` es una función normal y no otro hook porque los campos se renderizan en bucles. `fmt` respeta la configuración regional (pasa por `i18n/format`); el `fmtSi` del propio `units.ts` se queda en ASCII simple para el código de exportación, que se ejecuta fuera de React y no debe depender del idioma activo.
- **`web/src/components/common/UnitChip.tsx`** — la unidad impresa junto a un valor, como selector de ese campo.

Dos capas, ambas persistidas en `settings.ts` y resueltas por `unitFor(units, unitOverrides, quantity, scope)`:

| campo | indexado por | lo escribe | alcance |
| --- | --- | --- | --- |
| `units` | magnitud | solo la pestaña Unidades | todo lo que no tenga una anulación propia |
| `unitOverrides` | campo (`unitScope(…)`) | solo `UnitChip` | ese único campo |

**Un selector cambia su propio campo y ahí se detiene.** Rebasar todas las longitudes de la aplicación es un efecto demasiado grande para colgarlo de un control pequeño junto a un número. Los campos de componente se indexan por TIPO de componente, no por instancia, así que seleccionar otro tubo no olvida la unidad recién puesta en esa ficha.

Los símbolos guardados se validan al leer, en `unitFor`, contra la magnitud que resulta tener el campo. Una clave de ámbito no nombra su magnitud, así que un `in` que quedara en un campo que ahora es una masa llegaría a `unitDef` y se convertiría calladamente en gramos.

Tres reglas impiden que las dos capas se atasquen: volver a elegir la preferencia desde un selector **elimina** la anulación en vez de guardar una que coincide (así el campo vuelve a seguir la preferencia); los preajustes métrico / imperial **borran todas las anulaciones**, o dejarían campos varados encima del preajuste; y la pestaña Unidades muestra un botón **Restablecer N campos** siempre que exista alguna, ya que una elección por campo es difícil de reencontrar.

Las claves huérfanas **no** se eliminan. Un ámbito solo existe mientras su campo se renderiza, así que nada puede enumerar el conjunto vivo al cargar, y renombrar la clave de un campo simplemente deja una entrada que nadie lee (`unitFor` recurre al valor por defecto). Es una no-funcionalidad deliberada: el mapa se queda en unas pocas decenas de entradas de unos pocos bytes cada una, así que un recolector costaría más código que los bytes que recuperaría. `PropertyPanel.scopes.test.ts` protege el fallo que sí importaría: dos campos de un mismo tipo de componente chocando en una clave, lo que en silencio les haría compartir unidad.

Las exportaciones deliberadamente no ven la capa por campo: un documento mitad en pulgadas y mitad en centímetros según dónde haya hecho clic alguien no le sirve a nadie. El diálogo del informe elige `current` (las preferencias), `metric` o `imperial` mediante `resolveUnitChoice`.

Los valores guardados en una convención que no es SI convierten en su propia frontera y en ningún otro sitio: `LaunchConditions` (grados, °C, hPa) en `LaunchPanel`, y el catálogo de motores (mm, g) en los componentes de motor.

## Atribución y licencia {#attribution--license}

El motor deriva del núcleo de OpenRocket (su rama **unstable**). Créditos completos y linaje de licencias: [`engine-java/ATTRIBUTION.md`](https://github.com/thzero/AstraRocketJs/blob/HEAD/engine-java/ATTRIBUTION.md) (y `docs/rasaero/` para la física y los diffs de las extensiones).
