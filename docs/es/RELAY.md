# ⚡ Nodyx Relay — Instala sin dominio ni puertos abiertos

> **El problema:** Quieres alojar Nodyx en casa — en una Raspberry Pi, un PC viejo, tu router doméstico — pero no tienes dominio y tu ISP bloquea los puertos entrantes.
>
> **La solución:** Nodyx Relay. Un binario Rust de 9 MB que establece una conexión **saliente** hacia nuestra infraestructura, haciendo tu instancia accesible en `mi-comunidad.nodyx.org` — sin ninguna configuración.

---

## Tabla de contenidos

- [Cómo funciona](#-cómo-funciona)
- [Requisitos](#-requisitos)
- [Instalación](#-instalación)
- [Comparativa con otros métodos](#-comparativa-con-otros-métodos)
- [Verificar que el túnel está activo](#-verificar-que-el-túnel-está-activo)
- [Solución de problemas](#-solución-de-problemas)
- [Preguntas frecuentes](#-preguntas-frecuentes)
- [Para los curiosos — Arquitectura técnica](#-para-los-curiosos--arquitectura-técnica)

---

## 🔌 Cómo funciona

```
                    Tu máquina (en casa)
                    ┌────────────────────────────────┐
                    │  nodyx-core (puerto 3000)      │
                    │  nodyx-frontend (puerto 4173)  │
                    │  Caddy (puerto 80, local)      │
                    │                                │
                    │  nodyx-relay-client  ──────────┼──── conexión TCP saliente ───►
                    └────────────────────────────────┘                               │
                                                                                     │
                                                              relay.nodyx.org:7443
                                                              ┌────────────────────────────┐
                                                              │  nodyx-relay-server        │
                                                              │                            │
                    ◄─────── HTTPS via Caddy ───────────────  │  *.nodyx.org → :7001   │
                    Navegador → mi-comunidad.nodyx.org      └────────────────────────────┘
```

1. **Ejecutas `bash install.sh`** y eliges la opción `[2] Nodyx Relay`
2. **`nodyx-relay-client`** arranca como servicio systemd en tu máquina
3. Establece una **conexión TCP saliente** (puerto 7443) hacia `relay.nodyx.org` — igual que abrir una web, no como abrir un puerto
4. Cuando alguien visita `mi-comunidad.nodyx.org`, la petición HTTPS llega a nuestro VPS, el servidor relay la enruta a través del túnel y tu máquina responde
5. **Tu máquina no tiene ningún puerto abierto.** Tu router no tiene nada que redirigir. Tu ISP solo ve tráfico saliente.

---

## 📋 Requisitos

| Elemento | ¿Obligatorio? | Notas |
|---|---|---|
| Dominio propio | ❌ No | El relay proporciona `mi-comunidad.nodyx.org` gratis |
| Puertos 80/443 abiertos | ❌ No | El relay solo usa tráfico **saliente** |
| Cuenta en Cloudflare | ❌ No | Independencia total |
| Conexión a internet | ✅ Sí | Cualquier conexión funciona (fibra, 4G, satélite) |
| SO Linux de 64 bits | ✅ Sí | Ubuntu 22.04/24.04, Debian 11/12, Raspberry Pi OS 64-bit |
| Arquitectura | ✅ `x86_64` o `aarch64` | PC/VPS o Raspberry Pi 3/4/5 |

> 💡 **Raspberry Pi 4, 8 GB RAM, Ubuntu Server 24.04 (arm64):** probado y validado en condiciones reales — 1 de marzo de 2026.

---

## 🚀 Instalación

### Método 1 — Instalador interactivo (recomendado)

```bash
git clone https://github.com/Pokled/Nodyx.git && cd Nodyx && sudo bash install.sh
```

Cuando el instalador pregunte por el modo de red, elige **`2`**:

```
  Modo de conexión de red
  ┌─ [1] Dominio propio  — requiere puertos 80/443 abiertos
  ├─ [2] Nodyx Relay     — recomendado — sin puertos, sin dominio (RPi, servidor en casa, ...)
  └─ [3] sslip.io auto   — dominio automático gratuito, requiere puertos abiertos

  ? Elección [1/2/3] (por defecto: 2 — Nodyx Relay):
```

**El instalador se encarga de todo:**
- Descarga el binario `nodyx-relay` (amd64 o arm64 detectado automáticamente)
- Registra tu identificador en el directorio de nodyx.org
- Crea e inicia el servicio systemd `nodyx-relay-client`
- Configura Caddy en modo HTTP local (sin puertos que abrir)

**Resultado:** `mi-comunidad.nodyx.org` disponible en ~5 minutos.

---

### Método 2 — Solo el binario (instalación existente)

Si ya tienes una instancia de Nodyx y solo quieres añadir el relay:

```bash
# 1. Descarga el binario
ARCH=$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')
sudo curl -L "https://github.com/Pokled/Nodyx/releases/download/v0.1.0-relay/nodyx-relay-linux-${ARCH}" \
  -o /usr/local/bin/nodyx-relay
sudo chmod +x /usr/local/bin/nodyx-relay

# 2. Verifica
nodyx-relay --version

# 3. Crea el servicio (sustituye TU_IDENTIFICADOR y TU_TOKEN por tus valores reales)
sudo tee /etc/systemd/system/nodyx-relay-client.service > /dev/null <<EOF
[Unit]
Description=Nodyx Relay Client
After=network.target

[Service]
ExecStart=/usr/local/bin/nodyx-relay client \
  --server relay.nodyx.org:7443 \
  --slug TU_IDENTIFICADOR \
  --token TU_TOKEN \
  --local-port 80
Restart=on-failure
RestartSec=5s
User=root

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now nodyx-relay-client
```

> 💡 Tu token está disponible en `/root/nodyx-credentials.txt` si usaste `install.sh`, o en la respuesta JSON de la API de registro de nodyx.org.

---

## ⚖️ Comparativa con otros métodos

| Método | Dominio necesario | Puertos a abrir | Cuenta de terceros | Dependencia |
|---|---|---|---|---|
| **Nodyx Relay** ⭐ | ❌ No | ❌ No | ❌ No | Solo nuestra infraestructura |
| VPS + dominio propio | ✅ Sí (~€1/año) | ✅ 80, 443 | ❌ No | Ninguna |
| sslip.io auto | ❌ No | ✅ 80, 443 | ❌ No | Ninguna |
| Cloudflare Tunnel | ✅ Sí (dominio CF) | ❌ No | ✅ Cloudflare | Cloudflare |
| Tailscale + Funnel | ❌ No | ❌ No | ✅ Tailscale | Tailscale |
| Ngrok | ❌ No | ❌ No | ✅ Ngrok | Ngrok |

> **Filosofía de Nodyx:** El relay es código abierto, autoalojado en nuestro propio VPS, y puede ser sustituido por un relay comunitario. Cero dependencia de empresas de terceros.

---

## 🔍 Verificar que el túnel está activo

```bash
# Estado del servicio
sudo systemctl status nodyx-relay-client

# Logs en directo
sudo journalctl -u nodyx-relay-client -f

# Lo que deberías ver en los logs:
# → Connected to relay.nodyx.org:7443
# → Registered as slug "mi-comunidad" — OK
# → Forwarding GET / → HTTP 200
```

**Desde el exterior:**

```bash
curl -I https://mi-comunidad.nodyx.org/
# HTTP/2 200
```

---

## 🔧 Solución de problemas

### El servicio no arranca

```bash
sudo journalctl -u nodyx-relay-client --no-pager -n 50
```

| Error | Causa | Solución |
|---|---|---|
| `Connection refused` | relay.nodyx.org inaccesible | Comprueba tu conexión a internet |
| `Registration rejected: Invalid slug or token` | Token incorrecto | Comprueba `/root/nodyx-credentials.txt` |
| `Binary not found` | Binario no instalado | Reinstala con `install.sh` o el Método 2 |
| `Address already in use` (puerto 80) | Otro servicio escuchando en :80 | `sudo ss -tlnp \| grep :80` |

### La reconexión no funciona

El cliente relay se reconecta automáticamente con retroceso exponencial (1s → 2s → 4s → máx. 30s). Si la conexión se cae (corte de internet, reinicio del servidor relay), se recupera sola. No tienes que hacer nada.

### Mi instancia no es accesible desde internet

1. Comprueba que el servicio está en ejecución: `systemctl is-active nodyx-relay-client`
2. Comprueba que Caddy está en ejecución: `systemctl is-active caddy`
3. Comprueba que nodyx-core está en ejecución: `pm2 status nodyx-core`
4. Prueba en local: `curl http://localhost/api/v1/instance/info`

### Reiniciar manualmente

```bash
sudo systemctl restart nodyx-relay-client
```

---

## ❓ Preguntas frecuentes

**P: ¿Mis datos pasan por vuestro servidor?**

Sí, las peticiones HTTP pasan por `relay.nodyx.org`. Pero el contenido permanece cifrado TLS de extremo a extremo (HTTPS entre el navegador y nuestro servidor Caddy). No almacenamos el contenido de las peticiones. Los datos de tu comunidad (publicaciones, mensajes, archivos) permanecen **exclusivamente en tu máquina**.

**P: ¿Qué pasa si nodyx.org no está disponible?**

Tu instancia local sigue funcionando con normalidad. Solo se interrumpe el acceso desde internet a través de `mi-comunidad.nodyx.org`. Si tienes tu propio dominio, puedes cambiar a él en cualquier momento.

**P: ¿Funcionan las salas de voz en modo Relay?**

Las salas de voz usan WebRTC, que requiere un servidor TURN para atravesar el NAT. En modo Relay, coturn no está instalado (los puertos UDP necesarios no están abiertos). Las llamadas de voz entre miembros en la misma red local funcionarán. Para llamadas entre redes distintas, se necesita un servidor TURN externo — esto es lo que resolverá la **Fase 3.0-B (nodyx-turn)** de forma integrada.

**P: ¿Es gratuito el relay?**

Sí, sin límites durante el periodo beta. Nos reservamos el derecho de introducir límites razonables si el uso se vuelve excesivo (ancho de banda > varios TB/mes por instancia, por ejemplo). El relay es código abierto — puedes alojar el tuyo propio.

**P: ¿Cómo cambio mi identificador?**

El identificador se registra en el momento de la instalación. Para cambiarlo, contacta con el soporte de nodyx.org o elimina y vuelve a registrar tu instancia.

**P: ¿Funciona el relay con Docker?**

Sí. El binario `nodyx-relay client` puede ejecutarse fuera del contenedor Docker — simplemente apunta `--local-port` al puerto expuesto por tu contenedor (por defecto 80).

---

## 🏗️ Para los curiosos — Arquitectura técnica

### El servidor relay (nodyx.org)

```
Puerto 7443 (TCP público)
└── Acepta conexiones de los clientes relay
    └── Autentica mediante token (tabla directory_instances en PostgreSQL)
    └── Registra identificador → TunnelHandle (DashMap en memoria)

Puerto 7001 (HTTP, solo local — recibe peticiones de Caddy)
└── Extrae el identificador de la cabecera Host
    ├── Identificador con túnel activo → reenvía por el túnel TCP
    ├── Identificador en BD con URL → redirección 302
    └── Identificador desconocido → 404
```

### El cliente relay (tu máquina)

```
nodyx-relay client
└── Conexión TCP a relay.nodyx.org:7443
    └── Envía: Register { slug, token }
    └── Recibe: ServerMessage::Request { id, method, path, headers, body_b64 }
        └── Ejecuta: reqwest → http://127.0.0.1:80{path}
        └── Envía: ClientMessage::Response { id, status, headers, body_b64 }
    └── Reconexión automática si se desconecta
```

### Protocolo de transporte

Mensajes JSON enmarcados con un prefijo de longitud de 4 bytes en big-endian:

```
[ 4 bytes: longitud (u32 big-endian) ][ payload JSON ]
```

Tamaño máximo de trama: 16 MB.

### Repositorio

El código fuente de `nodyx-relay` está en el mismo repositorio que Nodyx:

```
nodyx-p2p/
└── crates/
    └── nodyx-relay/
        └── src/
            ├── main.rs          — CLI (clap)
            ├── protocol.rs      — tipos + enmarcado
            ├── server/          — servidor relay (VPS)
            └── client/          — cliente relay (tu máquina)
```

---

*Versión 1.0 — 1 de marzo de 2026*
*Validado en Raspberry Pi 4 (arm64), Ubuntu Server 24.04, sin puertos abiertos.*
