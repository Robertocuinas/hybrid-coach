import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createStorageClient, missingStorageVars, readStorageConfig, signedURLTTL, storageKeyForHash, sha256 } from "./r2.js";

test("sin credenciales el almacenamiento queda deshabilitado, no a medias", () => {
  assert.equal(readStorageConfig({}).enabled, false);
  assert.equal(createStorageClient({}), null);
  assert.equal(readStorageConfig({ R2_ACCOUNT_ID: "abc", R2_BUCKET: "papers" }).enabled, false, "faltan las claves");
});

test("se dice qué variable falta, por nombre y sin filtrar valores", () => {
  assert.deepEqual(missingStorageVars({}), ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"]);
  assert.deepEqual(
    missingStorageVars({ R2_ACCOUNT_ID: "abc", R2_ACCESS_KEY_ID: "k", R2_BUCKET: "papers" }),
    ["R2_SECRET_ACCESS_KEY"],
  );
  // Un endpoint forzado sustituye al identificador de cuenta: no falta nada.
  assert.deepEqual(
    missingStorageVars({ R2_ENDPOINT: "http://127.0.0.1:1", R2_ACCESS_KEY_ID: "k", R2_SECRET_ACCESS_KEY: "s", R2_BUCKET: "b" }),
    [],
  );
  // Espacios en blanco no cuentan como valor: pegar mal una variable es común.
  assert.deepEqual(missingStorageVars({ R2_ACCOUNT_ID: "abc", R2_ACCESS_KEY_ID: "  ", R2_SECRET_ACCESS_KEY: "s", R2_BUCKET: "b" }), ["R2_ACCESS_KEY_ID"]);
});

test("el endpoint se deriva del identificador de cuenta si no se fuerza", () => {
  const config = readStorageConfig({
    R2_ACCOUNT_ID: "cuenta123", R2_ACCESS_KEY_ID: "k", R2_SECRET_ACCESS_KEY: "s", R2_BUCKET: "papers",
  });
  assert.equal(config.endpoint, "https://cuenta123.r2.cloudflarestorage.com");
});

test("la clave del objeto sale del hash, nunca del nombre subido", () => {
  const hash = sha256(Buffer.from("contenido"));
  assert.equal(storageKeyForHash(hash), `documents/${hash.slice(0, 2)}/${hash}.pdf`);
  // Un nombre malicioso no puede convertirse en clave: solo se aceptan hashes.
  assert.throws(() => storageKeyForHash("../../etc/passwd"), /hash SHA-256 no válido/);
  assert.throws(() => storageKeyForHash(""), /hash SHA-256 no válido/);
});

/* Servidor S3 mínimo en memoria: confirma que el SDK firma, enruta y sube el
   binario intacto. No sustituye a una prueba contra Cloudflare real, pero
   cubre todo lo que este módulo controla. */
function servidorS3Falso({ estadoBucket = 200 } = {}) {
  const objetos = new Map();
  const server = http.createServer((req, res) => {
    const key = decodeURIComponent(req.url.replace(/^\//, "").split("?")[0]);
    /* HeadBucket: la ruta es el bucket y su barra final, sin clave detrás. */
    if (req.method === "HEAD" && !key.replace(/\/$/, "").includes("/")) return res.writeHead(estadoBucket).end();
    if (req.method === "PUT") {
      const trozos = [];
      req.on("data", (t) => trozos.push(t));
      req.on("end", () => {
        objetos.set(key, { cuerpo: Buffer.concat(trozos), contentType: req.headers["content-type"] });
        res.writeHead(200, { ETag: '"fingido"' }).end();
      });
      return;
    }
    if (!objetos.has(key)) return res.writeHead(404).end();
    if (req.method === "HEAD") return res.writeHead(200).end();
    res.writeHead(200, { "Content-Type": "application/pdf" }).end(objetos.get(key).cuerpo);
  });
  return { server, objetos };
}

test("guarda, comprueba y recupera el PDF contra un endpoint S3 real", async () => {
  const { server, objetos } = servidorS3Falso();
  await new Promise((listo) => server.listen(0, "127.0.0.1", listo));
  const puerto = server.address().port;

  const storage = createStorageClient({
    R2_ENDPOINT: `http://127.0.0.1:${puerto}`,
    R2_ACCESS_KEY_ID: "clave", R2_SECRET_ACCESS_KEY: "secreto", R2_BUCKET: "papers",
  });

  const pdf = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(512, 0x41)]);
  const hash = sha256(pdf);
  const key = await storage.guardarPDF(pdf, hash);

  assert.equal(key, storageKeyForHash(hash));
  // El SDK usa path-style: el bucket va en la ruta, que es lo que exige R2.
  const guardado = objetos.get(`papers/${key}`);
  assert.ok(guardado, `no se subió a papers/${key}; claves vistas: ${[...objetos.keys()]}`);
  assert.ok(guardado.cuerpo.equals(pdf), "el binario debe llegar intacto");
  assert.equal(guardado.contentType, "application/pdf");

  assert.equal(await storage.existe(key), true);
  assert.equal(await storage.existe("documents/ff/" + "f".repeat(64) + ".pdf"), false);
  assert.ok((await storage.leerPDF(key)).equals(pdf));

  storage.cerrar();
  await new Promise((listo) => server.close(listo));
});

/* Credenciales presentes y credenciales que funcionan son cosas distintas: sin
   esta comprobación un token caducado solo se descubre al final de la ingesta,
   con la extracción y los embeddings ya pagados. */
test("comprobar() distingue bucket accesible, inexistente y sin permiso", async () => {
  const conBucket = async (estadoBucket) => {
    const { server } = servidorS3Falso({ estadoBucket });
    await new Promise((listo) => server.listen(0, "127.0.0.1", listo));
    const storage = createStorageClient({
      R2_ENDPOINT: `http://127.0.0.1:${server.address().port}`,
      R2_ACCESS_KEY_ID: "clave", R2_SECRET_ACCESS_KEY: "secreto", R2_BUCKET: "papers",
    });
    const resultado = await storage.comprobar();
    storage.cerrar();
    await new Promise((listo) => server.close(listo));
    return resultado;
  };

  assert.deepEqual(await conBucket(200), { ok: true });

  const inexistente = await conBucket(404);
  assert.equal(inexistente.ok, false);
  assert.match(inexistente.motivo, /papers.*no existe/);

  const prohibido = await conBucket(403);
  assert.equal(prohibido.ok, false);
  assert.match(prohibido.motivo, /no dan acceso/);
});

test("urlPublica solo existe si hay dominio propio configurado", () => {
  const base = { R2_ENDPOINT: "http://127.0.0.1:1", R2_ACCESS_KEY_ID: "k", R2_SECRET_ACCESS_KEY: "s", R2_BUCKET: "b" };
  assert.equal(createStorageClient(base).urlPublica("documents/aa/bb.pdf"), null);
  const conDominio = createStorageClient({ ...base, R2_PUBLIC_BASE_URL: "https://papers.example.com/" });
  assert.equal(conDominio.urlPublica("documents/aa/bb.pdf"), "https://papers.example.com/documents/aa/bb.pdf");
});

test("la URL firmada usa la clave resuelta por servidor y una caducidad corta", async () => {
  const base = {
    R2_ENDPOINT: "http://127.0.0.1:1", R2_ACCESS_KEY_ID: "k",
    R2_SECRET_ACCESS_KEY: "s", R2_BUCKET: "papers", R2_SIGNED_URL_TTL_SECONDS: "420",
  };
  let llamada;
  const storage = createStorageClient(base, {
    clientFactory: () => ({ destroy() {} }),
    signer: async (_client, command, options) => {
      llamada = { input: command.input, options };
      return "https://firmada.example/pdf?expira=420";
    },
  });
  const url = await storage.urlFirmada("documents/aa/paper.pdf");

  assert.equal(url, "https://firmada.example/pdf?expira=420");
  assert.equal(llamada.input.Bucket, "papers");
  assert.equal(llamada.input.Key, "documents/aa/paper.pdf");
  assert.equal(llamada.input.ResponseContentType, "application/pdf");
  assert.equal(llamada.options.expiresIn, 420);
  assert.equal(signedURLTTL({ R2_SIGNED_URL_TTL_SECONDS: "99999" }), 900);
  assert.equal(signedURLTTL({ R2_SIGNED_URL_TTL_SECONDS: "1" }), 60);
});
