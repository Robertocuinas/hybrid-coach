/* Configuración de ESLint — solo dependencia de desarrollo, no entra en el
   despliegue ni en el bundle del navegador.

   Está aquí por un fallo concreto: `src/HybridCoach.jsx` usaba `curW` suelto en
   el cuerpo de HybridCoach, donde esa variable no existe (solo existe como
   propiedad de `full`). Era una variable libre, lanzaba ReferenceError al
   evaluarse, y como el cálculo vive fuera de <Barrera> dejaba la aplicación en
   negro. No lo cazó nada: esbuild trata los identificadores no resueltos como
   globales del navegador y no avisa, y los tests no renderizan el JSX.

   El conjunto de reglas es DELIBERADAMENTE corto. No es un linter de estilo: el
   estilo de este proyecto lo fija CLAUDE.md §5 y no se negocia con una
   herramienta. Solo se activan reglas que señalan código roto —cosas que
   fallarían en ejecución— para que un aviso de ESLint siempre signifique un
   fallo real y nadie aprenda a ignorarlos.

   Ejecutar con `npm run lint`. */
import js from "@eslint/js";
import globals from "globals";

/* Los tests usan el ejecutor de Node, cuyos `test`, `describe` y demás no son
   globales del lenguaje sino del módulo node:test, ya importados en cada
   fichero. Aquí solo hace falta el entorno de Node. */
const ficherosNavegador = ["src/**/*.js", "src/**/*.jsx"];
const ficherosNodo = ["server/**/*.js", "scripts/**/*.js", "migration/**/*.js", "*.js", "*.mjs"];

/* De `eslint:recommended` se conserva lo que delata código roto y se apagan las
   que solo describen un estilo o que en este proyecto son intencionadas. */
const reglas = {
  /* La razón de ser de este fichero. */
  "no-undef": "error",

  /* Un `catch {}` con comentario dentro NO lo marca no-empty, así que los
     bloques deliberadamente vacíos del proyecto (que siempre llevan comentario
     explicando por qué se ignora el fallo) pasan sin ruido. */
  "no-empty": ["error", { allowEmptyCatch: false }],

  /* Variables sin usar: señalan un import que sobra o, peor, un renombrado a
     medias. Los argumentos se ignoran porque el proyecto usa `_req`, `_next` y
     firmas de Express que exigen la aridad completa.

     AVISO y no error: lo que hay hoy es código muerto heredado, y borrarlo es
     una decisión de producto —`rutinaBase()` puede estar esperando a que se
     enganche el editor— no algo que deba decidir el linter. Que avise sin
     tumbar la ejecución. */
  "no-unused-vars": ["warn", {
    args: "none",
    caughtErrors: "none",
    varsIgnorePattern: "^_",
  }],

  /* Las tres siguientes marcan patrones DELIBERADOS de este proyecto, así que
     avisar de ellas sería enseñar a ignorar al linter:

     no-control-regex   las expresiones con \x00 son justamente las que limpian
                        el byte NUL antes de que llegue a PostgreSQL.
     no-useless-assignment  `let trusted = false` o `let ficha = {}` antes de un
                        if/try que siempre reasigna es inicialización defensiva
                        y se lee mejor así.
     preserve-caught-error  exigir `{ cause }` en cada re-lanzamiento es una
                        convención de estilo, y el estilo lo fija CLAUDE.md §5. */
  "no-control-regex": "off",
  "no-useless-assignment": "off",
  "preserve-caught-error": "off",
};

export default [
  {
    ignores: ["node_modules/**", "public/app.js", ".venv/**", ".venv-needle/**", "migration/source/**", "migration/parsed/**", "migration/transformed/**", "migration/backups/**"],
  },
  {
    files: ficherosNavegador,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      /* `jsx: automatic` en build.mjs: React no tiene que estar en ámbito, así
         que no se declara como global ni se exige importarlo. */
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser },
    },
    rules: { ...js.configs.recommended.rules, ...reglas },
  },
  {
    /* Los tests de src corren en Node aunque el código que prueban sea de
       navegador: necesitan los dos conjuntos de globales. */
    files: ["src/**/*.test.js"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  {
    files: ficherosNodo,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: { ...js.configs.recommended.rules, ...reglas },
  },
];
