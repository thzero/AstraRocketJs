---
title: "Dependencias"
sidebar_position: 16
---
Solo `web/` tiene dependencias de npm (`engine-java/` usa el envoltorio de Gradle incluido). Esta página registra la **política de versiones** y, más importante, **por qué un paquete no está deliberadamente en su última versión**, para que la siguiente persona que ejecute `npm outdated` no vuelva a discutir una decisión ya tomada ni «arregle» una fijación que existe por un motivo.

_Última auditoría: **2026-09-11**._

#### Contenido

- [Política de versiones](#version-policy)
- [Retenciones deliberadas](#deliberate-holds)
- [Revisar una retención](#re-checking-a-hold)

## Política de versiones {#version-policy}

**1. El rango declarado nombra la versión realmente instalada.** `web/package.json` nunca debería declarar `^4.0.0` mientras `node_modules` ejecuta `4.3.3`. El rango sigue permitiendo versiones más nuevas —para eso está `^`—, pero el mínimo indica con qué se sabe que el proyecto compila y se prueba. Compruébalo con:

```bash
cd web
node -e "const p=require('./package.json');const a={...p.dependencies,...p.devDependencies};
for(const [k,r] of Object.entries(a)){let v;try{v=require('./node_modules/'+k+'/package.json').version}catch{continue}
if(r.replace(/^[\^~]/,'')!==v)console.log(k,r,'!=',v)}"
```

**2. Los `@types/*` deben coincidir con el paquete en tiempo de ejecución que describen, no con su propia última versión.** Las definiciones de tipos no llevan código: son una afirmación sobre lo que contiene la biblioteca. Unos tipos por delante del tiempo de ejecución hacen que `tsc` acepte APIs que no existen al ejecutar: la compilación pasa y el navegador falla. No es hipotético; `@types/three` estuvo en `0.185` frente a `three@0.169` hasta el 2026-09-11.

Por eso algunas entradas `@types/*` usan `~` (solo parche) en vez de `^`: están atadas a una versión de ejecución que a su vez está retenida.

**3. Las actualizaciones bloqueadas por peers se mueven en grupo, en un solo `npm install`.** Subir un paquete del ecosistema de React por su cuenta produce una cascada confusa de `ERESOLVE`. Consulta la retención de más abajo para ver el grupo actual.

**4. `three` es `0.x` para siempre.** Three.js nunca ha publicado una 1.0; sube la versión *menor* en cada publicación, y por tanto `^0.186.0` significa `>=0.186.0 <0.187.0`: el símbolo de intercalación fija la publicación, no una línea mayor. Actualizar Three.js es siempre una decisión explícita.

## Retenciones deliberadas {#deliberate-holds}

### React 19.2 — bloqueado por `@react-three/fiber` {#react-192--blocked-by-react-threefiber}

| paquete | retenido en | última |
| --- | --- | --- |
| `react` | `~19.2.8` | 19.3.0 |
| `react-dom` | `~19.2.8` | 19.3.0 |
| `@types/react` | `~19.2.18` | 19.3.0 |
| `@types/react-dom` | `~19.2.7` | 19.3.0 |

**Por qué.** `@react-three/fiber@9.7.0` —la última estable— declara:

```json
"peerDependencies": { "react": ">=19 <19.3" }
```

React 19.3.0 queda fuera de ese techo. Instalarlo falla con `ERESOLVE … Could not resolve dependency: peer react@">=19 <19.3" from @react-three/fiber@9.7.0`. A su vez, `react-dom@19.3.0` requiere `peer react@^19.3.0`, así que queda retenido por la misma restricción. Las dos entradas `@types/*` se mantienen para coincidir con el tiempo de ejecución, según la política n.º 2: técnicamente nada las bloquea.

No hay publicado nada más nuevo que 9.7.0 salvo prelanzamientos `10.0.0-canary.*`, que no distribuimos.

**Se desbloquea cuando:** una versión estable de `@react-three/fiber` amplíe ese rango de peers. Los cuatro paquetes pasarán entonces a 19.3 juntos, en una sola instalación.

### No retenidos (para que conste) {#not-held-for-the-record}

Estos están al día, y se verificaron en lugar de darse por supuestos:

- **`three` / `@types/three` en `0.186.0`** — actualizados desde r169 el 2026-09-11. Nada los limitaba; todos los consumidores (`drei`, `fiber`, `three-mesh-bvh`, `@monogrid/gainmap-js`, …) declaran solo un mínimo, el más alto `>=0.159`. El salto de 17 publicaciones **no requirió cambios de código** en `Rocket3D.tsx` ni en `FlightPath3D.tsx`.
- **`tailwindcss` / `@tailwindcss/vite` en `4.3.3`** — durante mucho tiempo declararon `^4.0.0` mientras resolvían a la 4.x más reciente. Eso era una violación de la política n.º 1 (un mínimo obsoleto), no una instalación desactualizada.
- **`typescript` en `5.9.3`** — la versión `8.x` de `typescript-eslint` y el `vite` actual no se han comprobado con TypeScript 7 (el port nativo). Más que una retención, es una actualización que nadie ha presupuestado todavía.

## Revisar una retención {#re-checking-a-hold}

```bash
cd web
npm outdated                                  # qué ofrece el registro
npm view @react-three/fiber version           # ¿hay una nueva estable?
npm view @react-three/fiber peerDependencies.react
```

Si el techo se ha movido, actualiza todo el grupo en **un solo** comando y después ejecuta la verificación completa:

```bash
npx tsc --noEmit && npx eslint . --max-warnings 0 && npm test && npm run build && npx playwright test
```

**La suite e2e no abre las vistas 3D.** Un `playwright test` en verde no dice nada sobre `three`, `fiber` ni `drei`. Cualquier actualización que toque esos paquetes debe comprobarse además a mano: abre la pestaña **3D** (cohete, marcadores CG/CP, etiquetas flotantes) y la pestaña **Trayectoria 3D** (ejecuta una simulación y pulsa reproducir: la trayectoria debe dibujarse con el coloreado de impulso y planeo y las etiquetas de fin de combustión y apogeo), y confirma que la consola del navegador está limpia. Un lienzo WebGL en blanco no lanza ningún error.

Ten cuidado también con un `node_modules` a medio actualizar: en Windows, un servidor de desarrollo en marcha puede retener `@rolldown/binding-win32-x64-msvc`, haciendo que `npm install` falle con `EBUSY` y dejando un árbol mixto que produce fallos de prueba espurios. Detén cualquier servidor de desarrollo, vuelve a ejecutar `npm install` y confirma las versiones antes de fiarte de una ejecución en rojo.
