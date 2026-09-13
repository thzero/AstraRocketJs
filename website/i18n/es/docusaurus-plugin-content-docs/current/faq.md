---
title: "Preguntas frecuentes"
sidebar_position: 4
---
### ¿Esto es OpenRocket?
No: es una aplicación independiente que **ejecuta el motor de física de OpenRocket** en el navegador. Cubre lo esencial con una interfaz ligera y adaptada a móviles, y lee y escribe los mismos archivos `.ork`. No está afiliada al proyecto OpenRocket.

### ¿Necesito instalar algo?
No. Es una aplicación web: abre la URL en un navegador moderno. Sin JDK, sin descargas.

### ¿Se suben mis diseños a algún sitio?
No. Todo se ejecuta en tu dispositivo. Tus cohetes, tus motores y materiales personalizados y tus ajustes se guardan en el almacenamiento local de tu navegador, y puedes exportar un `.ork` a tu disco. No se envía nada a ningún servidor.

### ¿Mis archivos `.ork` funcionarán en OpenRocket de escritorio?
Sí: la importación y la exportación son de ida y vuelta con total fidelidad, y un archivo exportado se vuelve a abrir en OpenRocket de escritorio.

### ¿Mis unidades aparecen en OpenRocket de escritorio?
No. Las unidades viven en los ajustes de tu navegador, no en el `.ork`: el archivo no tiene dónde guardarlas, y OpenRocket de escritorio mantiene las suyas en sus preferencias. Tu archivo se abre allí con las unidades de OpenRocket y aquí con las tuyas; el cohete es el mismo en ambos casos. Por la misma razón, tus unidades no te siguen a otro ordenador ni a otro navegador. Consulta **[Ajustes](./settings.md#units)**.

### ¿Por qué la estabilidad es distinta «en la rampa» y «al salir del raíl»?
Cuando el cohete abandona la varilla o el raíl ya pesa algo menos (ha quemado algo de propelente) y su CG se ha desplazado, así que su margen de estabilidad difiere del valor en la rampa con el cohete cargado. El valor de salida del raíl suele ser el más significativo.

### ¿Puedo usar pulgadas o unidades imperiales?
Sí. **Ajustes ▸ Unidades** tiene un botón de **Valores imperiales**, y puedes configurar cada magnitud por separado (longitudes en pulgadas, altitud en pies, masa en onzas, viento en mph, etc.). La unidad impresa junto a cualquier valor también es un selector: haz clic para cambiar ese campo concreto, dejando todo lo demás en tus valores por defecto.

Las unidades solo afectan a lo que se muestra y se escribe: tu diseño se guarda siempre en SI, así que cambiar de unidades nunca modifica un cohete ni cómo se escribe un archivo `.ork`. Consulta **[Ajustes](./settings.md#units)**.

### ¿Funciona sin conexión?
Sí. Tras la primera visita, la aplicación conserva en tu dispositivo tanto la propia aplicación como el motor de física y los dos catálogos, así que se abre y ejecuta una simulación completa sin conexión — útil en un campo de vuelo sin cobertura. Tu navegador también te ofrecerá **instalarla**. Consulta **[Sin conexión e instalación](./offline-and-installing.md)**.

### ¿Qué es la insignia `WASM` / `JS` de la cabecera?
Indica qué motor se ha cargado: **WASM** (WebAssembly, el rápido por defecto) o **JS** (JavaScript, la alternativa para navegadores sin soporte de WASM). Ambos producen resultados idénticos.

### El nombre de un material cambió tras guardar y reabrir un `.ork`. ¿Está mal mi cohete?
No: **la física se conserva** (los materiales se aplican por densidad, así que la masa, el CG y la estabilidad son exactos). Solo el **nombre** legible de un material no predeterminado puede no sobrevivir todavía al viaje de ida y vuelta; la densidad queda intacta.

### La simulación no bloqueó la aplicación mientras se ejecutaba, ¿es normal?
Sí. Las simulaciones de vuelo se ejecutan en un Web Worker en segundo plano, así que la interfaz sigue respondiendo mientras se calcula un vuelo.

### ¿Cómo informo de un fallo o pido una función?
Consulta la página **[Contribuir](./contributing.md)**: se agradecen informes de fallos, ideas de funciones, traducciones y código.
