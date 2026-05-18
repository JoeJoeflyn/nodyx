# NODYX — Hoja de ruta
### Versión 2.4 — Sistema de copias de seguridad + Modo de mantenimiento en vivo

---

> *"Un proyecto que intenta hacerlo todo a la vez no hace nada bien."*
> La hoja de ruta de Nodyx se basa en una regla simple:
> cada fase debe funcionar perfectamente antes de pasar a la siguiente.

---

## ESTADO ACTUAL — Mayo 2026

| Fase | Título | Estado |
|---|---|---|
| **Fase 1** | Foro MVP + Admin | ✅ Completa |
| **Fase 2** | Chat en tiempo real + Directorio + Identidad de red | ✅ Completa |
| **Fase 2.5** | Personalización de comunidad + Federación ligera | ✅ Completa |
| **Fase 3** | Infraestructura P2P + Base en Rust | ✅ Completa |
| **Fase 4** | Enriquecimiento de la plataforma (v1.4 → v1.8) | ✅ Completa |
| **Fase 4.5** | Refuerzo de seguridad (v1.8.2) | ✅ Completa |
| **Fase 4.6** | Defensa activa y seguridad en tiempo de ejecución (v1.9.0) | ✅ Completa |
| **Fase 4.7** | 2FA — TOTP + Nodyx Signet como 2.º factor (v1.9.1) | ✅ Completa |
| **Fase 4.8** | Estabilidad en producción y refuerzo entre runtimes (v1.9.3) | ✅ Completa |
| **Fase 4.9** | Aislamiento de procesos, cobertura de tests y CI (v1.9.4) | ✅ Completa |
| **Fase 4.10** | Perfil vivo + Rediseño del foro (v1.9.5) | ✅ Completa |
| **Fase 4.11** | Comunicaciones privadas y soberanas — MDs E2E (v2.0) | ✅ Completa |
| **Fase 4.12** | Constructor de página de inicio + SDK de widgets (v2.1) | ✅ Completa |
| **Fase 4.13** | NodyxCanvas — Actualización mayor (v2.2) | ✅ Completa |
| **Fase 4.14** | Reproductor multimedia universal + Catálogo del constructor + Refuerzo de túneles (v2.3) | ✅ Completa |
| **Fase 4.15** | Sistema de copias de seguridad Fase 1 + Modo de mantenimiento en vivo (v2.4) | ✅ Completa |
| Fase 5 | Móvil + Nodos + Reacciones + Importación de Discord | 🔨 En curso |
| **Fase Horizonte** | NODYX-ETHER — Soberanía de la capa física | 🌌 Visión |
| **Fase Radio** | NODYX-RADIO — Radio por internet + red publicitaria cooperativa | 📻 Visión |

---

## FASE 1 — Foro MVP + Admin ✅ COMPLETA
### Objetivo: Una comunidad puede instalar, configurar y vivir en Nodyx

### 1.1 Backend del foro
- [x] Migración SQL inicial (users, communities, categories, threads, posts)
- [x] Migración 002 — user_profiles (bio, avatar, tags, links, campos sociales)
- [x] Migración 003 — grades (grades, community_grades, community_members.grade_id)
- [x] Migración 004 — social links (github, youtube, twitter, instagram, website)
- [x] Migración 005 — categories.parent_id (categorías infinitas, CTE recursivo)
- [x] Migración 006 — threads.is_featured (artículos destacados)
- [x] Migración 007 — post_reactions + post_thanks (reacciones emoji + karma)
- [x] Migración 008 — tags + thread_tags (etiquetas por comunidad)
- [x] Migración 009 — search_vector + GIN triggers (búsqueda de texto completo)
- [x] Migración 010 — notifications (thread_reply, post_thanks, mention)
- [x] Ruta POST /api/v1/auth/register
- [x] Ruta POST /api/v1/auth/login + logout
- [x] Ruta GET  /api/v1/communities + /communities/:slug
- [x] Ruta POST /api/v1/communities/:slug/members (unirse/salir)
- [x] Rutas del foro (categorías, hilos, publicaciones) — CRUD completo
- [x] Edición del título del hilo (autor + mods)
- [x] Reacciones emoji en publicaciones (6 emojis, alternancia)
- [x] Botón de agradecimiento (+5 karma al autor, 1 por usuario/publicación)
- [x] Etiquetas de hilos (el admin las crea, se seleccionan al crear)
- [x] Búsqueda de texto completo en PostgreSQL (ts_headline, filtro por comunidad)
- [x] Notificaciones (respuesta, agradecimiento recibido, @mención)
- [x] Middleware de autenticación JWT
- [x] Middleware de limitación de peticiones Redis
- [x] Validación Zod en todas las rutas
- [x] Seguimiento de usuarios "en línea" — heartbeat Redis TTL 900s
- [x] Rutas de instancia — /instance/info, /instance/categories, /instance/threads/recent
- [x] Rutas de administración — estadísticas, miembros, hilos (anclar/bloquear/eliminar), categorías, etiquetas

### 1.2 SEO e indexación
- [x] Rutas del foro renderizadas como HTML estático (SvelteKit SSR)
- [x] Metaetiquetas dinámicas (title, description, og:*)
- [x] Sitemap.xml automático
- [x] robots.txt configurable
- [x] Feed RSS
- [x] Schema.org JSON-LD (Forum, DiscussionForumPosting)
- [x] llms.txt (para agentes de IA)

### 1.3 Frontend
- [x] SvelteKit inicializado + Tailwind v4
- [x] Página de inicio = comunidad de la instancia (NODYX_COMMUNITY_NAME vía .env)
- [x] Árbol de categorías recursivo (CategoryTree.svelte)
- [x] Página de lista de categorías + hilos (con etiquetas)
- [x] Página de hilo + publicaciones + formulario de respuesta
- [x] Editor WYSIWYG (Tiptap — negrita, código, tablas, imágenes, iframes)
- [x] Formulario de registro / inicio de sesión
- [x] Perfiles de usuario completos (bio, etiquetas, enlaces, widget de GitHub)
- [x] Sistema de rangos (CRUD admin + insignia de color)
- [x] Directorio de instancias (/communities — impulsado por nodyx.org)
- [x] Panel de administración completo (/admin — 9 páginas incluyendo Etiquetas)
- [x] Barra de navegación adaptativa (búsqueda, campana de notificaciones, enlace Admin)
- [x] Página /search — pestañas Hilos/Publicaciones, extractos resaltados
- [x] Página /notifications — lista + marcar como leído + sondeo cada 30s

### 1.4 Autoalojamiento
- [x] `install.sh` — instalador de VPS en un clic (puertos 80/443, Let's Encrypt vía Caddy, PM2, coturn, PostgreSQL, Redis)
- [x] `install_tunnel.sh` — instalador para servidor en casa vía Cloudflare Tunnel (sin puertos abiertos, Raspberry Pi)
- [x] docker-compose.yml (Nodyx + PostgreSQL + Redis)
- [x] Dockerfile multietapa
- [x] Script de seed (datos de demostración)
- [x] Script PowerShell "Nodyx-Easy-Install" — automatiza Node/PostgreSQL/Redis en Windows Server sin Docker
- [x] Comprobación de salud visual post-instalación (spinner braille, puntuación PASS/WARN/FAIL)
- [x] Documentación de instalación en 15 minutos
- [x] Guía completa de nombres de dominio (DOMAIN.md — tipos, compatibilidad, preguntas frecuentes)
- [x] .env.example documentado

### Criterios de éxito de la Fase 1 ✅
Un usuario no desarrollador puede:
1. Instalar Nodyx en su servidor en menos de 15 minutos ✅
2. Configurar su instancia a través del instalador interactivo ✅
3. Crear categorías, hilos y etiquetas ✅
4. Gestionar su comunidad a través del panel de administración ✅
5. Aparecer en los motores de búsqueda (Google, Bing, Brave, Qwant...) ✅

---

## FASE 2 — Chat en tiempo real + Directorio + Identidad de red ✅ COMPLETA
### Objetivo: Los miembros se comunican en directo, el directorio es real, cada instancia tiene su URL

### 2.1 Chat en tiempo real ✅
- [x] WebSocket (Socket.io) integrado en Fastify v5
- [x] Canales de texto configurables por el administrador
- [x] Notificaciones en tiempo real (WebSocket — sustituye el sondeo cada 30s)
- [x] Historial de mensajes persistido en PostgreSQL

### 2.2 nodyx.org — Directorio ✅
- [x] Servicio de directorio global real — API de registro de instancias
- [x] Página /communities alimentada por el directorio real (fin del mock)
- [x] Registro automático de la instancia en el primer arranque
- [x] Ping automático cada 5 minutos (contador de miembros en vivo, estadísticas de conexión)

### 2.3 Identidad de red — `mi-comunidad.nodyx.org` ✅
- [x] Cada instancia elige un identificador único en la instalación
- [x] El identificador se reserva con el directorio de nodyx.org (API REST)
- [x] DNS wildcard `*.nodyx.org` gestionado por nuestro Cloudflare
- [x] Caddy enruta `mi-comunidad.nodyx.org → IP del nodo` (Certificado de origen de Cloudflare)
- [x] El administrador no tiene que configurar DNS — URL limpia en 1 clic

### 2.4 Salas de voz — Capa de red ✅
- [x] Servidor coturn (STUN/TURN) configurado e iniciado por `install.sh`
- [x] Señalización WebRTC vía Socket.io (`src/socket/voice.ts`)
- [x] VoicePanel.svelte — barra flotante + controles de micrófono/cámara/pantalla compartida
- [x] VoiceSettings.svelte — cadena AudioContext configurable
- [x] MediaCenter.svelte — compartir pantalla + clips

---

## FASE 2.5 — Personalización de comunidad + Federación ligera ✅ COMPLETA
### Objetivo: Cada instancia es única, y las instancias pueden compartir sus creaciones

### v0.6 — Biblioteca de recursos y Jardín de funciones ✅

- [x] Migración 017 — `community_assets` (marcos, banners, insignias, pegatinas, avatares, fondos)
- [x] Migración 018 — `user_equipped_assets` (ranuras de personalización de perfil)
- [x] Migración 019 — `feature_seeds` (propuestas de funciones)
- [x] Migración 020 — `user_seed_balance` (3 semillas/semana por usuario)
- [x] Ruta `POST /api/v1/assets` — subida multipart con compresión Sharp (WebP)
- [x] CRUD completo + like + equipar/desequipar rutas para recursos de comunidad
- [x] `assetService.ts` — miniaturas automáticas, redimensionado, gestión de ranuras
- [x] Página `/library` — galería de recursos con filtros de categoría/etiqueta/popularidad
- [x] Página `/library/[id]` — detalle de recurso con like, equipar, botón Whisper
- [x] Rutas `/api/v1/garden` — propuestas + votación con semillas + cambio de estado (admin)
- [x] Página `/garden` — lista de propuestas, votación visual con contador de semillas
- [x] Perfil de usuario — mostrar recursos equipados (marco, banner, insignia, fondo)
- [x] `/users/me/edit` — gestionar ranuras de recursos en tu propio perfil

### v0.7 — Recursos federados + Whispers ✅

- [x] Migración 021 — `directory_assets` (instantánea de recursos federados de otras instancias)
- [x] Migración 022 — `whisper_rooms` + `whisper_messages` (salas efímeras)
- [x] Ruta `POST /api/directory/assets` — enviar recursos al registro (token Bearer)
- [x] Ruta `GET /api/directory/assets/search` — búsqueda pública en múltiples instancias
- [x] Planificador — envía recursos a `nodyx.org` cada hora
- [x] Planificador — limpia salas whisper caducadas cada 10 minutos
- [x] Pestaña "🌐 Todas las instancias" en `/library` — recursos federados del directorio
- [x] Rutas `/api/v1/whispers` — crear, obtener, eliminar salas efímeras
- [x] Socket.IO — eventos `whisper:*` (unirse, salir, mensaje, escribiendo, historial, caducado)
- [x] Página `/whisper/[id]` — sala whisper en tiempo real (estilo iMessage, TTL visible)
- [x] Botón "🤫 Whisper" en páginas de recursos — creación de sala contextual
- [x] Botón "🔗 Compartir" — copia enlace con feedback "✅ Copiado!"
- [x] `linkify.ts` — URLs clicables en chat (`linkifyHtml`) y whispers (`linkifyText`)

---

## FASE 3 — Infraestructura P2P + Base en Rust ✅ COMPLETA
### Objetivo: Liberarse de las dependencias de red de terceros. Construir el núcleo descentralizado.

> *"P2P es el alma. Rust es el cuerpo."*
>
> Nodyx no reemplazará Node.js ni SvelteKit — hacen su trabajo perfectamente.
> Rust vendrá **por debajo**, invisible para el usuario, para gestionar las partes
> que JavaScript no puede hacer bien: redes de bajo nivel, cifrado, WireGuard, DHT.
> La capa Rust se comunica con nodyx-core vía un socket Unix local — simple y desacoplado.

---

### 3.0 — `nodyx-p2p`: La base en Rust ✅ COMPLETA

#### ¿Por qué Rust aquí?

Hoy, un usuario sin dominio y sin puertos abiertos debe:
1. Crear una cuenta de Cloudflare
2. Añadir su dominio a Cloudflare (requiere tener uno, ~$1/año)
3. Configurar `cloudflared` manualmente o vía `install_tunnel.sh`

Demasiada fricción. Y más importante: **es una dependencia de un servicio de terceros**,
contraria a la filosofía de Nodyx.

La capa Rust resuelve esto de forma radical y progresiva.

#### Arquitectura

```
nodyx-frontend (SvelteKit) ──────────────────────┐
nodyx-core    (Fastify/Node.js) ─────────────────┤
                                                  │ IPC (Unix socket)
                                                  ▼
                                    ┌─────────────────────┐
                                    │     nodyx-p2p       │
                                    │       (Rust)        │
                                    │                     │
                                    │  ┌───────────────┐  │
                                    │  │ Relay Client  │  │
                                    │  │ (TCP/tokio)   │  │
                                    │  └───────────────┘  │
                                    │  ┌───────────────┐  │
                                    │  │ STUN/TURN     │  │
                                    │  │ (reemplaza    │  │
                                    │  │  coturn)      │  │
                                    │  └───────────────┘  │
                                    │  ┌───────────────┐  │
                                    │  │ DHT Kademlia  │  │
                                    │  │ + WireGuard   │  │
                                    │  │ (red en malla │  │
                                    │  │  entre nodos) │  │
                                    │  └───────────────┘  │
                                    └─────────────────────┘
```

#### Fase 3.0-A — `nodyx-relay-client` ✅ VALIDADA — 1 de marzo de 2026

> Reemplaza `install_tunnel.sh` + Cloudflare Tunnel. Sin dominio. Sin puertos abiertos.
> **Probado en condiciones reales: Raspberry Pi 4, sin puertos abiertos, sin cuenta de Cloudflare.**

- [x] Binario Rust estático (9MB) — `tokio` + `hyper` + `tokio-postgres` + `clap` + `dashmap`
- [x] Conexión TCP saliente a `relay.nodyx.org:7443` (nuestra infraestructura)
- [x] Reenvío HTTP bidireccional (enmarcado JSON, prefijo de longitud de 4 bytes)
- [x] Registro automático de `mi-comunidad.nodyx.org` sin DNS ni cuenta de CF
- [x] Reconexión automática con retroceso exponencial (1s → 2s → 4s → máx. 30s)
- [x] GitHub Release `v0.1.1-relay` — binarios amd64 + arm64 (fix: gestión de peticiones concurrentes)
- [x] Integración en `install.sh`: opción 2 "Nodyx Relay (recomendado)"
- [x] Servicio systemd en el cliente (`nodyx-relay-client.service`)

**Resultado para el usuario:** `bash install.sh` → elige "Relay" → obtiene `mi-comunidad.nodyx.org` **sin ninguna configuración de red**.

#### Fase 3.0-B — Nodos P2P en el navegador (WebRTC DataChannels) ✅ POC VALIDADO — 2 de marzo de 2026

> Los navegadores de los usuarios se convierten en nodos relay activos.
> Comunicación directa entre pares sin intermediario de servidor.
> **Reutiliza la señalización existente de `voice.ts`** — sin nueva infraestructura de servidor.

**Enfoque:** DataChannels WebRTC nativos + señalización Socket.IO existente (patrón voice.ts)
**No en este POC:** libp2p (excesivo), DHT (2027+)

**v0.8 — POC dos navegadores ✅:**
- [x] Añadir eventos `p2p:offer`, `p2p:answer`, `p2p:ice` a `voice.ts` (3 líneas — mismo patrón que `voice:offer/answer/ice`)
- [x] Crear `nodyx-frontend/src/lib/p2p.ts` — gestor RTCPeerConnection + DataChannel
- [x] Descubrimiento de pares vía Socket.IO existente (handshake educado/maleducado — un único iniciador)
- [x] Usar el coturn propio de la instancia (ya instalado) — sin STUN de terceros
- [x] Manejador `ondatachannel` en el lado del receptor (crítico — sin él, el receptor nunca recibe el canal)
- [x] Indicador UI "⚡ P2P · N" en la cabecera del canal de texto (amarillo cuando activo, gris pulsante al conectar)
- [x] Test validado: dos navegadores, DataChannel directo confirmado, mensajes sin pasar por el servidor

**Resultado para el usuario:** unirse a cualquier canal de texto → el indicador ⚡ P2P aparece automáticamente cuando otro miembro está presente. Sin configuración.

**v0.9 — Malla 1-N ✅ ENTREGADO — 2 de marzo de 2026:**
- [x] Gestionar múltiples conexiones de pares simultáneas (Map de RTCPeerConnections — ya en p2p.ts)
- [x] Indicadores de escritura P2P instantáneos (~1–5ms, puntos animados estilo Discord)
- [x] Reacciones optimistas + animación pop con físicas de muelle (llega antes del roundtrip al servidor)
- [x] Fallback elegante si WebRTC falla (timeout ICE 12s, toast sutil, flags _hadAttempt/_hadSuccess)
- [x] Transferencia de recursos entre pares (chunks de 32 KB, protocolo p2p:asset:*, store p2pAssetPeers, botón ⚡ amarillo)

#### Fase 3.0-C — `nodyx-turn` (reemplaza coturn) ✅ VALIDADA — 4 de marzo de 2026 / Actualizada el 8 de marzo de 2026

> coturn es un proyecto C de los años 2000. Complejo de configurar, gran superficie de ataque.
> **Reemplazado por un binario Rust de 2,9 MB — sin dependencias, credenciales dinámicas.**

- [x] Servidor STUN/TURN en Rust — RFC 5389 (STUN) + RFC 5766 (TURN)
- [x] Credenciales basadas en tiempo HMAC-SHA1 (username={expires}:{userId})
- [x] MESSAGE-INTEGRITY en todas las respuestas de éxito TURN (RFC 5389 §10.3) — requerido para relay en Firefox/Chrome
- [x] **TURN-over-TCP (RFC 6062)** — TCP:3478 junto a UDP:3478, registro de asignaciones compartido
- [x] Enmarcado RFC 4571 (prefijo de longitud de 2 bytes big-endian por mensaje TCP)
- [x] Abstracción `ResponseSink` — todos los manejadores TURN independientes del transporte (UDP y TCP unificados)
- [x] Limitador de velocidad UDP por IP (30 pkt/seg) + cuotas de asignación (MAX_LIFETIME=300s) + mapa de bloqueo
- [x] Binario estático de 2,9 MB, integrado en `install.sh`, servicio systemd
- [x] Validado: STUN Binding Request → 0x0101 Binding Success ✅
- [x] **Voz — Failover a relay**: cambia automáticamente a `iceTransportPolicy: relay` tras pérdida de paquetes alta sostenida (>25% × 3 sondeos)
- [x] **Voz — Optimización Opus**: 32 kbps por defecto, DTX desactivado, mono, FEC activado — optimizado para enlaces VPN/con pérdidas

#### Fase 3.0-D — Núcleo `nodyx-p2p` (visión a largo plazo 2027-2028)

> El núcleo distribuido. Cuando un nodo quiere contactar con otro directamente, sin pasar por nosotros.
> Red inmortal: cada dato replicado en 3+ nodos, autocurativo.

- [ ] Kademlia DHT (vía `libp2p`) — descubrimiento de pares sin servidor central
- [ ] WireGuard (vía `wireguard-rs`) — túnel directo cifrado entre instancias voluntarias
- [ ] ICE/STUN nativo — NAT traversal sin coturn para conexiones P2P
- [ ] API IPC expuesta a nodyx-core: `relay.register(slug)`, `peer.connect(slug)`, `network.peers()`
- [ ] Protocolo Gossip — propagación natural del estado por la red
- [ ] CRDTs — datos distribuidos sin conflictos (como contadores, presencia)
- [ ] Factor de replicación 3 — autocurativo si un nodo cae
- [ ] Si `nodyx.org` no está disponible, los nodos se encuentran vía DHT (resiliencia)

---

### 3.1 — Salas de voz — Interfaz y modos avanzados
*(capa de red ya en marcha — Fase 2.4)*

- [x] Barra lateral VoicePanel — panel izquierdo en posición fija con lista de participantes (diseño Galaxy Bar)
- [x] Panel de interacción con miembros en voz — clic en cualquier miembro → estadísticas de red en tiempo real (RTT / jitter / pérdida de paquetes) + control de volumen
- [x] Panel de automonitorización — clic en ti mismo → medidor de nivel de audio en vivo, insignias de estado silenciado / sin sonido / PTT
- [x] Popup VoiceSettings — modal grande en posición fija (360px), escapa el desbordamiento de la barra lateral con superposición de fondo
- [x] Botones de interacción por par — enlace de perfil, Mensaje directo, compartir archivos + Mini-juego (próximamente)
- [ ] Modo anfiteatro — difusión 1→N (9 a 25+ personas, vídeo en "pantalla")
- [ ] Nodos como servicio — una Raspberry Pi puede convertirse en relay multimedia para aliviar el servidor principal

#### v1.0 — Mesa colaborativa ⏳ PLANIFICADA
*(base P2P DataChannels operativa — v0.9)*

> *La sala de voz se convierte en un espacio vivo: jugar, trabajar, escuchar música, compartir archivos — todo en una ventana. El primero self-hosted de código abierto en combinar los cuatro casos de uso.*

**Base visual**
- [ ] Mesa oval SVG — avatares posicionados en elipse (yo = siempre abajo, algoritmo `getAvatarPositions`)
- [ ] Zona central despejada (arrastrar y soltar, mismo plano SVG)
- [ ] Clic en avatar → menú contextual (whisper, perfil, desafío, silenciar)
- [ ] Protocolo `table:*` en DataChannels (estado, evento, objeto:mover/añadir/eliminar)
- [ ] Árbitro anfitrión — fuente única de verdad, elección automática cuando el anfitrión sale
- [ ] Persistencia del estado en BD (instantánea cada 30s) + restauración al reconectar
- [ ] Ondas de audio en avatares (AnalyserNode + propiedad CSS personalizada `--voice-intensity`)

**Archivos y presencia**
- [ ] Arrastrar y soltar archivo → compartido en la mesa para todos (temporal)
- [ ] Anclar 📎 — el archivo permanece visible aunque el propietario esté desconectado
- [ ] Arrastrar archivo sobre avatar → abre un Whisper con el archivo adjunto
- [ ] Estados de presencia: 🎙️ en voz / 🪑 en la mesa / 🎮 en partida

**Widgets**
- [ ] Giro aleatorio "¿Quién empieza?" (animación CSS, resultado visible para todos)
- [ ] Temporizador compartido — Pomodoro / Blitz / Personalizado (AudioContext para sonido final)
- [ ] Marcador de sesión persistente
- [ ] Modo escenario — "Tomar la palabra" (votación rápida, micrófono prioritario, otros -20dB)
- [ ] Modo espectador — miembros del foro observan sin participar (sala Socket.IO separada)
- [ ] Historial de sesión exportable (texto o PDF)

**Jukebox colaborativo**
- [ ] Reproductor Web Audio API (reproducir/pausar/siguiente) — sincronización P2P, calidad original, sin compresión
- [ ] Volumen individual (GainNode + localStorage, nunca se emite a otros)
- [ ] Carátula: etiquetas ID3 → MusicBrainz → Apple iTunes → caché IndexedDB
- [ ] Listas de reproducción colaborativas guardadas en BD
- [ ] Votos 👍👎 + cola de prioridad inteligente
- [ ] Fundido cruzado entre pistas (dos GainNodes superpuestos)
- [ ] Reacciones con código de tiempo (estilo SoundCloud) — almacenadas en BD, reaparecen al reproducir de nuevo
- [ ] Temporizador de sueño con fundido progresivo

**Plantillas y plugins**
- [ ] Selector de plantillas (el anfitrión elige, emite `table:theme:set` a todos)
- [ ] 3 plantillas oficiales: Brasserie de Nuit, Table de Feutre, Pierre & Braise
- [ ] Sistema de plugins `plugins/table-templates/` — primer ejemplo para desarrolladores de la comunidad

**Juegos (progresión secuencial)**
- [ ] Dados RPG (d4–d100) — animación CSS 3D + historial de tiradas visible para todos
- [ ] Ajedrez — `chess.js` + tablero SVG + sincronización de estado FEN vía DataChannel
- [ ] Póker — máquina de estados + cifrado AES-GCM de mano por jugador
- [ ] RPG / Warhammer — mapa hexagonal, fichas (recursos de la Biblioteca), niebla de guerra *(largo plazo)*

### 3.2 — Red en malla entre instancias
*(depende de la Fase 3.0-C)*

- [ ] Malla WireGuard entre instancias voluntarias — túnel cifrado de extremo a extremo
- [ ] DHT para descubrimiento de pares sin servidor central
- [ ] Protocolo Gossip — sincronización ligera de metadatos entre nodos
- [ ] Directorio de copias de seguridad distribuido — si `nodyx.org` cae, los nodos mantienen el directorio
- [ ] Transición automática a conexión P2P directa cuando esté disponible
- [ ] Federación ligera — un miembro de la comunidad A puede interactuar con la comunidad B

---

## FASE 4 — Enriquecimiento de la plataforma (v1.4 → v1.8) ✅ COMPLETA
### Objetivo: Nodyx se convierte en la plataforma de comunidad completa

**Entregado:**
- [x] **NodyxCanvas** (v0.9) — pizarra colaborativa P2P en salas de voz (CRDT LWW, cursores reactivos a la voz, exportación PNG)
- [x] **Sistema de temas de perfil** (v1.0) — 6 preajustes integrados (Défaut, Minuit, Forêt, Chaleur, Rose, Verre), motor de variables CSS (`--p-bg`, `--p-card-bg`, `--p-accent`…), editor en vivo con selectores de color, propagación a toda la app (nav, barras laterales, fondo)
- [x] **UI adaptable a móvil** (v1.0) — drawer de canales de chat, barra de navegación inferior, VoicePanel accesible en móvil, páginas de foro + admin responsivas
- [x] **Biblioteca de recursos 12 MB** (v1.0) — ampliado desde 5 MB, directrices de diseño de subida por tipo
- [x] **Chat — Sistema de respuesta/cita** (v1.1) — reply_to_id en mensajes, barra de vista previa en el campo de entrada, cita inline en el mensaje
- [x] **Chat — Mensajes anclados** (v1.1) — banner fijo en la cabecera del canal, anclar/desanclar por admin
- [x] **Chat — Previsualizaciones de enlaces** (v1.1) — despliegue Open Graph en el servidor, caché Redis 1h, tarjetas de vista previa bajo los mensajes
- [x] **Chat — Insignia de mención** (v1.1) — burbuja roja en el icono de Chat cuando se @menciona, separada de la campana de notificaciones
- [x] **Presencia — Estado de usuario personalizado** (v1.1) — emoji + texto, 8 preajustes, almacenado en Redis 24h, visible en la barra lateral
- [x] **Presencia — Lista de miembros desconectados** (v1.1) — sección desplegable en la barra lateral, avatares en escala de grises
- [x] **Plugins** (v1.1) — base `plugins/` con 3 plantillas de mesa oficiales (Brasserie de Nuit, Table de Feutre, Pierre & Braise)
- [x] **Mensajes directos (MDs)** (v1.2) — conversaciones privadas 1:1, `dm_conversations` + `dm_messages`, insignia de no leídos, Socket.IO `dm:send/typing/read`
- [x] **Encuestas** (v1.2) — en chat (botón 📊) y foro (creación de hilo + independiente), 3 tipos: elección / planificación / clasificación, resultados Socket.IO en tiempo real
- [x] **Sistema de bloqueo** (v1.2) — bloqueo de IP, bloqueo de email, aplicación multicapa (registro, inicio de sesión, middleware), UI de administración
- [x] **nodyx-turn — TURN-over-TCP** (v1.3) — RFC 6062, TCP:3478, bypass de VPN/firewall para voz
- [x] **nodyx-turn — fix MESSAGE-INTEGRITY** (v1.3) — RFC 5389 §10.3, el relay ahora funciona en Firefox, Chrome, todos los clientes WebRTC
- [x] **Voz — Failover a relay** (v1.3) — reinicia ICE automáticamente con `iceTransportPolicy: relay` tras 3 sondeos consecutivos con alta pérdida
- [x] **Voz — Opus optimizado** (v1.3) — 32 kbps por defecto, DTX desactivado, mono, FEC activado
- [x] **Calendario de eventos** (v1.6) — CRUD completo, RSVP, subida de portada, páginas `/calendar` + `/calendar/[id]` + edición, `can_manage` (autor O mod/admin), sanitize-html extendido
- [x] **Protocolo Gossip** (v1.6) — `announceEventsToDirectory()` cada 10 min, `/discover` multitipo (comunidades + hilos + eventos)
- [x] **Búsqueda global basada en Gossip** (v1.5) — `network_index` FTS GIN PostgreSQL, `announceThreadsToDirectory()`, `/discover` con barra de búsqueda y tarjetas entre instancias, opt-in `NODYX_GLOBAL_INDEXING=true`
- [x] **Admin — Panel de control enriquecido** (v1.7) — estadísticas extendidas (eventos/encuestas/recursos/chat/MDs), doble gráfico de actividad de 7 días (publicaciones + nuevos miembros), top 5 colaboradores, registros recientes
- [x] **Anuncios del sistema** (v1.7) — banners con código de color (6 variantes) creados por el admin, descartables por el usuario, caducidad opcional, vista previa — `/admin/announcements`
- [x] **Registro de moderación** (v1.7) — trazabilidad de 11 tipos de acciones de administración, filtros de acción/actor, paginación — `/admin/audit-log`
- [x] **Sistema de tareas ligero** (v1.8) — tableros Kanban de comunidad, columnas configurables, tarjetas con asignado/fecha límite/prioridad, arrastrar y soltar HTML5 nativo, `/tasks`

---

## FASE 4.5 — Refuerzo de seguridad ✅ COMPLETA
### Objetivo: Reforzar cada superficie de ataque antes de que la Fase 5 abra la plataforma a un uso más amplio

> *"Desplegado rápido. Ahora hagámoslo a prueba de balas."*
> Auditoría de seguridad completa realizada en marzo de 2026 — antes de iniciar cualquier trabajo de la Fase 5.

### Alcance y resultados de la auditoría

- **38 vulnerabilidades** identificadas y corregidas en toda la base de código
- Cero errores de compilación TypeScript tras todas las correcciones
- Todas las correcciones desplegadas en producción sin tiempo de inactividad

### Categorías de vulnerabilidades corregidas

**Inyección SQL**
- [x] `gardenService` — consultas parametrizadas en lugar de interpolación de cadenas directa
- [x] Rutas de `notifications` — todos los filtros dinámicos reforzados

**JWT**
- [x] Ataque de confusión de algoritmo — `algorithms: ['HS256']` explícito aplicado en todas las llamadas a `jwt.verify()`

**SSRF / DNS Rebinding**
- [x] Despliegue Open Graph (`chat:unfurl`) — lista de bloqueo de rangos de IP privadas (RFC 1918 + loopback + link-local), verificación de resolución de hostname antes de fetch

**Socket.IO IDOR**
- [x] `chat:react` — verificación de propiedad/membresía antes de aplicar la reacción
- [x] `chat:delete` — validación de autor o admin, sin eliminación entre canales
- [x] `voice:stats` — membresía de canal verificada antes de exponer estadísticas de pares
- [x] Eventos `jukebox` — membresía de sala aplicada en todas las acciones sobre la cola

**Inyección CSS / XSS**
- [x] Temas de perfil — valores de variables CSS saneados, sin `url()` / `expression()` / `javascript:` permitidos
- [x] Inyección CSS de fuentes — valores de `font-family` restringidos a lista de permitidos
- [x] URLs de GIFs — validación de esquema + lista de dominios permitidos antes de renderizar

**Autenticación**
- [x] Limitación de velocidad en el registro — endpoint de registro de Nodyx Signet protegido
- [x] Limpieza de sesión al cerrar sesión — JWT invalidado en Redis al cerrar sesión explícitamente
- [x] Validación del asignado — el asignado de una tarea debe ser miembro de la comunidad

**Criptografía / Entrada**
- [x] Validación RIFF WebP — las subidas de recursos verifican los bytes mágicos antes del procesamiento con Sharp
- [x] Inyección de cabeceras SMTP — eliminación de saltos de línea en todas las cabeceras de email proporcionadas por el usuario

---

## FASE 4.6 — Defensa activa y seguridad en tiempo de ejecución ✅ COMPLETA
### Objetivo: Convertir la plataforma en un defensor activo — detectar, disuadir y alertar en tiempo real

> *"El mejor cortafuegos es el que piensa."*
> La Fase 4.6 construye sobre el refuerzo estático de la 4.5 con sistemas de seguridad dinámicos en tiempo de ejecución.

- [x] **Honeypot** — más de 25 rutas de escáner atrapadas (`.env`, `.git`, `wp-admin`, `phpmyadmin`, shells, copias de seguridad…); tarpit 3–7s; geolocalización; scare page; registro en BD + bloqueo automático de fail2ban
- [x] **fail2ban** — 5 jaulas: SSH, reincidentes SSH (permanente), fuerza bruta de autenticación HTTP, honeypot (7 días), lista negra permanente
- [x] **`nodyx-auth.log`** — la ruta de autenticación ahora alimenta la jaula de fail2ban en cada inicio de sesión fallido
- [x] **Lista negra de IP permanente** — jaula `nodyx-permban` (`bantime = -1`) + BD `ip_bans` para actores maliciosos conocidos
- [x] **Monitorización de seguridad en Discord** — embeds en tiempo real para hits de honeypot, fuerza bruta, inicio de sesión de admin, detección de nueva IP, nuevos registros
- [x] **Argon2id** — nuevo estándar de hash de contraseñas (OWASP 2026); hashes bcrypt migrados transparentemente en el próximo inicio de sesión
- [x] **Anti-spam de chat** — limitador de velocidad de ventana deslizante dual (ráfaga + sostenido); UI de espera en el cliente
- [x] **Filtro de contenido** — símbolos nazi/de odio (6 puntos de código Unicode), lista de imágenes permitidas (solo Tenor/Giphy), lista de dominios bloqueados configurable
- [x] **Escaneo NSFW opcional** — `nsfwjs` + TensorFlow.js en la subida de imágenes (`NSFW_SCAN=true`)
- [x] **Limitación de velocidad de subida** — 10 subidas / 10 minutos / usuario
- [x] **Verificación de email** — obligatoria cuando SMTP está configurado; inicio de sesión bloqueado para cuentas no verificadas
- [x] **Rotación de logs** — rotación diaria, retención de 90 días, comprimidos
- [x] **Píxel de seguimiento** (v1.9.2) — PNG transparente 1×1 incrustado en la scare page; registrado en `honeypot_pixel_hits`; alerta de Discord en visitas repetidas (umbral >30s)
- [x] **Trampas de recolección de credenciales** (v1.9.2) — 12 rutas de inicio de sesión muestran un formulario de inicio de sesión de WordPress falso convincente; credenciales registradas; embed de Discord "🔑 Credential Harvest"
- [x] **Archivos canario** (v1.9.2) — 11 patrones de archivo sirven credenciales falsas realistas; PRNG determinista por IP; embed de Discord "📄 Canary"
- [x] **Huella de canvas** (v1.9.2) — JS del navegador en la scare page envía hash de huella a `/_hp_fp`; Discord "🔍 Fingerprint Reconnu" si visitas > 1
- [x] **Honeytokens** (v1.9.2) — 3 enlaces invisibles + 1 casi invisible en el HTML de la scare page; clic → Discord "🎯 HONEYTOKEN CLICKED"
- [x] **Slowloris inverso** (v1.9.2) — `reply.hijack()` transmite la scare page byte a byte; mantiene ocupados los hilos del atacante 45–90s
- [x] **Hub Olimpo** (v1.9.2) — centro de control de seguridad: estadísticas globales, cronología de 48h, IPs principales, panel de trampas activas, tabla de recolección de credenciales enmascarada, lista de atacantes recurrentes

---

## FASE 4.7 — Autenticación de dos factores ✅ COMPLETA
### Objetivo: Añadir un segundo factor fuerte sin sacrificar la experiencia de usuario

> *"Algo que sabes + algo que tienes."*
> La Fase 4.7 añade 2FA criptográfico sobre el sistema de autenticación existente, con Nodyx Signet como opción premium.

- [x] **TOTP (RFC 6238)** — compatible con cualquier app de autenticación (Google Authenticator, Aegis, Bitwarden); configuración con código QR; confirmación de 6 dígitos; sesión pendiente de 5 min respaldada por Redis
- [x] **2FA vía Nodyx Signet** — si el usuario tiene un dispositivo Signet registrado, Signet se usa como 2.º factor (ECDSA P-256 > secreto TOTP compartido)
- [x] **Cadena de prioridad** — Signet > TOTP > inicio de sesión directo; el sistema selecciona automáticamente el factor más fuerte disponible
- [x] **UI de configuración** — activar/desactivar 2FA con visualización de código QR y flujo de confirmación
- [x] **UI de inicio de sesión** — segundo paso fluido: campo de código TOTP o pantalla de espera de Signet activada automáticamente
- [x] **Reconstrucción PWA de Nodyx Signet** — marcadores de posición obsoletos `nexusnode.app` reemplazados por `nodyx.org`

---

## FASE 4.8 — Estabilidad en producción y refuerzo entre runtimes ✅ COMPLETA
### Objetivo: Hacer Nodyx imperturbable — cada estado compartido entre runtimes coherente, cada escenario de fallo gestionado

> *"Un sistema es tan estable como su suposición más débil."*
> La Fase 4.8 es una auditoría quirúrgica completa de toda la pila.

- [x] **Auditoría de keyPrefix Redis — Node.js** — `ioredis keyPrefix: 'nodyx:'` es la única fuente de verdad; todos los prefijos `nodyx:` manuales eliminados
- [x] **Auditoría de keyPrefix Redis — Rust** — Rust no tiene ioredis keyPrefix; las 11 claves compartidas llevan prefijo `nodyx:` manual
- [x] **Coherencia de bloqueo entre runtimes** — los bloqueos establecidos por Node.js o Rust son ahora visibles para ambos runtimes
- [x] **Limitación de velocidad entre runtimes** — los límites de inicio de sesión/registro/reset/reenvío de verificación ahora se comparten
- [x] **Contador de miembros en línea corregido** — el panel de administración siempre mostraba 0 (Rust escaneaba `heartbeat:*` en lugar de `nodyx:heartbeat:*`)
- [x] **Invalidación de sesión al cambiar contraseña** — el índice `user_sessions:{id}` ahora es coherente entre ambos runtimes
- [x] **Timeouts de fetch del planificador** — `AbortSignal.timeout()` añadido a las 4 llamadas HTTP salientes anteriormente sin guardia
- [x] **Caddy — Failover a Rust** — todos los bloques `localhost:3100` cambiados a `lb_policy first` + `fail_duration 30s`
- [x] **install.sh — versión centralizada** — variable única `NODYX_VERSION` usada de forma coherente
- [x] **install.sh — Caddyfile generado reforzado** — cabeceras de seguridad, bloque honeypot y `header_up -X-Forwarded-For` en todas las rutas API
- [x] **Guardias de memoria PM2** — `max_memory_restart` añadido a los 4 procesos (512M core, 256M frontend, 256M hub, 128M docs)
- [x] **Rotación de logs** — `/etc/logrotate.d/nodyx-auth` — diaria, retención de 30 días, comprimidos
- [x] **Renombrado systemd** — descripción de `nodyx-relay.service` y `SyslogIdentifier` actualizados a `nodyx-relay`

**Validación:** 63/63 tests Node.js en verde · Build Rust 0 errores · Caddy validate OK

---

## FASE 4.9 — Aislamiento de procesos, cobertura de tests y CI ✅ COMPLETA
### Objetivo: Cero procesos root, cobertura de tests completa en ambos runtimes, pipeline CI reproducible

- [x] **Aislamiento de procesos — User=nodyx** — Todos los procesos de la aplicación se ejecutan ahora como el usuario de sistema dedicado `nodyx`
- [x] **Restricción de permisos de archivo** — `nodyx-frontend/.env` y `nodyx-hub/.env` cambiados de 644 a `root:nodyx 640`
- [x] **Suite de tests Node.js — 181/181** — 6 nuevos archivos de test que cubren módulos, encuestas, búsqueda, notificaciones, wiki, middleware
- [x] **Suite de tests Rust — 18/18** — Primeros tests Rust escritos para `nodyx-server`: `error.rs` (11 tests) + `extractors.rs` (7 tests)
- [x] **Bloqueo de dependencias críticas** — paquetes sensibles a la seguridad fijados a versiones exactas en `nodyx-core/package.json`
- [x] **Pipeline CI reforzado** — GitHub Actions actualizado: dos trabajos paralelos (`test-node`, `test-rust`), caché npm, verificación de tipos `npx tsc --noEmit` antes de vitest
- [x] **Brecha de migración cerrada** — `052_placeholder.sql` añadido para cerrar la brecha de secuencia entre 051 y 053

**Validación:** 181/181 tests Node.js en verde · 18/18 tests Rust en verde · TypeScript 0 errores · Todos los servicios activos como usuario nodyx

---

## FASE 4.10 — Perfil vivo + Rediseño del foro ✅ COMPLETA (v1.9.5)
### Objetivo: Perfiles dinámicos, un foro que parece una plataforma seria

- [x] **Banner generativo** — SVG Lissajous único por nombre de usuario, hash FNV-1a determinista, compatible con SSR, animado vía `animateTransform`
- [x] **Anillos de reputación** — 3 anillos SVG concéntricos animados (Longevidad / Calidad / Compromiso), tooltips, enlace a `/reputation`
- [x] **Mapa de calor de actividad** — cuadrícula 53×7 estilo GitHub, estadísticas de racha + récord, tooltip en posición fija
- [x] **Endpoint de actividad** — `GET /api/v1/users/:username/activity` (UNION publicaciones + hilos, ventana de 365 días)
- [x] **Hero parallax** — el banner se desplaza al 35% de la velocidad de la página, limitado a 60px
- [x] **Arcos de avatar** — 3 círculos SVG giratorios vía `animateTransform` + pulso de brillo
- [x] **Línea de tiempo** — hitos temporales + umbrales de XP en la parte inferior del perfil
- [x] **Página `/reputation`** — documentación completa de la fórmula transparente (Longevidad, Calidad con decaimiento λ, Compromiso)
- [x] **Eliminar avatar / eliminar banner** — limpia tanto `banner_url` como `banner_asset_id` atómicamente
- [x] **Rediseño del foro** — diseño plano, sin `rounded-*` (excepto avatares), contenido a ancho completo

---

## FASE 4.11 — Comunicaciones privadas y soberanas ✅ COMPLETA (v2.0)
### Objetivo: MDs que ningún servidor puede leer — ni siquiera el tuyo

- [x] **Par de claves ECDH P-256** — generado en el navegador, clave privada almacenada como `CryptoKey` no extraíble en IndexedDB, nunca sale del cliente
- [x] **Cifrado AES-256-GCM** — IV aleatorio de 12 bytes por mensaje, texto cifrado autenticado almacenado en la base de datos
- [x] **Capa ESY Barbare** — segunda capa de ofuscación por instancia sobre AES-GCM (tabla de permutación de bytes + ruido PRNG xorshift32, N rondas). El servidor solo ve base64 opaco
- [x] **`instance.esy`** — generado una vez por instancia, con huella digital (`SHA-256` truncado), servido vía `/api/v1/instance/esy-public`
- [x] **Escudo E2E** en la cabecera de MD — punto verde pulsante (ambos activos), naranja (parcial), huella ESY al pasar el ratón
- [x] **Animación de barbarización** — el remitente ve el texto difuminarse durante el cifrado, el receptor ve la burbuja descifrarse en tiempo real (350ms)
- [x] **Edición de mensajes con recifrado** — editar un mensaje E2E recifra con la cadena completa ECDH + AES + ESY
- [x] **Eliminación en tiempo real** — borrado suave propagado instantáneamente a todos los participantes vía Socket.IO
- [x] **Rediseño de MDs a ancho completo** — diseño dividido con glassmorphism, burbujas agrupadas estilo iMessage
- [x] **Fix AudioContext** — contexto compartido único para todo el VAD de pares (límite de Chrome de 6 contextos por origen)

---

## FASE 4.12 — Constructor de página de inicio + SDK de widgets ✅ COMPLETA (v2.1)
### Objetivo: Cada comunidad obtiene su propia página de inicio totalmente personalizable

- [x] **Constructor de página de inicio** — editor de administración con arrastrar y soltar, 11 zonas de diseño (banner, hero, barra de estadísticas, principal, barra lateral, mitad ×2, trío ×3, pie ×4)
- [x] **Registro de plugins** — cada widget nativo es un archivo autocontenido, sin cambios en el núcleo para añadir nuevos
- [x] **4 widgets nativos Fase 1** — Hero Banner (variantes en vivo/evento/noche), Barra de estadísticas (contadores animados), Tarjeta de unirse, Banner de anuncio
- [x] **Reglas de visibilidad** — audiencia por widget (todos / invitados / miembros) + fechas de inicio/fin programadas
- [x] **Tienda de widgets** — instala widgets externos vía subida de `.zip` (barra de progreso XHR, validación de 4 pasos, lista blanca de extracción)
- [x] **Cargador dinámico de widgets** — Web Components cargados en tiempo de ejecución, sin rebuild, sin despliegue
- [x] **SDK de widgets** — Custom Elements JS simples (Shadow DOM), esquema `manifest.json` → campos de configuración generados automáticamente en el constructor
- [x] **Widget de demostración: Reproductor de vídeo** — YouTube / Vimeo / MP4 con vista previa, visor de código fuente, instalable con un clic

---

## FASE 4.13 — Actualización mayor de NodyxCanvas ✅ COMPLETA (v2.2)
### Objetivo: Convertir la pizarra colaborativa en un espacio de trabajo creativo completo

> *"De una herramienta de dibujo básica a una plataforma de colaboración asíncrona real."*
> El canvas fue reescrito desde cero con 4 componentes UI dedicados, 11 herramientas de dibujo,
> una pila undo/redo persistente y un chat por tablero — todo sincronizado vía CRDT Socket.IO.

### 4.13.1 — Arquitectura UI (Sprint A)

- [x] **4 componentes dedicados** — CanvasLeftToolbar (selector de herramientas), CanvasTopBar (opciones contextuales), CanvasBottomBar (deshacer/zoom/cuadrícula), CanvasRightPanel (participantes + chat)
- [x] **CanvasLeftToolbar** — selector de herramientas vertical con atajos de teclado (V/P/T/N/R/C/S/A/X/I/F/E)
- [x] **CanvasTopBar** — controles contextuales por herramienta: pluma, texto, nota adhesiva, rectángulo/círculo, forma, flecha, conector
- [x] **CanvasBottomBar** — botones Deshacer / Rehacer, Zoom− / % / Zoom+ / Restablecer, alternar cuadrícula (G), alternar ajuste
- [x] **CanvasRightPanel** — panel derecho desplegable: lista de participantes con avatar real, indicador de herramienta en vivo, punto de color; chat en tiempo real por tablero con burbujas estilo iMessage
- [x] **Atajos de teclado completos** — V P T N R C S A X I F E G + Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z + Supr + Escape
- [x] **Renderizado portal** — canvas montado en `document.body` vía `use:portal`, bypasea `position:fixed` roto por `transform` CSS
- [x] **Avatares de usuario reales** — el panel de participantes muestra los avatares reales de los usuarios con fallback a iniciales
- [x] **Deshacer / Rehacer** — pila de 50 ops `UndoOp { id, before, after }` por sesión. Fix de bug CRDT LWW timestamp
- [x] **Ajuste a cuadrícula** — `snapV(v) = snapEnabled ? Math.round(v / 28) * 28 : v`, aplicado en creación + movimiento + redimensionado
- [x] **Renderizado de texto enriquecido** — negrita/cursiva vía `ctx.font`, subrayado + tachado dibujados manualmente, ajuste de palabras con `buildTextLines()`

### 4.13.2 — Nuevas herramientas (Sprint B)

- [x] **Formas avanzadas** — triángulo, diamante, estrella (5 puntas), hexágono, nube — dibujadas vía `Path2D`, relleno + trazo + etiqueta opcional interior
- [x] **Conectores** — líneas rectas / bezier / en ángulo, `startCap` y `endCap` independientes (flecha/punto/ninguno), estilo sólido/discontinuo/punteado, creación en 2 clics
- [x] **Marcos / Secciones** — regiones rectangulares con nombre, borde discontinuo + relleno semitransparente + etiqueta superior; campo de nombre inline al crear
- [x] **Inserción de imágenes** — arrastrar y soltar desde el escritorio o selector de archivos → subida multipart a `/api/v1/assets`, caché asíncrono, tamaño proporcional (máx. 400px)
- [x] **Barra de herramientas conectada** — CanvasLeftToolbar y CanvasTopBar actualizados para herramientas de forma, conector, marco e imagen

### 4.13.3 — Asas de redimensionado (Fase 1.1)

- [x] **8 asas de redimensionado** — esquinas (nw/ne/sw/se) + puntos medios (n/s/e/w) renderizados en espacio de pantalla tras la transformación del canvas, tamaño fijo de 5px a cualquier zoom
- [x] **Elementos soportados** — rect, circle, shape, frame, image, sticky
- [x] **Redimensionado en vivo** — `applyResize()` actualiza x/y/w/h durante el arrastre, tamaño mínimo 12px, compatible con ajuste
- [x] **Deshacer/rehacer** — ops de redimensionado añadidas a la pila de deshacer, restauradas vía CRDT con timestamp actualizado

### 4.13.4 — Correcciones de bugs

- [x] **Fix CRDT undo** — `undo()` ahora restaura `{ ...entry.before, ts: Date.now() }` en lugar de `entry.before` directamente — evita el rechazo silencioso por la verificación LWW
- [x] **Orden de campos en subida de imágenes** — campos de texto (`name`, `asset_type`) añadidos antes del archivo en FormData para que `@fastify/multipart` pueda leerlos del stream antes del binario
- [x] **Estructura HTML** — superposición del nombre del marco correctamente colocada dentro del div del contenedor central
## FASE 5 — Móvil + Nodos + Reacciones
### Objetivo: Nodyx en el bolsillo de todos, con conocimiento estructurado

- [ ] **Reacciones en MDs** — reacciones emoji en mensajes privados
- [ ] **Importación de Discord** — importación masiva de canales, hilos, reacciones y avatares desde una exportación de servidor de Discord
- [ ] **Bio enriquecida en Markdown** — editor TipTap en la bio del perfil
- [ ] **Backend del sistema Gracias** — tabla `thanks`, puntuación Q real con decaimiento λ (`e^{-λt}`)
- [ ] **Tarjeta de perfil compartible** — `/users/:username/card` imagen SSR (avatar + anillos + estadísticas), meta OG
- [ ] **Nodos** (SPEC 013) — conocimiento estructurado duradero, Anchors, validado por la comunidad vía Garden
- [ ] **Sistema de módulos** — 26 módulos activables desde el panel de administración (estilo CMS)
- [ ] **Móvil — iOS** vía Capacitor
- [ ] **Móvil — Android** vía Capacitor
- [ ] **Escritorio** vía Tauri (.exe/.app/.sh ~10MB, independiente)
- [ ] **Migración a Rust** — crate `nodyx-server` Axum reemplazando nodyx-core progresivamente (directorio → auth → búsqueda → usuarios → foros → Socket.IO)
- [ ] **NodyxPoints** — sistema de reputación comunitaria entre instancias
- [ ] **Insignias y niveles**
- [ ] **Galaxy Bar** — selector de múltiples instancias, SSO descentralizado, notificaciones bioluminiscentes
- [ ] **API pública documentada** para desarrolladores de terceros

---

## REGLAS DEL ROADMAP

1. No empezar una fase sin que la anterior esté estable y en uso
2. No romper lo que funciona — proponer alternativas (ej. Relay vs CF Tunnel vs puertos abiertos)
3. La complejidad está oculta: el usuario ve un botón, la capa Rust gestiona la complejidad
4. Cada añadido debe ser coherente con el aspecto descentralizado y soberano
5. El núcleo se mantiene simple. La complejidad va a los plugins.
6. La comunidad puede votar para repriorizar fases futuras

---

## LO QUE NUNCA ESTARÁ EN EL ROADMAP

- Publicidad
- Venta de datos
- Funciones que requieran un **servidor central obligatorio** (`nodyx.org` es opcional — sin él, la instancia sigue siendo completamente funcional en su propio dominio)
- Puertas traseras de cualquier tipo
- Dependencia permanente de un servicio propietario de terceros
- Reemplazar Node.js o SvelteKit por Rust (cada herramienta en su lugar)

---

## FASE HORIZONTE — NODYX-ETHER
### La capa física. La última frontera.

> *"Las ondas de radio no necesitan permiso."*

Nodyx descentraliza la capa de aplicación.
Pero seguimos dependiendo de una cosa: la infraestructura física de internet.
Cables de fibra controlados por los ISP. Satélites controlados por corporaciones.

**NODYX-ETHER descentraliza la propia capa física.**

El puente que lo hace posible: los **CRDTs**.
Ya en Nodyx (NodyxCanvas). Ya en producción.
El mismo CRDT que sincroniza el trazo de una pizarra puede sincronizar una publicación del foro
sobre un enlace LoRa a 250 bps — incluso con un retraso de 2 horas.

```
Capa 1 — Malla local      LoRa / Wi-Fi ad-hoc   0–50 km      sin infraestructura
Capa 2 — Radio regional   HF / NVIS             500–3000 km  rebote ionosférico
Capa 3 — Ionosfera        HF onda corta         Global       sin cables, sin satélites
```

```
nodyx-p2p/
└── nodyx-ether/          ← espacio de trabajo futuro
    ├── nodyx-modem/      ← módem software (codificación HF / LoRa en Rust)
    ├── nodyx-mesh/       ← relay en malla LoRa / Wi-Fi ad-hoc
    └── nodyx-sync/       ← serialización de deltas CRDT (Cap'n Proto / FlatBuffers)
```

**nodyx-relay se convierte en un orquestador multirruta:**
`ethernet → wifi-mesh → lora → hf-radio` — fallback automático, el CRDT gestiona la convergencia.

**Lo que esto significa en la práctica:**
Una comunidad en una zona de desastre. La fibra cortada. El 4G destruido.
Una Raspberry Pi con batería. Un módulo LoRa en el tejado. 55€ en total.
La comunidad continúa. Los anuncios llegan. La gente sabe quién está vivo.

**Eso es soberanía.**

Esta no es una función para mañana. Es una **llamada a los colaboradores:**
→ Radioaficionados, makers de LoRa, contribuidores de Meshtastic, desarrolladores de Rust embebido.
→ La arquitectura está aquí. La base CRDT está desplegada.
→ La capa de radio espera las manos adecuadas.

→ **[Especificación completa: docs/ideas/NODYX-ETHER.md](../ideas/NODYX-ETHER.md)**

---

## FASE RADIO — NODYX-RADIO
### La radio por internet que por fin tiene una razón de existir.

> *"50.000 operadores de radio por internet emitiendo al vacío. Nodyx es la señal de vuelta."*

El problema que nadie resolvió: más de 100.000 emisoras de radio por internet existían en su apogeo.
Menos del 5% tenía más de 10 oyentes simultáneos.
No porque los programas fueran malos. Porque no había estructura para convertir oyentes simultáneos en una comunidad.

**Las emisoras que sobrevivieron** tenían una capa de comunidad estructuralmente unida.
**Las emisoras que murieron** tenían audiencia pero no comunidad.

La inversión que Nodyx hace posible:
```
Emisoras muertas  :  emiten → esperan tener comunidad
Emisoras vivas    :  comunidad → emiten como expresión
```

**Una instancia de Nodyx ES la capa de comunidad.** Una emisora que usa Nodyx obtiene:
- Foro (archivos, debates, notas del programa — indexados por todos los motores de búsqueda)
- Chat en vivo (los oyentes reaccionan en tiempo real durante las emisiones)
- Salas de voz (estudio abierto, backstage, preguntas y respuestas con oyentes)
- Jardín (la comunidad vota los próximos programas)

**La red publicitaria cooperativa — el modelo económico que faltaba:**

Una emisora pequeña con 80 oyentes no puede negociar con los anunciantes sola.
Pero 200 emisoras Nodyx-Radio con 80 oyentes cada una = **16.000 oyentes locales**.
Un panadero, artesano o evento local puede pagar por ese alcance.

```
nodyx.org/radio
  → red publicitaria cooperativa
  → anunciantes locales/regionales contratan cuñas de audio
  → cuñas distribuidas a emisoras de la región objetivo
  → reparto de ingresos: 80% emisora / 20% infraestructura nodyx.org
```

Sin seguimiento. Sin perfilado de usuarios. Solo segmentación geográfica.
El panadero del pueblo financia la radio del pueblo que funciona en una Raspberry Pi del pueblo.
**El dinero se queda local. La infraestructura sigue siendo libre.**

Surgirán nuevas emisoras porque por fin tienen una comunidad.
Y porque por fin pueden sostenerse.

→ **[Visión completa: docs/ideas/NODYX-RADIO.md](../ideas/NODYX-RADIO.md)**

---

*Versión 2.2 — marzo de 2026*
*"P2P es el alma. Rust es el cuerpo. La radio es la resiliencia. La comunidad es la razón."*
