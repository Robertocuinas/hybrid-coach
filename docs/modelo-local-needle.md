# Modelo local Needle 2

Needle se integra como **enrutador de herramientas**, no como modelo de conversación.
Selecciona una intención estructurada (perfil, plan, sesiones, evidencia o conversación)
y devuelve una confianza. No ejecuta herramientas ni modifica datos.

## Instalación local

Needle descarga su motor una sola vez y después infiere en el equipo sin clave de API.
En este Windows ARM64 la instalación compatible es:

```powershell
py -V:3.13-arm64 -m venv .venv-needle
.\.venv-needle\Scripts\python.exe -m pip install cactus-needle --no-deps
.\.venv-needle\Scripts\python.exe -m pip install huggingface_hub
npm run needle:smoke
```

La instalación `--no-deps` es intencionada en Windows ARM64: el runtime de inferencia
usa la biblioteca nativa y `huggingface_hub`; JAX/Flax son dependencias de entrenamiento
sin rueda oficial para esta plataforma.

## Arranque

En una terminal:

```powershell
npm run needle:serve
```

Debe aparecer:

```text
NEEDLE READY http://127.0.0.1:9475 version=2.0.2
```

En otra terminal, configura el backend local antes de arrancarlo:

```powershell
$env:TOOL_ROUTER_PROVIDER="needle"
$env:NEEDLE_BASE_URL="http://127.0.0.1:9475"
$env:NEEDLE_MIN_CONFIDENCE="0.85"
npm start
```

`GET /api/estado` mostrará `localModel.enabled=true` y `localModel.ready=true`.
Con una sesión iniciada, `POST /api/coach/route` acepta `{"consulta":"..."}`.

## Límites y seguridad

- El puente escucha solo en `127.0.0.1` y no registra las consultas.
- El estado nativo del modelo se reinicia antes de cada petición para que no se
  mezcle contexto entre usuarios.
- El backend valida la herramienta contra una lista cerrada y nunca acepta un
  `athlete_profile_id` del cliente.
- Una confianza inferior a `NEEDLE_MIN_CONFIDENCE` no autoriza la ruta.
- Needle no genera texto libre. Las respuestas completas del Coach seguirán usando el
  proveedor configurado con `LLM_PROVIDER`.
- El Railway desplegado no puede acceder al `localhost` de tu ordenador. Para usar Needle
  allí habría que desplegar el puente como servicio privado; no actives
  `NEEDLE_ALLOW_REMOTE=true` ni publiques el puerto en Internet.

Fuentes oficiales: [Cactus Needle](https://cactuscompute.com/needle) y
[repositorio de Needle](https://github.com/cactus-compute/needle).
