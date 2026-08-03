# ThreadPort — Kit de lanzamiento

*Preparado el 2026-08-01, mientras la v0.1.2 está en revisión. Ejecutar el día de la aprobación.*

## Posicionamiento (el mensaje, en una línea)

> **Your AI conversations, portable.** Continue any ChatGPT / Claude / Gemini conversation on another AI — full context, one click.

Contra la importación nativa de memoria de Claude (nuestro "competidor" más citado): esa migra
tus *preferencias generales* una sola vez; ThreadPort mueve *la conversación que tenés abierta
ahora mismo*, en ambas direcciones, entre las tres plataformas. Complementarios, no rivales.
Viento de cola: los medios tech están escribiendo activamente sobre "moverse de ChatGPT a
Claude" y "diversificar entre IAs" (TechRadar, Tom's Guide, 2026).

## Canales, en orden de ejecución

### Día 0 (aprobación)
1. **Actualizar el enlace de la landing** (`docs/index.html`, botón #install → URL real de la tienda) y push.
2. **Edge Add-ons**: registrarse (gratis) en partner.microsoft.com y subir el MISMO zip. Menos competencia, revisión suave, distribución regalada.

### Día 0-2 — Responder demanda existente (el canal que mejor convierte)
Buscar en Reddit (reddit.com/search y dentro de r/ChatGPT, r/ClaudeAI, r/GoogleGeminiAI, r/artificial):
- "continue conversation claude chatgpt"
- "move chat to claude"
- "transfer chatgpt conversation"
- "switch ai mid conversation"
- "hit limit continue another ai"
Ordenar por recientes; responder SOLO donde la pregunta es literalmente nuestra solución.

**Plantilla de respuesta (adaptar siempre al hilo, jamás pegar tal cual):**
> I had this exact problem (kept copy-pasting chats between ChatGPT and Claude), so I built a
> small extension that does it in one click — it grabs the conversation, opens the other AI and
> pastes everything formatted as context: [link]
> Free for 10 transfers/month. Full disclosure: I'm the developer. Feedback very welcome —
> it's brand new.
- Regla de oro: transparencia total (decir que somos los devs) + ser útil primero. Los mods
  toleran self-promo honesto en respuesta a preguntas directas; banean el spam.
- Máximo 2-3 respuestas por subreddit por semana.

### Día 2-7 — Product Hunt
- Lanzar martes o miércoles (más tráfico útil que lunes/finde).
- **Tagline:** "Move AI chats between ChatGPT, Claude & Gemini in one click"
- **First comment (del maker):** historia honesta — "I use 3 AIs daily and was sick of
  copy-pasting conversations between them. ThreadPort extracts the chat, cleans out the UI
  junk (widgets, buttons, citations), and pastes it into the other AI formatted as context.
  No servers — everything runs in your browser. Free plan: 10 transfers/month. Ask me anything."
- Preparar 3-4 respuestas a preguntas previsibles: privacidad (no hay servidores), por qué no
  API (porque scraping del DOM no requiere API keys del usuario), roadmap (Firefox, más IAs).

### Semana 1-2 — Prensa especializada
Pitch corto a los periodistas que YA escriben de esto (buscar autor actual de cada pieza):
- Tom's Guide — artículos "I quit ChatGPT, moved to Claude/Gemini" y "diversifying AI chatbots"
- TechRadar — "How to move from ChatGPT to Claude"
**Email (3 líneas, sin adjuntos):**
> Subject: One-click tool for the exact workflow you covered — moving chats between AIs
> Hi [name], you wrote about moving from ChatGPT to Claude without losing context. I built a
> free Chrome extension that does it for live conversations: one click moves any chat between
> ChatGPT, Claude and Gemini, full context included. 30-sec demo: [link/gif]. Happy to answer
> anything — [Juan, Valencia].

### Continuo
- X/Twitter: buscar "wish I could move this chat" / "copy paste chatgpt claude" y responder útil.
- GIF de demo de 20-30 segundos (grabar cuando esté aprobada) — multiplica conversión en
  todos los canales. Herramienta: ScreenToGif (gratis, Windows).

## Métricas que importan (panel Chrome Web Store)
- Semana 1: instalaciones > 50 y sin desinstalación masiva (>50% retención) = hay señal.
- Mes 1: 300-500 usuarios activos semanales = conectar Stripe y activar Pro.
- Reviews: pedirla SOLO a quien nos escriba algo positivo. Las 5 primeras reviews definen la ficha.

## Qué NO hacer
- No comprar instalaciones ni reviews (baneo de por vida de la cuenta de operador).
- No spamear subreddits el mismo día (los mods se hablan entre sí).
- No tocar el paquete durante la revisión inicial.
