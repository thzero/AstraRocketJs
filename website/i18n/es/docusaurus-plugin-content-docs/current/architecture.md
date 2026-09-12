---
title: "Arquitectura e interioridades"
sidebar_position: 15
---
> Referencia de arquitectura para desarrolladores: la inmersión profunda tras la [Guía del desarrollador](./developer-guide.md). El [README](https://github.com/thzero/AstraRocketJs/blob/HEAD/README.md) del repositorio es el resumen breve; [Contribuir](./contributing.md) cubre cómo trabajar en el proyecto.

AstraRocketJs ejecuta el **núcleo de física de OpenRocket** en el navegador, compilado a **WebAssembly** (con **JavaScript como alternativa**). Es un monorepo:

- `engine-java/` — el núcleo de física de OpenRocket (una compilación de desarrollo posterior a la 24.12), extraído y parcheado mínimamente para TeaVM, compilado a **dos** destinos: un módulo WebAssembly (WASM-GC) y un módulo JavaScript (GPL-3.0; consulta `engine-java/ATTRIBUTION.md`).
- `web/` — la interfaz adaptable: Vite + React + TypeScript + Tailwind CSS. Consume el motor mediante un envoltorio tipado (`web/src/engine/openRocketEngine.ts`), que elige el motor al cargar y muestra cuál está activo en la cabecera.

## El motor extraído (`engine-java/src/java/`) {#the-extracted-engine-engine-javasrcjava}

El módulo `core` completo de OpenRocket son unos 700 archivos Java y arrastra Guice, JAXB, GraalVM-JS y classgraph, ninguno de los cuales puede manejar TeaVM (el compilador de Java a JavaScript/WASM). La **extracción** es una copia puntual de solo los ~270 archivos que la física y la simulación realmente necesitan, dejando atrás toda la maquinaria dependiente de la reflexión (cargadores de archivos, sistema de complementos, scripting, enganches de interfaz gráfica).

`src/java/` es por tanto código fuente literal del núcleo de OpenRocket (una compilación de desarrollo posterior a la 24.12) con un puñado de pequeñas ediciones de compatibilidad con TeaVM ya aplicadas (las sobrescrituras de `patches/`: por ejemplo `UUID`→`LongUUID`, un mapa concurrente cambiado por uno simple, una búsqueda del calculador aerodinámico sin reflexión, y un `ArrayList.clone()` de constructor de copia que exigen las conversiones estrictas de WASM-GC). **Esto es el motor**: cuando la interfaz llama a `staticInfo()` o `simulate()`, este es el código que se ejecuta. No edites los archivos extraídos directamente; los cambios pasan por una sobrescritura documentada en `patches/` (solo al actualizar la versión original de OpenRocket).

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

1. `engine-java/` (núcleo extraído + los reemplazos solo-JVM de `src/shims/` + un sustituto del `Collator` del JDK en `src/jdkstubs/` + la fachada @JSExport `src/api/OpenRocketEngine`) lo compila TeaVM a **dos destinos**: un módulo **WASM-GC** y un módulo **JavaScript**. Ambos salen de las mismas fuentes con `node engine-java/build-engine.mjs` (JS) / `--wasm` (WASM-GC).
2. Los artefactos compilados están versionados para que la aplicación web compile sin un JDK:
   - JS → `web/src/engine/vendor/openrocket-engine.mjs`
   - WASM → `web/public/engine/openrocket-engine.wasm` (+ su `*.wasm-runtime.js`)
3. `web/` los importa mediante el envoltorio tipado `openRocketEngine.ts`; React nunca toca los módulos en bruto.

**Selección de motor.** `initEngine()` carga **WASM-GC por defecto** (más rápido) y recurre a la compilación **JS** cuando el navegador carece de soporte WASM o la carga falla. Ambos se cargan **dinámicamente** (un fragmento o descarga aparte), así que solo se descarga uno, nunca los dos. Se puede forzar con `?engine=js` / `?engine=wasm` (o `localStorage.setItem('engine', …)`); la insignia de la cabecera muestra cuál está activo. Se ha verificado que los dos motores son **idénticos bit a bit**.

TeaVM requiere `optimization = NONE` + `fastGlobalAnalysis = true` (consulta `engine-java/build.gradle`): su optimizador por defecto compila mal el núcleo (pone masas a cero y colapsa instancias de aletas). WASM-GC necesita además el parche del `ArrayList.clone()` de constructor de copia (sus conversiones estrictas rechazan el `(ArrayList) super.clone()` de la JVM).

**Hilos.** Las llamadas **interactivas** al motor —CG/CP/estabilidad en vivo en cada edición (`staticInfo`), el barrido de resistencia (`getDragSweep`), la información de componentes— se ejecutan **de forma síncrona en el hilo principal** (son rápidas, del orden de milisegundos, y deben ser instantáneas). La **simulación de vuelo** (`simulate`, ~500 ms) se ejecuta en un **Web Worker** con su propia instancia del motor, así que una ejecución nunca congela la interfaz (`engine/simClient.ts` + `engine/simWorker.ts`; el worker construye el cohete idéntico mediante el `services/buildRocket.ts` compartido). Esta es la fase 1 de un plan incremental para mover más trabajo del motor fuera del hilo principal; las dos opciones y la hoja de ruta completa están en [engine-worker-proposal.md](https://github.com/thzero/AstraRocketJs/blob/HEAD/docs/engine-worker-proposal.md).

## Sin conexión e instalabilidad (PWA) {#offline--installability-pwa}

Todo lo que la aplicación necesita es estático —el núcleo WASM ejecuta la física en el navegador y no hay backend—, así que puede funcionar sin conexión alguna. `vite-plugin-pwa` (configurado en `web/vite.config.ts`) emite un service worker que precachea el armazón de la aplicación, el motor WASM y los dos catálogos (~7,8 MB), además de un manifiesto de aplicación web que la hace instalable.

Dos exclusiones y adiciones deliberadas:

- El **motor JS alternativo** (~970 kB, emitido dos veces: hilo principal y worker de simulación) se deja *fuera* del precacheado y se guarda en caché en tiempo de ejecución la primera vez que se usa. WASM-GC es el camino que toma prácticamente todo navegador actual, así que precachear ~1,9 MB de alternativa sin usar en cada instalación es un mal trato.
- Los **catálogos de la rama `data`** reciben una regla `StaleWhileRevalidate`, así que se muestran al instante desde la caché y se refrescan en segundo plano: así es como una actualización semanal de catálogo llega a una copia instalada.

El worker se registra con `registerType: 'prompt'`, no `autoUpdate`: una activación silenciosa recarga la página, lo que interrumpiría una edición en curso. En su lugar, `components/layout/UpdateToast.tsx` pregunta, y descartarlo mantiene la versión en marcha hasta la siguiente recarga natural.

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

   **Motores importados.** Se puede importar un archivo `.eng` (RASP): lleva su propia curva de empuje, así que no necesita ninguna consulta a thrustcurve. `engParser.ts` lo analiza, el `MotorStore` lo persiste (`motors:custom`), `loadCatalog()` lo fusiona en el selector (señalado y eliminable) y `fetchMotorSpec` construye su `MotorSpec` a partir de las muestras guardadas. Es contenido de la persona usuaria, simétrico a los materiales personalizados.

   La réplica del catálogo, las entradas por motor y los motores importados se persisten todos mediante el **`MotorStore`** intercambiable (`web/src/services/motorStore.ts`; por defecto `KeyValueMotorStore` sobre IndexedDB), que es dueño de la política de frescura (firma del catálogo, TTL por entrada). Sustitúyelo con `setMotorStore(...)` para llevar los datos de motores a otro sitio; consulta **Dónde viven los datos** más abajo.

## Materiales {#materials}

A diferencia de los motores, los materiales **no** son una fuente externa: los materiales incorporados de OpenRocket son una lista estática. Viven en dos lugares:

- **Incorporados** — `web/src/data/materials.ts` porta la lista original completa (~61 materiales: volumen / superficie / línea, con densidades y grupos) desde el `Databases.java` de OpenRocket. El selector de materiales del editor los lee; el motor reproduce la masa y el CG de OpenRocket porque aplica un material por su **densidad**.
- **Materiales personalizados** — definidos por la persona usuaria (nombre + densidad), persistidos bajo `materials:custom`, fusionados en el selector y reutilizables entre diseños. El núcleo acepta cualquier densidad directamente, así que un material personalizado no es más que una densidad con nombre. `materials.ts` es dueño de las reglas de dominio; `materialStore.ts` es un almacén tipado que se apoya en el almacén clave-valor compartido (más abajo).

La selección de material se aplica al núcleo como una sobrescritura de densidad (`materialDensity`), así que la **física es exacta**: la masa y el CG coinciden con OpenRocket en cualquier caso. Lo que queda pendiente es el viaje de ida y vuelta de los *nombres* de material por `.ork`: al guardar y recargar, un material personalizado o no predeterminado puede perder su **etiqueta** legible (la densidad, y por tanto la física, se conserva). Cerrar ese hueco requiere portar la lista completa de materiales incorporados al shim del motor (`engine-java/src/shims/.../database/Databases.java`, que ahora solo tiene los *valores por defecto* incorporados) más una recompilación del motor, y está integrado en la tarea de `.ork`. (Los catálogos de **componentes** reales de fabricante son una función aparte y sí están implementados; consulta **Componentes** más abajo.)

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

Igual que el catálogo de motores, es un archivo generado bajo `public/data/` que se descarga al primer uso (véase más arriba) en lugar de compilarse en el paquete, así que no cuesta nada hasta que se abre un selector, y se publica en la rama `data` con la misma periodicidad semanal.

## Abrir archivos `.ork` {#opening-ork-files}

**Importar .ork** carga un diseño existente de OpenRocket con **total fidelidad**: cualquier diseño que soporte la API del árbol de componentes del motor (etapas, transiciones, acopladores, anillos, mamparos…), no solo la disposición fija del editor:

```
.ork (zip)  →  orkFile.importOrk()  →  RocketTree  →  OpenRocketDesign.buildTree()  →  staticInfo() / simulate()
```

- **`web/src/services/orkFile.ts`** descomprime con `fflate` y analiza el XML de OpenRocket con `DOMParser`. Sin cargador Java, sin red: el propio cargador de `.ork` de OpenRocket vive en *core* (`core/.../file/openrocket`), pero analizarlo en JS es mucho más ligero que arrastrarlo por TeaVM.
- **`web/src/services/loadOrk.ts`** orquesta: `importOrk` → `buildTree` → resolver el motor de cada soporte contra nuestro catálogo (`findCatalogMotor` → `fetchMotorSpec`) → `staticInfo`. Los motores sin resolver y los componentes no soportados aparecen como notas en el aviso del diseño cargado.

**Exportar .ork** exporta el diseño actual (`orkFile.exportOrk` → comprimido con `fflate` → descargado mediante `web/src/services/saveOrk.ts`). Exportar → volver a importar se ha verificado **idéntico bit a bit** (misma masa, CG, CP y estabilidad), y los archivos se reabren en OpenRocket de escritorio.

## Dónde viven los datos (almacenes intercambiables) {#where-user-data-lives-swappable-stores}

Los datos del lado del cliente viven tras **almacenes de dominio tipados e intercambiables de forma independiente** —uno para motores, otro para materiales—, así que cualquiera puede sustituirse por otra implementación sin tocar los servicios ni la interfaz:

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
```

Todos ellos persisten por defecto mediante un **`IndexedDbKeyValueStore`**, y sus interfaces son asíncronas para que otra implementación (un backend, un almacén compartido) encaje sin reformar a quienes las llaman. Para sustituir uno en el cliente, implementa su interfaz e intercámbialo:

- **Motores:** `setMotorStore(new MyMotorStore())`
- **Materiales:** `setMaterialStore(new MyMaterialStore())`

…o conserva la lógica de dominio por defecto sobre otro backend clave-valor:

- `setMotorStore(new KeyValueMotorStore(new MyKeyValueStore()))`
- `setMaterialStore(new KeyValueMaterialStore('materials:custom', new MyKeyValueStore()))`

Intercambiar uno no afecta al otro.

### Por qué IndexedDB, y los dos sitios donde queda localStorage {#why-indexeddb-and-the-two-places-localstorage-remains}

localStorage es síncrono —cada lectura y escritura bloquea el hilo principal— y está limitado a cerca de **5 MB por origen**, compartidos entre diseños, motores y materiales personalizados, plantillas importadas y las cachés de curvas de empuje. Que `workspaceStore.save()` lance `storage-full` es ese límite asomando. IndexedDB es asíncrono y prácticamente ilimitado.

Los datos existentes se migran **de forma perezosa, por clave, en la primera lectura**: una clave ausente en IndexedDB pero presente en localStorage se copia, y el original solo se borra una vez confirmada la escritura; una migración interrumpida se reintenta en la siguiente carga en lugar de destruir la única copia. Si IndexedDB no está disponible (bloqueado por política, algunos modos privados), toda operación recurre a localStorage, así que la aplicación degrada a su comportamiento anterior en vez de perder el almacenamiento.

Antes de esto la aplicación tenía exactamente UN diseño: un único blob que se reemplazaba cada vez que abrías otro. `designLibrary.ts` hace los diseños direccionables, e incorpora ese espacio de trabajo previo a la biblioteca como su primera entrada en el primer uso (con el nombre de su `.ork` importado, si tenía uno). Como ahora es posible cambiar de diseño, el diario de descarga registra **a qué** diseño pertenece: reproducirlo sobre el que resulte estar abierto sobrescribiría un cohete ajeno.

Dos cosas se quedan en localStorage a propósito:

- **Los ajustes** (`settings.ts`) se leen **de forma síncrona** para que el primer renderizado ya tenga las unidades y preferencias de la persona usuaria; una lectura asíncrona haría parpadear los valores por defecto.
- **El diario de descarga.** Una escritura en IndexedDB no puede completarse mientras la página se está desmontando, así que `WorkspaceStore.saveSync()` escribe el espacio de trabajo en localStorage en `pagehide`/`beforeunload` y el siguiente `load()` lo reincorpora (es por definición la copia más reciente) y lo borra. Sin esto, una edición hecha dentro de los 500 ms de amortiguación del guardado automático se perdería en una recarga rápida. Un manejador de `visibilitychange → hidden` dispara además el guardado asíncrono normal, que en móvil suele ser la última oportunidad antes de que se descarte la pestaña.

Las preferencias pequeñas de interfaz (columnas del panel, filtros del selector) también se quedan en localStorage: son diminutas, y una lectura síncrona mantiene correcto el primer pintado.

## Atribución y licencia {#attribution--license}

El motor deriva del núcleo de OpenRocket (una compilación de desarrollo posterior a la 24.12), y las extensiones opcionales de aerodinámica supersónica (RASAero) son obra original del proyecto mmrocket-sim. Créditos completos y linaje de licencias: [`engine-java/ATTRIBUTION.md`](https://github.com/thzero/AstraRocketJs/blob/HEAD/engine-java/ATTRIBUTION.md) (y `docs/rasaero/` para la física y los diffs de las extensiones).
