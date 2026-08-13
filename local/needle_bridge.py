"""Puente HTTP mínimo entre Hybrid Coach y Cactus Needle 2.

Escucha solo en loopback por defecto, no registra consultas y nunca ejecuta
funciones. Needle devuelve únicamente la llamada estructurada seleccionada.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import needle


MAX_BODY_BYTES = 128 * 1024
MAX_QUERY_CHARS = 1_000
MAX_SYSTEM_CHARS = 4_000
MAX_TOOLS = 20
_engine_lock = threading.Lock()
_engine = None
_engine_fingerprint = None


def _json_bytes(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def _validate_tools(tools):
    if not isinstance(tools, list) or not 1 <= len(tools) <= MAX_TOOLS:
        raise ValueError(f"tools debe contener entre 1 y {MAX_TOOLS} elementos")
    names = []
    for tool in tools:
        if not isinstance(tool, dict) or not isinstance(tool.get("name"), str) or not tool["name"].strip():
            raise ValueError("cada herramienta debe tener un nombre")
        if not isinstance(tool.get("parameters", {}), dict):
            raise ValueError("parameters debe ser un objeto JSON Schema")
        names.append(tool["name"].strip())
    if len(names) != len(set(names)):
        raise ValueError("los nombres de herramienta deben ser únicos")
    return tools


def route_locally(payload):
    query = str(payload.get("query") or "").strip()
    system = str(payload.get("system") or "").strip()
    if not query or len(query) > MAX_QUERY_CHARS:
        raise ValueError(f"query debe tener entre 1 y {MAX_QUERY_CHARS} caracteres")
    if len(system) > MAX_SYSTEM_CHARS:
        raise ValueError(f"system no puede superar {MAX_SYSTEM_CHARS} caracteres")
    tools = _validate_tools(payload.get("tools"))
    max_new_tokens = int(payload.get("maxNewTokens") or 128)
    if not 1 <= max_new_tokens <= 256:
        raise ValueError("maxNewTokens debe estar entre 1 y 256")

    global _engine, _engine_fingerprint
    fingerprint = hashlib.sha256(_json_bytes({"tools": tools, "system": system})).hexdigest()
    # El motor nativo usa estado global: inicialización e inferencia se
    # serializan para que dos peticiones no mezclen esquemas.
    with _engine_lock:
        if _engine is None or fingerprint != _engine_fingerprint:
            _engine = needle.Needle(tools=tools, system=system)
            _engine_fingerprint = fingerprint
        else:
            # complete() conserva el historial nativo. Cada petición HTTP es
            # independiente: borrar el KV cache evita contaminación entre
            # usuarios o entre dos consultas del mismo usuario.
            _engine.reset()
        return _engine.complete(query, max_new_tokens=max_new_tokens)


class Handler(BaseHTTPRequestHandler):
    server_version = "HybridCoachNeedle/1"

    def log_message(self, _format, *_args):
        # No escribir preguntas ni datos del atleta en logs locales.
        return

    def _send(self, status, value):
        body = _json_bytes(value)
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.send_header("cache-control", "no-store")
        self.send_header("x-content-type-options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path != "/health":
            return self._send(404, {"ok": False, "message": "Ruta no encontrada"})
        self._send(200, {"ok": True, "provider": "needle", "version": needle.__version__, "model": "needle-2"})

    def do_POST(self):
        if self.path != "/route":
            return self._send(404, {"ok": False, "message": "Ruta no encontrada"})
        try:
            length = int(self.headers.get("content-length") or 0)
            if length < 1 or length > MAX_BODY_BYTES:
                return self._send(413, {"ok": False, "message": "Cuerpo ausente o demasiado grande"})
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            if not isinstance(payload, dict):
                raise ValueError("el cuerpo debe ser un objeto JSON")
            self._send(200, route_locally(payload))
        except (ValueError, TypeError, json.JSONDecodeError) as error:
            self._send(400, {"ok": False, "message": str(error)})
        except Exception:
            # No filtrar rutas locales, detalles nativos ni contenido sensible.
            self._send(500, {"ok": False, "message": "Needle no pudo clasificar la petición"})


SMOKE_TOOLS = [
    {
        "name": "consultar_sesiones",
        "description": "Consultar entrenamientos realizados.",
        "parameters": {
            "type": "object",
            "properties": {"periodo": {"type": "string", "enum": ["hoy", "semana", "mes", "todo"]}},
            "required": ["periodo"],
        },
    },
    {
        "name": "conversar_coach",
        "description": "Responder una pregunta general de entrenamiento.",
        "parameters": {"type": "object", "properties": {}},
    },
]


def main():
    parser = argparse.ArgumentParser(description="Puente local de Cactus Needle para Hybrid Coach")
    parser.add_argument("--smoke", action="store_true", help="ejecuta una inferencia y termina")
    args = parser.parse_args()
    if args.smoke:
        print(json.dumps(route_locally({
            "query": "Enséñame mis sesiones de esta semana",
            "tools": SMOKE_TOOLS,
            "system": "Selecciona exactamente una herramienta y no ejecutes acciones.",
        }), ensure_ascii=False, indent=2))
        return

    host = os.environ.get("NEEDLE_BIND_HOST", "127.0.0.1")
    if host not in {"127.0.0.1", "localhost", "::1"} and os.environ.get("NEEDLE_ALLOW_REMOTE", "false").lower() != "true":
        raise RuntimeError("NEEDLE_BIND_HOST debe ser loopback salvo habilitación remota explícita")
    port = int(os.environ.get("NEEDLE_PORT", "9475"))
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"NEEDLE READY http://{host}:{port} version={needle.__version__}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
