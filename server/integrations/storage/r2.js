/* Cloudflare R2 — almacenamiento del PDF original.
   R2 habla el protocolo de S3, así que se usa el SDK oficial de AWS apuntando
   al endpoint de la cuenta. Ver docs/07-railway-despliegue.md §4: el binario
   NUNCA va a PostgreSQL, solo la storage_key.

   Sin credenciales configuradas el módulo queda deshabilitado y la ingesta lo
   detecta antes de procesar nada, en vez de fallar a mitad. */
import { createHash } from "node:crypto";
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, HeadBucketCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const limpio = (valor) => String(valor || "").trim();

/* Qué falta exactamente, por NOMBRE de variable. Con un booleano suelto,
   configurar tres de las cuatro se ve igual que no configurar ninguna y quien
   administra no sabe qué corregir. Nunca se devuelven valores, solo nombres
   (CLAUDE.md §4.6). */
export function missingStorageVars(env = process.env) {
  const faltan = [];
  /* El endpoint se puede forzar (pruebas contra un S3 local); si no, se deriva
     del identificador de cuenta como indica la documentación de R2. */
  if (!limpio(env.R2_ENDPOINT) && !limpio(env.R2_ACCOUNT_ID)) faltan.push("R2_ACCOUNT_ID");
  if (!limpio(env.R2_ACCESS_KEY_ID)) faltan.push("R2_ACCESS_KEY_ID");
  if (!limpio(env.R2_SECRET_ACCESS_KEY)) faltan.push("R2_SECRET_ACCESS_KEY");
  if (!limpio(env.R2_BUCKET)) faltan.push("R2_BUCKET");
  return faltan;
}

export function readStorageConfig(env = process.env) {
  if (missingStorageVars(env).length) return { enabled: false };
  const accountId = limpio(env.R2_ACCOUNT_ID);
  return {
    enabled: true,
    endpoint: limpio(env.R2_ENDPOINT) || `https://${accountId}.r2.cloudflarestorage.com`,
    accessKeyId: limpio(env.R2_ACCESS_KEY_ID),
    secretAccessKey: limpio(env.R2_SECRET_ACCESS_KEY),
    bucket: limpio(env.R2_BUCKET),
    publicBaseURL: limpio(env.R2_PUBLIC_BASE_URL),
  };
}

export const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

/* La clave del objeto sale del hash del contenido, nunca del nombre que envía
   el cliente (docs/08-seguridad.md §8: evita path traversal y colisiones).
   El prefijo de dos caracteres reparte los objetos y evita un único
   directorio gigante en el bucket. */
export function storageKeyForHash(hash) {
  if (!/^[a-f0-9]{64}$/.test(String(hash || ""))) throw new Error("hash SHA-256 no válido");
  return `documents/${hash.slice(0, 2)}/${hash}.pdf`;
}

export function signedURLTTL(env = process.env) {
  const value = Number.parseInt(env.R2_SIGNED_URL_TTL_SECONDS || "300", 10);
  return Math.min(900, Math.max(60, Number.isFinite(value) ? value : 300));
}

export function createStorageClient(env = process.env, { clientFactory, signer = getSignedUrl } = {}) {
  const config = readStorageConfig(env);
  if (!config.enabled) return null;

  const client = clientFactory ? clientFactory(config) : new S3Client({
    region: "auto",                 // R2 no usa regiones; "auto" es lo que documenta Cloudflare
    endpoint: config.endpoint,
    forcePathStyle: true,           // el endpoint de R2 no soporta bucket como subdominio
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });

  return {
    bucket: config.bucket,

    /* Tener las cuatro variables puestas no significa que sirvan: un token
       caducado o un bucket que no existe dan credenciales "configuradas" y una
       subida que revienta al final, después de haber pagado la extracción, el
       LLM y los embeddings. Esto lo comprueba antes y por separado. */
    async comprobar() {
      try {
        await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
        return { ok: true };
      } catch (error) {
        const estado = error?.$metadata?.httpStatusCode;
        if (estado === 404 || error?.name === "NotFound") {
          return { ok: false, motivo: `El bucket "${config.bucket}" no existe en esa cuenta de R2` };
        }
        if (estado === 401 || estado === 403) {
          return { ok: false, motivo: "Las credenciales de R2 no dan acceso a ese bucket" };
        }
        return { ok: false, motivo: `No se pudo contactar con R2: ${error.message}` };
      }
    },

    async guardarPDF(buffer, hash) {
      const key = storageKeyForHash(hash);
      await client.send(new PutObjectCommand({
        Bucket: config.bucket, Key: key, Body: buffer,
        ContentType: "application/pdf", ChecksumSHA256: Buffer.from(hash, "hex").toString("base64"),
      }));
      return key;
    },

    async existe(key) {
      try {
        await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
        return true;
      } catch (error) {
        if (error?.$metadata?.httpStatusCode === 404 || error?.name === "NotFound") return false;
        throw error;
      }
    },

    async leerPDF(key) {
      const salida = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
      return Buffer.from(await salida.Body.transformToByteArray());
    },

    async urlFirmada(key, { expiresIn = signedURLTTL(env) } = {}) {
      const ttl = Math.min(900, Math.max(60, Number(expiresIn) || 300));
      const command = new GetObjectCommand({
        Bucket: config.bucket,
        Key: key,
        ResponseContentType: "application/pdf",
        ResponseContentDisposition: 'inline; filename="evidencia.pdf"',
      });
      return signer(client, command, { expiresIn: ttl });
    },

    /* Solo si el bucket se sirve por un dominio propio. Sin él, la ficha no
       ofrece enlace directo y el PDF se descarga por el endpoint autenticado. */
    urlPublica(key) {
      return config.publicBaseURL ? `${config.publicBaseURL.replace(/\/+$/, "")}/${key}` : null;
    },

    cerrar() { client.destroy?.(); },
  };
}
