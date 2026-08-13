import test from "node:test";
import assert from "node:assert/strict";

/* El cifrado deriva su clave de este secreto; se fija antes de importar. */
process.env.SESSION_SECRET = "secreto-de-pruebas-con-mas-de-32-caracteres";

const {
  cifrarClaveEmbeddings, configDesdeAjustes, invalidarEmbeddingsDeInstancia,
  publicEmbeddingSettings, resolveEmbeddingConfig,
} = await import("./instance-embeddings.js");

const dbCon = (fila) => ({ query: async () => ({ rows: fila ? [fila] : [] }) });

const ENTORNO_VACIO = {};
const ENTORNO_CON_VOYAGE = {
  EMBEDDING_PROVIDER: "voyage",
  EMBEDDING_MODEL: "voyage-3",
  EMBEDDING_API_KEY: "clave-de-entorno",
};

const AJUSTE_OPENAI = {
  provider: "openai",
  model: "text-embedding-3-small",
  api_key_ciphertext: cifrarClaveEmbeddings("clave-guardada"),
  base_url: null,
};

test.beforeEach(() => invalidarEmbeddingsDeInstancia());

test("lo guardado en la base de datos manda sobre las variables de entorno", async () => {
  const config = await resolveEmbeddingConfig({ db: dbCon(AJUSTE_OPENAI), env: ENTORNO_CON_VOYAGE });
  assert.equal(config.enabled, true);
  assert.equal(config.provider, "openai");
  assert.equal(config.model, "text-embedding-3-small");
  assert.equal(config.apiKey, "clave-guardada", "debe descifrar la clave almacenada");
  assert.equal(config.origen, "instancia");
});

test("sin nada guardado se usa el entorno, y sin entorno queda desactivado", async () => {
  const desdeEntorno = await resolveEmbeddingConfig({ db: dbCon(null), env: ENTORNO_CON_VOYAGE });
  assert.equal(desdeEntorno.provider, "voyage");
  assert.equal(desdeEntorno.origen, "entorno");

  invalidarEmbeddingsDeInstancia();
  const sinNada = await resolveEmbeddingConfig({ db: dbCon(null), env: ENTORNO_VACIO });
  assert.equal(sinNada.enabled, false, "sin configurar, el retrieval se queda en la mitad léxica");
});

/* Un ajuste corrupto no puede tumbar el retrieval de toda la aplicación: se
   cae al entorno y el motivo viaja para que el panel lo enseñe. */
test("un ajuste guardado ilegible cae al entorno en vez de propagar el fallo", async () => {
  const corrupto = { ...AJUSTE_OPENAI, api_key_ciphertext: "v1.no-es-descifrable" };
  const config = await resolveEmbeddingConfig({ db: dbCon(corrupto), env: ENTORNO_CON_VOYAGE });
  assert.equal(config.provider, "voyage", "sigue funcionando con lo del entorno");
  assert.equal(config.origen, "entorno");
  assert.ok(config.error, "y el motivo queda a la vista");
});

test("la dimensión fija del proyecto se aplica también a lo guardado", async () => {
  /* 1024 no es negociable: es la dimensión de la columna vector en PostgreSQL.
     Se comprueba que el ajuste guardado pasa por la misma validación. */
  const config = configDesdeAjustes(AJUSTE_OPENAI, ENTORNO_VACIO);
  assert.equal(config.dimensions, 1024);
});

test("un proveedor guardado que no existe se rechaza al resolver", async () => {
  const invalido = { ...AJUSTE_OPENAI, provider: "inventado" };
  const config = await resolveEmbeddingConfig({ db: dbCon(invalido), env: ENTORNO_VACIO });
  assert.equal(config.enabled, false, "no se instancia un proveedor desconocido");
  assert.match(config.error, /EMBEDDING_PROVIDER desconocido/);
});

test("la vista pública nunca incluye la clave de API", async () => {
  const config = await resolveEmbeddingConfig({ db: dbCon(AJUSTE_OPENAI), env: ENTORNO_VACIO });
  const publico = publicEmbeddingSettings(config, { last_tested_at: null, last_test_ok: null });

  const serializado = JSON.stringify(publico);
  assert.ok(!serializado.includes("clave-guardada"), `la clave no puede salir: ${serializado}`);
  assert.ok(!("apiKey" in publico) && !("api_key_ciphertext" in publico));
  assert.equal(publico.provider, "openai");
  assert.equal(publico.origen, "instancia");
});
