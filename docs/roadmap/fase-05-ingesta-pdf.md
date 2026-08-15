# Fase 5 · Ingesta de PDFs con chunking real

**Dificultad:** alta · **Depende de:** Fase 4 · **Bloquea a:** Fase 6

Aquí empieza el trabajo de diseño genuinamente nuevo. Las fases anteriores eran, en gran
parte, traducción de algo que ya existía.

---

## Objetivo

Subir un PDF y que quede: guardado en R2, troceado por secciones, con metadatos extraídos, y
listo para revisión humana. **Sin embeddings todavía** (Fase 6).

## Referencias

- [`../05-rag.md`](../05-rag.md) §2 y §3 — ingesta y chunking
- [`../08-seguridad.md`](../08-seguridad.md) §8 — subida de archivos

## Tareas

### Almacenamiento
- [ ] Crear bucket en Cloudflare R2, credenciales en variables de entorno
- [ ] Cliente S3-compatible en `server/integrations/storage/`
- [ ] Nombre de objeto derivado del **hash SHA-256**, nunca del nombre subido

### Extracción
- [ ] Pipeline de extracción con **PyMuPDF** (`fitz`)
- [ ] Limpieza: cabeceras/pies repetidos, números de página, guiones de partición de línea,
      lista de referencias del final, pies de figura sueltos
- [ ] Extracción de DOI por regex (`10.\d{4,9}/[-._;()/:A-Z0-9]+`) **antes** de pedírselo
      al modelo
- [ ] Ampliar `SYS_PDF` para devolver también `study_type`, `population_type`, `sample_size`

### Chunking
- [ ] Detector de secciones (Abstract, Introduction, Methods, Results, Discussion,
      Conclusion; el resto → `other`)
- [ ] Troceado por párrafos dentro de cada sección, 400-600 tokens, 15% de solape
- [ ] Guardar `seccion`, `pagina_inicio`, `pagina_fin`, `num_tokens` en cada chunk
- [ ] Columna generada `tsv` con `to_tsvector('english', texto)` + índice GIN

### Deduplicación
- [ ] Comprobar `hash_archivo` y `doi` antes de procesar; rechazar duplicados con mensaje claro

### Interfaz
- [ ] Endpoint de subida, **solo rol `admin`**
- [ ] Validar tipo real por magic bytes, límite de tamaño (~50 MB)
- [ ] Pantalla de administración: subir, ver estado de procesado, revisar ficha, confirmar
- [x] Solo participa en retrieval lo que tiene chunks y `revisado = true`. La ingesta deja
      siempre la ficha automática pendiente: una persona debe contrastarla y confirmarla.
      La base impide revisar fichas sin chunks. Ver docs/05-rag.md §2.5.

## Criterio de terminado

- [ ] Subo un PDF y aparece en `documents` con metadatos correctos y en `document_chunks`
      troceado por secciones con páginas correctas
- [ ] El original está en R2 y se puede abrir desde la ficha
- [ ] Subir el mismo PDF dos veces lo rechaza como duplicado
- [ ] Subir el mismo paper desde otro PDF con el mismo DOI también lo rechaza
- [ ] Un usuario sin rol `admin` no puede subir
- [ ] Reviso 3-5 documentos a mano y las secciones detectadas son correctas

## Riesgos

| Riesgo | Mitigación |
|---|---|
| **Calidad de extracción variable** según maquetación (columnas, tablas) | Revisión humana de todo lo que la ficha automática no cubra por completo, más enums cerrados que convierten un valor inventado en un documento pendiente. Es la mitigación principal de toda esta fase |
| PDFs escaneados sin capa de texto | Detectarlo y rechazarlo con mensaje claro. OCR como excepción manual, no como caso general |
| Detección de secciones falla en papers con formato atípico | Fallback a `other` + chunking por párrafos. No debe romper la ingesta |
| PDF malicioso que explota la librería de extracción | Mantener PyMuPDF actualizado; procesar en contexto aislado |
| Chunks demasiado grandes o pequeños | Ajustable por configuración; medir en Fase 10 con el dataset de evaluación |

## Notas

**Este pipeline sale del navegador.** Hoy la extracción se hace en cliente con pdf.js y el
PDF no se guarda. El cambio es deliberado: necesitas poder reprocesar toda la biblioteca si
cambias de estrategia de chunking o de modelo de embeddings, y para eso hace falta conservar
el original.

Consecuencia positiva: `pdf.js` desde CDN desaparece del cliente, lo que simplifica la
política de seguridad de contenido (ver `08-seguridad.md` §7).

**Empieza el dataset de evaluación en paralelo** (Fase 10). Si esperas a tenerlo todo
construido, descubrirás tarde que el chunking no sirve para tus preguntas reales.
