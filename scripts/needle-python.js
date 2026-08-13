import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";

const workspace = process.cwd();
const candidates = [
  process.env.NEEDLE_PYTHON_BIN,
  path.join(workspace, ".venv-needle", "Scripts", "python.exe"),
  path.join(workspace, ".venv-needle", "bin", "python"),
].filter(Boolean);
const python = candidates.find((candidate) => existsSync(candidate));
if (!python) {
  console.error("Needle no está instalado. Sigue docs/modelo-local-needle.md antes de ejecutar este comando.");
  process.exit(1);
}

const child = spawn(python, [path.join(workspace, "local", "needle_bridge.py"), ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
});
child.on("error", (error) => {
  console.error(`No se pudo iniciar Needle: ${error.message}`);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode = signal ? 1 : (code ?? 1);
});
