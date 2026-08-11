/* Cloudflare R2 — almacenamiento del PDF original.
   R2 habla el protocolo de S3, así que se usa el SDK oficial de AWS apuntando
   al endpoint de la cuenta. Ver docs/07-railway-despliegue.md §4: el binario
   NUNCA va a PostgreSQL, solo la storage_key.

   Sin credenciales configuradas el módulo queda deshabilitado y la ingesta lo
   detecta antes de procesar nada, en vez de fallar a mitad. */
import { createHash } from "node:crypto";
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

export function readStorageConfig(env = process.env) {
  const accountId = String(env.R2_ACCOUNT_ID || "").trim();
  const accessKeyId = String(env.R2_ACCESS_KEY_ID || "").trim();
  const secretAccessKey = String(env.R2_SECRET_ACCESS_KEY || "").trim();
  const bucket = String(env.R2_BUCKET || "").trim();
  const publicBaseURL = String(env.R2_PUBLIC_BASE_URL || "").trim();
  /* El endpoint se puede forzar (pruebas contra un S3 local); si no, se deriva
     del identificador de cuenta como indica la documentación de R2. */
  const endpoint = String(env.R2_ENDPOINT || "").trim()
    || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "");

  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) return { enabled: false };
  return { enabled: true, endpoint, accessKeyId, secretAccessKey, bucket, publicBaseURL };
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

export function createStorageClient(env = process.env, { clientFactory } = {}) {
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

    /* Solo si el bucket se sirve por un dominio propio. Sin él, la ficha no
       ofrece enlace directo y el PDF se descarga por el endpoint autenticado. */
    urlPublica(key) {
      return config.publicBaseURL ? `${config.publicBaseURL.replace(/\/+$/, "")}/${key}` : null;
    },

    cerrar() { client.destroy?.(); },
  };
}
