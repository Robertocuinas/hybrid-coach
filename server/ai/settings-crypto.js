import crypto from "node:crypto";

const VERSION = "v1";
const SALT = Buffer.from("hybrid-coach:user-ai-settings:v1", "utf8");

function encryptionSecret(env = process.env) {
  const secret = String(env.AI_SETTINGS_ENCRYPTION_KEY || env.SESSION_SECRET || "");
  if (secret.length < 32) {
    throw new Error("AI_SETTINGS_ENCRYPTION_KEY o SESSION_SECRET debe tener al menos 32 caracteres");
  }
  return secret;
}

function deriveKey(env) {
  return Buffer.from(crypto.hkdfSync("sha256", Buffer.from(encryptionSecret(env), "utf8"), SALT, Buffer.from("api-key", "utf8"), 32));
}

export function encryptApiKey(apiKey, userId, env = process.env) {
  const value = String(apiKey || "");
  if (!value) throw new Error("La clave de API está vacía");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(env), iv);
  cipher.setAAD(Buffer.from(String(userId), "utf8"));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptApiKey(packed, userId, env = process.env) {
  const [version, iv64, tag64, ciphertext64, extra] = String(packed || "").split(".");
  if (version !== VERSION || !iv64 || !tag64 || !ciphertext64 || extra !== undefined) {
    throw new Error("Formato de clave cifrada no reconocido");
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", deriveKey(env), Buffer.from(iv64, "base64url"));
  decipher.setAAD(Buffer.from(String(userId), "utf8"));
  decipher.setAuthTag(Buffer.from(tag64, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext64, "base64url")), decipher.final()]).toString("utf8");
}
