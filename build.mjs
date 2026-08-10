/* Compila la aplicación a un único archivo. React, recharts y el código propio
   acaban en public/app.js; el navegador no descarga nada más.               */
import * as esbuild from "esbuild";

const opciones = {
  entryPoints: ["src/index.jsx"],
  bundle: true,
  minify: true,
  sourcemap: false,
  target: ["es2020"],
  format: "iife",
  outfile: "public/app.js",
  loader: { ".jsx": "jsx" },
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "info",
};

if (process.argv.includes("--watch")) {
  const ctx = await esbuild.context(opciones);
  await ctx.watch();
  console.log("Vigilando cambios…");
} else {
  await esbuild.build(opciones);
}
