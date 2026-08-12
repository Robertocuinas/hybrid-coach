import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const backupDir = path.resolve(here, "../backups");

export function safeBackupName(value, now = new Date()) {
  const fallback = `hybridcoach-${now.toISOString().replace(/[:.]/g, "-")}.dump`;
  const name = String(value || fallback).trim();
  if (path.basename(name) !== name || !/^[a-zA-Z0-9._-]+\.dump$/.test(name)) {
    throw new Error("El nombre del backup debe terminar en .dump y no puede contener rutas");
  }
  return name;
}

function run(binary, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ["ignore", "inherit", "inherit"], env });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${binary} terminó con código ${code}`)));
  });
}

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

export async function createDatabaseBackup({ databaseUrl = process.env.DATABASE_URL, fileName, env = process.env } = {}) {
  if (!databaseUrl) throw new Error("DATABASE_URL es obligatoria para crear el backup");
  const name = safeBackupName(fileName);
  await mkdir(backupDir, { recursive: true });
  const target = path.join(backupDir, name);
  const temporary = `${target}.partial`;
  const childEnv = { ...env, PGDATABASE: databaseUrl };
  try {
    await run(env.PG_DUMP_BIN || "pg_dump", ["--format=custom", "--no-owner", "--no-acl", "--file", temporary], childEnv);
    await run(env.PG_RESTORE_BIN || "pg_restore", ["--list", temporary], childEnv);
    await rename(temporary, target);
    const digest = await sha256(target);
    await writeFile(`${target}.sha256`, `${digest}  ${name}\n`, "utf8");
    return { target, digest };
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const nameIndex = process.argv.indexOf("--name");
  const fileName = nameIndex >= 0 ? process.argv[nameIndex + 1] : undefined;
  try {
    const result = await createDatabaseBackup({ fileName });
    console.log(`BACKUP VERDE: ${result.target}`);
    console.log(`SHA-256: ${result.digest}`);
  } catch (error) {
    console.error(`BACKUP ROJO: ${error.message}`);
    process.exitCode = 1;
  }
}
