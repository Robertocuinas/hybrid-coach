import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { clasificar, comprobarPrevio, listarPDFs, resumir } from "./ingest-lib.js";

async function carpetaDePrueba() {
  const raiz = await mkdtemp(path.join(tmpdir(), "hc-ingest-"));
  await mkdir(path.join(raiz, "2024"), { recursive: true });
  await mkdir(path.join(raiz, ".oculta"), { recursive: true });
  await writeFile(path.join(raiz, "b.pdf"), "%PDF-1.7");
  await writeFile(path.join(raiz, "a.pdf"), "%PDF-1.7");
  await writeFile(path.join(raiz, "notas.txt"), "no es un pdf");
  await writeFile(path.join(raiz, "MAYUSCULAS.PDF"), "%PDF-1.7");
  await writeFile(path.join(raiz, "2024", "anidado.pdf"), "%PDF-1.7");
  await writeFile(path.join(raiz, ".oculta", "ignorado.pdf"), "%PDF-1.7");
  return raiz;
}

test("recorre subcarpetas, acepta cualquier caja en la extensión y salta lo oculto", async () => {
  const raiz = await carpetaDePrueba();
  const encontrados = (await listarPDFs(raiz)).map((p) => path.relative(raiz, p).replace(/\\/g, "/"));

  assert.deepEqual(encontrados.sort(), ["2024/anidado.pdf", "MAYUSCULAS.PDF", "a.pdf", "b.pdf"].sort());
  assert.ok(!encontrados.some((f) => f.includes("notas.txt")), "solo PDF");
  assert.ok(!encontrados.some((f) => f.includes("oculta")), "las carpetas ocultas no se recorren");
});

test("una carpeta que no existe devuelve lista vacía en vez de reventar", async () => {
  assert.deepEqual(await listarPDFs(path.join(tmpdir(), "no-existe-" + Date.now())), []);
});

/* La comprobación previa es lo que evita descubrir a mitad de un lote de horas
   que faltaba configuración. Distingue lo que impide empezar de lo que solo
   cambia el resultado. */
test("sin extractor no se puede empezar; sin embeddings sí, con aviso", async () => {
  const base = { embeddingConfig: { enabled: true, provider: "voyage", model: "voyage-3" }, llmProvider: {}, storage: {}, totalPDFs: 10, db: {} };

  const sinExtractor = await comprobarPrevio({ ...base, extractor: { ok: false, motivo: "PyMuPDF no está instalado" } });
  assert.equal(sinExtractor.listo, false);
  assert.match(sinExtractor.bloqueos[0], /extractor/i);

  const sinEmbeddings = await comprobarPrevio({ ...base, extractor: { ok: true, pymupdf: "1.28.2", python: "3.14" }, embeddingConfig: { enabled: false } });
  assert.equal(sinEmbeddings.listo, true, "se puede ingerir y vectorizar después");
  assert.ok(sinEmbeddings.avisos.some((a) => /reindex/.test(a)), "pero hay que decir cómo completarlo");
});

test("una carpeta sin PDF es un bloqueo, no un lote vacío que parece haber ido bien", async () => {
  const previo = await comprobarPrevio({
    extractor: { ok: true }, embeddingConfig: { enabled: true }, llmProvider: {}, storage: {}, totalPDFs: 0, db: {},
  });
  assert.equal(previo.listo, false);
  assert.match(previo.bloqueos.join(" "), /ning[úu]n PDF/i);
});

test("sin proveedor de IA avisa de que todo quedará pendiente de revisión", async () => {
  const previo = await comprobarPrevio({
    extractor: { ok: true }, embeddingConfig: { enabled: true }, llmProvider: null, storage: null, totalPDFs: 5, db: {},
  });
  assert.equal(previo.listo, true);
  assert.ok(previo.avisos.some((a) => /revisión manual/i.test(a)));
  assert.ok(previo.avisos.some((a) => /R2|original/i.test(a)));
});

/* Un duplicado no es un error: es lo que hace que relanzar el mismo lote
   continúe donde lo dejó en vez de abortar o duplicar. */
test("el duplicado se clasifica aparte de los errores reales", () => {
  assert.equal(clasificar(null), "ok");
  assert.equal(clasificar({ status: 409 }), "duplicado");
  assert.equal(clasificar({ status: 415 }), "descartado", "no es un PDF");
  assert.equal(clasificar({ status: 422 }), "descartado", "escaneado sin capa de texto");
  assert.equal(clasificar({ status: 413 }), "descartado", "demasiado grande");
  assert.equal(clasificar({ status: 503 }), "servidor", "detiene el lote");
  assert.equal(clasificar(new Error("cualquier otra cosa")), "error");
});

test("el resumen separa lo ingerido de lo que ya estaba y cuenta lo disponible", () => {
  const r = resumir([
    { estado: "ok", chunks: 12, embeddings: 12, revisado: true },
    { estado: "ok", chunks: 8, embeddings: 8, revisado: false },
    { estado: "duplicado" },
    { estado: "duplicado" },
    { estado: "descartado" },
    { estado: "error" },
  ]);

  assert.equal(r.total, 6);
  assert.equal(r.conteo.ok, 2);
  assert.equal(r.conteo.duplicado, 2);
  assert.equal(r.chunks, 20);
  assert.equal(r.embeddings, 20);
  assert.equal(r.disponibles, 1, "solo cuenta el que entró con ficha completa");
});

test("un lote entero de duplicados no cuenta como fallo", () => {
  const r = resumir(Array.from({ length: 30 }, () => ({ estado: "duplicado" })));
  assert.equal(r.conteo.duplicado, 30);
  assert.equal(r.conteo.error, 0);
  assert.equal(r.chunks, 0);
});
