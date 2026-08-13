"""Extrae texto de un PDF con PyMuPDF, página a página.

Se invoca desde server/integrations/pdf-extractor.js con el PDF por stdin y
devuelve JSON por stdout. Deliberadamente hace UNA cosa: sacar el texto en
orden de lectura. La limpieza y la detección de secciones viven en JavaScript
para que se puedan probar sin depender de Python.

Entrada : bytes del PDF por stdin
Salida  : {"numPaginas": int, "paginas": [{"numero": int, "bloques": [str]}], "meta": {...}}

Se devuelven BLOQUES y no texto plano porque el bloque de PyMuPDF ya es una
unidad tipo párrafo: es lo que permite trocear después por párrafos sin tener
que adivinar dónde acaba cada uno a partir de saltos de línea sueltos.
"""
import json
import sys


def importar_pymupdf():
    """Devuelve el módulo de PyMuPDF, o None si no está instalado.

    Se importa como `pymupdf` y NO como `fitz`: desde la versión 1.26 el alias
    antiguo escribe un aviso de obsolescencia en **stdout**, que es justo el
    canal por el que este script devuelve el JSON. Importarlo por el nombre
    viejo corrompía la salida y el extractor entero pasaba por ilegible.
    El respaldo a `fitz` cubre las versiones anteriores a 1.24.3, que aún no
    exponían el nombre nuevo.
    """
    try:
        import pymupdf
        return pymupdf
    except ImportError:
        pass
    try:
        import fitz
        return fitz
    except ImportError:
        return None


def comprobar() -> int:
    """Modo diagnóstico (--check): confirma que el intérprete arranca y que
    PyMuPDF se puede importar, sin necesidad de subir un PDF de prueba.

    Existe porque las dos cosas que faltan en un despliegue nuevo (el runtime de
    Python y la librería) solo se notaban a mitad de la ingesta, con el archivo
    ya aceptado.
    """
    pymupdf = importar_pymupdf()
    if pymupdf is None:
        print(json.dumps({"error": "PyMuPDF no está instalado (pip install pymupdf)"}), file=sys.stderr)
        return 3

    # El atributo cambia de nombre entre versiones; ninguna es imprescindible.
    version = getattr(pymupdf, "__version__", None) or getattr(pymupdf, "VersionBind", "") or "desconocida"
    json.dump({"pymupdf": str(version).strip(), "python": sys.version.split()[0]}, sys.stdout)
    return 0


def main() -> int:
    if "--check" in sys.argv[1:]:
        return comprobar()

    datos = sys.stdin.buffer.read()
    if not datos:
        print(json.dumps({"error": "PDF vacío"}), file=sys.stderr)
        return 2

    pymupdf = importar_pymupdf()
    if pymupdf is None:
        print(json.dumps({"error": "PyMuPDF no está instalado (pip install pymupdf)"}), file=sys.stderr)
        return 3

    try:
        doc = pymupdf.open(stream=datos, filetype="pdf")
    except Exception as e:  # PDF corrupto o cifrado
        print(json.dumps({"error": f"No se pudo abrir el PDF: {e}"}), file=sys.stderr)
        return 4

    if doc.needs_pass:
        print(json.dumps({"error": "El PDF está protegido con contraseña"}), file=sys.stderr)
        return 5

    paginas = []
    for i, pagina in enumerate(doc, start=1):
        # sort=True reordena los bloques por posición: es lo que mantiene
        # coherente el texto en papers a dos columnas.
        bloques = []
        for bloque in pagina.get_text("blocks", sort=True):
            # (x0, y0, x1, y1, texto, nº bloque, tipo) — tipo 1 son imágenes.
            if len(bloque) > 6 and bloque[6] != 0:
                continue
            texto = (bloque[4] or "").strip()
            if texto:
                bloques.append(texto)
        paginas.append({"numero": i, "bloques": bloques})

    meta = doc.metadata or {}
    salida = {
        "numPaginas": doc.page_count,
        "paginas": paginas,
        "meta": {
            "titulo": (meta.get("title") or "").strip(),
            "autores": (meta.get("author") or "").strip(),
        },
    }
    doc.close()
    json.dump(salida, sys.stdout, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
