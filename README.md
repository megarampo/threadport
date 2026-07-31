# ThreadPort

**Mueve, ramifica y continúa conversaciones entre ChatGPT, Claude y Gemini con todo su contexto, en un click.**

Extensión de Chrome (Manifest V3). Sin servidores: todo corre en el navegador del usuario. Modelo freemium: 10 transferencias/mes gratis, Pro ilimitado.

## Cómo funciona

1. El content script extrae la conversación de la pestaña activa (DOM scraping con estrategias en capas por plataforma — ver `src/content/extractors.js`).
2. El popup muestra la conversación detectada y los destinos posibles.
3. Al elegir destino, se construye el "handoff prompt" (`src/common/transcript.js`: encabezado + transcript + truncado inteligente si supera 60k caracteres).
4. El service worker guarda el payload en `chrome.storage.local` y abre el chat nuevo del destino.
5. El content script del destino detecta el payload pendiente, espera el composer e inyecta el texto. El envío automático es opcional (apagado por defecto: el usuario revisa antes de enviar).

## Probar en desarrollo

1. Abrir Chrome → `chrome://extensions`
2. Activar **Modo de desarrollador** (arriba a la derecha)
3. **Cargar extensión sin empaquetar** → elegir la carpeta `threadport/`
4. Abrir una conversación en ChatGPT, Claude o Gemini → click en el ícono de ThreadPort → elegir destino

**Nota:** si la extensión se instaló con pestañas de IA ya abiertas, recargarlas una vez.

## Mantenimiento de selectores

Los tres sitios cambian su DOM sin aviso. Cuando la extracción falle:
- Agregar una **nueva estrategia al tope** de la lista en `extractors.js` (no editar las viejas: siguen sirviendo para usuarios con la UI anterior en rollout escalonado).
- Ídem para los selectores de composer/envío en `injector.js`.
- Mantener esto mejor que la competencia ES el producto.

## Estado y roadmap

- [x] MVP: extracción + transferencia ChatGPT ↔ Claude ↔ Gemini
- [x] Cuota free tier (10/mes) con contador mensual en `storage.sync`
- [x] Truncado inteligente de chats largos
- [ ] Probar selectores contra los sitios reales (ver arriba) y ajustar
- [ ] Pro: checkout con Stripe/ExtensionPay + verificación de licencia (`popup.js` tiene el stub en `tp_pro`)
- [ ] Landing page (threadport.app u otro dominio)
- [ ] Fork "mismo sitio": ramificar una conversación dentro de la misma IA
- [ ] Publicación en Chrome Web Store (cuenta dev USD 5) — título ASO: "ThreadPort — Move chats between ChatGPT, Claude & Gemini"
- [ ] Historial de transferencias (feature Pro)
- [ ] Firefox/Edge (portar manifest)

## Pricing decidido

Free 10/mes · Pro €7,99/mes · Anual €47 · Lifetime lanzamiento €69-79.
