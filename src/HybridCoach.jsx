import React, { useState, useEffect, useMemo, useRef } from "react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { createSyncController } from "./sync.js";
import { BIBLIO_SEED } from "./data/biblioSeed.js";
import { documentoDesdeAPI, documentoParaAPI } from "./data/documentAdapter.js";

/* ============================================================
   HYBRID COACH v2 — multiperfil · plan generado · base de evidencia
   ============================================================ */

const CSS = `
.hc *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
.hc{--ink:#0E1621;--surf:#16222F;--surf2:#1D2C3C;--line:#27394C;--paper:#E9EFF4;--mut:#8CA3B8;
 --run:#4CC9C0;--gym:#F2A65A;--rest:#5E738A;--alert:#E2685F;--ok:#7BC96F;--evid:#9B8CF0;
 background:var(--ink);color:var(--paper);min-height:100vh;font-family:'IBM Plex Sans',system-ui,sans-serif;
 font-size:15px;line-height:1.45;padding-bottom:76px}
.hc .wrap{max-width:560px;margin:0 auto;padding:0 16px}
.hc h1,.hc h2,.hc h3,.hc .disp{font-family:'Barlow Condensed',Impact,sans-serif;letter-spacing:.02em;margin:0}
.hc h1{font-size:30px;font-weight:700;text-transform:uppercase}
.hc h2{font-size:21px;font-weight:600;text-transform:uppercase}
.hc h3{font-size:16px;font-weight:600;text-transform:uppercase;color:var(--mut)}
.hc .mono{font-family:'IBM Plex Mono',ui-monospace,monospace;font-variant-numeric:tabular-nums}
.hc .eyebrow{font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--mut)}
.hc .card{background:var(--surf);border:1px solid var(--line);border-radius:12px;padding:14px;margin-bottom:12px}
.hc .card.flat{background:transparent}
.hc .row{display:flex;align-items:center;gap:10px}
.hc .between{display:flex;align-items:center;justify-content:space-between;gap:10px}
.hc .btn{appearance:none;border:1px solid var(--line);background:var(--surf2);color:var(--paper);
 font-family:'Barlow Condensed',sans-serif;font-size:17px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;
 padding:13px 16px;border-radius:10px;cursor:pointer;width:100%;transition:filter .15s}
.hc .btn:hover{filter:brightness(1.15)}
.hc .btn:focus-visible{outline:2px solid var(--gym);outline-offset:2px}
.hc .btn.primary{background:var(--gym);color:#12202C;border-color:var(--gym)}
.hc .btn.run{background:var(--run);color:#0C1F1E;border-color:var(--run)}
.hc .btn.sm{font-size:14px;padding:8px 12px;width:auto}
.hc .btn.ghost{background:transparent}
.hc .btn.danger{background:transparent;border-color:#7A3A36;color:var(--alert)}
.hc .btn:disabled{opacity:.45;cursor:not-allowed}
.hc input,.hc textarea,.hc select{width:100%;background:var(--ink);border:1px solid var(--line);color:var(--paper);
 border-radius:8px;padding:10px;font-family:'IBM Plex Mono',monospace;font-size:15px}
.hc input:focus,.hc textarea:focus,.hc select:focus{outline:2px solid var(--run);outline-offset:1px}
.hc input[type=range]{-webkit-appearance:none;appearance:none;background:transparent;border:0;height:26px;accent-color:var(--gym)}
.hc input[type=range]::-webkit-slider-runnable-track{height:4px;background:var(--line);border-radius:2px}
.hc input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:22px;height:22px;border-radius:50%;background:var(--gym);margin-top:-9px}
.hc input[type=range]::-moz-range-track{height:4px;background:var(--line);border-radius:2px}
.hc input[type=range]::-moz-range-thumb{width:20px;height:20px;border:0;border-radius:50%;background:var(--gym)}
.hc label{display:block;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--mut);margin:0 0 5px}
.hc .tag{font-family:'IBM Plex Mono',monospace;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;
 padding:3px 7px;border-radius:5px;border:1px solid var(--line);color:var(--mut);white-space:nowrap;display:inline-block}
.hc .tag.run{color:var(--run);border-color:#2F6A66}
.hc .tag.gym{color:var(--gym);border-color:#7A5730}
.hc .tag.alert{color:var(--alert);border-color:#7A3A36}
.hc .tag.ok{color:var(--ok);border-color:#3E6B3A}
.hc .tag.evid{color:var(--evid);border-color:#4E4483}
.hc .evidence-overlay{position:fixed;inset:0;z-index:80;background:rgba(4,9,14,.82);display:flex;align-items:flex-end;justify-content:center;padding:12px}
.hc .evidence-modal{width:min(620px,100%);max-height:88vh;overflow:auto;background:var(--surf);border:1px solid #4E4483;border-radius:16px;padding:16px;box-shadow:0 18px 70px #000}
.hc .evidence-quote{white-space:pre-wrap;background:var(--ink);border-left:3px solid var(--evid);border-radius:8px;padding:12px;margin:12px 0;font-size:13px;line-height:1.55}
.hc .strip{display:grid;grid-template-columns:repeat(7,1fr);gap:5px;align-items:end;height:74px;margin:10px 0 6px}
.hc .strip .col{display:flex;flex-direction:column;justify-content:flex-end;height:100%;gap:4px;cursor:pointer;border:0;background:none;padding:0}
.hc .strip .bar{width:100%;border-radius:3px 3px 0 0;background:var(--rest);transition:height .5s ease}
.hc .strip .lbl{font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--mut);text-align:center}
.hc .strip .today .lbl{color:var(--gym);font-weight:600}
.hc .strip .today .bar{box-shadow:0 -2px 0 0 var(--gym)}
.hc .nav{position:fixed;bottom:0;left:0;right:0;background:#101B26;border-top:1px solid var(--line);
 display:grid;grid-template-columns:repeat(5,1fr);z-index:50}
.hc .nav button{background:none;border:0;color:var(--mut);padding:9px 2px 11px;cursor:pointer;
 font-family:'Barlow Condensed',sans-serif;font-size:12.5px;text-transform:uppercase;letter-spacing:.06em}
.hc .nav button.on{color:var(--gym)}
.hc .nav .ic{display:block;font-size:17px;line-height:1.25}
.hc .topbar{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 0 4px;
 position:sticky;top:0;background:var(--ink);z-index:40;border-bottom:1px solid var(--line);margin-bottom:6px}
.hc .pill{display:flex;align-items:center;gap:7px;background:var(--surf2);border:1px solid var(--line);
 border-radius:20px;padding:5px 11px 5px 6px;cursor:pointer;color:inherit;font-size:13px}
.hc .av{width:24px;height:24px;border-radius:50%;display:grid;place-items:center;font-family:'Barlow Condensed',sans-serif;
 font-size:13px;font-weight:700;color:#12202C;background:var(--gym)}
.hc .icobtn{background:var(--surf2);border:1px solid var(--line);color:var(--mut);width:34px;height:34px;
 border-radius:9px;cursor:pointer;font-size:15px}
.hc .day{display:flex;gap:10px;padding:11px 0;border-bottom:1px solid var(--line)}
.hc .day:last-child{border-bottom:0}
.hc .dcol{width:44px;flex:0 0 44px}
.hc .chatbox{background:var(--surf);border:1px solid var(--line);border-radius:12px;padding:11px 13px;margin-bottom:9px}
.hc .chatbox.me{background:var(--surf2);border-color:#31465C}
.hc .grid2{display:grid;grid-template-columns:1fr 1fr;gap:9px}
.hc .grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.hc .chip{border:1px solid var(--line);background:var(--surf2);color:var(--mut);border-radius:8px;padding:9px 6px;
 font-size:13px;cursor:pointer;text-align:center;font-family:'IBM Plex Mono',monospace}
.hc .chip.on{background:var(--gym);color:#12202C;border-color:var(--gym);font-weight:600}
.hc .chip.on.run{background:var(--run);color:#0C1F1E;border-color:var(--run)}
.hc hr{border:0;border-top:1px solid var(--line);margin:13px 0}
.hc .muted{color:var(--mut)} .hc .sm{font-size:13px} .hc .xs{font-size:11.5px}
.hc .prog{height:5px;background:var(--ink);border-radius:3px;overflow:hidden}
.hc .prog span{display:block;height:100%;background:var(--gym);transition:width .3s}
.hc .q{padding:13px 0;border-bottom:1px solid var(--line)}
.hc .q:last-child{border-bottom:0}
.hc .req{color:var(--gym)}
.hc details summary{cursor:pointer;list-style:none}
.hc details summary::-webkit-details-marker{display:none}
@media (prefers-reduced-motion:reduce){.hc *{transition:none!important}}
`;

const DAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const DSHORT = ["L", "M", "X", "J", "V", "S", "D"];

/* ---------- DISTANCIAS DE CARRERA ---------- */
const DIST = {
  "5 km":        { km: 5,    largoMax: 55,  largoSeguro: 45,  picoMin: 170, taper: 1, calidad: "intervalos cortos y progresivos" },
  "10 km":       { km: 10,   largoMax: 75,  largoSeguro: 60,  picoMin: 210, taper: 1, calidad: "bloques a ritmo y progresivos" },
  "Media maratón": { km: 21.1, largoMax: 120, largoSeguro: 105, picoMin: 280, taper: 2, calidad: "bloques largos a ritmo objetivo" },
  "Maratón":     { km: 42.2, largoMax: 175, largoSeguro: 150, picoMin: 380, taper: 3, calidad: "bloques a ritmo maratón" },
  "Trail / otra": { km: 20,   largoMax: 130, largoSeguro: 105, picoMin: 270, taper: 2, calidad: "subidas y bloques a ritmo" },
};

/* ---------- CATÁLOGO DE EJERCICIOS POR PATRÓN Y EQUIPAMIENTO ---------- */
const PAT = {
  rodilla:    { g: "Cuádriceps/glúteo",      full: "Sentadilla trasera",           basico: "Sentadilla goblet",          casa: "Sentadilla búlgara con mochila", inc: 5 },
  rodilla_alt:{ g: "Cuádriceps",             full: "Prensa de piernas",            basico: "Zancada con mancuernas",     casa: "Sentadilla a una pierna asistida", inc: 5 },
  cadera:     { g: "Isquios/glúteo",         full: "Peso muerto rumano",           basico: "Peso muerto rumano mancuernas", casa: "Puente de glúteo a una pierna", inc: 5 },
  gluteo:     { g: "Glúteo mayor",           full: "Hip thrust",                   basico: "Hip thrust con mancuerna",   casa: "Puente de glúteo con pausa", inc: 5 },
  isquios:    { g: "Isquios (flexión)",      full: "Curl femoral",                 basico: "Curl nórdico asistido",      casa: "Curl nórdico asistido", inc: 2.5 },
  unilateral: { g: "Unilateral/glúteo medio",full: "Zancada o búlgara",            basico: "Zancada con mancuernas",     casa: "Zancada inversa", inc: 2 },
  soleo:      { g: "SÓLEO",                  full: "Elevación de gemelo SENTADO",  basico: "Elevación de gemelo sentado con disco", casa: "Elevación de gemelo sentado con mochila", inc: 2.5 },
  gastro:     { g: "Gastrocnemio",           full: "Elevación de gemelo DE PIE",   basico: "Elevación de gemelo de pie con mancuernas", casa: "Elevación de gemelo a una pierna", inc: 2.5 },
  tibial:     { g: "Tibial anterior",        full: "Dorsiflexión con máquina o disco", basico: "Dorsiflexión con goma",  casa: "Dorsiflexión con goma", inc: 1 },
  emp_h:      { g: "Pectoral/tríceps",       full: "Press banca",                  basico: "Press con mancuernas",       casa: "Flexiones (progresión)", inc: 2.5 },
  emp_h2:     { g: "Pectoral superior",      full: "Press inclinado con mancuernas", basico: "Press inclinado mancuernas", casa: "Flexiones con pies elevados", inc: 2 },
  emp_v:      { g: "Deltoides",              full: "Press militar sentado",        basico: "Press militar con mancuernas", casa: "Press pica con mochila", inc: 2 },
  trac_h:     { g: "Dorsal/romboides",       full: "Remo con barra",               basico: "Remo con mancuerna",         casa: "Remo invertido en mesa", inc: 2.5 },
  trac_v:     { g: "Dorsal/bíceps",          full: "Dominadas o jalón al pecho",   basico: "Dominadas asistidas con goma", casa: "Dominadas en barra de puerta", inc: 2.5 },
  delt_lat:   { g: "Deltoides lateral",      full: "Elevaciones laterales",        basico: "Elevaciones laterales",      casa: "Elevaciones laterales con goma", inc: 1 },
  biceps:     { g: "Bíceps",                 full: "Curl de bíceps",               basico: "Curl con mancuernas",        casa: "Curl con goma", inc: 2 },
  triceps:    { g: "Tríceps",                full: "Extensión de tríceps en polea",basico: "Extensión de tríceps con mancuerna", casa: "Fondos entre sillas", inc: 2 },
  core_ext:   { g: "Core anti-extensión",    full: "Rueda abdominal o dead bug",   basico: "Dead bug",                   casa: "Dead bug", inc: 0 },
  core_rot:   { g: "Core antirrotación",     full: "Pallof press",                 basico: "Pallof con goma",            casa: "Pallof con goma", inc: 0 },
  cadera_abd: { g: "Glúteo medio",           full: "Abducción de cadera",          basico: "Abducción con goma",         casa: "Abducción tumbado con goma", inc: 2 },
};
/* El catálogo es ampliable: PAT son los ejercicios de serie y P.ejercicios
   los que añade el usuario. Se fusionan en cada consulta.                    */
const catalogoEj = (P) => ({ ...PAT, ...((P && P.ejercicios) || {}) });
const exName = (pat, equip, cat) => { const c = (cat || PAT)[pat]; return c ? (c[equip] || c.full) : pat; };
const GRUPOS = [...new Set(Object.values(PAT).map((x) => x.g))];

/* ---------- PLANTILLAS DE GIMNASIO SEGÚN DÍAS ---------- */
const S = (pat, s, r, rir, key) => ({ pat, s, r, rir, key: !!key });
const PLANTILLAS = {
  1: [{ code: "GYM A", foco: "Full body completo", pesado: true, ej: [S("rodilla",3,"5-8","2-3",1),S("cadera",3,"6-10","2-3",1),S("emp_h",3,"6-10","2"),S("trac_v",3,"6-10","2"),S("soleo",4,"8-12","1-2",1),S("emp_v",2,"8-12","2"),S("core_ext",3,"8-12","2")] }],
  2: [
    { code: "GYM A", foco: "Rodilla dominante + empuje", pesado: true,  ej: [S("rodilla",3,"5-8","2-3",1),S("emp_h",3,"6-10","2"),S("trac_h",3,"8-12","2"),S("soleo",4,"8-12","1-2",1),S("unilateral",2,"10-12","2-3"),S("emp_v",2,"8-12","2"),S("biceps",2,"10-15","1-2"),S("core_ext",3,"8-12","2")] },
    { code: "GYM B", foco: "Cadera dominante + tracción", pesado: false, ej: [S("cadera",3,"6-10","2-3",1),S("trac_v",3,"6-10","2"),S("emp_h2",3,"8-12","2"),S("soleo",3,"10-15","1-2",1),S("gastro",3,"8-12","1-2"),S("isquios",3,"8-12","1-2",1),S("gluteo",2,"10-15","2"),S("delt_lat",3,"12-20","1-2"),S("core_rot",2,"10-12","2-3")] },
  ],
  3: [
    { code: "GYM A", foco: "Rodilla dominante + empuje", pesado: true,  ej: [S("rodilla",4,"5-8","2-3",1),S("emp_h",3,"6-10","2"),S("trac_h",3,"8-12","2"),S("soleo",4,"8-12","1-2",1),S("emp_v",2,"8-12","2"),S("core_ext",3,"8-12","2")] },
    { code: "GYM B", foco: "Cadera dominante + tracción", pesado: false, ej: [S("cadera",3,"6-10","2-3",1),S("trac_v",3,"6-10","2"),S("emp_h2",3,"8-12","2"),S("isquios",3,"8-12","1-2",1),S("gastro",3,"8-12","1-2"),S("delt_lat",3,"12-20","1-2")] },
    { code: "GYM C", foco: "Unilateral, sóleo y core", pesado: false,   ej: [S("unilateral",3,"10-12","2"),S("gluteo",3,"10-15","2"),S("soleo",4,"10-15","1-2",1),S("tibial",3,"15-20","1-2"),S("cadera_abd",3,"15-20","2"),S("core_rot",3,"10-12","2"),S("biceps",2,"10-15","1-2"),S("triceps",2,"10-15","1-2")] },
  ],
  4: [
    { code: "GYM A", foco: "Pierna rodilla dominante", pesado: true,   ej: [S("rodilla",4,"5-8","2-3",1),S("unilateral",3,"10-12","2"),S("soleo",4,"8-12","1-2",1),S("tibial",3,"15-20","1-2"),S("core_ext",3,"8-12","2")] },
    { code: "GYM B", foco: "Torso empuje", pesado: false,              ej: [S("emp_h",4,"6-10","2"),S("emp_v",3,"8-12","2"),S("emp_h2",3,"8-12","2"),S("delt_lat",3,"12-20","1-2"),S("triceps",3,"10-15","1-2")] },
    { code: "GYM C", foco: "Pierna cadera dominante", pesado: false,   ej: [S("cadera",4,"6-10","2-3",1),S("isquios",3,"8-12","1-2",1),S("gluteo",3,"10-15","2"),S("soleo",3,"10-15","1-2",1),S("gastro",3,"8-12","1-2"),S("cadera_abd",3,"15-20","2")] },
    { code: "GYM D", foco: "Torso tracción", pesado: false,            ej: [S("trac_v",4,"6-10","2"),S("trac_h",3,"8-12","2"),S("biceps",3,"10-15","1-2"),S("delt_lat",3,"12-20","1-2"),S("core_rot",3,"10-12","2")] },
  ],
};

/* ---------- BIBLIOGRAFÍA SEMILLA (heredada de la revisión previa) ---------- */


/* ============================================================
   BIBLIOTECA v2 — MODELO, NORMALIZACIÓN Y BÚSQUEDA POR RELEVANCIA
   ============================================================ */

/* Cada referencia puede venir de tres sitios: las 22 semilla, una alta manual
   o un PDF importado. normRef() garantiza que todas tengan la misma forma,
   para que la biblioteca vieja siga funcionando sin migración destructiva.   */
const GRADOS = ["fuerte", "moderada", "débil", "práctica"];
/* Espejo de los enums study_type y population_type de PostgreSQL. La clave es
   el valor del enum; la etiqueta, lo que se lee en pantalla.                */
const STUDY_TYPES_UI = [
  ["", "— sin clasificar —"],
  ["meta_analysis", "Metaanálisis"], ["systematic_review", "Revisión sistemática"],
  ["rct", "Ensayo controlado aleatorizado"], ["observational", "Observacional"],
  ["position_statement", "Posicionamiento"], ["narrative_review", "Revisión narrativa"],
  ["preprint", "Preprint"],
];
const POPULATION_TYPES_UI = [
  ["", "— sin especificar —"],
  ["runners", "Corredores / resistencia"], ["strength_athletes", "Deportistas de fuerza"],
  ["general_population", "Población general"], ["mixed", "Mixta"],
];
const TEMAS_SUG = ["Rendimiento","Volumen","Lesiones","Concurrente","Fuerza","Hipertrofia","Detraining","Carga","Progresión","Monitorización","Taper","Nutrición","Recuperación","Sueño","Biomecánica","Calzado","Mujer","Calor/altitud"];

function normRef(r) {
  return {
    id: r.id || uid(),
    _dbId: r._dbId || "",
    autores: r.autores || "", anio: +r.anio || new Date().getFullYear(),
    titulo: r.titulo || "", fuente: r.fuente || "", tema: r.tema || "",
    grado: GRADOS.includes(r.grado) ? r.grado : "moderada",
    aplicacion: r.aplicacion || "", doi: r.doi || "",
    /* --- campos nuevos v2 --- */
    tags: Array.isArray(r.tags) ? r.tags : [],          // palabras clave para la búsqueda
    origen: r.origen || "manual",                        // manual | semilla | pdf
    archivo: r.archivo || "",                            // nombre del PDF de origen
    resumenIA: r.resumenIA || "",                        // qué dice el estudio, en 2-3 frases
    poblacion: r.poblacion || "",                        // en quién se estudió
    limites: r.limites || "",                            // por qué NO generalizar
    paginas: +r.paginas || 0,
    revisado: r.revisado === undefined ? true : !!r.revisado, // false = propuesto por IA, sin confirmar
    creado: r.creado || iso(new Date()),
    studyType: r.studyType || null,
    populationType: r.populationType || null,
    sampleSize: Number.isInteger(r.sampleSize) ? r.sampleSize : null,
  };
}

/* --- normalización de texto para búsqueda --- */
const STOP = new Set("de la el los las y o en con para por un una unos unas del al que se su sus es son como más menos entre sobre tras cuando si no ni lo the of and in on for to a an is are with".split(" "));
const norm = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9ñ\s]/g, " ");
const tokens = (t) => norm(t).split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w));
const PESO_GRADO = { fuerte: 1.6, moderada: 1.25, "débil": 0.85, "práctica": 0.6 };

/* Puntúa la biblioteca contra una consulta y devuelve solo lo relevante.
   Con 30+ referencias mandar la biblioteca entera en cada prompt es inviable:
   ni cabe en contexto ni tiene sentido económicamente.                        */
function refsRelevantes(biblio, consulta, opts = {}) {
  const { max = 8, min = 3, umbral = 1 } = opts;
  const qs = tokens(consulta);
  if (!biblio || !biblio.length) return [];
  if (!qs.length) return [...biblio].sort((a, b) => (PESO_GRADO[b.grado] || 1) - (PESO_GRADO[a.grado] || 1)).slice(0, min);

  const puntuada = biblio.map((r) => {
    const campos = [
      [r.tema, 4], [(r.tags || []).join(" "), 4], [r.titulo, 2.5],
      [r.aplicacion, 2.5], [r.resumenIA, 1.5], [r.fuente, 1], [r.autores, 1], [r.poblacion, 0.8],
    ];
    let sc = 0;
    for (const [txt, peso] of campos) {
      const tk = new Set(tokens(txt));
      if (!tk.size) continue;
      for (const q of qs) {
        if (tk.has(q)) sc += peso;
        else if ([...tk].some((w) => w.startsWith(q.slice(0, 5)) || q.startsWith(w.slice(0, 5)))) sc += peso * 0.45;
      }
    }
    return { r, score: sc * (PESO_GRADO[r.grado] || 1) };
  }).sort((a, b) => b.score - a.score);

  const sel = puntuada.filter((x) => x.score >= umbral).slice(0, max).map((x) => x.r);
  if (sel.length >= min) return sel;
  // Relleno: si nada de la biblioteca trata el tema, se añaden las de mayor grado
  // marcadas como tales, para que el modelo sepa que NO son una coincidencia
  // temática y no las fuerce como si respondieran a la pregunta.
  const resto = puntuada.filter((x) => !sel.includes(x.r)).map((x) => x.r)
    .sort((a, b) => (PESO_GRADO[b.grado] || 1) - (PESO_GRADO[a.grado] || 1));
  return [...sel, ...resto.slice(0, min - sel.length).map((r) => ({ ...r, _relleno: true }))];
}

/* Formato compacto para meter en un prompt */
const refLinea = (r) => (r._relleno ? "(sin relación directa con la consulta) " : "") + "[" + (r.autores.split(",")[0] || "Anón") + " " + r.anio + " · id:" + r.id + "] " + r.titulo
  + " (" + r.fuente + ") · tema " + r.tema + " · evidencia " + r.grado
  + (r.poblacion ? " · población: " + r.poblacion : "")
  + " · aplicación: " + r.aplicacion
  + (r.limites ? " · límites: " + r.limites : "");
const refsPrompt = (refs) => refs.map(refLinea).join("\n") || "(sin referencias relevantes en la biblioteca)";

/* ============================================================
   CUESTIONARIO DE PERFIL
   ============================================================ */
const ZONAS = ["Gemelo / sóleo","Tendón de Aquiles","Rodilla","Tibia / periostio","Fascia plantar","Isquiotibiales","Cadera / glúteo","Zona lumbar","Tobillo","Hombro","Muñeca / mano","Otra"];

const WIZARD = [
  { id: "quien", titulo: "Quién eres", icon: "01", preguntas: [
    { k: "nombre", l: "Nombre", t: "text", req: true },
    { k: "edad", l: "Edad", t: "num", unit: "años", req: true },
    { k: "sexo", l: "Sexo", t: "choice", opts: ["Hombre", "Mujer", "Prefiero no decirlo"], req: true, why: "Cambia las referencias de frecuencia cardíaca y algunas recomendaciones de nutrición." },
    { k: "altura", l: "Altura", t: "num", unit: "cm", req: true },
    { k: "peso", l: "Peso", t: "num", unit: "kg", req: true, why: "Se usa para calcular la proteína diaria y estimar la carga de impacto." },
    { k: "grasa", l: "Grasa corporal estimada", t: "num", unit: "%", req: false },
  ]},
  { id: "objetivo", titulo: "Tu carrera", icon: "02", preguntas: [
    { k: "distancia", l: "Distancia objetivo", t: "choice", opts: Object.keys(DIST), req: true },
    { k: "fechaCarrera", l: "Fecha de la carrera", t: "date", req: true, why: "Define cuántas semanas hay y, con ello, toda la progresión." },
    { k: "metaTipo", l: "Qué buscas en la carrera", t: "choice", opts: ["Terminar en buenas condiciones", "Terminar con un tiempo aproximado", "Buscar marca personal"], req: true },
    { k: "metaTiempo", l: "Tiempo objetivo (si tienes uno)", t: "text", ph: "1h55", req: false },
    { k: "prioridad", l: "Ordena tus prioridades", t: "rank", opts: ["Masa muscular", "Composición corporal", "Rendimiento en carrera"], req: true, why: "Determina si el gimnasio o la carrera manda cuando hay que recortar." },
  ]},
  { id: "carrera", titulo: "Tu nivel corriendo", icon: "03", preguntas: [
    { k: "expCarrera", l: "Experiencia corriendo", t: "choice", opts: ["Ninguna", "Menos de 1 año", "1-3 años", "Más de 3 años"], req: true },
    { k: "kmSemana", l: "Kilómetros que corres ahora por semana", t: "num", unit: "km", req: true, why: "Es el punto de partida real de la progresión. Si es 0, escribe 0." },
    { k: "sesionesCarrera", l: "Sesiones de carrera por semana ahora", t: "num", unit: "sesiones", req: true },
    { k: "tiradaLarga", l: "Tu carrera continua más larga del último mes", t: "num", unit: "minutos", req: true },
    { k: "ritmoComodo", l: "Ritmo cómodo aproximado", t: "text", ph: "6:15 min/km", req: false },
    { k: "marca", l: "Mejor marca reciente", t: "text", ph: "10 km en 52:00", req: false },
    { k: "paron", l: "¿Vienes de un parón?", t: "choice", opts: ["No", "Menos de 1 mes", "1-3 meses", "Más de 3 meses"], req: true },
    { k: "superficie", l: "Dónde sueles correr", t: "multi", opts: ["Asfalto", "Tierra / pista", "Cinta", "Montaña"], req: false },
  ]},
  { id: "fuerza", titulo: "Tu nivel en el gimnasio", icon: "04", preguntas: [
    { k: "expFuerza", l: "Experiencia con pesas", t: "choice", opts: ["Ninguna", "Menos de 1 año", "1-3 años", "Más de 3 años"], req: true },
    { k: "equipamiento", l: "Equipamiento disponible", t: "choice", opts: ["Gimnasio completo", "Básico (mancuernas y máquinas)", "En casa (peso corporal y gomas)"], req: true, why: "Cada ejercicio del plan se sustituye por su equivalente disponible." },
    { k: "cargas", l: "Cargas de trabajo actuales", t: "cargas", req: false, why: "Si las conoces, el sistema arranca con el peso adecuado en vez de pedirte que lo estimes." },
    { k: "tecnica", l: "Cómo describirías tu técnica en los básicos", t: "choice", opts: ["No los he hecho nunca", "En aprendizaje", "Sólida"], req: true },
  ]},
  { id: "salud", titulo: "Lesiones y molestias", icon: "05", preguntas: [
    { k: "lesiones", l: "Lesiones previas relevantes", t: "lesiones", req: false, why: "Es lo que más condiciona el plan. Una lesión recurrente cambia ejercicios, progresión y volumen máximo." },
    { k: "molestias", l: "Molestias que tienes ahora mismo", t: "molestias", req: false },
    { k: "estructural", l: "Particularidades estructurales conocidas", t: "multi", opts: ["Pie cavo", "Pie plano", "Dismetría de piernas", "Hipermovilidad", "Ninguna que sepa"], req: false },
    { k: "cirugias", l: "Cirugías o limitaciones permanentes", t: "textarea", ph: "Cirugía de muñeca hace 2 meses, sin carga en flexión completa", req: false },
    { k: "banderas", l: "¿Alguna de estas situaciones?", t: "multi", opts: ["Dolor en el pecho al esforzarme", "Mareos o desmayos", "Tensión arterial no controlada", "Problema cardíaco diagnosticado", "Embarazo o posparto reciente", "Ninguna"], req: true, why: "Si marcas alguna, el sistema te pedirá valoración médica antes de empezar. No sustituye a un profesional sanitario." },
  ]},
  { id: "dispo", titulo: "Tu disponibilidad", icon: "06", preguntas: [
    { k: "dias", l: "Días que sueles poder entrenar", t: "dias", req: true },
    { k: "minGym", l: "Minutos disponibles por sesión de gimnasio", t: "num", unit: "min", req: true },
    { k: "minRun", l: "Minutos disponibles entre semana para correr", t: "num", unit: "min", req: true },
    { k: "finde", l: "Minutos disponibles el fin de semana para la tirada larga", t: "num", unit: "min", req: true, why: "Limita la tirada larga máxima real, que es la sesión que más condiciona el plan." },
    { k: "momento", l: "Cuándo entrenas normalmente", t: "choice", opts: ["Antes del trabajo", "Mediodía", "Después del trabajo", "Variable"], req: false },
    { k: "crossTraining", l: "¿Tienes bici, elíptica o piscina?", t: "choice", opts: ["Sí", "No"], req: true, why: "Permite sustituir impacto por trabajo sin impacto cuando hay molestias." },
  ]},
  { id: "recup", titulo: "Recuperación y contexto", icon: "07", preguntas: [
    { k: "sueno", l: "Horas de sueño habituales", t: "num", unit: "h", req: true },
    { k: "calidadSueno", l: "Calidad del sueño", t: "choice", opts: ["Buena", "Moderada", "Mala"], req: true },
    { k: "estres", l: "Nivel de estrés general", t: "slider", min: 1, max: 10, req: true },
    { k: "trabajo", l: "Tu trabajo es", t: "choice", opts: ["Sedentario", "De pie", "Físicamente exigente"], req: false },
    { k: "nutricion", l: "Enfoque nutricional actual", t: "choice", opts: ["Mantenimiento", "Déficit calórico", "Superávit", "No lo controlo"], req: true },
    { k: "suplementos", l: "Suplementos que tomas", t: "multi", opts: ["Creatina", "Proteína en polvo", "Cafeína", "Ninguno"], req: false },
    { k: "reloj", l: "¿Usas reloj o pulsómetro?", t: "choice", opts: ["Sí, con frecuencia cardíaca", "Sí, solo GPS", "No"], req: true, why: "Si no hay datos fiables, el plan se prescribe por sensación (RPE) en vez de por ritmos." },
  ]},
];

const CARGAS_LIFTS = ["Sentadilla", "Peso muerto", "Press banca", "Dominadas (lastre)"];

function allQuestions() { return WIZARD.flatMap((s) => s.preguntas.map((q) => ({ ...q, seccion: s.id }))); }
function completeness(perfil) {
  const req = allQuestions().filter((q) => q.req);
  const done = req.filter((q) => { const v = perfil[q.k]; return v !== undefined && v !== "" && v !== null && !(Array.isArray(v) && !v.length); });
  return { pct: Math.round((done.length / req.length) * 100), faltan: req.filter((q) => !done.includes(q)) };
}

/* ============================================================
   MOTOR — RIESGO Y GENERACIÓN DEL PLAN
   ============================================================ */
const iso = (d) => d.toISOString().slice(0, 10);
const parse = (s) => new Date(s + "T12:00:00");
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);
const fmtDate = (s) => parse(s).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const uid = () => Math.random().toString(36).slice(2, 9);

function riskScore(p) {
  let r = 0; const causas = [];
  const les = p.lesiones || [];
  const recur = les.filter((l) => l.recurrente);
  if (recur.length) { r += 3; causas.push("lesión recurrente en " + recur.map((l) => l.zona.toLowerCase()).join(", ")); }
  else if (les.length) { r += 1; causas.push("antecedente de lesión"); }
  const mol = (p.molestias || []).filter((m) => +m.intensidad >= 3);
  if (mol.length) { r += 3; causas.push("molestia activa ≥3/10 en " + mol.map((m) => m.zona.toLowerCase()).join(", ")); }
  if (p.paron === "Más de 3 meses") { r += 2; causas.push("parón largo"); }
  else if (p.paron === "1-3 meses") { r += 1; causas.push("parón reciente"); }
  if (p.expCarrera === "Ninguna" || +p.kmSemana === 0) { r += 2; causas.push("sin volumen de carrera actual"); }
  const est = (p.estructural || []).filter((e) => e !== "Ninguna que sepa");
  if (est.length) { r += 1; causas.push(est.join(", ").toLowerCase()); }
  if (+p.sueno && +p.sueno < 6.5) { r += 1; causas.push("sueño por debajo de 6,5 h"); }
  const imc = +p.peso && +p.altura ? +p.peso / Math.pow(+p.altura / 100, 2) : 0;
  if (imc > 28) { r += 1; causas.push("carga de impacto elevada por composición corporal"); }
  return { score: clamp(r, 0, 10), causas };
}

function splitDays(nDias, prioridad) {
  const musculoPrimero = (prioridad || [])[0] !== "Rendimiento en carrera";
  const tabla = {
    2: musculoPrimero ? { gym: 1, run: 1 } : { gym: 0, run: 2 },
    3: musculoPrimero ? { gym: 2, run: 1 } : { gym: 1, run: 2 },
    4: { gym: 2, run: 2 },
    5: musculoPrimero ? { gym: 2, run: 3 } : { gym: 2, run: 3 },
    6: musculoPrimero ? { gym: 3, run: 3 } : { gym: 2, run: 4 },
    7: musculoPrimero ? { gym: 3, run: 3 } : { gym: 2, run: 4 },
  };
  return tabla[clamp(nDias, 2, 7)] || { gym: 2, run: 2 };
}

function buildPlan(p, hoy) {
  const d = DIST[p.distancia] || DIST["Media maratón"];
  const riesgo = riskScore(p);
  const alto = riesgo.score >= 6;
  const dow = (parse(hoy).getDay() + 6) % 7;                 // 0 = lunes
  const lunes = dow >= 4 ? addDays(hoy, 7 - dow) : addDays(hoy, -dow);
  const semanas = clamp(Math.ceil((daysBetween(lunes, p.fechaCarrera) + 1) / 7), 3, 26);
  const taper = clamp(d.taper, 1, Math.max(1, Math.floor(semanas / 4)));
  const build = semanas - taper;
  const nDias = (p.dias || []).length || 4;
  const mezcla = splitDays(nDias, p.prioridad);
  const gymPlantilla = PLANTILLAS[clamp(mezcla.gym, 1, 4)] || PLANTILLAS[2];

  // Techo real de la tirada larga: el menor entre el techo de la distancia,
  // el techo seguro si el riesgo es alto y el tiempo del que dispone el fin de semana.
  const techo = Math.min(alto ? d.largoSeguro : d.largoMax, +p.finde || 999);
  const inicio = clamp(+p.tiradaLarga || 20, 20, Math.max(20, Math.round(techo * 0.6)));
  const cadaN = alto ? 3 : 4;                    // descarga cada 3 o 4 semanas
  const deloads = [];
  for (let w = cadaN; w <= build; w += cadaN) if (w !== build) deloads.push(w);
  const progW = build - deloads.length;
  const paso = progW > 1 ? (techo - inicio) / (progW - 1) : 0;

  const caminarCorrer = alto && (+p.kmSemana || 0) < 10 ? Math.min(2, build - 1) : ((+p.kmSemana || 0) === 0 ? Math.min(2, build - 1) : 0);
  const calidadDesde = Math.max(caminarCorrer + 2, Math.round(build * 0.45));
  const semanasArr = [];
  let largo = inicio, prog = 0;

  for (let w = 1; w <= semanas; w++) {
    const esTaper = w > build;
    const esDeload = deloads.includes(w);
    if (!esTaper && !esDeload) { largo = Math.round(inicio + paso * prog); prog++; }
    let largoW = esDeload ? Math.round(largo * 0.65) : largo;
    let fase = "Base", nota = "", cp = "", gym = "carga";

    if (w <= caminarCorrer) { fase = "Adaptación · caminar-correr"; gym = "carga";
      nota = "Fraccionamos el impacto en bloques con caminata para dar ventanas de descarga al tendón."; }
    else if (esDeload) { fase = "Descarga"; gym = "descarga"; nota = "Semana de descarga: el volumen baja para que la adaptación se consolide."; }
    else if (esTaper) { fase = w === semanas ? "SEMANA DE CARRERA" : "Taper"; gym = "taper";
      largoW = w === semanas ? 0 : Math.round(techo * (0.5 - (w - build - 1) * 0.12));
      nota = "Bajamos volumen y mantenemos algo de intensidad. Nada que ganar, mucho que perder."; }
    else if (w >= calidadDesde) { fase = "Específica"; gym = w > build * 0.7 ? "mantenimiento" : "carga";
      nota = "Entra el ritmo objetivo dentro de las sesiones: " + d.calidad + "."; }
    else { fase = "Construcción"; nota = "Subimos volumen manteniendo la mayor parte del tiempo en suave."; }

    if (w === Math.min(2, build)) cp = "Checkpoint 1 — ¿toleran los tejidos el impacto? Si el dolor crece, replanteamos.";
    if (deloads.length && w === deloads[Math.floor(deloads.length / 2)]) cp = "Checkpoint 2 — GO/NO-GO: ¿puedes sostener " + Math.round(techo * 0.6) + " min continuos sin molestia relevante?";
    if (w === build) cp = "Checkpoint 3 — cerramos objetivo de ritmo y estrategia de carrera.";

    const runs = {};
    const nRuns = mezcla.run;
    const conCalidad = w >= calidadDesde && !esDeload && !esTaper && riesgo.score < 8;
    if (nRuns >= 1) runs["RUN A"] = { t: largoW, d: w === semanas ? "COMPETICIÓN · " + p.distancia
      : w <= caminarCorrer ? Math.max(4, Math.round(largoW / 6)) + " × (" + (w === 1 ? 3 : 4) + "′ corriendo RPE 3 / " + (w === 1 ? 2 : 1.5) + "′ caminando)"
      : conCalidad ? largoW + "′ con " + (largoW > 80 ? 3 : 2) + " × 10′ a RPE 5 en la parte media" : largoW + "′ continuos a RPE 3-4" };
    if (nRuns >= 2) { const t = Math.max(25, Math.round(largoW * 0.55) || 30);
      runs["RUN B"] = { t: Math.min(t, +p.minRun || 999), d: w <= caminarCorrer ? Math.max(4, Math.round(t / 5)) + " × (3′ / 2′ caminando)"
        : conCalidad ? t + "′ con 3 × 8′ a RPE 5 (2′ suaves entre bloques)" : t + "′ continuos a RPE 3-4" }; }
    if (nRuns >= 3) { const t = clamp(Math.round(largoW * 0.4), 20, +p.minRun || 999);
      runs["RUN C"] = { t, d: esDeload || esTaper ? "Recuperación " + t + "′ a RPE 3, o sin impacto si hay molestias" : t + "′ muy fáciles a RPE 3. Su función es repartir impacto, no añadir volumen" }; }
    if (nRuns >= 4) { const t = clamp(Math.round(largoW * 0.35), 20, +p.minRun || 999);
      runs["RUN D"] = { t, d: t + "′ regenerativos a RPE 2-3" }; }

    semanasArr.push({ w, fase, nota, cp, gym, deload: esDeload, taper: esTaper, runs, inicio: null });
  }
  semanasArr.forEach((s) => { s.inicio = addDays(lunes, (s.w - 1) * 7); });

  return {
    generado: hoy, semanas: semanasArr, totalSemanas: semanas, riesgo, mezcla, techo, taper,
    gymCodes: gymPlantilla.map((g) => g.code), gymDias: mezcla.gym, runDias: mezcla.run,
    decisiones: decisiones(p, riesgo, d, techo, mezcla, caminarCorrer, cadaN, taper),
    adaptaciones: adaptaciones(p, riesgo),
  };
}

function decisiones(p, riesgo, d, techo, mezcla, cc, cadaN, taper) {
  const out = [];
  out.push({ t: "Tirada larga limitada a " + techo + " min y prescrita por tiempo", p: techo < d.largoMax ? "Por debajo del techo habitual de la distancia por tu perfil de riesgo y por el tiempo del que dispones el fin de semana. El tiempo controla el coste de recuperación mejor que los kilómetros." : "Es el techo razonable para la distancia; prescribir por tiempo evita que un día lento se convierta en una sesión más larga de lo previsto.", refs: ["b2", "b3"] });
  out.push({ t: mezcla.run + " sesiones de carrera y " + mezcla.gym + " de gimnasio por semana", p: "Reparto derivado de tus días disponibles y de tu orden de prioridades. Repartir el mismo volumen en más sesiones reduce la carga por sesión, que es la variable asociada al riesgo estructural.", refs: ["b3", "b8"] });
  out.push({ t: "Gimnasio en " + (mezcla.gym <= 2 ? "full body" : mezcla.gym === 3 ? "full body A/B/C" : "torso-pierna") + " con frecuencia 2× por grupo", p: "Con pocas sesiones, la frecuencia es el mecanismo para distribuir volumen sin concentrar fatiga en un solo día.", refs: ["b7", "b8"] });
  if (cc) out.push({ t: "Empezamos con " + cc + " semanas de caminar-correr", p: "No es una concesión de principiante: fracciona la carga sobre el tendón y el sóleo dándoles ventanas de descarga.", refs: ["b3"] });
  out.push({ t: "Descarga cada " + cadaN + " semanas", p: riesgo.score >= 6 ? "Ciclo corto por tu perfil de riesgo: la adaptación del tejido conectivo va más lenta que la cardiovascular." : "Ciclo estándar de acumulación y consolidación.", refs: ["b3", "b17"] });
  out.push({ t: "Taper de " + taper + " semana(s): baja el volumen, se mantiene la intensidad", p: "Reducir volumen manteniendo intensidad mejora el rendimiento; reducir intensidad lo empeora.", refs: ["b19", "b12"] });
  out.push({ t: "En las fases de más carrera se recortan series, nunca cargas", p: "El mantenimiento de fuerza y masa depende de la intensidad, no del volumen. Bajar el peso pierde el estímulo y conserva la fatiga.", refs: ["b9", "b6"] });
  out.push({ t: "Nada de fallo muscular: RIR 1-3", p: "El fallo genera fatiga desproporcionada respecto al estímulo adicional, y aquí la fatiga se reparte entre dos modalidades.", refs: ["b10", "b5"] });
  if (riesgo.score >= 5) out.push({ t: "Sin pliometría", p: "Carga excéntrica aditiva sobre un tejido ya comprometido. Es una desviación deliberada de la recomendación general.", refs: ["b22", "b3"] });
  out.push({ t: "Proteína alta y creatina si la toleras", p: "Cubre el objetivo de masa muscular sin depender de un superávit calórico, especialmente si vienes de un parón.", refs: ["b20", "b21"] });
  return out;
}

function adaptaciones(p, riesgo) {
  const out = []; const zonas = [...(p.lesiones || []).map((l) => l.zona), ...(p.molestias || []).map((m) => m.zona)];
  const has = (t) => zonas.some((z) => z && z.toLowerCase().includes(t));
  if (has("gemelo") || has("aquiles")) out.push({ z: "Gemelo / Aquiles", a: "Sóleo en todas las sesiones de gimnasio con tempo controlado, tibial anterior añadido, sin pliometría y tirada larga por tiempo." });
  if (has("rodilla")) out.push({ z: "Rodilla", a: "Trabajo de isquios en flexión y glúteo medio en todas las semanas; rango de sentadilla limitado al tramo sin dolor." });
  if (has("lumbar")) out.push({ z: "Zona lumbar", a: "Peso muerto sustituido por variantes de cadera con menor carga axial y más core anti-extensión." });
  if (has("fascia")) out.push({ z: "Fascia plantar", a: "Progresión de volumen más lenta, sóleo con recorrido completo y control del calzado en la tirada larga." });
  if (has("hombro") || has("muñeca")) out.push({ z: "Tren superior", a: "Agarres neutros y variantes en máquina donde el agarre cargado sea limitante." });
  if (has("isquio")) out.push({ z: "Isquiotibiales", a: "Trabajo excéntrico progresivo y sin sprints ni cambios bruscos de ritmo." });
  if (riesgo.score >= 6) out.push({ z: "Riesgo global alto", a: "Progresión más lenta, descargas cada 3 semanas y sustitución de impacto por trabajo sin impacto ante cualquier molestia ≥3/10." });
  return out;
}

/* ============================================================
   MOTOR — SESIONES, PLANIFICADOR SEMANAL Y FUERZA
   ============================================================ */
function weekOf(plan, dateStr) {
  if (!plan) return { w: 1, dayIdx: 0, fuera: true };
  const first = plan.semanas[0].inicio;
  const diff = daysBetween(first, dateStr);
  if (diff < 0) return { w: 1, dayIdx: 0, fuera: true };
  const w = Math.floor(diff / 7) + 1;
  return { w: clamp(w, 1, plan.totalSemanas), dayIdx: ((diff % 7) + 7) % 7, fuera: w > plan.totalSemanas };
}
const semanaPlan = (plan, w) => plan.semanas.find((s) => s.w === w) || plan.semanas[plan.semanas.length - 1];
const esGym = (c) => c.startsWith("GYM");
const colorOf = (c) => (esGym(c) ? "gym" : c === "RECOVERY" ? "rest" : "run");

function sessionDetail(plan, perfil, w, code, P) {
  const sp = semanaPlan(plan, w);
  if (code === "RECOVERY") return { titulo: "Recuperación sin impacto", dur: 28, desc: "25-30′ de bici, elíptica o natación a RPE 3. O descanso completo si la fatiga es alta." };
  if (sp.runs[code]) {
    const nombres = { "RUN A": sp.w === plan.totalSemanas ? "COMPETICIÓN" : "Tirada larga", "RUN B": "Rodaje medio", "RUN C": "Rodaje corto fácil", "RUN D": "Rodaje regenerativo" };
    return { titulo: nombres[code] || code, dur: sp.runs[code].t, desc: sp.runs[code].d };
  }
  const g = gymSession(plan, perfil, w, code, P);
  return { titulo: g.foco, dur: g.dur, desc: g.mod + ". " + g.ej.length + " ejercicios." };
}

function gymSession(plan, perfil, w, code, P) {
  const cat = catalogoEj(P);
  const propia = (P && P.rutinas && P.rutinas[code]) || null;   // rutina editada a mano
  const plantilla = PLANTILLAS[clamp(plan.gymDias, 1, 4)] || PLANTILLAS[2];
  const base = propia || plantilla.find((g) => g.code === code) || plantilla[0];
  const sp = semanaPlan(plan, w);
  const equip = perfil.equipamiento === "Gimnasio completo" ? "full" : perfil.equipamiento === "En casa (peso corporal y gomas)" ? "casa" : "basico";
  const zonas = [...(perfil.lesiones || []).map((l) => l.zona), ...(perfil.molestias || []).map((m) => m.zona)].join(" ").toLowerCase();
  const gemelo = zonas.includes("gemelo") || zonas.includes("aquiles");
  const rodilla = zonas.includes("rodilla");
  const lumbar = zonas.includes("lumbar");
  const avisos = [];

  let ej = (base.ej || []).map((e) => ({ ...e }));

  /* --- ADAPTACIONES POR HISTORIAL ---
     Se aplican también sobre las rutinas editadas a mano: si quitas trabajo
     protector, el motor lo devuelve y te lo dice. Es la parte que no negocias
     contigo mismo un martes a las 7 de la mañana.                            */
  if (gemelo) {
    if (ej.some((e) => e.pat === "soleo")) {
      ej = ej.map((e) => (e.pat === "soleo" ? { ...e, s: Math.max(e.s, propia ? e.s : e.s + 1), key: true, nota: e.nota || "Tempo 3-1-3. Prioridad absoluta por tu historial: no lo elimines nunca." } : e));
    } else {
      ej.push({ ...S("soleo", 4, "8-12", "1-2", 1), nota: "Reañadido automáticamente: tu historial de gemelo/Aquiles lo hace innegociable." });
      if (propia) avisos.push("Habías quitado el sóleo. Se ha vuelto a añadir por tu historial de gemelo y Aquiles.");
    }
    if (!ej.some((e) => e.pat === "tibial")) ej.push({ ...S("tibial", 2, "15-20", "1-2"), nota: "Añadido por tu historial de gemelo/Aquiles." });
  }
  if (rodilla) { ej = ej.map((e) => (e.pat === "rodilla" ? { ...e, nota: e.nota || "Trabaja solo en el rango que no te dé molestia." } : e));
    if (!ej.some((e) => e.pat === "isquios")) { ej.push({ ...S("isquios", 3, "8-12", "1-2", 1), nota: "Añadido por tu historial de rodilla." });
      if (propia) avisos.push("Se ha añadido curl femoral: trabajo de isquios en flexión por tu historial de rodilla."); } }
  if (lumbar) ej = ej.map((e) => (e.pat === "cadera" ? { ...S("gluteo", e.s, "10-15", "2", 1), nota: "Sustituye al peso muerto por tu historial lumbar: misma cadena, menos carga axial." } : e));

  const mods = { carga: "Volumen completo", descarga: "Quita 1 serie a cada accesorio", mantenimiento: "Recorta series, mantén la carga", taper: "Solo torso, sin trabajo de pierna" };
  if (sp.gym === "descarga") ej = ej.map((e) => ({ ...e, s: Math.max(2, e.s - 1) }));
  if (sp.gym === "mantenimiento") ej = ej.map((e) => ({ ...e, s: e.key ? e.s : Math.max(2, e.s - 1) }));
  if (sp.gym === "taper") ej = ej.filter((e) => !["rodilla","rodilla_alt","cadera","gluteo","isquios","soleo","gastro","unilateral"].includes(e.pat)).map((e) => ({ ...e, s: 2 }));

  let detalle = ej.map((e) => ({ ...e, n: exName(e.pat, equip, cat), g: cat[e.pat] ? cat[e.pat].g : "", inc: cat[e.pat] ? cat[e.pat].inc : 2.5 }));

  /* --- AJUSTE POR TIEMPO (~3,2 min por serie) ---
     Solo en rutinas generadas. Si la has editado tú, se respeta entera: ya
     decides tú qué recortar, y se te muestra la duración estimada.
     Nunca se deja un ejercicio en 1 serie: se baja a 2 y, si aún no cabe,
     se elimina entero. Una serie suelta no es un estímulo, es un trámite.   */
  const minDisp = +perfil.minGym || 70;
  const dur = (arr) => Math.round(arr.reduce((a, e) => a + e.s, 0) * 3.2 + 8);
  if (!propia) {
    let vueltas = 0;
    while (dur(detalle) > minDisp && vueltas < 60) {
      vueltas++;
      const bajable = [...detalle].reverse().find((e) => !e.key && e.s > 2);
      if (bajable) { bajable.s -= 1; continue; }
      const quitable = [...detalle].reverse().find((e) => !e.key);
      if (quitable) { detalle = detalle.filter((e) => e !== quitable); continue; }
      break;
    }
  }

  const duracion = dur(detalle);
  if (propia && duracion > minDisp + 5) avisos.push("Esta rutina son unos " + duracion + " min y tienes " + minDisp + ". Cabe si aprietas los descansos, pero tenlo en cuenta.");

  return { code, foco: base.foco, pesado: base.pesado, ej: detalle, dur: duracion, mod: mods[sp.gym], fase: sp.gym, editada: !!propia, avisos };
}

/* Rutina base editable: la plantilla generada, ya con el nombre resuelto según
   tu equipamiento, lista para que la modifiques.                             */
function rutinaBase(plan, perfil, code, P) {
  const plantilla = PLANTILLAS[clamp(plan.gymDias, 1, 4)] || PLANTILLAS[2];
  const b = plantilla.find((g) => g.code === code) || plantilla[0];
  return { code, foco: b.foco, pesado: b.pesado, ej: b.ej.map((e) => ({ ...e })), editada: true, modificada: iso(new Date()) };
}

function sessionPool(plan, w) {
  const sp = semanaPlan(plan, w);
  const runs = Object.keys(sp.runs).filter((k) => sp.runs[k].t > 0 || w === plan.totalSemanas);
  const gyms = (PLANTILLAS[clamp(plan.gymDias, 1, 4)] || PLANTILLAS[2]).map((g) => g.code);
  if (sp.taper) return [...runs, gyms[0]].filter(Boolean);
  if (sp.deload) return [...runs.filter((r) => r !== "RUN D"), ...gyms];
  return [...runs, ...gyms];
}
function priorityOrder(plan, perfil, w) {
  const pool = sessionPool(plan, w);
  const rendimiento = (perfil.prioridad || [])[0] === "Rendimiento en carrera";
  const orden = rendimiento ? ["RUN A", "RUN B", "GYM A", "GYM B", "RUN C", "GYM C", "RUN D", "GYM D"]
                            : ["RUN A", "GYM A", "GYM B", "RUN B", "GYM C", "RUN C", "GYM D", "RUN D"];
  return orden.filter((c) => pool.includes(c)).concat(pool.filter((c) => !orden.includes(c)));
}

function generateWeek(plan, perfil, w, availDays, opts = {}) {
  const { gym = true, correr = true, dolor = 0, fatiga = 3 } = opts;
  let pool = priorityOrder(plan, perfil, w).filter((s) => (gym || !esGym(s)) && (correr || esGym(s)));
  const notes = [];
  if (dolor >= 4) { pool = pool.filter((s) => s !== "RUN C" && s !== "RUN D"); if (perfil.crossTraining === "Sí") pool.push("RECOVERY");
    notes.push("Dolor " + dolor + "/10: sustituyo el rodaje de menor valor por trabajo sin impacto y bajo el volumen del resto. Si el dolor aparece al correr y no cede al calentar, no corras hoy."); }
  if (fatiga >= 8) { pool = pool.slice(0, Math.max(2, pool.length - 1)); notes.push("Fatiga 8+/10: quito la sesión de menor prioridad de la semana."); }
  const chosen = pool.slice(0, Math.min(availDays.length, pool.length));
  if (availDays.length < pool.length) notes.push("Con " + availDays.length + " días mantengo por prioridad: " + chosen.join(" · ") + ".");

  let best = null;
  const perm = (rem, acc) => {
    if (acc.length === chosen.length) { const sc = scoreAssignment(acc, plan, perfil, w, availDays); if (!best || sc.score > best.score) best = { assign: [...acc], ...sc }; return; }
    for (let i = 0; i < rem.length; i++) { acc.push({ day: rem[i], code: chosen[acc.length] }); perm(rem.filter((_, j) => j !== i), acc); acc.pop(); }
  };
  if (chosen.length <= 6) perm(availDays, []);
  else { const a = availDays.slice(0, 6); perm(a, []); }
  if (!best) return { assign: [], notes, violations: [] };
  return { assign: best.assign.sort((a, b) => a.day - b.day), notes: [...notes, ...best.reasons], violations: best.violations };
}

function scoreAssignment(acc, plan, perfil, w, availDays) {
  const at = {}; acc.forEach((a) => (at[a.code] = a.day));
  const plantilla = PLANTILLAS[clamp(plan.gymDias, 1, 4)] || PLANTILLAS[2];
  const pesadoCode = (plantilla.find((g) => g.pesado) || plantilla[0]).code;
  const gyms = plantilla.map((g) => g.code).filter((c) => at[c] !== undefined);
  let score = 0; const reasons = []; const violations = [];
  const gP = at[pesadoCode], rA = at["RUN A"], rB = at["RUN B"], rC = at["RUN C"];
  const has = (x) => x !== undefined;

  if (has(gP) && has(rA)) {
    if (gP < rA) { const gap = rA - gP; if (gap >= 2) { score += 60; if (gap >= 3) score += 10; } else { score -= 900; violations.push("R1: solo " + gap * 24 + " h entre la sesión de pierna pesada y la tirada larga"); } }
    else { score += 45; if (gP === rA + 1) { score += 25; reasons.push("La sesión de pierna pesada va justo después de la tirada larga: concentro la fatiga de pierna en días contiguos y dejo limpio el resto de la semana."); } }
  }
  for (let i = 0; i < gyms.length; i++) for (let j = i + 1; j < gyms.length; j++) {
    const dd = Math.abs(at[gyms[i]] - at[gyms[j]]);
    if (dd <= 1 && plan.gymDias <= 2) { score -= 800; violations.push("R4: dos sesiones de gimnasio en días consecutivos"); }
    else if (dd <= 1) score -= 120; else if (dd >= 3) score += 20;
  }
  if (has(gP) && has(rB) && rB === gP + 1) { score -= 220; violations.push("R9: rodaje de calidad el día siguiente a la pierna pesada"); }
  if (availDays.length >= 7 && acc.length >= 7) { score -= 500; violations.push("R5: no queda ningún día de descanso completo"); }
  if (has(rC) && gyms.length > 1) { const gLigero = gyms.find((c) => c !== pesadoCode); if (gLigero !== undefined && rC === at[gLigero] + 1) { score += 22; reasons.push("El rodaje corto cae el día después de la sesión de gimnasio menos exigente para la rodilla: el trote suave ahí incluso ayuda a recuperar."); } }
  if (has(rA)) { if (rA >= 5) score += 35; if (rA === 6) score += 12; }
  const days = acc.map((a) => a.day).sort((a, b) => a - b);
  let streak = 1, maxS = 1;
  for (let i = 1; i < days.length; i++) { streak = days[i] === days[i - 1] + 1 ? streak + 1 : 1; maxS = Math.max(maxS, streak); }
  if (maxS >= 4) score -= 120; else if (maxS === 3) score -= 25;
  score += days.length > 1 ? (days[days.length - 1] - days[0]) * 3 : 0;
  return { score, reasons, violations };
}

/* ---------- PROGRESIÓN DE CARGA ---------- */
const LIFT_MAP = { "Sentadilla": ["Sentadilla trasera", "Sentadilla goblet", "Prensa de piernas"], "Peso muerto": ["Peso muerto rumano", "Peso muerto rumano mancuernas"], "Press banca": ["Press banca", "Press con mancuernas"], "Dominadas (lastre)": ["Dominadas o jalón al pecho", "Dominadas asistidas con goma"] };
function baseLoad(nombre, perfil) {
  const c = perfil.cargas || {};
  for (const k of Object.keys(LIFT_MAP)) if (LIFT_MAP[k].includes(nombre) && c[k]) return Math.round(+c[k] * 0.9);
  return null;
}
function suggestLoad(ej, history, perfil, painFlag) {
  const prev = history.filter((s) => s.exercise === ej.n).sort((a, b) => (a.date < b.date ? 1 : -1));
  if (!prev.length) {
    const b = baseLoad(ej.n, perfil);
    return { peso: b, msg: b ? "Sin registros de este ejercicio. Arranca en " + b + " kg (un 10% por debajo de la carga que declaraste) y ajusta según las repeticiones que te salgan." : "Sin registros. Elige un peso que te deje 2-3 repeticiones en recámara y anótalo: a partir de ahí el sistema progresa solo." };
  }
  const lastDate = prev[0].date;
  const last = prev.filter((s) => s.date === lastDate).sort((a, b) => a.set - b.set);
  const peso = Math.max(...last.map((s) => s.weight || 0));
  const top = parseInt(String(ej.r).split("-")[1]) || 10;
  const allTop = last.every((s) => (s.reps || 0) >= top);
  const rirOk = last.every((s) => (s.rir === null || s.rir === undefined ? true : s.rir >= 1));
  const txt = last.map((s) => s.reps).join(" / ");
  if (painFlag) return { peso, msg: "Última: " + peso + " kg × " + txt + ". Hay molestias registradas estos días → repite carga, no subas." };
  if (allTop && rirOk && ej.inc > 0) return { peso: peso + ej.inc, msg: "Última: " + peso + " kg × " + txt + " con repeticiones al tope y RIR suficiente. Sube a " + (peso + ej.inc) + " kg y vuelve al extremo bajo del rango." };
  if (allTop && ej.inc === 0) return { peso: null, msg: "Última: " + txt + " repeticiones. Añade dificultad (tempo, recorrido o lastre) antes que repeticiones." };
  return { peso, msg: "Última: " + peso + " kg × " + txt + ". Mantén " + peso + " kg hasta llegar a " + top + " repeticiones en todas las series." };
}
const e1rm = (w, r) => (r > 0 && r < 15 ? Math.round(w * (1 + r / 30)) : w);

/* ============================================================
   MÓDULO DE NUTRICIÓN
   ============================================================
   Tres capas, igual que el resto del sistema:
   1. Energética   — cuánto necesitas hoy, según la sesión que toca
   2. Cronograma   — cuándo comer qué, según a qué hora entrenas
   3. Catálogo     — con qué alimentos concretos lo cubres (tuyo, editable)
   La capa 3 es opcional: sin ella el módulo sigue dando pautas útiles.     */

const MOMENTOS = [
  { k: "temprano", l: "Temprano, antes del trabajo", h: "06:00-08:00" },
  { k: "mediodia", l: "Al mediodía", h: "13:00-15:00" },
  { k: "tarde",    l: "Por la tarde, después del trabajo", h: "18:00-20:00" },
  { k: "noche",    l: "Noche", h: "21:00-22:30" },
];
const momentoDe = (perfil) => ({ "Antes del trabajo": "temprano", "Mediodía": "mediodia", "Después del trabajo": "tarde", "Variable": "tarde" }[perfil.momento] || "tarde");

/* --- Gasto energético ---
   Se usa Katch-McArdle cuando hay porcentaje de grasa (más fiable porque
   parte de la masa magra) y Mifflin-St Jeor cuando no lo hay.             */
function metabolismoBasal(p) {
  const peso = +p.peso || 70, altura = +p.altura || 175, edad = +p.edad || 30;
  if (+p.grasa > 0 && +p.grasa < 60) {
    const magra = peso * (1 - +p.grasa / 100);
    return { kcal: Math.round(370 + 21.6 * magra), metodo: "Katch-McArdle", magra: Math.round(magra * 10) / 10 };
  }
  const base = 10 * peso + 6.25 * altura - 5 * edad + (p.sexo === "Mujer" ? -161 : 5);
  return { kcal: Math.round(base), metodo: "Mifflin-St Jeor", magra: null };
}
/* Actividad no deportiva: el entreno se suma aparte, para que el objetivo
   del día cambie de verdad según lo que toque.                            */
const FACTOR_NEAT = { "Sedentario": 1.35, "De pie": 1.5, "Físicamente exigente": 1.65 };

/* MET aproximados. Correr fácil ronda 8-9; el gimnasio con descansos, 5.   */
function gastoSesion(codigo, minutos, peso, intensidad) {
  if (!minutos) return 0;
  const met = esGym(codigo) ? 5 : codigo === "RECOVERY" ? 4.5 : (intensidad === "calidad" ? 10 : 8.5);
  return Math.round(met * 3.5 * (+peso || 70) / 200 * minutos);
}

/* --- Objetivos del día --- */
function objetivosDia(perfil, sesiones, cfg = {}) {
  const peso = +perfil.peso || 70;
  const bm = metabolismoBasal(perfil);
  const neat = FACTOR_NEAT[perfil.trabajo] || 1.45;
  const base = Math.round(bm.kcal * neat);
  const entreno = sesiones.reduce((a, x) => a + gastoSesion(x.code, x.dur, peso, x.intensidad), 0);
  const minutos = sesiones.reduce((a, x) => a + (x.dur || 0), 0);
  const corriendo = sesiones.filter((x) => !esGym(x.code) && x.code !== "RECOVERY").reduce((a, x) => a + (x.dur || 0), 0);

  // Ajuste según el objetivo declarado, con techo y suelo deliberados
  const obj = perfil.nutricion || "Mantenimiento";
  const ajuste = obj === "Déficit calórico" ? -0.12 : obj === "Superávit" ? 0.10 : 0;
  let kcal = Math.round((base + entreno) * (1 + ajuste));

  /* SUELO DE SEGURIDAD. La disponibilidad energética por debajo de 30 kcal
     por kg de masa magra se asocia a problemas hormonales, óseos e inmunes
     [Melin 2019]. Aquí no se baja de ahí pase lo que pase.                 */
  const magra = bm.magra || peso * 0.8;
  const sueloDisp = Math.round(30 * magra + entreno);
  const sueloBasal = bm.kcal;
  const suelo = Math.max(sueloDisp, sueloBasal);
  /* Si el usuario fija una cifra (por ejemplo la de su nutricionista), manda
     la suya. El suelo se sigue aplicando: es lo único no negociable.       */
  const fijado = +cfg.kcalFijo > 0;
  if (fijado) kcal = Math.round(+cfg.kcalFijo);
  const recortado = kcal < suelo;
  if (recortado) kcal = suelo;

  // Proteína: estable, no se toca con la carga del día
  const gkg = +cfg.protGkg > 0 ? +cfg.protGkg
    : obj === "Déficit calórico" ? 2.2 : (perfil.prioridad || [])[0] === "Masa muscular" ? 2.0 : 1.8;
  const prot = Math.round(peso * gkg);

  /* Carbohidrato escalado a la carga del día [Thomas 2016, Impey 2018] */
  const chKg = minutos === 0 ? 3.5 : minutos < 45 ? 4.5 : minutos < 75 ? 5.5 : minutos < 105 ? 6.5 : 7.5;
  let ch = Math.round(peso * chKg);
  const gras = Math.max(Math.round(peso * 0.8), Math.round((kcal - prot * 4 - ch * 4) / 9));
  // Cuadrar: el carbohidrato absorbe el desajuste, nunca la proteína
  ch = Math.max(Math.round(peso * 2.5), Math.round((kcal - prot * 4 - gras * 9) / 4));

  const fibra = Math.round(Math.min(38, Math.max(25, kcal / 1000 * 12)));
  const agua = Math.round((peso * 33 + minutos * 8) / 100) / 10;

  return { kcal, prot, ch, gras, fibra, agua, base, entreno, minutos, corriendo, bm, neat,
    gkg, chKg, suelo, recortado, fijado, calculado: Math.round((base + entreno) * (1 + ajuste)), objetivo: obj,
    disponibilidad: Math.round((kcal - entreno) / magra) };
}

/* --- Cronograma del día ---
   Devuelve las tomas en orden con su ventana, su contenido y por qué.
   Todo aquí sale de reglas explícitas, no de la IA.                        */
function cronogramaDia(perfil, sesiones, momento, obj) {
  const peso = +perfil.peso || 70;
  const T = [];
  const dosisProt = Math.round(peso * 0.4);            // [Schoenfeld 2018, Areta 2013]
  const ses = sesiones.filter((x) => x.code !== "RECOVERY");
  const principal = ses.slice().sort((a, b) => (b.dur || 0) - (a.dur || 0))[0] || null;
  const correr = ses.find((x) => !esGym(x.code));
  const gym = ses.find((x) => esGym(x.code));
  const dur = principal ? principal.dur || 0 : 0;
  const larga = correr && (correr.dur || 0) >= 75;
  const calidad = principal && principal.intensidad === "calidad";
  const descanso = !ses.length;

  const add = (o) => T.push({ id: uid(), ...o });

  if (descanso) {
    add({ hora: "Todo el día", titulo: "Día sin entreno", que: obj.prot + " g de proteína repartidos en 4 tomas de unos " + dosisProt + " g, y el carbohidrato en la parte baja del rango (" + obj.ch + " g).",
      porque: "Sin sesión no hay demanda extra de glucógeno, pero la proteína sostiene la recuperación y no se recorta nunca.", refs: ["n1", "n8"], tipo: "base" });
    add({ hora: "Comida y cena", titulo: "Día ideal para la fibra", que: "Concentra aquí las legumbres, la verdura y el almidón resistente (patata, arroz o boniato cocidos y enfriados 24 h).",
      porque: "Sin entreno cerca no hay riesgo de molestias digestivas, así que es cuando la fibra sale gratis.", refs: ["n14", "n15", "n12"], tipo: "fibra" });
    return T;
  }

  /* ---------- ENTRENO TEMPRANO ---------- */
  if (momento === "temprano") {
    if (larga || calidad || dur >= 60) {
      add({ hora: "15-30 min antes", titulo: "Pre-entreno ligero", que: "20-40 g de carbohidrato de digestión rápida: un plátano, 2 dátiles, 2 tortitas de arroz con miel o un zumo pequeño. Nada de fibra, grasa ni proteína en cantidad.",
        porque: "A esta hora vienes de 8 h de ayuno y la sesión es larga o intensa. Lo que buscas es glucosa disponible sin nada que se quede en el estómago.", refs: ["n16", "n12"], tipo: "pre" });
    } else {
      add({ hora: "Opcional, 15 min antes", titulo: "Puedes entrenar en ayunas", que: "Para un rodaje corto y fácil no necesitas comer antes. Si te sienta mal el ayuno, medio plátano basta.",
        porque: "En sesiones cortas de baja intensidad la comida previa apenas cambia nada.", refs: ["n16"], tipo: "pre" });
    }
    if (larga) add({ hora: "Durante, desde el minuto 60", titulo: "Carbohidrato en marcha", que: "30-60 g por hora: gel, bebida deportiva o dátiles. Empieza antes de notarte vacío.",
      porque: "Por encima de 75 min el glucógeno deja de dar y la ingesta durante sostiene el ritmo y la cabeza.", refs: ["n3"], tipo: "durante" });
    add({ hora: "Dentro de la hora siguiente", titulo: "Desayuno post-entreno", que: dosisProt + " g de proteína más carbohidrato: cualquiera de tus desayunos completos.",
      porque: "Aquí la ventana sí importa: has entrenado en ayunas y llevas muchas horas sin nutrientes.", refs: ["n4", "n5"], tipo: "post" });
    add({ hora: "Resto del día", titulo: "Tres tomas más", que: "Comida, merienda y cena, con unos " + dosisProt + " g de proteína en cada comida principal.",
      porque: "Repartir la proteína en 4 tomas rinde más que concentrarla en una o dos.", refs: ["n6", "n7"], tipo: "base" });
    add({ hora: "Comida y cena", titulo: "Aquí va la fibra", que: "Legumbres, verdura abundante y almidón resistente. Lejos del entreno de mañana.",
      porque: "La fibra es el objetivo del día, pero nunca en las horas previas a correr.", refs: ["n14", "n12"], tipo: "fibra" });
    return T;
  }

  /* ---------- ENTRENO AL MEDIODÍA ---------- */
  if (momento === "mediodia") {
    add({ hora: "Desayuno, 3-4 h antes", titulo: "Desayuno completo y bajo en fibra", que: "Carbohidrato principal más proteína (" + dosisProt + " g). Deja para después las legumbres, la verdura cruda y los integrales muy fibrosos.",
      porque: "Con 3-4 h de margen te da tiempo a vaciar el estómago, pero la fibra y la grasa siguen ralentizándolo.", refs: ["n16", "n12"], tipo: "pre" });
    if (larga || calidad) add({ hora: "45-60 min antes", titulo: "Recarga corta", que: "20-30 g de carbohidrato simple si notas el desayuno lejos.",
      porque: "Sesión exigente: mejor llegar con glucosa disponible.", refs: ["n2", "n16"], tipo: "pre" });
    if (larga) add({ hora: "Durante, desde el minuto 60", titulo: "Carbohidrato en marcha", que: "30-60 g por hora.", porque: "Por encima de 75 min el depósito no llega.", refs: ["n3"], tipo: "durante" });
    add({ hora: "En las 2 h siguientes", titulo: "Comida post-entreno", que: "Tu plato completo: " + dosisProt + " g de proteína, carbohidrato y verdura.",
      porque: "Con una comida decente antes y otra después, el minuto exacto da igual.", refs: ["n5", "n4"], tipo: "post" });
    add({ hora: "Merienda y cena", titulo: "Completar proteína y fibra", que: "Dos tomas más hasta los " + obj.prot + " g, y aquí sí la fibra y el almidón resistente.",
      porque: "Ya no hay sesión cerca: es la ventana libre para la fibra.", refs: ["n6", "n14"], tipo: "fibra" });
    return T;
  }

  /* ---------- ENTRENO POR LA TARDE ---------- */
  add({ hora: "Desayuno", titulo: "Desayuno normal", que: dosisProt + " g de proteína y carbohidrato. Aquí la fibra no molesta: quedan muchas horas.",
    porque: "Lejos del entreno, la comida es la que te apetezca dentro del plan.", refs: ["n6", "n14"], tipo: "fibra" });
  add({ hora: "Comida, 3-4 h antes", titulo: "Comida principal, fibra moderada", que: "Plato completo pero sin cargar de legumbre ni crucíferas si vas a correr fuerte.",
    porque: "Con 3-4 h suele bastar, aunque una comida muy fibrosa sigue pesando al correr.", refs: ["n12", "n16"], tipo: "pre" });
  add({ hora: "60-90 min antes", titulo: "Merienda pre-entreno", que: (larga || calidad ? "40-60" : "25-40") + " g de carbohidrato con poca grasa y poca fibra: fruta, pan blanco con miel o mermelada, tortitas de arroz, yogur con plátano.",
    porque: larga || calidad ? "Sesión exigente al final del día: llegas con horas desde la comida y conviene rellenar." : "Suficiente para que el rodaje no se haga cuesta arriba, sin llenar el estómago.", refs: ["n16", "n2"], tipo: "pre" });
  if (larga) add({ hora: "Durante, desde el minuto 60", titulo: "Carbohidrato en marcha", que: "30-60 g por hora.", porque: "Por encima de 75 min el glucógeno se agota.", refs: ["n3"], tipo: "durante" });
  add({ hora: "Cena, dentro de 1-2 h", titulo: "Cena de recuperación", que: dosisProt + " g de proteína y carbohidrato suficiente para reponer.",
    porque: "Es la última toma grande antes de dormir y la que cierra la recuperación del día.", refs: ["n4", "n8"], tipo: "post" });
  if (gym || (obj.minutos >= 90)) add({ hora: "Antes de dormir", titulo: "Toma opcional", que: "30-40 g de proteína de digestión lenta: yogur griego, skyr, queso fresco batido o caseína.",
    porque: "Día de carga alta. El beneficio es modesto pero real, y encaja con tus postres del plan.", refs: ["n8"], tipo: "base" });
  return T;
}

/* --- Avisos: donde el plan choca con la sesión, o con la salud --- */
function avisosNutricion(perfil, obj, momento, sesiones) {
  const av = [];
  const correr = sesiones.find((x) => !esGym(x.code) && x.code !== "RECOVERY");
  if (obj.recortado) av.push({ n: "alta", t: "Objetivo elevado hasta el suelo de seguridad",
    d: "Tu objetivo declarado daba una cifra por debajo de lo razonable para la carga de hoy. Se ha subido a " + obj.kcal + " kcal. Por debajo de 30 kcal por kg de masa magra disponibles aparecen problemas hormonales, óseos e inmunitarios [Melin 2019]." });
  if (correr && momento === "tarde") av.push({ n: "media", t: "Fibra: hoy corres por la tarde",
    d: "La comida del mediodía cae dentro de las 3-4 h previas. Deja la legumbre, la crucífera y el integral muy fibroso para el desayuno o la cena [de Oliveira 2014]." });
  if (correr && momento === "temprano") av.push({ n: "baja", t: "Fibra: tienes el día libre",
    d: "Al entrenar antes de desayunar, comida y cena quedan lejos de la sesión: es cuando el almidón resistente y las legumbres salen gratis." });
  if (obj.corriendo >= 75) av.push({ n: "media", t: "Sesión larga: bebe y come en marcha",
    d: "30-60 g de carbohidrato por hora y 400-800 ml de líquido por hora, ajustado a tu sudoración. Pésate antes y después alguna vez para conocer la tuya [Jeukendrup 2014, Sawka 2007]." });
  if ((perfil.suplementos || []).includes("Cafeína") && momento === "tarde") av.push({ n: "media", t: "Cafeína y sueño",
    d: "Entrenas por la tarde y duermes " + perfil.sueno + " h. La cafeína interfiere hasta 6-8 h después: úsala solo en sesiones de calidad de mañana [Guest 2021]." });
  if ((perfil.suplementos || []).includes("Creatina")) av.push({ n: "info", t: "Creatina",
    d: "3-5 g al día, a la hora que te resulte fácil recordarla. El momento no importa [Kreider 2017]." });
  if (+perfil.sueno < 7 && obj.minutos > 60) av.push({ n: "media", t: "Duermes poco para esta carga",
    d: "Con " + perfil.sueno + " h de sueño y " + obj.minutos + " min de entreno, ninguna estrategia nutricional compensa el déficit de descanso." });
  if ((perfil.banderas || []).some((b) => b !== "Ninguna")) av.push({ n: "alta", t: "Consulta médica pendiente",
    d: "Marcaste una bandera de salud en el cuestionario. Cualquier pauta nutricional debe revisarla un profesional sanitario antes de aplicarla." });
  return av;
}

/* Variante ligera: calcula a partir de una lista de códigos, sin depender de
   que la semana esté guardada. La usa el planificador con su borrador.     */
function nutriDeCodigos(P, w, codes) {
  const plan = P.plan, perfil = P.perfil;
  const sesiones = (codes || []).map((c) => {
    const det = sessionDetail(plan, perfil, w, c, P);
    return { code: c, dur: det.dur, titulo: det.titulo,
      intensidad: !esGym(c) && /RPE 5|ritmo|calidad/i.test(det.desc || "") ? "calidad" : "facil" };
  });
  const momento = momentoDe(perfil);
  const obj = objetivosDia(perfil, sesiones, P.nutriConfig || {});
  return { sesiones, momento, obj, crono: cronogramaDia(perfil, sesiones, momento, obj),
    avisos: avisosNutricion(perfil, obj, momento, sesiones) };
}

/* Media semanal: sirve para comparar el enfoque dinámico con una cifra fija
   pautada por un profesional, y ver si cuadran a lo largo de la semana.   */
function resumenSemanaNutricion(st, P, w) {
  const dias = [];
  for (let i = 0; i < 7; i++) {
    const n = nutricionDia(st, P, w, i);
    dias.push({ dia: i, kcal: n.obj.kcal, prot: n.obj.prot, ch: n.obj.ch, min: n.obj.minutos,
      sesiones: n.sesiones.map((x) => x.code).join(" + ") || "descanso" });
  }
  const media = (k) => Math.round(dias.reduce((a, d) => a + d[k], 0) / 7);
  return { dias, mediaKcal: media("kcal"), mediaProt: media("prot"), mediaCh: media("ch"),
    minKcal: Math.min(...dias.map((d) => d.kcal)), maxKcal: Math.max(...dias.map((d) => d.kcal)),
    totalMin: dias.reduce((a, d) => a + d.min, 0) };
}

/* --- Catálogo de comidas: estructura genérica, contenido de cada usuario --- */
const CATEGORIAS_COMIDA = [
  { k: "pre", l: "Pre-entreno rápido", ayuda: "Carbohidrato de digestión rápida, sin fibra ni grasa. Para 15-30 min antes." },
  { k: "desayuno", l: "Desayunos", ayuda: "Proteína + carbohidrato + fruta o extra." },
  { k: "comida", l: "Comidas", ayuda: "Proteína + carbohidrato + verdura." },
  { k: "cena", l: "Cenas", ayuda: "Misma estructura que las comidas." },
  { k: "merienda", l: "Meriendas y snacks", ayuda: "Tomas intermedias y pre-entreno de tarde." },
  { k: "postre", l: "Postres", ayuda: "Sobre todo lácteos proteicos." },
];

/* Catálogo nutricional opcional de ejemplo. Cada cuenta empieza vacía y puede
   cargarlo de forma explícita desde la pantalla de nutrición.               */
const PLAN_COMIDAS_SEED = {
  estructura: "50% verduras · 25% carbohidrato · 25% proteína, con una cucharada de aceite de oliva virgen extra",
  notas: "Desayunos, comidas y cenas intercambiables. Cocinar y enfriar patata, arroz o boniato 24 h para aumentar el almidón resistente.",
  fijos: ["Legumbres 2-3 veces por semana", "Salmón 1-2 veces por semana", "Atún o caballa 2 veces por semana", "Carne roja 1 vez por semana", "Huevos 4-6 veces por semana", "Patata, arroz o boniato cocidos y enfriados 3-4 veces por semana"],
  flexible: "Día de carrera, después de correr: pizza, hamburguesa, pasta, sushi o helado.",
  pre: ["1 plátano", "2 tortitas de arroz con miel", "2 dátiles", "Zumo de naranja pequeño"],
  desayuno: ["Tortilla de 3 huevos · 2 tostadas integrales · tomate rallado y café", "Yogur griego natural con scoop de proteína · avena · plátano",
    "Queso fresco batido · muesli o avena · fresas o arándanos", "Jamón cocido o pavo · pan integral · fruta de temporada",
    "Batido de proteína con leche · avena · plátano", "Huevos revueltos · tortitas de maíz o arroz · fruta", "Yogur proteico · granola casera · fruta"],
  comida: ["Pollo · arroz cocinado el día anterior · ensalada completa", "Pavo · patata cocida y enfriada · judías verdes",
    "Salmón · boniato · ensalada", "Merluza · patata · tomate y cebolla", "Atún natural · arroz · ensalada mediterránea",
    "Ternera magra · patata asada · verduras salteadas", "Pollo · pasta · tomate y lechuga", "Garbanzos con huevo · patata · sofrito de verduras",
    "Lentejas con atún · pan integral · verduras", "Pavo · boniato · ensalada"],
  cena: ["Merluza · patata cocida · ensalada", "Tortilla de 3 huevos · boniato · tomate aliñado", "Salmón · patata · judías verdes",
    "Atún natural · arroz cocido el día anterior · ensalada", "Pavo · patata · verduras salteadas", "Pollo · boniato · ensalada",
    "Huevos con queso curado · patata · tomate", "Caballa o atún · pan integral · ensalada", "Revuelto de huevos y gambas · patata · verduras",
    "Merluza · arroz · ensalada"],
  merienda: ["Pieza de fruta", "Puñado de frutos secos", "Yogur", "Tortitas de arroz con pavo"],
  postre: ["Yogur griego natural", "Skyr", "Queso fresco batido", "Pudin proteico", "Yogur con canela", "Yogur con arándanos", "Yogur con nueces", "Queso curado con fruta"],
};

/* Reúne todo lo del día: sesiones, objetivos, cronograma y avisos */
function nutricionDia(st, P, w, dayIdx) {
  const plan = P.plan, perfil = P.perfil;
  const wdata = P.weeks[w];
  const asignadas = wdata ? wdata.assign.filter((a) => a.day === dayIdx) : [];
  const sp = semanaPlan(plan, w);
  const sesiones = asignadas.map((a) => {
    const det = sessionDetail(plan, perfil, w, a.code, P);
    const esCal = !esGym(a.code) && /RPE 5|ritmo|calidad/i.test(det.desc || "");
    return { code: a.code, dur: det.dur, titulo: det.titulo, intensidad: esCal ? "calidad" : "facil", momento: a.momento || momentoDe(perfil) };
  });
  const momento = sesiones.length ? sesiones[0].momento : momentoDe(perfil);
  const obj = objetivosDia(perfil, sesiones, P.nutriConfig || {});
  return { sesiones, momento, obj, fase: sp.fase, deload: sp.deload, taper: sp.taper,
    crono: cronogramaDia(perfil, sesiones, momento, obj),
    avisos: avisosNutricion(perfil, obj, momento, sesiones) };
}

/* ============================================================
   CAPA DE IA — LLAMADA, RAZONAMIENTO Y GUARDARRAÍLES
   ============================================================ */

const MODELO = "configurado-en-servidor";

/* Llamada única a la API. Dentro de un artifact de claude.ai esta petición se
   intercepta y no necesita API key; fuera de ahí fallará, y todo lo que la usa
   tiene un camino alternativo sin IA.                                        */
async function llamarIA({ system, messages, max_tokens = 1400 }) {
  /* Dentro de un artifact de claude.ai la petición a la API se intercepta sola.
     Desplegada en un servidor, va por /api/ia y la clave vive en el servidor:
     así no se puede leer desde el navegador de quien use la aplicación.      */
  const r = await fetch("/api/ia", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ max_tokens, system, messages }),
  });
  if (!r.ok) {
    let d = ""; try { d = (await r.json()).message || ""; } catch { }
    throw new Error(r.status === 503 ? (d || "El servidor no tiene clave de IA configurada") : "La API respondió " + r.status);
  }
  const data = await r.json();
  const txt = data.text || (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  if (!txt) throw new Error("Respuesta vacía");
  return txt;
}

/* Extrae el primer objeto o array JSON de una respuesta, tolerando que el
   modelo lo envuelva en ```json o añada texto alrededor.                     */
function extraerJSON(txt) {
  let t = String(txt).trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const i = t.search(/[[{]/);
  if (i < 0) throw new Error("La respuesta no contenía JSON");
  const abre = t[i], cierra = abre === "[" ? "]" : "}";
  let n = 0, fin = -1, str = false, esc = false;
  for (let k = i; k < t.length; k++) {
    const c = t[k];
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (c === '"') { str = !str; continue; }
    if (str) continue;
    if (c === abre) n++;
    else if (c === cierra) { n--; if (!n) { fin = k; break; } }
  }
  if (fin < 0) throw new Error("JSON incompleto");
  return JSON.parse(t.slice(i, fin + 1));
}

/* ---------- LÍMITES INAMOVIBLES ----------
   La IA razona sobre el porqué y sobre los matices, nunca sobre la estructura
   que protege el tejido. Estos campos los calcula el código y no se negocian. */
const CAMPOS_BLOQUEADOS = ["techo", "totalSemanas", "semanas", "taper", "deloads", "riesgo", "gymDias", "runDias", "mezcla", "cadaN", "caminarCorrer"];
const AJUSTES_PERMITIDOS = ["rir", "enfasis", "pliometria", "nota", "tempo", "accesorios", "nutricion", "calentamiento", "superficie", "cross"];

/* Hechos que el motor determinista ya ha calculado. Se le pasan a la IA como
   dato de entrada cerrado, no como algo que pueda recalcular.                */
function hechosPlan(p, plan) {
  return {
    atleta: { edad: +p.edad, sexo: p.sexo, peso: +p.peso, altura: +p.altura, grasa: +p.grasa || null },
    objetivo: { distancia: p.distancia, fecha: p.fechaCarrera, meta: p.metaTipo, prioridades: p.prioridad || [] },
    punto_partida: { experiencia: p.expCarrera, km_semana: +p.kmSemana, sesiones: +p.sesionesCarrera, tirada_larga_min: +p.tiradaLarga, paron: p.paron },
    gimnasio: { experiencia: p.expFuerza, tecnica: p.tecnica, equipamiento: p.equipamiento, cargas: p.cargas || {} },
    lesiones: (p.lesiones || []).map((l) => ({ zona: l.zona, recurrente: !!l.recurrente, contexto: l.cuando })),
    molestias: (p.molestias || []).map((m) => ({ zona: m.zona, intensidad: +m.intensidad, cuando: m.cuando })),
    estructural: p.estructural || [], 
    disponibilidad: { dias: (p.dias || []).length, min_gym: +p.minGym, min_run: +p.minRun, min_finde: +p.finde, cross: p.crossTraining },
    recuperacion: { sueno_h: +p.sueno, calidad: p.calidadSueno, estres: +p.estres, nutricion: p.nutricion, suplementos: p.suplementos || [] },
    ESTRUCTURA_YA_DECIDIDA: {
      semanas_totales: plan.totalSemanas, semanas_taper: plan.taper,
      techo_tirada_larga_min: plan.techo, riesgo_estructural: plan.riesgo.score + "/10",
      causas_riesgo: plan.riesgo.causas, sesiones_carrera: plan.runDias, sesiones_gimnasio: plan.gymDias,
      fases: plan.semanas.map((w) => ({ semana: w.w, fase: w.fase, tirada_larga_min: w.runs["RUN A"] ? w.runs["RUN A"].t : 0 })),
    },
  };
}

const SYS_DECISIONES = `Eres un fisiólogo del ejercicio que redacta la justificación razonada de un plan de entrenamiento híbrido (carrera + fuerza), apoyándote EXCLUSIVAMENTE en la bibliografía que se te entrega.

REGLA CENTRAL: el bloque ESTRUCTURA_YA_DECIDIDA lo ha calculado un motor determinista que protege al atleta. NO lo recalculas, NO lo discutes y NO propones cambiarlo. Tu trabajo es explicar POR QUÉ esa estructura es razonable para este atleta concreto citando la evidencia, y proponer matices que caben DENTRO de ella.

Devuelves SOLO un objeto JSON con esta forma exacta:
{
  "decisiones": [
    { "t": "titular de la decisión, una línea", "p": "justificación en 1-3 frases, concreta y referida a ESTE atleta", "refs": ["id de referencia", "..."], "confianza": "alta|media|baja" }
  ],
  "adaptaciones": [ { "z": "zona o factor", "a": "qué se cambia exactamente y por qué" } ],
  "ajustes": [ { "campo": "rir|enfasis|pliometria|nota|tempo|accesorios|nutricion|calentamiento|superficie|cross", "valor": "texto breve", "motivo": "una frase" } ],
  "sin_respaldo": ["afirmación que has hecho y que es práctica habitual sin evidencia sólida detrás"]
}

CÓMO CITAS
- En "refs" pones los id exactos de las referencias entregadas (el campo id: de cada línea). Nunca inventes id.
- Si una decisión no tiene respaldo en la bibliografía entregada, deja "refs" vacío, márcala con confianza "baja" y anótala en "sin_respaldo". Es preferible admitirlo a forzar una cita.
- No cites un estudio para algo que ese estudio no midió. Fíjate en el campo población y en el campo límites.
- Si la población del estudio no se parece al atleta, dilo dentro de la propia justificación.

TONO: español, directo, sin adornos. Nada de "es importante destacar". Frases cortas. Entre 6 y 10 decisiones.`;

async function decisionesIA(perfil, plan, biblio) {
  const consulta = [perfil.distancia, "entrenamiento concurrente fuerza resistencia hipertrofia",
    "volumen tirada larga progresion lesion tendon", "taper descarga recuperacion nutricion proteina",
    (perfil.lesiones || []).map((l) => l.zona).join(" "), (perfil.molestias || []).map((m) => m.zona).join(" "),
    (perfil.prioridad || []).join(" ")].join(" ");
  const refs = refsRelevantes(biblio, consulta, { max: 14, min: 6 });
  const txt = await llamarIA({
    system: SYS_DECISIONES, max_tokens: 2200,
    messages: [{ role: "user", content: "BIBLIOGRAFÍA DISPONIBLE\n" + refsPrompt(refs) + "\n\nDATOS DEL ATLETA Y ESTRUCTURA YA DECIDIDA\n" + JSON.stringify(hechosPlan(perfil, plan), null, 1) }],
  });
  const j = extraerJSON(txt);
  return { ...validarPropuesta(j, plan, biblio), generado: iso(new Date()), refsUsadas: refs.map((r) => r.id), modelo: MODELO };
}

/* ---------- GUARDARRAÍLES ----------
   Todo lo que devuelve la IA pasa por aquí antes de poder mostrarse siquiera.
   Se recorta lo que invade la estructura y se deja constancia del intento.   */
function validarPropuesta(j, plan, biblio) {
  const avisos = [];
  const ids = new Set((biblio || []).map((r) => r.id));

  const decisiones = (Array.isArray(j.decisiones) ? j.decisiones : []).map((d) => {
    const refs = (Array.isArray(d.refs) ? d.refs : []).filter((x) => {
      if (ids.has(x)) return true;
      avisos.push('Cita descartada: la referencia "' + x + '" no existe en tu biblioteca.');
      return false;
    });
    const texto = ((d.t || "") + " " + (d.p || "")).toLowerCase();
    const invade = CAMPOS_BLOQUEADOS.some((c) => new RegExp("(sub|baj|ampl|reduc|elimin|cambi)\\w*\\s+(el\\s+|la\\s+|los\\s+|las\\s+)?" + c).test(texto));
    if (invade) avisos.push('Propuesta marcada: "' + (d.t || "").slice(0, 60) + '" parece tocar la estructura de seguridad. Se muestra como texto, no altera ningún número.');
    return { id: uid(), t: String(d.t || "").slice(0, 160), p: String(d.p || "").slice(0, 600), refs,
      confianza: ["alta", "media", "baja"].includes(d.confianza) ? d.confianza : "media",
      sinRespaldo: !refs.length, invade, estado: "pendiente" };
  }).filter((d) => d.t && d.p);

  const adaptaciones = (Array.isArray(j.adaptaciones) ? j.adaptaciones : [])
    .map((a) => ({ id: uid(), z: String(a.z || "").slice(0, 80), a: String(a.a || "").slice(0, 400), estado: "pendiente" }))
    .filter((a) => a.z && a.a);

  const ajustes = (Array.isArray(j.ajustes) ? j.ajustes : []).filter((a) => {
    if (AJUSTES_PERMITIDOS.includes(a.campo)) return true;
    avisos.push('Ajuste rechazado: "' + a.campo + '" no está entre los campos que la IA puede tocar.');
    return false;
  }).map((a) => ({ id: uid(), campo: a.campo, valor: String(a.valor || "").slice(0, 200), motivo: String(a.motivo || "").slice(0, 200), estado: "pendiente" }));

  const sinRespaldo = (Array.isArray(j.sin_respaldo) ? j.sin_respaldo : []).map((x) => String(x).slice(0, 300));
  if (!decisiones.length) avisos.push("La IA no devolvió ninguna decisión utilizable. Se mantienen las deterministas.");

  return { decisiones, adaptaciones, ajustes, sinRespaldo, avisos };
}

/* Decisiones que se muestran y que van al coach: las deterministas de siempre
   más las propuestas por IA que TÚ has aceptado. Nunca se sustituyen solas.  */
function decisionesActivas(plan) {
  const base = (plan.decisiones || []).map((d) => ({ ...d, fuente: "motor" }));
  const ia = ((plan.ia && plan.ia.decisiones) || []).filter((d) => d.estado === "aceptada").map((d) => ({ ...d, fuente: "ia" }));
  return [...base, ...ia];
}
function adaptacionesActivas(plan) {
  const base = (plan.adaptaciones || []).map((a) => ({ ...a, fuente: "motor" }));
  const ia = ((plan.ia && plan.ia.adaptaciones) || []).filter((a) => a.estado === "aceptada").map((a) => ({ ...a, fuente: "ia" }));
  return [...base, ...ia];
}

/* ============================================================
   IMPORTACIÓN DE PDF
   ============================================================ */
const PDFJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
let _pdfjs = null;

function cargarPdfJs() {
  if (_pdfjs) return Promise.resolve(_pdfjs);
  if (window.pdfjsLib) { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; _pdfjs = window.pdfjsLib; return Promise.resolve(_pdfjs); }
  return new Promise((res, rej) => {
    const sc = document.createElement("script");
    sc.src = PDFJS_URL;
    sc.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; _pdfjs = window.pdfjsLib; res(_pdfjs); };
    sc.onerror = () => rej(new Error("No se pudo cargar pdf.js desde la CDN"));
    document.head.appendChild(sc);
  });
}

/* Extrae texto en el navegador. Se limita a las primeras páginas y a un tope
   de caracteres: un artículo completo no cabe en el prompt y tampoco hace
   falta — el resumen, métodos y discusión suelen bastar para clasificarlo.  */
async function extraerTextoPDF(file, { maxPags = 14, maxChars = 55000, onProgreso } = {}) {
  const pdfjs = await cargarPdfJs();
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const n = Math.min(doc.numPages, maxPags);
  let out = "";
  for (let i = 1; i <= n; i++) {
    if (onProgreso) onProgreso(i, n);
    const pag = await doc.getPage(i);
    const c = await pag.getTextContent();
    out += c.items.map((it) => it.str).join(" ") + "\n\n";
    if (out.length > maxChars) break;
  }
  return { texto: out.slice(0, maxChars), paginas: doc.numPages, leidas: n };
}

const SYS_PDF = `Extraes los metadatos de un artículo científico y, sobre todo, decides para qué sirve en la práctica.

Devuelves SOLO un objeto JSON:
{
  "autores": "Apellido, N. y cols.",
  "anio": 2023,
  "titulo": "título en español si el original está en inglés, manteniendo el sentido técnico",
  "fuente": "revista y tipo de estudio (ECA, meta-análisis, revisión, estudio observacional, preprint…)",
  "doi": "doi si aparece en el texto, cadena vacía si no",
  "tema": "una sola palabra o dos de esta lista si encaja: Rendimiento, Volumen, Lesiones, Concurrente, Fuerza, Hipertrofia, Detraining, Carga, Progresión, Monitorización, Taper, Nutrición, Recuperación, Sueño, Biomecánica, Calzado",
  "tags": ["5-10 palabras clave en español, en minúscula, que usará un buscador interno"],
  "grado": "fuerte|moderada|débil|práctica",
  "poblacion": "en quién se estudió: n, sexo, edad, nivel de entrenamiento",
  "resumenIA": "qué encontró el estudio, 2-3 frases, con las cifras concretas si las da",
  "limites": "por qué NO se puede generalizar: tamaño de muestra, diseño, población, conflictos de interés",
  "aplicacion": "qué decisión concreta de entrenamiento justifica y con qué límites. Esto es lo más importante: escríbelo como una instrucción accionable, no como un resumen"
}

CRITERIO DE GRADO
- fuerte: meta-análisis o revisión sistemática de ECA, o varios ECA concordantes
- moderada: un ECA bien hecho, o estudios observacionales consistentes
- débil: estudio pequeño, preprint, transversal, o resultados contradictorios
- práctica: artículo de posición, opinión de expertos o descripción de práctica habitual sin datos

REGLAS
- Si un dato no aparece en el texto, cadena vacía. NO inventes DOI, año ni autores.
- Si el texto está incompleto o cortado, trabaja con lo que hay y dilo en "limites".
- En "aplicacion" no repitas el resumen: escribe qué haría un entrenador distinto por haber leído esto.`;

async function analizarPDF(texto, nombreArchivo) {
  const txt = await llamarIA({ system: SYS_PDF, max_tokens: 1600,
    messages: [{ role: "user", content: "Archivo: " + nombreArchivo + "\n\nTEXTO EXTRAÍDO:\n" + texto }] });
  const j = extraerJSON(txt);
  return normRef({ ...j, origen: "pdf", archivo: nombreArchivo, revisado: false });
}

/* ============================================================
   ALMACENAMIENTO MULTIPERFIL
   ============================================================ */
const KEY_PREFIX = "hybridcoach:v3";
const emptyProfile = (nombre) => ({ id: uid(), nombre: nombre || "Nuevo perfil", creado: iso(new Date()), perfil: { nombre: nombre || "" }, plan: null, weeks: {}, running: [], strength: [], checkins: [], recovery: [], changes: [], chat: [], rutinas: {}, ejercicios: {}, comidas: null });
const EMPTY = { v: 3, activo: null, perfiles: {}, biblio: BIBLIO_SEED, config: { sheetsUrl: "", lastSync: null, iaPlan: true } };

/* Almacenamiento. En claude.ai existe window.storage; fuera de ahí no, así que
   se usa localStorage. Misma interfaz asíncrona para no tocar el resto.      */
const store = {
  async get(k) {
    if (typeof window !== "undefined" && window.storage) return window.storage.get(k);
    const v = localStorage.getItem(k);
    return v === null ? null : { value: v };
  },
  async set(k, v) {
    if (typeof window !== "undefined" && window.storage) return window.storage.set(k, v);
    localStorage.setItem(k, v);
    return true;
  },
};

function emptyStateForProfile(profile) {
  const p = emptyProfile(profile?.nombre || "");
  if (profile?.id) p.id = profile.id;
  return { ...EMPTY, activo: p.id, perfiles: { [p.id]: p } };
}

async function loadState(key, profile) {
  const prep = (s) => { if (!s.biblio || !s.biblio.length) s.biblio = BIBLIO_SEED; s.biblio = s.biblio.map(normRef); return { ...EMPTY, ...s, config: { ...EMPTY.config, ...(s.config || {}) } }; };
  try { const r = await store.get(key); if (r) return prep(JSON.parse(r.value)); } catch { }
  try {
    const response = await fetch("/api/sync-state", { credentials: "same-origin" });
    const data = response.ok ? await response.json() : null;
    const remote = data?.snapshot?.profile;
    if (remote && typeof remote === "object") {
      const fallback = emptyProfile(profile?.nombre || remote.nombre || "");
      const id = profile?.id || remote.id || fallback.id;
      const restored = {
        ...fallback,
        ...remote,
        id,
        nombre: remote.nombre || profile?.nombre || fallback.nombre,
        perfil: { ...fallback.perfil, ...(remote.perfil || {}) },
      };
      const hydrated = prep({ ...EMPTY, activo: id, perfiles: { [id]: restored } });
      await saveState(key, hydrated);
      return hydrated;
    }
  } catch { }
  return prep(emptyStateForProfile(profile));
}
async function saveState(key, s) { try { await store.set(key, JSON.stringify(s)); return true; } catch { return false; } }
async function cargarBibliografiaAPI() {
  const documents = [];
  let page = 1;
  let total = Infinity;
  while (documents.length < total) {
    const response = await fetch(`/api/documents?page=${page}&pageSize=100`, { credentials: "same-origin" });
    if (!response.ok) throw new Error(`Biblioteca API: HTTP ${response.status}`);
    const data = await response.json();
    const batch = Array.isArray(data.documents) ? data.documents : [];
    documents.push(...batch);
    total = Number(data.total) || documents.length;
    if (!batch.length) break;
    page += 1;
  }
  return documents.map(documentoDesdeAPI).map(normRef);
}
async function pushToSheets(url, sheet, rows, perfil) {
  if (!url) return { ok: false, msg: "Sin URL de Apps Script configurada" };
  try {
    const propio = url.startsWith("/");
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": propio ? "application/json" : "text/plain;charset=utf-8" }, body: JSON.stringify({ action: "append", sheet, rows, perfil }) });
    const j = await r.json(); return { ok: !!j.ok, msg: j.message || "" };
  } catch (e) { return { ok: false, msg: "No se pudo conectar: " + e.message }; }
}

/* Respaldo de rutinas y ejercicios propios en Google Sheets.
   Son un ESTADO, no un historial: el backend sustituye las filas de este perfil
   en vez de acumular. Se dispara al editar; si no hay hoja configurada, no hace
   nada y la app sigue funcionando igual.                                      */
async function respaldarRutinas(st, P) {
  const url = (st.config && st.config.sheetsUrl) || "/api/sheets";
  if (!url || !P || !P.plan) return;
  const cat = catalogoEj(P);
  const equip = P.perfil.equipamiento === "Gimnasio completo" ? "full" : P.perfil.equipamiento === "En casa (peso corporal y gomas)" ? "casa" : "basico";
  const filas = [];
  (P.plan.gymCodes || []).forEach((code) => {
    const r = (P.rutinas || {})[code];
    const ej = r ? r.ej : gymSession(P.plan, P.perfil, 1, code, P).ej;
    ej.forEach((e, i) => filas.push({ perfil: P.nombre, sesion: code, orden: i + 1, ejercicio_id: e.pat,
      ejercicio: e.n || exName(e.pat, equip, cat), grupo: (cat[e.pat] || {}).g || "", series: e.s, reps: e.r,
      rir: e.rir, prioritario: e.key ? "sí" : "", incremento_kg: (cat[e.pat] || {}).inc || "", nota: e.nota || "",
      origen: r ? "editada" : "generada" }));
  });
  await pushToSheets(url, "Rutinas", filas, P.nombre);
  const props = Object.entries(P.ejercicios || {}).map(([id, v]) => ({ id, perfil: P.nombre, nombre: v.full,
    grupo: v.g, incremento_kg: v.inc, creado: iso(new Date()) }));
  await pushToSheets(url, "Ejercicios_Propios", props, P.nombre);
}

/* ============================================================
   APP
   ============================================================ */
export default function HybridCoach({ user, activeProfile, onLogout }) {
  const [st, setSt] = useState(null);
  const [tab, setTab] = useState("hoy");
  const [pantalla, setPantalla] = useState(null); // wizard | perfiles | biblio | ajustes
  const [today] = useState(() => iso(new Date()));
  const [toast, setToast] = useState(null);
  const stateKey = `${KEY_PREFIX}:${user.id}`;
  const syncRef = useRef(null);
  if (!syncRef.current && typeof window !== "undefined") {
    syncRef.current = createSyncController({ storage: window.localStorage, fetchImpl: window.fetch.bind(window) });
  }

  useEffect(() => {
    let active = true;
    loadState(stateKey, activeProfile).then(async (localState) => {
      if (!active) return;
      setSt(localState);
      try {
        const biblio = await cargarBibliografiaAPI();
        if (active && biblio.length) setSt((current) => current ? { ...current, biblio } : current);
      } catch {
        // Sin sesión, sin red o antes del seed: se conserva la copia local intacta.
      }
    });
    return () => { active = false; };
  }, [stateKey, activeProfile?.id]);
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(null), 2800); return () => clearTimeout(t); } }, [toast]);
  useEffect(() => {
    const sync = syncRef.current;
    if (!sync) return undefined;
    const flush = () => { void sync.flush(); };
    window.addEventListener("online", flush);
    window.addEventListener("visibilitychange", flush);
    const timer = window.setInterval(flush, 30000);
    flush();
    return () => { window.removeEventListener("online", flush); window.removeEventListener("visibilitychange", flush); window.clearInterval(timer); };
  }, []);
  useEffect(() => {
    if (st && syncRef.current) void syncRef.current.reportDaily(st).catch(() => {});
  }, [st]);

  const update = (fn) => setSt((prev) => {
    const next = fn(JSON.parse(JSON.stringify(prev)));
    saveState(stateKey, next); // La escritura local sigue siendo inmediata y autoritativa durante 3b.
    syncRef.current?.enqueue(next);
    void syncRef.current?.flush();
    return next;
  });
  const notify = (m) => setToast(m);

  if (!st) return (<div className="hc"><style>{CSS}</style><div className="wrap" style={{ paddingTop: 60 }}><p className="eyebrow">Cargando…</p></div></div>);

  const P = st.perfiles[st.activo];
  const ctx = { st, P, update, notify, today, setTab, setPantalla, tab, onLogout, user };

  if (!P) return (<div className="hc"><style>{CSS}</style><div className="wrap"><Bienvenida {...ctx} /></div></div>);
  if (pantalla === "wizard" || !P.plan) return (<div className="hc"><style>{CSS}</style><div className="wrap"><Wizard {...ctx} onClose={() => setPantalla(null)} /></div>{toast && <Toast m={toast} />}</div>);

  const wk = weekOf(P.plan, today);
  const full = { ...ctx, wk, curW: wk.w };

  return (
    <div className="hc">
      <style>{CSS}</style>
      <div className="wrap">
        <div className="topbar">
          <button className="pill" onClick={() => setPantalla("perfiles")}>
            <span className="av">{(P.nombre || "?").slice(0, 1).toUpperCase()}</span>
            <span>{P.nombre}</span><span className="muted xs">▾</span>
          </button>
          <div className="row" style={{ gap: 6 }}>
            <button className="icobtn" title="Nutrición" onClick={() => setPantalla("nutricion")}>◐</button>
            <button className="icobtn" title="Mis rutinas" onClick={() => setPantalla("rutinas")}>≡</button>
            <button className="icobtn" title="Bibliografía" onClick={() => setPantalla("biblio")}>◈</button>
            <button className="icobtn" title="Ajustes" onClick={() => setPantalla("ajustes")}>⚙</button>
            <button className="icobtn" title="Cerrar sesión" onClick={onLogout}>↪</button>
          </div>
        </div>
        {pantalla === "perfiles" ? <Perfiles {...full} onClose={() => setPantalla(null)} />
          : pantalla === "biblio" ? <Biblioteca {...full} onClose={() => setPantalla(null)} />
          : pantalla === "rutinas" ? <EditorRutinas {...full} onClose={() => setPantalla(null)} />
          : pantalla === "nutricion" ? <Nutricion {...full} onClose={() => setPantalla(null)} />
          : pantalla === "ajustes" ? <Ajustes {...full} onClose={() => setPantalla(null)} />
          : (<>
            {tab === "hoy" && <Today {...full} />}
            {tab === "semana" && <Semana {...full} />}
            {tab === "entrenar" && <Entrenar {...full} />}
            {tab === "coach" && <Coach {...full} />}
            {tab === "progreso" && <Progreso {...full} />}
          </>)}
      </div>
      {toast && <Toast m={toast} />}
      <nav className="nav">
        {[["hoy", "◉", "Hoy"], ["semana", "▤", "Semana"], ["entrenar", "▶", "Entrenar"], ["coach", "◍", "Coach"], ["progreso", "◢", "Progreso"]].map(([k, i, l]) => (
          <button key={k} className={tab === k && !pantalla ? "on" : ""} onClick={() => { setTab(k); setPantalla(null); }}><span className="ic">{i}</span>{l}</button>
        ))}
      </nav>
    </div>
  );
}
const Toast = ({ m }) => (<div style={{ position: "fixed", bottom: 88, left: 16, right: 16, maxWidth: 528, margin: "0 auto", background: "var(--surf2)", border: "1px solid var(--line)", borderRadius: 10, padding: "11px 14px", zIndex: 60 }} className="sm">{m}</div>);

function Bienvenida({ update, setPantalla }) {
  const crear = () => { const p = emptyProfile(""); update((s) => { s.perfiles[p.id] = p; s.activo = p.id; return s; }); setPantalla("wizard"); };
  return (
    <div style={{ paddingTop: 70 }}>
      <p className="eyebrow">Entrenador híbrido · carrera + fuerza</p>
      <h1 style={{ fontSize: 40, lineHeight: .95, marginTop: 6 }}>Hybrid<br />Coach</h1>
      <p className="sm muted" style={{ marginTop: 14 }}>Construye un plan de carrera y gimnasio a partir de tu perfil real: tu carrera objetivo, tus lesiones, tu material y los días que puedes entrenar. Cada decisión queda justificada y enlazada a la evidencia en la que se apoya.</p>
      <div style={{ height: 16 }} />
      <button className="btn primary" onClick={crear}>Crear mi perfil</button>
    </div>
  );
}

/* ============================================================
   CUESTIONARIO
   ============================================================ */
function Pregunta({ q, val, set }) {
  const v = val;
  const inp = (t = "text") => <input type={t} value={v ?? ""} onChange={(e) => set(q.k, t === "number" ? e.target.value : e.target.value)} placeholder={q.ph || ""} />;
  return (
    <div className="q">
      <label style={{ marginBottom: 7 }}>{q.l} {q.req ? <span className="req">·</span> : <span className="muted" style={{ textTransform: "none", letterSpacing: 0 }}>(opcional)</span>} {q.unit ? <span className="muted">· {q.unit}</span> : null}</label>
      {q.t === "text" && inp()}
      {q.t === "num" && inp("number")}
      {q.t === "date" && inp("date")}
      {q.t === "textarea" && <textarea rows="2" value={v ?? ""} onChange={(e) => set(q.k, e.target.value)} placeholder={q.ph || ""} style={{ fontFamily: "'IBM Plex Sans',sans-serif" }} />}
      {q.t === "choice" && <div style={{ display: "grid", gap: 7 }}>{q.opts.map((o) => <button key={o} className={"chip" + (v === o ? " on" : "")} style={{ textAlign: "left", padding: "10px 12px" }} onClick={() => set(q.k, o)}>{o}</button>)}</div>}
      {q.t === "multi" && <div style={{ display: "grid", gap: 7 }}>{q.opts.map((o) => { const arr = v || []; const on = arr.includes(o);
        return <button key={o} className={"chip" + (on ? " on" : "")} style={{ textAlign: "left", padding: "10px 12px" }} onClick={() => set(q.k, on ? arr.filter((x) => x !== o) : [...arr, o])}>{on ? "✓ " : ""}{o}</button>; })}</div>}
      {q.t === "slider" && (<><div className="mono" style={{ fontSize: 19 }}>{v ?? q.min}/{q.max}</div><input type="range" min={q.min} max={q.max} value={v ?? q.min} onChange={(e) => set(q.k, +e.target.value)} /></>)}
      {q.t === "dias" && <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 6 }}>{DSHORT.map((d, i) => { const arr = v || []; const on = arr.includes(i);
        return <button key={i} className={"chip" + (on ? " on" : "")} onClick={() => set(q.k, on ? arr.filter((x) => x !== i) : [...arr, i].sort((a, b) => a - b))}>{d}</button>; })}</div>}
      {q.t === "rank" && (<div>{(v || q.opts).map((o, i) => (
        <div className="row" key={o} style={{ marginBottom: 6 }}>
          <span className="mono muted" style={{ width: 18 }}>{i + 1}</span>
          <div style={{ flex: 1, background: "var(--surf2)", border: "1px solid var(--line)", borderRadius: 8, padding: "9px 11px" }} className="sm">{o}</div>
          <button className="icobtn" disabled={i === 0} onClick={() => { const a = [...(v || q.opts)]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; set(q.k, a); }}>▲</button>
          <button className="icobtn" disabled={i === (v || q.opts).length - 1} onClick={() => { const a = [...(v || q.opts)]; [a[i + 1], a[i]] = [a[i], a[i + 1]]; set(q.k, a); }}>▼</button>
        </div>))}</div>)}
      {q.t === "cargas" && <div className="grid2">{CARGAS_LIFTS.map((l) => (
        <div key={l}><label>{l}</label><input type="number" placeholder="kg" value={(v || {})[l] ?? ""} onChange={(e) => set(q.k, { ...(v || {}), [l]: e.target.value })} /></div>))}</div>}
      {q.t === "lesiones" && <ListaLesiones val={v || []} onChange={(x) => set(q.k, x)} />}
      {q.t === "molestias" && <ListaMolestias val={v || []} onChange={(x) => set(q.k, x)} />}
      {q.why && <p className="xs muted" style={{ margin: "7px 0 0" }}>{q.why}</p>}
    </div>
  );
}

function ListaLesiones({ val, onChange }) {
  const add = () => onChange([...val, { id: uid(), zona: ZONAS[0], cuando: "", recurrente: false }]);
  const upd = (id, k, v) => onChange(val.map((l) => (l.id === id ? { ...l, [k]: v } : l)));
  return (<div>
    {val.map((l) => (
      <div key={l.id} style={{ border: "1px solid var(--line)", borderRadius: 9, padding: 10, marginBottom: 8 }}>
        <select value={l.zona} onChange={(e) => upd(l.id, "zona", e.target.value)}>{ZONAS.map((z) => <option key={z}>{z}</option>)}</select>
        <div style={{ height: 7 }} />
        <input value={l.cuando} onChange={(e) => upd(l.id, "cuando", e.target.value)} placeholder="¿Cuándo? p. ej. 2023, jugando a balonmano" style={{ fontFamily: "'IBM Plex Sans',sans-serif", fontSize: 14 }} />
        <div className="between" style={{ marginTop: 8 }}>
          <button className={"chip" + (l.recurrente ? " on" : "")} style={{ flex: 1 }} onClick={() => upd(l.id, "recurrente", !l.recurrente)}>{l.recurrente ? "✓ Recurrente" : "¿Es recurrente?"}</button>
          <button className="btn danger sm" onClick={() => onChange(val.filter((x) => x.id !== l.id))}>Quitar</button>
        </div>
      </div>))}
    <button className="btn ghost sm" style={{ width: "100%" }} onClick={add}>+ Añadir lesión</button>
  </div>);
}
function ListaMolestias({ val, onChange }) {
  const add = () => onChange([...val, { id: uid(), zona: ZONAS[0], intensidad: 3, cuando: "Al empezar, desaparece al calentar" }]);
  const upd = (id, k, v) => onChange(val.map((l) => (l.id === id ? { ...l, [k]: v } : l)));
  return (<div>
    {val.map((m) => (
      <div key={m.id} style={{ border: "1px solid var(--line)", borderRadius: 9, padding: 10, marginBottom: 8 }}>
        <select value={m.zona} onChange={(e) => upd(m.id, "zona", e.target.value)}>{ZONAS.map((z) => <option key={z}>{z}</option>)}</select>
        <label style={{ margin: "9px 0 3px" }}>Intensidad: <span className="mono">{m.intensidad}/10</span></label>
        <input type="range" min="0" max="10" value={m.intensidad} onChange={(e) => upd(m.id, "intensidad", +e.target.value)} />
        <select value={m.cuando} onChange={(e) => upd(m.id, "cuando", e.target.value)}>
          {["Al empezar, desaparece al calentar", "Durante todo el ejercicio", "Solo después", "Al día siguiente", "También en reposo"].map((o) => <option key={o}>{o}</option>)}
        </select>
        {(m.cuando === "También en reposo" || m.intensidad >= 5) && <p className="xs" style={{ color: "var(--alert)", marginBottom: 0 }}>Dolor en reposo o ≥5/10 no es fatiga normal. Consúltalo con un profesional sanitario antes de empezar el plan.</p>}
        <button className="btn danger sm" style={{ marginTop: 8 }} onClick={() => onChange(val.filter((x) => x.id !== m.id))}>Quitar</button>
      </div>))}
    <button className="btn ghost sm" style={{ width: "100%" }} onClick={add}>+ Añadir molestia actual</button>
  </div>);
}

function Wizard({ st, P, update, notify, today, onClose, setTab, onLogout }) {
  const [paso, setPaso] = useState(0);
  const [f, setF] = useState(P.perfil || {});
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const sec = WIZARD[paso];
  const comp = completeness(f);
  const faltanAqui = sec.preguntas.filter((q) => q.req && (f[q.k] === undefined || f[q.k] === "" || (Array.isArray(f[q.k]) && !f[q.k].length)));
  const ultimo = paso === WIZARD.length - 1;
  const banderas = (f.banderas || []).filter((b) => b !== "Ninguna");

  const guardar = () => {
    if (comp.pct < 100) return notify("Faltan " + comp.faltan.length + " respuestas necesarias: " + comp.faltan.slice(0, 3).map((q) => q.l).join(", "));
    const plan = buildPlan(f, today);
    update((s) => { const p = s.perfiles[P.id]; p.perfil = f; p.nombre = f.nombre || "Perfil"; p.plan = plan; p.weeks = {}; 
      p.changes.push({ fecha: today, semana: 0, plan_original: "—", cambio: "Plan generado: " + plan.totalSemanas + " semanas hasta " + f.distancia, motivo: "Perfil completado", datos: "riesgo " + plan.riesgo.score + "/10" }); return s; });
    notify("Plan generado: " + plan.totalSemanas + " semanas.");
    onClose && onClose(); setTab && setTab("hoy");
  };

  return (
    <div style={{ paddingTop: 18 }}>
      <div className="between">
        <div><p className="eyebrow" style={{ margin: 0 }}>Paso {sec.icon} de {String(WIZARD.length).padStart(2, "0")}</p><h1 style={{ marginTop: 2 }}>{sec.titulo}</h1></div>
        <button className="btn sm ghost" onClick={P.plan ? onClose : onLogout}>{P.plan ? "Salir" : "Cerrar sesión"}</button>
      </div>
      <div className="prog" style={{ margin: "12px 0 4px" }}><span style={{ width: comp.pct + "%" }} /></div>
      <p className="xs muted">{comp.pct}% del perfil completo · {comp.faltan.length} respuestas necesarias pendientes</p>

      <div className="card">
        {sec.preguntas.map((q) => <Pregunta key={q.k} q={q} val={f[q.k]} set={set} />)}
      </div>

      {sec.id === "salud" && banderas.length > 0 && (
        <div className="card" style={{ borderColor: "#7A3A36" }}>
          <span className="tag alert">Antes de empezar</span>
          <p className="sm" style={{ marginBottom: 0, marginTop: 8 }}>Has marcado: {banderas.join(", ").toLowerCase()}. Consulta con tu médico antes de iniciar un programa de entrenamiento. El plan se generará igualmente, pero no empieces sin esa valoración: esta aplicación organiza entrenamiento, no valora tu salud.</p>
        </div>
      )}
      {sec.id === "dispo" && (f.dias || []).length > 0 && (
        <div className="card">
          <span className="eyebrow">Con {(f.dias || []).length} días</span>
          <p className="sm" style={{ marginBottom: 0, marginTop: 6 }}>{(() => { const m = splitDays((f.dias || []).length, f.prioridad); return m.run + " sesiones de carrera y " + m.gym + " de gimnasio por semana, más al menos un día de descanso completo."; })()}</p>
        </div>
      )}

      {faltanAqui.length > 0 && <p className="xs" style={{ color: "var(--gym)" }}>Pendiente en este paso: {faltanAqui.map((q) => q.l).join(", ")}.</p>}
      <div className="row" style={{ marginBottom: 20 }}>
        <button className="btn ghost" disabled={paso === 0} onClick={() => { setPaso(paso - 1); window.scrollTo(0, 0); }}>Atrás</button>
        {ultimo ? <button className="btn primary" onClick={guardar}>Generar mi plan</button>
                : <button className="btn primary" onClick={() => { setPaso(paso + 1); window.scrollTo(0, 0); }}>Siguiente</button>}
      </div>
    </div>
  );
}

/* ============================================================
   COMPONENTES COMPARTIDOS
   ============================================================ */
function Strip({ assign, todayIdx, onPick }) {
  const maxT = Math.max(...assign.map((a) => a.dur || 0), 60);
  return (<div className="strip">{DSHORT.map((d, i) => {
    const s = assign.find((a) => a.day === i);
    const h = s ? Math.max(14, ((s.dur || 25) / maxT) * 100) : 8;
    const c = s ? colorOf(s.code) : "rest";
    const col = c === "run" ? "var(--run)" : c === "gym" ? "var(--gym)" : "var(--rest)";
    return (<button key={i} className={"col" + (i === todayIdx ? " today" : "")} onClick={() => onPick && onPick(i)} aria-label={DAYS[i] + ": " + (s ? s.code : "descanso")}>
      <div className="bar" style={{ height: h + "%", background: col, opacity: s ? 1 : .35 }} /><span className="lbl">{d}</span></button>);
  })}</div>);
}
function SessionCard({ plan, perfil, code, w, compact, P }) {
  const det = sessionDetail(plan, perfil, w, code, P);
  return (<div>
    <div className="row" style={{ marginBottom: 6 }}>
      <span className={"tag " + colorOf(code)}>{code}</span>
      <strong className="disp" style={{ fontSize: 19 }}>{det.titulo}</strong>
      <span className="mono muted sm" style={{ marginLeft: "auto" }}>{det.dur ? det.dur + "′" : ""}</span>
    </div>
    {!compact && <p className="sm" style={{ margin: 0 }}>{det.desc}</p>}
  </div>);
}
const Metric = ({ l, v, alert }) => (<div style={{ background: "var(--ink)", border: "1px solid var(--line)", borderRadius: 9, padding: "9px 6px", textAlign: "center" }}>
  <div className="mono" style={{ fontSize: 20, color: alert ? "var(--alert)" : "var(--paper)" }}>{v}</div>
  <div className="xs muted" style={{ textTransform: "uppercase", letterSpacing: ".07em" }}>{l}</div></div>);

const doiHref = (doi) => doi ? (/^https?:\/\//i.test(doi) ? doi : `https://doi.org/${String(doi).replace(/^doi:\s*/i, "")}`) : null;
const citationAuthor = (c) => String(c.autores || c.titulo || "Referencia").split(",")[0];

function EvidenceModal({ citation, onClose }) {
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState("");
  useEffect(() => {
    const key = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  const abrirPDF = async () => {
    const tab = window.open("about:blank", "_blank");
    if (tab) tab.opener = null;
    setPdfBusy(true); setPdfError("");
    try {
      const response = await fetch(`/api/evidence/chunks/${encodeURIComponent(citation.chunkId)}/pdf-url`, { credentials: "same-origin" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || `HTTP ${response.status}`);
      const page = citation.paginaInicio ? `#page=${citation.paginaInicio}` : "";
      if (tab) tab.location.replace(data.url + page);
      else window.location.assign(data.url + page);
    } catch (error) {
      tab?.close(); setPdfError(error.message || "No se pudo abrir el PDF.");
    } finally { setPdfBusy(false); }
  };

  const pagina = citation.paginaInicio
    ? `${citation.paginaInicio}${citation.paginaFin && citation.paginaFin !== citation.paginaInicio ? `–${citation.paginaFin}` : ""}`
    : "No indicada";
  const score = citation.similarityScore !== null && citation.similarityScore !== undefined && Number.isFinite(Number(citation.similarityScore))
    ? Number(citation.similarityScore).toFixed(3) : null;
  return (<div className="evidence-overlay" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <section className="evidence-modal" role="dialog" aria-modal="true" aria-label="Evidencia citada">
      <div className="between" style={{ alignItems: "flex-start" }}>
        <div style={{ flex: 1 }}><span className={"tag " + (citation.relleno ? "" : "evid")}>{citation.relleno ? "Cita de relleno" : "Cita directa"}</span>
          <h2 style={{ marginTop: 8 }}>{citation.titulo || "Referencia bibliográfica"}</h2></div>
        <button className="btn ghost sm" onClick={onClose} aria-label="Cerrar evidencia">Cerrar</button>
      </div>
      <p className="sm muted" style={{ marginBottom: 4 }}>{citation.autores || "Autor no indicado"}{citation.anio ? ` · ${citation.anio}` : ""}</p>
      <p className="xs muted" style={{ marginTop: 0 }}>{citation.seccion || "Sección no indicada"} · pág. {pagina}</p>

      {citation.relleno && <div className="card" style={{ borderColor: "var(--gym)", marginTop: 10 }}><span className="tag gym">Relación indirecta</span>
        <p className="xs" style={{ margin: "6px 0 0" }}>Este fragmento completó el contexto, pero no superó el umbral de relevancia. No debe leerse como respaldo fuerte.</p></div>}
      {citation.origen === "semilla" && <div className="card" style={{ borderColor: "var(--alert)", marginTop: 10 }}><span className="tag alert">Referencia semilla</span>
        <p className="xs" style={{ margin: "6px 0 0" }}>Esta ficha procede de la biblioteca inicial. Comprueba la fuente original antes de usarla para una decisión sensible.</p></div>}

      <div className="evidence-quote">{citation.texto || "Esta referencia heredada no tiene un fragmento textual asociado."}</div>
      <div className="card flat" style={{ marginBottom: 8 }}>
        <p className="xs" style={{ margin: "0 0 5px" }}><strong>Tipo de estudio:</strong> {citation.studyType || "No indicado"} · <strong>Grado de evidencia:</strong> {citation.evidenceGrade || "No indicado"}</p>
        <p className="xs" style={{ margin: "0 0 5px" }}><strong>Población:</strong> {citation.poblacion || citation.populationType || "No indicada"}{citation.sampleSize ? ` · n=${citation.sampleSize}` : ""}</p>
        {score && <p className="xs muted" style={{ margin: 0 }}><strong>Relevancia:</strong> {score} ({citation.scoreType || "score no identificado"}). La relevancia no equivale al grado de evidencia.</p>}
      </div>
      <div className="row" style={{ flexWrap: "wrap" }}>
        {citation.doi && <a className="btn ghost sm" href={doiHref(citation.doi)} target="_blank" rel="noreferrer">Abrir DOI</a>}
        {citation.hasPdf && citation.chunkId && <button className="btn primary sm" disabled={pdfBusy} onClick={abrirPDF}>{pdfBusy ? "Firmando enlace…" : "Ver PDF original"}</button>}
      </div>
      {pdfError && <p className="xs" style={{ color: "var(--alert)" }}>{pdfError}</p>}
    </section>
  </div>);
}

function RefChips({ citas, ids, biblio = [], onOpen }) {
  const [active, setActive] = useState(null);
  const resolved = (citas && citas.length) ? citas : (ids || []).map((id) => {
    const ref = biblio.find((item) => item.id === id);
    return ref ? { ...ref, chunkId: null, texto: null, hasPdf: false } : null;
  }).filter(Boolean);
  return (<>
    <div className="row" style={{ flexWrap: "wrap", gap: 5, marginTop: 6 }}>
      {resolved.map((citation, index) => <button key={citation.chunkId || citation.id || index}
        className={"tag " + (citation.relleno ? "" : "evid")}
        title={citation.relleno ? "Cita indirecta: no superó el umbral de relevancia" : "Ver fragmento y metadatos"}
        style={{ cursor: "pointer", borderStyle: citation.relleno ? "dashed" : "solid", opacity: citation.relleno ? .78 : 1 }}
        onClick={() => { if (!citas?.length && onOpen) onOpen(citation); else setActive(citation); }}>
        {citationAuthor(citation)} {citation.anio || "s.f."}{citation.relleno ? " · indirecta" : ""}
      </button>)}
    </div>
    {active && <EvidenceModal citation={active} onClose={() => setActive(null)} />}
  </>);
}

/* ============================================================
   HOY
   ============================================================ */
function Today({ st, P, curW, today, wk, setTab, setPantalla }) {
  const plan = P.plan, perfil = P.perfil;
  const wdata = P.weeks[curW];
  const assign = (wdata?.assign || []).map((a) => ({ ...a, dur: sessionDetail(plan, perfil, curW, a.code, P).dur }));
  const todaySes = assign.find((a) => a.day === wk.dayIdx && !wk.fuera);
  const sp = semanaPlan(plan, curW);
  const dias = daysBetween(today, perfil.fechaCarrera);
  const lastCk = P.checkins[P.checkins.length - 1];
  const dolorReciente = P.checkins.slice(-5).some((c) => c.dolor >= 3);
  const done = wdata?.done || [];

  return (<div>
    <div className="between" style={{ alignItems: "flex-start", marginTop: 8 }}>
      <div><p className="eyebrow" style={{ margin: 0 }}>{fmtDate(today)}</p><h1 style={{ marginTop: 2 }}>Hoy</h1></div>
      <div style={{ textAlign: "right" }}>
        <div className="mono" style={{ fontSize: 30, lineHeight: 1, color: "var(--gym)" }}>{dias > 0 ? dias : 0}</div>
        <p className="eyebrow" style={{ margin: 0 }}>días · {perfil.distancia}</p></div>
    </div>
    <p className="eyebrow" style={{ marginTop: 12 }}>Semana {curW} de {plan.totalSemanas} · {sp.fase}</p>
    <Strip assign={assign} todayIdx={wk.fuera ? -1 : wk.dayIdx} onPick={() => setTab("semana")} />

    {sp.cp && <div className="card" style={{ borderColor: "#7A5730" }}><span className="tag gym">Checkpoint</span><p className="sm" style={{ margin: "7px 0 0" }}>{sp.cp}</p></div>}

    {!wdata && (<div className="card"><h3>Sin semana generada</h3>
      <p className="sm muted">Dime qué días puedes entrenar y reparto las sesiones respetando las reglas de separación entre fuerza y carrera.</p>
      <button className="btn primary" onClick={() => setTab("semana")}>Planificar la semana {curW}</button></div>)}

    {wdata && !todaySes && (<div className="card"><span className="tag">Descanso</span>
      <p style={{ margin: "8px 0 0" }}>Hoy no toca entrenar. El descanso es parte del plan: es cuando se produce la adaptación.</p></div>)}

    {todaySes && (<div className="card" style={{ borderColor: colorOf(todaySes.code) === "run" ? "#2F6A66" : "#7A5730" }}>
      <SessionCard P={P} plan={plan} perfil={perfil} code={todaySes.code} w={curW} />
      <div style={{ height: 12 }} />
      {done.includes(todaySes.code)
        ? <div className="row"><span className="tag ok">Completado</span><span className="sm muted">Registrado</span></div>
        : (<><button className={"btn " + (colorOf(todaySes.code) === "run" ? "run" : "primary")} onClick={() => setTab("entrenar")}>Empezar entrenamiento</button>
           <div style={{ height: 8 }} /><button className="btn ghost" onClick={() => setTab("entrenar")}>Registrar entrenamiento</button></>)}
    </div>)}

    <NutricionHoy st={st} P={P} curW={curW} wk={wk} setPantalla={setPantalla} />

    <div className="card">
      <div className="between"><h3>Cómo estás</h3><button className="btn sm ghost" onClick={() => setTab("entrenar")}>Registrar</button></div>
      {lastCk ? (<div className="grid3" style={{ marginTop: 10 }}>
        <Metric l="RPE última" v={lastCk.rpe ?? "—"} /><Metric l="Dolor" v={lastCk.dolor ?? 0} alert={lastCk.dolor >= 3} /><Metric l="Energía" v={(lastCk.energia ?? "—") + "/5"} />
      </div>) : <p className="sm muted" style={{ margin: 0 }}>Aún no hay sensaciones registradas. Después de entrenar tardas 20 segundos.</p>}
      {dolorReciente && <p className="xs" style={{ color: "var(--alert)", margin: "10px 0 0" }}>Dolor ≥3/10 registrado estos días. Si aparece al empezar a correr y no cede al calentar, párate y consúltalo con un profesional sanitario.</p>}
    </div>

    <div className="card">
      <div className="between"><h3>En qué se basa tu plan</h3><button className="btn sm ghost" onClick={() => setPantalla("biblio")}>Ver base</button></div>
      <p className="sm muted" style={{ margin: "8px 0 0" }}>{plan.decisiones.length} decisiones documentadas · riesgo estructural estimado {plan.riesgo.score}/10{plan.riesgo.causas.length ? " (" + plan.riesgo.causas[0] + ")" : ""}.</p>
    </div>
    <p className="xs muted" style={{ textAlign: "center", padding: "4px 0 12px" }}>{sp.nota}</p>
  </div>);
}

/* ============================================================
   MI SEMANA
   ============================================================ */
function Semana({ st, P, curW, wk, update, notify, setTab, today }) {
  const plan = P.plan, perfil = P.perfil;
  const [w, setW] = useState(curW);
  const saved = P.weeks[w];
  const [sel, setSel] = useState(saved ? saved.assign.map((a) => a.day) : (perfil.dias || [0, 1, 3, 4, 6]));
  const [gym, setGym] = useState(true), [correr, setCorrer] = useState(true);
  const [dolor, setDolor] = useState(0), [fatiga, setFatiga] = useState(3);
  const [draft, setDraft] = useState(null);
  useEffect(() => { setSel(P.weeks[w] ? P.weeks[w].assign.map((a) => a.day) : (perfil.dias || [0, 1, 3, 4, 6])); setDraft(null); }, [w]);

  const gen = () => { if (!sel.length) return notify("Marca al menos un día disponible.");
    setDraft(generateWeek(plan, perfil, w, [...sel].sort((a, b) => a - b), { gym, correr, dolor, fatiga })); };
  const accept = () => {
    update((s) => { const p = s.perfiles[P.id];
      p.weeks[w] = { assign: draft.assign, done: p.weeks[w]?.done || [], notes: draft.notes, generated: today };
      p.changes.push({ fecha: today, semana: w, plan_original: "—", cambio: "Semana generada: " + draft.assign.map((a) => DSHORT[a.day] + "=" + a.code).join(" "), motivo: "Días disponibles " + sel.map((d) => DSHORT[d]).join(""), datos: "dolor " + dolor + "/10, fatiga " + fatiga + "/10" });
      return s; });
    notify("Semana " + w + " guardada."); setDraft(null); if (w === curW) setTab("hoy");
  };
  const shown = draft ? draft.assign : (saved?.assign || []);
  const sp = semanaPlan(plan, w);

  return (<div>
    <p className="eyebrow" style={{ marginTop: 8 }}>Planificador</p><h1>Mi semana</h1>
    <div className="row" style={{ margin: "10px 0 4px" }}>
      <button className="btn sm ghost" disabled={w <= 1} onClick={() => setW(w - 1)}>◀</button>
      <div style={{ flex: 1, textAlign: "center" }}>
        <div className="disp" style={{ fontSize: 20 }}>Semana {w} · {sp.fase}</div>
        <div className="xs muted mono">{sp.inicio} → {addDays(sp.inicio, 6)}</div></div>
      <button className="btn sm ghost" disabled={w >= plan.totalSemanas} onClick={() => setW(w + 1)}>▶</button>
    </div>

    <div className="card">
      <h3>Días que puedo entrenar</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 7, marginTop: 9 }}>
        {DSHORT.map((d, i) => <button key={i} className={"chip" + (sel.includes(i) ? " on" : "")} onClick={() => setSel(sel.includes(i) ? sel.filter((x) => x !== i) : [...sel, i])}>{d}</button>)}
      </div>
      <hr />
      <div className="grid2">
        <div><label>Gimnasio</label><div className="row">{[["Sí", true], ["No", false]].map(([l, v]) => <button key={l} className={"chip" + (gym === v ? " on" : "")} style={{ flex: 1 }} onClick={() => setGym(v)}>{l}</button>)}</div></div>
        <div><label>Puedo correr</label><div className="row">{[["Sí", true], ["No", false]].map(([l, v]) => <button key={l} className={"chip" + (correr === v ? " on run" : "")} style={{ flex: 1 }} onClick={() => setCorrer(v)}>{l}</button>)}</div></div>
      </div>
      <div style={{ height: 10 }} />
      <label>Molestias hoy: <span className="mono">{dolor}/10</span></label>
      <input type="range" min="0" max="10" value={dolor} onChange={(e) => setDolor(+e.target.value)} />
      <label style={{ marginTop: 6 }}>Fatiga general: <span className="mono">{fatiga}/10</span></label>
      <input type="range" min="1" max="10" value={fatiga} onChange={(e) => setFatiga(+e.target.value)} />
      <div style={{ height: 12 }} />
      <button className="btn primary" onClick={gen}>Generar mi semana</button>
    </div>

    {shown.length > 0 && (<div className="card">
      <div className="between"><h3>{draft ? "Propuesta" : "Semana guardada"}</h3>{draft && <span className="tag gym">Sin guardar</span>}</div>
      <Strip assign={shown.map((a) => ({ ...a, dur: sessionDetail(plan, perfil, w, a.code, P).dur }))} todayIdx={w === curW && !wk.fuera ? wk.dayIdx : -1} />
      {DAYS.map((d, i) => { const s = shown.find((a) => a.day === i);
        return (<div className="day" key={i}><div className="dcol eyebrow" style={{ paddingTop: 3 }}>{d.slice(0, 3)}</div>
          <div style={{ flex: 1 }}>
            {s ? <SessionCard P={P} plan={plan} perfil={perfil} code={s.code} w={w} /> : <span className="muted sm">Descanso</span>}
            <NutriLinea P={P} w={w} codes={shown.filter((a) => a.day === i).map((a) => a.code)} />
          </div></div>); })}
      {draft && (<>
        <hr /><h3>Por qué así</h3>
        <ul className="sm" style={{ paddingLeft: 18, margin: "8px 0 0" }}>
          {draft.notes.length ? draft.notes.map((n, i) => <li key={i} style={{ marginBottom: 5 }}>{n}</li>)
            : <li>Reparto estándar: la sesión larga cae en fin de semana, la pierna pesada queda a ≥48 h de ella y no hay dos sesiones de gimnasio seguidas.</li>}
        </ul>
        {draft.violations.length > 0 && (<div style={{ marginTop: 10, border: "1px solid #7A3A36", borderRadius: 9, padding: 10 }}>
          <span className="tag alert">Reglas forzadas</span>
          <ul className="sm" style={{ paddingLeft: 18, margin: "8px 0 0" }}>{draft.violations.map((v, i) => <li key={i}>{v}</li>)}</ul>
          <p className="xs muted" style={{ marginBottom: 0 }}>Con esos días no hay ninguna distribución que las respete todas. Si puedes mover un día, mejora.</p></div>)}
        <div style={{ height: 12 }} />
        <div className="row"><button className="btn primary" onClick={accept}>Aceptar semana</button><button className="btn ghost" onClick={() => setDraft(null)}>Descartar</button></div>
      </>)}
    </div>)}
  </div>);
}

/* ============================================================
   ENTRENAR
   ============================================================ */
function Entrenar(ctx) {
  const { P, curW, wk } = ctx;
  const assign = P.weeks[curW]?.assign || [];
  const todaySes = assign.find((a) => a.day === wk.dayIdx);
  const [mode, setMode] = useState(todaySes ? (esGym(todaySes.code) ? "fuerza" : "carrera") : "carrera");
  const gymCodes = (PLANTILLAS[clamp(P.plan.gymDias, 1, 4)] || PLANTILLAS[2]).map((g) => g.code);
  return (<div>
    <p className="eyebrow" style={{ marginTop: 8 }}>Registro</p><h1>Entrenar</h1>
    <div className="grid3" style={{ margin: "12px 0" }}>
      {[["carrera", "Carrera"], ["fuerza", "Fuerza"], ["check", "Sensaciones"]].map(([k, l]) =>
        <button key={k} className={"chip" + (mode === k ? " on" : "")} onClick={() => setMode(k)}>{l}</button>)}
    </div>
    {mode === "carrera" && <RunForm {...ctx} sug={todaySes && !esGym(todaySes.code) ? todaySes.code : "RUN A"} />}
    {mode === "fuerza" && <StrengthForm {...ctx} codes={gymCodes} sug={todaySes && esGym(todaySes.code) ? todaySes.code : gymCodes[0]} />}
    {mode === "check" && <CheckIn {...ctx} />}
  </div>);
}

function RunForm({ st, P, update, notify, curW, today, sug }) {
  const plan = P.plan, perfil = P.perfil;
  const codes = Object.keys(semanaPlan(plan, curW).runs).concat(["RECOVERY"]);
  const [f, setF] = useState({ code: codes.includes(sug) ? sug : codes[0], km: "", min: "", fcm: "", fcx: "", desnivel: "", cadencia: "", rpe: 4, dolor: 0, notas: "" });
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const pace = f.km > 0 && f.min > 0 ? (() => { const s = (f.min * 60) / f.km; return Math.floor(s / 60) + ":" + String(Math.round(s % 60)).padStart(2, "0"); })() : "—";
  const save = () => {
    if (!f.min) return notify("Falta la duración.");
    const row = { id: Date.now(), date: today, source: "manual", external_id: null, session_code: f.code, semana: curW, distancia_km: +f.km || null, duracion_min: +f.min, ritmo: pace, fc_media: +f.fcm || null, fc_max: +f.fcx || null, desnivel: +f.desnivel || null, cadencia: +f.cadencia || null, rpe: f.rpe, dolor: f.dolor, notas: f.notas };
    update((s) => { const p = s.perfiles[P.id]; p.running.push(row); if (!p.weeks[curW]) p.weeks[curW] = { assign: [], done: [] };
      p.weeks[curW].done = [...new Set([...(p.weeks[curW].done || []), f.code])]; return s; });
    if (st.config.sheetsUrl) pushToSheets(st.config.sheetsUrl, "Running", [{ ...row, perfil: P.nombre }]);
    notify("Carrera registrada."); setF({ ...f, km: "", min: "", notas: "" });
  };
  return (<>
    <div className="card"><SessionCard P={P} plan={plan} perfil={perfil} code={f.code} w={curW} /></div>
    <div className="card">
      <label>Sesión</label>
      <select value={f.code} onChange={(e) => set("code", e.target.value)}>{codes.map((c) => <option key={c}>{c}</option>)}</select>
      <div style={{ height: 10 }} />
      <div className="grid2">
        <div><label>Distancia (km)</label><input inputMode="decimal" value={f.km} onChange={(e) => set("km", e.target.value)} placeholder="6,2" /></div>
        <div><label>Duración (min)</label><input inputMode="numeric" value={f.min} onChange={(e) => set("min", e.target.value)} placeholder="35" /></div>
        <div><label>FC media</label><input inputMode="numeric" value={f.fcm} onChange={(e) => set("fcm", e.target.value)} /></div>
        <div><label>FC máx</label><input inputMode="numeric" value={f.fcx} onChange={(e) => set("fcx", e.target.value)} /></div>
        <div><label>Desnivel (m)</label><input inputMode="numeric" value={f.desnivel} onChange={(e) => set("desnivel", e.target.value)} /></div>
        <div><label>Cadencia</label><input inputMode="numeric" value={f.cadencia} onChange={(e) => set("cadencia", e.target.value)} /></div>
      </div>
      <div className="between" style={{ marginTop: 10 }}><span className="eyebrow">Ritmo medio</span><span className="mono" style={{ fontSize: 19 }}>{pace} /km</span></div>
      <hr />
      <label>RPE: <span className="mono">{f.rpe}/10</span></label>
      <input type="range" min="1" max="10" value={f.rpe} onChange={(e) => set("rpe", +e.target.value)} />
      <label style={{ marginTop: 6 }}>Dolor: <span className="mono">{f.dolor}/10</span></label>
      <input type="range" min="0" max="10" value={f.dolor} onChange={(e) => set("dolor", +e.target.value)} />
      {f.dolor >= 4 && <p className="xs" style={{ color: "var(--alert)" }}>Dolor ≥4/10: no encadenes otra sesión de impacto. Si persiste más de 3-4 días o empeora al correr, consúltalo con un fisioterapeuta.</p>}
      <label style={{ marginTop: 8 }}>Notas</label>
      <textarea rows="2" value={f.notas} onChange={(e) => set("notas", e.target.value)} style={{ fontFamily: "'IBM Plex Sans',sans-serif" }} placeholder="Gemelos cargados pero cardiovascularmente cómodo" />
      <div style={{ height: 12 }} />
      <button className="btn run" onClick={save}>Guardar carrera</button>
    </div>
  </>);
}

function StrengthForm({ st, P, update, notify, curW, today, sug, codes, setPantalla }) {
  const plan = P.plan, perfil = P.perfil;
  const [code, setCode] = useState(codes.includes(sug) ? sug : codes[0]);
  const ses = useMemo(() => gymSession(plan, perfil, curW, code, P), [code, curW, P.id, P.rutinas, P.ejercicios]);
  const painFlag = P.checkins.slice(-4).some((c) => c.dolor >= 3) || P.running.slice(-3).some((r) => r.dolor >= 3);
  const [logs, setLogs] = useState({});
  const [open, setOpen] = useState(0);
  const setSet = (ej, i, k, v) => setLogs((p) => ({ ...p, [ej + "|" + i]: { ...(p[ej + "|" + i] || {}), [k]: v } }));
  const save = () => {
    const rows = [];
    ses.ej.forEach((e) => { for (let i = 0; i < e.s; i++) { const d = logs[e.n + "|" + i]; if (d && (d.weight || d.reps))
      rows.push({ id: Date.now() + Math.random(), date: today, semana: curW, session: code, exercise: e.n, set: i + 1, weight: +d.weight || 0, reps: +d.reps || 0, rir: d.rir === undefined || d.rir === "" ? null : +d.rir, notes: "" }); } });
    if (!rows.length) return notify("No hay ninguna serie anotada todavía.");
    update((s) => { const p = s.perfiles[P.id]; p.strength.push(...rows); if (!p.weeks[curW]) p.weeks[curW] = { assign: [], done: [] };
      p.weeks[curW].done = [...new Set([...(p.weeks[curW].done || []), code])]; return s; });
    if (st.config.sheetsUrl) pushToSheets(st.config.sheetsUrl, "Fuerza", rows.map((r) => ({ ...r, perfil: P.nombre })), P.nombre);
    notify(rows.length + " series guardadas."); setLogs({});
  };
  return (<>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(" + codes.length + ",1fr)", gap: 8, marginBottom: 12 }}>
      {codes.map((c) => <button key={c} className={"chip" + (code === c ? " on" : "")} onClick={() => setCode(c)}>{c}</button>)}
    </div>
    <div className="card">
      <SessionCard P={P} plan={plan} perfil={perfil} code={code} w={curW} />
      {ses.fase !== "carga" && <p className="xs" style={{ color: "var(--gym)", margin: "8px 0 0" }}>Fase {ses.fase}: se recortan series, nunca cargas. Mantener la intensidad es lo que preserva fuerza y masa.</p>}
      {painFlag && <p className="xs" style={{ color: "var(--alert)", margin: "8px 0 0" }}>Molestias recientes registradas: hoy no subo cargas en ningún ejercicio.</p>}
      {!!ses.avisos.length && ses.avisos.map((a, i) => <p key={i} className="xs" style={{ color: "var(--alert)", margin: "8px 0 0" }}>{a}</p>)}
      <div className="row" style={{ marginTop: 10 }}>
        {ses.editada && <span className="tag">Rutina tuya</span>}
        <button className="btn ghost sm" style={{ marginLeft: "auto" }} onClick={() => setPantalla && setPantalla("rutinas")}>Editar rutina</button>
      </div>
    </div>
    {ses.ej.map((e, idx) => {
      const sg = suggestLoad(e, P.strength, perfil, painFlag);
      const isOpen = open === idx;
      return (<div className="card" key={e.n + idx} style={{ borderColor: e.key ? "#7A5730" : "var(--line)" }}>
        <button onClick={() => setOpen(isOpen ? -1 : idx)} style={{ background: "none", border: 0, padding: 0, width: "100%", textAlign: "left", color: "inherit", cursor: "pointer" }}>
          <div className="between"><div>
            <div className="disp" style={{ fontSize: 17 }}>{e.n}{e.key ? " ⭐" : ""}</div>
            <div className="xs muted">{e.g} · {e.s} × {e.r} · RIR {e.rir}</div>
          </div><span className="mono muted">{isOpen ? "−" : "+"}</span></div>
        </button>
        {isOpen && (<>
          <div style={{ background: "var(--ink)", border: "1px solid var(--line)", borderRadius: 9, padding: 10, margin: "10px 0" }}>
            <span className="eyebrow">Hoy sugerido</span>
            <div className="mono" style={{ fontSize: 20, color: "var(--gym)" }}>{sg.peso ? sg.peso + " kg" : "—"}</div>
            <p className="xs muted" style={{ margin: "4px 0 0" }}>{sg.msg}</p>
          </div>
          {e.nota && <p className="xs" style={{ color: "var(--gym)", marginTop: -4 }}>{e.nota}</p>}
          {Array.from({ length: e.s }).map((_, i) => (
            <div className="row" key={i} style={{ marginBottom: 7 }}>
              <span className="mono muted xs" style={{ width: 22 }}>S{i + 1}</span>
              <input placeholder="kg" inputMode="decimal" style={{ flex: 1 }} value={logs[e.n + "|" + i]?.weight || ""} onChange={(ev) => setSet(e.n, i, "weight", ev.target.value)} />
              <input placeholder="reps" inputMode="numeric" style={{ flex: 1 }} value={logs[e.n + "|" + i]?.reps || ""} onChange={(ev) => setSet(e.n, i, "reps", ev.target.value)} />
              <input placeholder="RIR" inputMode="numeric" style={{ width: 66 }} value={logs[e.n + "|" + i]?.rir ?? ""} onChange={(ev) => setSet(e.n, i, "rir", ev.target.value)} />
            </div>))}
        </>)}
      </div>);
    })}
    <button className="btn primary" onClick={save}>Guardar sesión</button>
    <div style={{ height: 10 }} />
    <p className="xs muted">Sesión ajustada a tus {perfil.minGym || 70} minutos y a tu equipamiento. Los ejercicios marcados con ⭐ vienen de tu historial de lesiones: no los elimines.</p>
  </>);
}

function CheckIn({ st, P, update, notify, today, curW }) {
  const [c, setC] = useState({ rpe: 5, feel: 2, dolor: 0, loc: "", tipo: "", cuando: "", energia: 3, comentario: "" });
  const [rec, setRec] = useState({ sueno: "", calidad: 3, fatiga: 4, agujetas: 3, estres: 3, motivacion: 4 });
  const s = (k, v) => setC((p) => ({ ...p, [k]: v }));
  const feels = ["😄 Muy bien", "🙂 Bien", "😐 Normal", "😓 Cansado", "🥵 Muy cansado"];
  const save = () => {
    const row = { ...c, date: today, semana: curW, feelTxt: feels[c.feel] };
    const rrow = { ...rec, date: today, sueno: +rec.sueno || null, dolor: c.dolor };
    update((st2) => { const p = st2.perfiles[P.id]; p.checkins.push(row); p.recovery.push(rrow); return st2; });
    if (st.config.sheetsUrl) { pushToSheets(st.config.sheetsUrl, "Feedback", [{ ...row, perfil: P.nombre }]); pushToSheets(st.config.sheetsUrl, "Recovery", [{ ...rrow, perfil: P.nombre }]); }
    notify("Registrado. El coach ya lo tiene en cuenta.");
    setC({ rpe: 5, feel: 2, dolor: 0, loc: "", tipo: "", cuando: "", energia: 3, comentario: "" });
  };
  return (<>
    <div className="card">
      <h3>Después del entrenamiento</h3>
      <label style={{ marginTop: 10 }}>RPE de la sesión: <span className="mono">{c.rpe}/10</span></label>
      <input type="range" min="1" max="10" value={c.rpe} onChange={(e) => s("rpe", +e.target.value)} />
      <label style={{ marginTop: 8 }}>¿Cómo te has sentido?</label>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 6 }}>
        {feels.map((f, i) => <button key={i} className={"chip" + (c.feel === i ? " on" : "")} style={{ fontSize: 18, padding: "8px 0" }} onClick={() => s("feel", i)} title={f}>{f.split(" ")[0]}</button>)}
      </div>
      <label style={{ marginTop: 12 }}>Dolor: <span className="mono">{c.dolor}/10</span></label>
      <input type="range" min="0" max="10" value={c.dolor} onChange={(e) => s("dolor", +e.target.value)} />
      {c.dolor > 0 && (<div style={{ marginTop: 8 }}>
        <div className="grid2">
          <div><label>Localización</label><input value={c.loc} onChange={(e) => s("loc", e.target.value)} placeholder="Sóleo derecho" /></div>
          <div><label>Tipo</label><input value={c.tipo} onChange={(e) => s("tipo", e.target.value)} placeholder="Tirantez / pinchazo" /></div>
        </div>
        <div style={{ height: 8 }} />
        <label>¿Cuándo aparece?</label>
        <select value={c.cuando} onChange={(e) => s("cuando", e.target.value)}>
          <option value="">Elige…</option>{["Al empezar, desaparece al calentar", "Durante toda la sesión", "Solo después", "Al día siguiente", "En reposo"].map((o) => <option key={o}>{o}</option>)}
        </select>
        {(c.cuando === "En reposo" || c.dolor >= 5) && <p className="xs" style={{ color: "var(--alert)" }}>Dolor en reposo o ≥5/10 no es fatiga normal. Detén el impacto y consúltalo con un profesional sanitario. Esta aplicación no diagnostica lesiones.</p>}
      </div>)}
      <label style={{ marginTop: 12 }}>Energía: <span className="mono">{c.energia}/5</span></label>
      <input type="range" min="1" max="5" value={c.energia} onChange={(e) => s("energia", +e.target.value)} />
      <label style={{ marginTop: 8 }}>Comentario</label>
      <textarea rows="2" value={c.comentario} onChange={(e) => s("comentario", e.target.value)} style={{ fontFamily: "'IBM Plex Sans',sans-serif" }} placeholder="Gemelos cargados pero cardiovascularmente cómodo" />
    </div>
    <div className="card">
      <h3>Recuperación <span className="xs muted" style={{ textTransform: "none", letterSpacing: 0 }}>· opcional</span></h3>
      <div className="grid2" style={{ marginTop: 10 }}>
        <div><label>Horas de sueño</label><input inputMode="decimal" value={rec.sueno} onChange={(e) => setRec({ ...rec, sueno: e.target.value })} placeholder="6,5" /></div>
        <div><label>Calidad 1-5</label><input inputMode="numeric" value={rec.calidad} onChange={(e) => setRec({ ...rec, calidad: e.target.value })} /></div>
        <div><label>Fatiga 1-10</label><input inputMode="numeric" value={rec.fatiga} onChange={(e) => setRec({ ...rec, fatiga: e.target.value })} /></div>
        <div><label>Agujetas 1-10</label><input inputMode="numeric" value={rec.agujetas} onChange={(e) => setRec({ ...rec, agujetas: e.target.value })} /></div>
        <div><label>Estrés 1-10</label><input inputMode="numeric" value={rec.estres} onChange={(e) => setRec({ ...rec, estres: e.target.value })} /></div>
        <div><label>Motivación 1-5</label><input inputMode="numeric" value={rec.motivacion} onChange={(e) => setRec({ ...rec, motivacion: e.target.value })} /></div>
      </div>
    </div>
    <button className="btn primary" onClick={save}>Guardar</button>
  </>);
}

/* ============================================================
   COACH
   ============================================================ */
function buildContext(st, P, curW, today, consulta = "") {
  const p = P.perfil, plan = P.plan, sp = semanaPlan(plan, curW);
  const wdata = P.weeks[curW];
  const semana = wdata ? wdata.assign.map((a) => DAYS[a.day] + ": " + a.code + " (" + sessionDetail(plan, p, curW, a.code, P).desc + ")").join("; ") : "sin generar";
  const runs = P.running.slice(-8).map((r) => r.date + " " + r.session_code + " " + (r.distancia_km || "?") + "km/" + r.duracion_min + "min RPE" + r.rpe + " dolor" + r.dolor + (r.notas ? " «" + r.notas + "»" : "")).join(" | ") || "sin registros";
  const lifts = {}; P.strength.slice(-80).forEach((s) => { if (!lifts[s.exercise] || lifts[s.exercise].date < s.date) lifts[s.exercise] = s; });
  const fuerza = Object.values(lifts).map((s) => s.exercise + " " + s.weight + "kg×" + s.reps + " (RIR " + s.rir + ", " + s.date + ")").join(" | ") || "sin registros";
  const ck = P.checkins.slice(-6).map((c) => c.date + " RPE" + c.rpe + " dolor" + c.dolor + (c.loc ? "(" + c.loc + ")" : "") + " energía" + c.energia + (c.comentario ? " «" + c.comentario + "»" : "")).join(" | ") || "sin registros";
  const rec = P.recovery.slice(-6).map((r) => r.date + " sueño" + (r.sueno || "?") + "h fatiga" + r.fatiga).join(" | ") || "sin registros";
  const les = (p.lesiones || []).map((l) => l.zona + (l.recurrente ? " (recurrente)" : "") + (l.cuando ? " — " + l.cuando : "")).join("; ") || "ninguna declarada";
  const mol = (p.molestias || []).map((m) => m.zona + " " + m.intensidad + "/10, " + m.cuando).join("; ") || "ninguna";
  const min7 = P.running.filter((r) => daysBetween(r.date, today) <= 7).reduce((a, r) => a + (r.duracion_min || 0), 0);
  // Con una biblioteca grande no se manda entera: se seleccionan las referencias
  // relevantes para lo que se está preguntando ahora mismo.
  const consultaAmpliada = [consulta, p.distancia, sp.fase, les, mol, (p.prioridad || [])[0]].filter(Boolean).join(" ");
  const refsSel = refsRelevantes(st.biblio, consultaAmpliada, { max: 10, min: 4 });
  const bib = refsPrompt(refsSel);
  let nut = null; try { nut = nutricionDia(st, P, curW, (weekOf(plan, today) || {}).dayIdx || 0); } catch { }
  const decs = decisionesActivas(plan);
  const adaps = adaptacionesActivas(plan);

  return `Eres el entrenador personal de ${p.nombre}. Hablas SIEMPRE en español, tuteas, y respondes breve (2-6 frases salvo que pidan detalle).

PERFIL
${p.nombre}, ${p.edad} años, ${p.sexo}, ${p.altura} cm, ${p.peso} kg${p.grasa ? ", " + p.grasa + "% de grasa" : ""}.
Objetivo: ${p.distancia} el ${p.fechaCarrera} — ${p.metaTipo}${p.metaTiempo ? " (" + p.metaTiempo + ")" : ""}.
Prioridades en orden: ${(p.prioridad || []).join(" > ")}.
Corriendo: experiencia ${p.expCarrera}, ${p.kmSemana} km/semana actuales, ${p.sesionesCarrera} sesiones, tirada más larga reciente ${p.tiradaLarga} min, parón: ${p.paron}.
Gimnasio: experiencia ${p.expFuerza}, técnica ${p.tecnica}, equipamiento ${p.equipamiento}, cargas declaradas ${JSON.stringify(p.cargas || {})}.
Lesiones previas: ${les}. Molestias actuales: ${mol}. Particularidades: ${(p.estructural || []).join(", ") || "—"}. ${p.cirugias || ""}
Disponibilidad: ${(p.dias || []).map((d) => DAYS[d]).join(", ")} · ${p.minGym} min de gimnasio, ${p.minRun} min entre semana, ${p.finde} min el fin de semana. Cross-training: ${p.crossTraining}.
Recuperación: ${p.sueno} h de sueño (${p.calidadSueno}), estrés ${p.estres}/10, nutrición ${p.nutricion}, suplementos ${(p.suplementos || []).join(", ") || "ninguno"}, medición ${p.reloj}.

PLAN GENERADO
${plan.totalSemanas} semanas · ${plan.runDias} carreras y ${plan.gymDias} sesiones de gimnasio por semana · tirada larga máxima ${plan.techo} min · taper de ${plan.taper} semana(s).
Riesgo estructural estimado: ${plan.riesgo.score}/10${plan.riesgo.causas.length ? " (" + plan.riesgo.causas.join("; ") + ")" : ""}.
Decisiones del plan y su justificación:
${decs.map((d) => "- " + d.t + ": " + d.p + (d.fuente === "ia" ? " [justificación revisada por " + p.nombre + "]" : "")).join("\n")}
Adaptaciones por lesión: ${adaps.map((a) => a.z + " → " + a.a).join(" | ") || "ninguna"}

ESTADO ACTUAL (${today})
Semana ${curW} de ${plan.totalSemanas} · fase ${sp.fase}. Faltan ${daysBetween(today, p.fechaCarrera)} días. ${sp.cp || ""}
Semana planificada: ${semana}
Últimas carreras: ${runs}
Últimas cargas: ${fuerza}
Check-ins: ${ck}
Recuperación: ${rec}
Últimos 7 días: ${min7} min de carrera.

NUTRICIÓN DE HOY (calculada por el motor, no la recalcules)
${nut ? `Objetivo: ${nut.obj.kcal} kcal · ${nut.obj.prot} g de proteína · ${nut.obj.ch} g de carbohidrato · ${nut.obj.gras} g de grasa · ${nut.obj.fibra} g de fibra · ${nut.obj.agua} L de líquido.
Metabolismo basal ${nut.obj.bm.kcal} kcal (${nut.obj.bm.metodo}), gasto base ${nut.obj.base} kcal, gasto de la sesión ${nut.obj.entreno} kcal. Entrena ${MOMENTOS.find((m) => m.k === nut.momento).l.toLowerCase()}.
Tomas de hoy: ${nut.crono.map((t) => t.hora + " → " + t.titulo + ": " + t.que).join(" | ")}
Avisos activos: ${nut.avisos.map((a) => a.t).join("; ") || "ninguno"}${nut.obj.fijado ? "\nATENCIÓN: usa una cifra calórica fijada por él, no la calculada." : ""}${nut.obj.recortado ? "\nATENCIÓN: su objetivo se ha elevado hasta el suelo de seguridad energética." : ""}` : "Sin datos suficientes de peso o perfil."}
${(P.comidas && Object.keys(P.comidas).length) ? "Tiene un catálogo de comidas propio cargado: cita SUS opciones concretas cuando propongas qué comer, en vez de hablar en abstracto. Desayunos: " + (P.comidas.desayuno || []).slice(0, 3).join(" / ") + ". Pre-entreno: " + (P.comidas.pre || []).join(" / ") + "." : "No tiene catálogo de comidas cargado: da cantidades y momentos, no menús cerrados."}

REGLAS DE DISTRIBUCIÓN QUE APLICA EL PLANIFICADOR
R1 ≥48 h entre la sesión de pierna pesada y la tirada larga cuando el gimnasio va antes. R4 nunca dos gimnasios en días consecutivos con solo dos sesiones. R5 mínimo un día de descanso completo. R6 la pierna pesada preferible el día DESPUÉS de la tirada larga. R7 rodaje corto tras el gimnasio menos exigente. R9 el rodaje de calidad no va el día siguiente a la pierna pesada. Si coinciden fuerza y carrera el mismo día: ≥6 h y la modalidad prioritaria primero. Las sesiones perdidas no se recuperan doblando carga.

BASE DE EVIDENCIA SELECCIONADA POR RELEVANCIA (${refsSel.length} de ${st.biblio.length} referencias de su biblioteca)
Cítala como [Autor año] cuando apoyes una recomendación en ella. Fíjate en el campo población: si no se parece a ${p.nombre}, dilo. Si algo que afirmas no está aquí, di explícitamente que es práctica habitual sin respaldo. Si necesitas una referencia que crees que tiene pero no aparece, pídele que la busque en su biblioteca.
${bib}

CÓMO RESPONDES
1. Consulta SIEMPRE los datos de arriba y menciona el dato concreto en el que te apoyas. Si falta el dato, dilo y pídelo.
2. Distingue lo que tiene respaldo de evidencia de lo que es práctica habitual. Si algo no está demostrado, dilo con esas palabras.
3. En nutrición: no diagnosticas intolerancias, alergias ni problemas digestivos, y no interpretas síntomas gastrointestinales. Ante síntomas digestivos persistentes, pérdida de peso involuntaria o dudas sobre disbiosis, derivas a un dietista-nutricionista o a un médico. Nunca propones bajar de las calorías que marca el motor: hay un suelo de seguridad energética y no lo negocias, ni siquiera si te lo pide. Si te pide comer mucho menos, explicas por qué no y le ofreces alternativas que no comprometan la disponibilidad energética.
4. Nunca diagnosticas lesiones. Ante dolor en reposo, dolor que empeora al correr, dolor punzante localizado o hinchazón: recomienda parar el impacto y consultar con un profesional sanitario. La seguridad va por delante de completar el plan.
5. Si propones un cambio concreto de planificación, termina con un bloque exactamente así:
<<CAMBIO>>{"tipo":"mover|sustituir|reducir_volumen|reducir_intensidad|eliminar|descansar","dia":"jueves","de":"RUN B","a":"RUN C","motivo":"frase breve"}<<FIN>>
Solo uno por mensaje y solo si es concreto y accionable.`;
}

function Coach({ st, P, update, curW, today, notify }) {
  const [msgs, setMsgs] = useState(P.chat || []);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);
  const sugerencias = ["Tengo los gemelos cargados desde ayer", "¿A qué ritmo debería correr hoy?", "¿Por qué tengo esta sesión?", "¿Cuánto peso pongo hoy?", "Esta semana solo puedo entrenar tres días", "¿En qué evidencia se basa mi plan?", "¿Qué dice mi bibliografía sobre el sóleo?", "¿Qué como antes del entreno de hoy?"];

  const send = async (text) => {
    const content = (text ?? q).trim(); if (!content || busy) return;
    const next = [...msgs, { role: "user", content }];
    setMsgs(next); setQ(""); setBusy(true);
    try {
      const txt = await llamarIA({ system: buildContext(st, P, curW, today, content), max_tokens: 1000,
        messages: next.slice(-12).map((m) => ({ role: m.role, content: m.content })) });
      let cambio = null, clean = txt;
      const m = txt.match(/<<CAMBIO>>([\s\S]*?)<<FIN>>/);
      if (m) { try { cambio = JSON.parse(m[1].trim()); } catch { } clean = txt.replace(m[0], "").trim(); }
      const final = [...next, { role: "assistant", content: clean, cambio, pendiente: !!cambio }];
      setMsgs(final); update((s) => { s.perfiles[P.id].chat = final.slice(-40); return s; });
    } catch (e) { setMsgs([...next, { role: "assistant", content: "No he podido conectar con el coach: " + e.message + ". Tus datos siguen guardados." }]); }
    finally { setBusy(false); }
  };
  const resolve = (i, accept) => {
    const m = msgs[i];
    const copy = msgs.map((x, j) => (j === i ? { ...x, pendiente: false, aceptado: accept } : x));
    setMsgs(copy);
    update((s) => { const p = s.perfiles[P.id]; p.chat = copy.slice(-40);
      if (accept) p.changes.push({ fecha: today, semana: curW, plan_original: m.cambio.de, cambio: m.cambio.tipo + " → " + (m.cambio.a || "-") + " (" + (m.cambio.dia || "") + ")", motivo: m.cambio.motivo, datos: "Propuesto por el coach desde el historial reciente" });
      return s; });
    notify(accept ? "Cambio aceptado y registrado." : "Cambio rechazado.");
  };

  return (<div style={{ display: "flex", flexDirection: "column", minHeight: "calc(100vh - 140px)" }}>
    <p className="eyebrow" style={{ marginTop: 8 }}>Semana {curW} · {daysBetween(today, P.perfil.fechaCarrera)} días para la carrera</p>
    <h1>Coach</h1>
    <div style={{ flex: 1, marginTop: 12 }}>
      {!msgs.length && (<div className="card flat">
        <p className="sm muted">Conozco tu perfil, tu plan, tus reglas y todo lo que has registrado. También tu bibliografía: en cada respuesta selecciono las referencias relevantes para lo que preguntas.</p>
        {sugerencias.map((s) => <button key={s} className="btn ghost sm" style={{ width: "100%", textAlign: "left", marginBottom: 7, textTransform: "none", fontFamily: "'IBM Plex Sans',sans-serif", letterSpacing: 0 }} onClick={() => send(s)}>{s}</button>)}
      </div>)}
      {msgs.map((m, i) => (<div key={i}>
        <div className={"chatbox" + (m.role === "user" ? " me" : "")}>
          <span className="eyebrow">{m.role === "user" ? "Tú" : "Coach"}</span>
          <p style={{ margin: "5px 0 0", whiteSpace: "pre-wrap" }} className="sm">{m.content}</p>
        </div>
        {m.cambio && (<div className="card" style={{ borderColor: "#7A5730" }}>
          <span className="tag gym">Cambio propuesto</span>
          <p className="sm" style={{ margin: "8px 0" }}><strong>{String(m.cambio.tipo || "").replace("_", " ")}</strong>{m.cambio.dia ? " · " + m.cambio.dia : ""}<br />{m.cambio.de} → {m.cambio.a || "—"}<br /><span className="muted">{m.cambio.motivo}</span></p>
          {m.pendiente ? (<div className="row"><button className="btn primary sm" style={{ flex: 1 }} onClick={() => resolve(i, true)}>Aceptar cambio</button><button className="btn ghost sm" style={{ flex: 1 }} onClick={() => resolve(i, false)}>Rechazar</button></div>)
            : <span className={"tag " + (m.aceptado ? "ok" : "")}>{m.aceptado ? "Aceptado y registrado" : "Rechazado"}</span>}
        </div>)}
      </div>))}
      {busy && <p className="eyebrow">Consultando tu historial…</p>}
      <div ref={endRef} />
    </div>
    <div className="row" style={{ position: "sticky", bottom: 0, background: "var(--ink)", paddingTop: 8 }}>
      <textarea rows="1" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder="Escribe a tu entrenador…" style={{ fontFamily: "'IBM Plex Sans',sans-serif", resize: "none" }} />
      <button className="btn primary" style={{ width: 72 }} onClick={() => send()} disabled={busy}>Enviar</button>
    </div>
  </div>);
}

/* ============================================================
   PROGRESO
   ============================================================ */
function Progreso({ P, curW }) {
  const plan = P.plan;
  const weekly = useMemo(() => {
    const out = [];
    for (let w = 1; w <= Math.max(curW, 1); w++) {
      const sp = semanaPlan(plan, w); const a = sp.inicio, b = addDays(a, 6);
      const rs = P.running.filter((r) => r.date >= a && r.date <= b);
      const done = P.weeks[w]?.done?.length || 0, plans = P.weeks[w]?.assign?.length || 0;
      out.push({ sem: "S" + w, km: +rs.reduce((x, r) => x + (r.distancia_km || 0), 0).toFixed(1), min: rs.reduce((x, r) => x + (r.duracion_min || 0), 0),
        larga: Math.max(0, ...rs.map((r) => r.duracion_min || 0)), prev: sp.runs["RUN A"]?.t || 0, adh: plans ? Math.round((done / plans) * 100) : 0 });
    }
    return out;
  }, [P, curW]);
  const lifts = useMemo(() => {
    const names = [...new Set(P.strength.map((s) => s.exercise))];
    return names.map((n) => { const byDate = {};
      P.strength.filter((s) => s.exercise === n).forEach((s) => { const e = e1rm(s.weight, s.reps); byDate[s.date] = Math.max(byDate[s.date] || 0, e); });
      const serie = Object.keys(byDate).sort().map((d) => ({ d: d.slice(5), v: byDate[d] }));
      return { n, serie, best: serie.length ? Math.max(...serie.map((x) => x.v)) : null, ultimo: serie.length ? serie[serie.length - 1].v : null };
    }).filter((l) => l.serie.length > 1).slice(0, 6);
  }, [P]);
  const rec = P.recovery.slice(-14).map((r) => ({ d: r.date.slice(5), sueno: +r.sueno || null, fatiga: +r.fatiga || null, dolor: +r.dolor || 0 }));
  const ax = { stroke: "#8CA3B8", fontSize: 10, fontFamily: "IBM Plex Mono" };
  const tt = { contentStyle: { background: "#16222F", border: "1px solid #27394C", borderRadius: 8, fontSize: 12 }, labelStyle: { color: "#8CA3B8" } };

  return (<div>
    <p className="eyebrow" style={{ marginTop: 8 }}>Semana {curW} de {plan.totalSemanas}</p><h1>Progreso</h1>
    <div className="grid3" style={{ margin: "14px 0" }}>
      <Metric l="km totales" v={P.running.reduce((a, r) => a + (r.distancia_km || 0), 0).toFixed(0)} />
      <Metric l="min corriendo" v={P.running.reduce((a, r) => a + (r.duracion_min || 0), 0)} />
      <Metric l="series fuerza" v={P.strength.length} />
    </div>
    <div className="card"><h3>Carrera por semana</h3>
      {weekly.some((w) => w.min > 0) ? (<ResponsiveContainer width="100%" height={165}>
        <BarChart data={weekly} margin={{ top: 10, right: 4, left: -22, bottom: 0 }}>
          <CartesianGrid stroke="#27394C" vertical={false} /><XAxis dataKey="sem" tick={ax} axisLine={false} tickLine={false} />
          <YAxis tick={ax} axisLine={false} tickLine={false} /><Tooltip {...tt} />
          <Bar dataKey="min" name="minutos" fill="#4CC9C0" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer>)
        : <p className="sm muted">Registra tu primera carrera y aparecerá la progresión semanal.</p>}
    </div>
    <div className="card"><h3>Tirada larga · prevista y real</h3>
      <ResponsiveContainer width="100%" height={150}>
        <LineChart data={weekly} margin={{ top: 10, right: 4, left: -22, bottom: 0 }}>
          <CartesianGrid stroke="#27394C" vertical={false} /><XAxis dataKey="sem" tick={ax} axisLine={false} tickLine={false} />
          <YAxis tick={ax} axisLine={false} tickLine={false} /><Tooltip {...tt} />
          <Line type="monotone" dataKey="prev" name="prevista" stroke="#5E738A" strokeWidth={2} strokeDasharray="4 3" dot={false} />
          <Line type="monotone" dataKey="larga" name="real" stroke="#F2A65A" strokeWidth={2} dot={{ r: 3 }} /></LineChart></ResponsiveContainer>
      <p className="xs muted" style={{ marginBottom: 0 }}>Techo del plan: {plan.techo} min. No lo superes aunque te encuentres bien.</p>
    </div>
    <div className="card"><h3>Fuerza · 1RM estimado</h3>
      {lifts.length ? lifts.map((l) => (<div key={l.n} style={{ marginBottom: 14 }}>
        <div className="between"><span className="sm">{l.n}</span><span className="mono sm">{l.ultimo} kg <span className="muted xs">máx {l.best}</span></span></div>
        <ResponsiveContainer width="100%" height={70}><LineChart data={l.serie} margin={{ top: 6, right: 4, left: -30, bottom: 0 }}>
          <XAxis dataKey="d" tick={ax} axisLine={false} tickLine={false} /><YAxis tick={ax} axisLine={false} tickLine={false} domain={["auto", "auto"]} />
          <Tooltip {...tt} /><Line type="monotone" dataKey="v" name="1RM est." stroke="#F2A65A" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer>
      </div>)) : <p className="sm muted">Con dos sesiones registradas del mismo ejercicio aparecerá aquí su progresión.</p>}
    </div>
    <div className="card"><h3>Recuperación</h3>
      {rec.length ? (<ResponsiveContainer width="100%" height={150}><LineChart data={rec} margin={{ top: 10, right: 4, left: -22, bottom: 0 }}>
        <CartesianGrid stroke="#27394C" vertical={false} /><XAxis dataKey="d" tick={ax} axisLine={false} tickLine={false} />
        <YAxis tick={ax} axisLine={false} tickLine={false} /><Tooltip {...tt} />
        <Line type="monotone" dataKey="sueno" name="sueño h" stroke="#4CC9C0" strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="fatiga" name="fatiga" stroke="#8CA3B8" strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="dolor" name="dolor" stroke="#E2685F" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer>)
        : <p className="sm muted">Sin registros de recuperación.</p>}
    </div>
    <div className="card"><h3>Adherencia</h3>
      <div style={{ marginTop: 8 }}>{weekly.map((w) => (<div className="row" key={w.sem} style={{ marginBottom: 6 }}>
        <span className="mono xs" style={{ width: 28 }}>{w.sem}</span>
        <div style={{ flex: 1, height: 8, background: "var(--ink)", borderRadius: 4, overflow: "hidden" }}>
          <div style={{ width: w.adh + "%", height: "100%", background: w.adh >= 80 ? "var(--ok)" : w.adh >= 50 ? "var(--gym)" : "var(--alert)" }} /></div>
        <span className="mono xs muted" style={{ width: 34, textAlign: "right" }}>{w.adh}%</span></div>))}</div>
    </div>
    {P.changes.length > 0 && (<div className="card"><h3>Cambios del plan</h3>
      {P.changes.slice(-8).reverse().map((c, i) => (<div key={i} style={{ borderBottom: "1px solid var(--line)", padding: "8px 0" }}>
        <div className="mono xs muted">{c.fecha} · S{c.semana}</div><div className="sm">{c.cambio}</div>
        <div className="xs muted">{c.motivo}{c.datos ? " · " + c.datos : ""}</div></div>))}
    </div>)}
  </div>);
}

/* ============================================================
   PERFILES
   ============================================================ */
function Perfiles({ st, P, update, notify, setPantalla, onClose, today }) {
  const lista = Object.values(st.perfiles);
  const crear = () => { const p = emptyProfile(""); update((s) => { s.perfiles[p.id] = p; s.activo = p.id; return s; }); setPantalla("wizard"); };
  const cambiar = (id) => { update((s) => { s.activo = id; return s; }); onClose(); };
  const [confirmar, setConfirmar] = useState(null);
  const borrar = (id) => { if (confirmar !== id) { setConfirmar(id); return; }
    update((s) => { delete s.perfiles[id]; if (s.activo === id) s.activo = Object.keys(s.perfiles)[0] || null; return s; }); setConfirmar(null); notify("Perfil eliminado."); };
  const duplicar = (id) => { const o = st.perfiles[id]; const n = { ...JSON.parse(JSON.stringify(o)), id: uid(), nombre: o.nombre + " (copia)", running: [], strength: [], checkins: [], recovery: [], changes: [], chat: [], weeks: {} };
    update((s) => { s.perfiles[n.id] = n; return s; }); notify("Perfil duplicado sin historial."); };

  return (<div>
    <div className="between" style={{ marginTop: 8 }}><div><p className="eyebrow" style={{ margin: 0 }}>{lista.length} perfil(es)</p><h1>Perfiles</h1></div>
      <button className="btn sm ghost" onClick={onClose}>Cerrar</button></div>
    {lista.map((p) => {
      const c = completeness(p.perfil);
      const dias = p.perfil.fechaCarrera ? daysBetween(today, p.perfil.fechaCarrera) : null;
      return (<div className="card" key={p.id} style={{ borderColor: p.id === st.activo ? "#7A5730" : "var(--line)" }}>
        <div className="between">
          <div className="row"><span className="av">{(p.nombre || "?").slice(0, 1).toUpperCase()}</span>
            <div><div className="disp" style={{ fontSize: 19 }}>{p.nombre || "Sin nombre"}</div>
              <div className="xs muted">{p.perfil.distancia || "Sin carrera"}{dias !== null ? " · " + (dias > 0 ? dias + " días" : "pasada") : ""} · perfil {c.pct}%</div></div></div>
          {p.id === st.activo && <span className="tag ok">Activo</span>}
        </div>
        {p.plan && <p className="xs muted" style={{ margin: "9px 0 0" }}>{p.plan.totalSemanas} semanas · {p.plan.runDias} carreras + {p.plan.gymDias} gimnasios/semana · riesgo {p.plan.riesgo.score}/10</p>}
        <div className="row" style={{ marginTop: 10, flexWrap: "wrap" }}>
          {p.id !== st.activo && <button className="btn sm" onClick={() => cambiar(p.id)}>Usar</button>}
          {p.id === st.activo && <button className="btn sm" onClick={() => setPantalla("wizard")}>Editar perfil</button>}
          <button className="btn sm ghost" onClick={() => duplicar(p.id)}>Duplicar</button>
          {lista.length > 1 && <button className="btn danger sm" onClick={() => borrar(p.id)}>{confirmar === p.id ? "Confirmar borrado" : "Eliminar"}</button>}
        </div>
      </div>);
    })}
    <button className="btn primary" onClick={crear}>+ Nuevo perfil</button>
    <div style={{ height: 12 }} />
    <p className="xs muted">Cada perfil tiene su propio plan, su historial y su chat. La bibliografía es común a todos.</p>
  </div>);
}

/* ============================================================
   BIBLIOTECA DE EVIDENCIA
   ============================================================ */
const gradoColor = (g) => (g === "fuerte" ? "ok" : g === "moderada" ? "gym" : g === "débil" ? "" : "alert");

function Biblioteca({ st, P, update, notify, onClose }) {
  const [vista, setVista] = useState("plan");
  const [filtro, setFiltro] = useState("Todos");
  const [edit, setEdit] = useState(null);
  const [importando, setImportando] = useState(false);
  const [q, setQ] = useState("");
  /* El rol lo dice el servidor, no el cliente: ocultar la pestaña es comodidad
     de interfaz, la puerta real es requireAdmin en /api/admin/*.            */
  const [esAdmin, setEsAdmin] = useState(false);
  useEffect(() => {
    fetch("/api/auth/me", { credentials: "same-origin" })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => setEsAdmin(d?.user?.role === "admin"))
      .catch(() => setEsAdmin(false));
  }, []);
  const temas = ["Todos", ...new Set(st.biblio.map((b) => b.tema).filter(Boolean))];
  const porRevisar = st.biblio.filter((b) => b.revisado === false).length;

  const lista = useMemo(() => {
    let l = st.biblio.filter((b) => filtro === "Todos" || b.tema === filtro);
    if (q.trim()) return refsRelevantes(l, q, { max: 40, min: 0, umbral: 0.5 });
    return l.sort((a, b) => b.anio - a.anio);
  }, [st.biblio, filtro, q]);

  const guardar = async (r) => {
    try {
      const method = r._dbId ? "PATCH" : "POST";
      const url = r._dbId ? `/api/documents/${encodeURIComponent(r._dbId)}` : "/api/documents";
      const response = await fetch(url, {
        method,
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(documentoParaAPI(r)),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || `HTTP ${response.status}`);
      const ref = normRef(documentoDesdeAPI(data.document));
      update((s) => {
        const i = s.biblio.findIndex((item) => item._dbId === ref._dbId || item.id === ref.id);
        if (i >= 0) s.biblio[i] = ref; else s.biblio.unshift(ref);
        return s;
      });
      notify("Referencia guardada."); setEdit(null);
    } catch (error) {
      notify("No se pudo guardar: " + error.message);
    }
  };
  const borrar = async (id) => {
    const ref = st.biblio.find((item) => item.id === id);
    if (!ref?._dbId) return notify("La referencia aún no existe en Postgres.");
    try {
      const response = await fetch(`/api/documents/${encodeURIComponent(ref._dbId)}`, { method: "DELETE", credentials: "same-origin" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || `HTTP ${response.status}`);
      update((s) => { s.biblio = s.biblio.filter((item) => item._dbId !== ref._dbId); return s; });
      notify("Referencia eliminada."); setEdit(null);
    } catch (error) {
      notify("No se pudo eliminar: " + error.message);
    }
  };

  if (importando) return <ImportarPDF notify={notify} onCancel={() => setImportando(false)}
    onListo={(ref, meta) => { setImportando(false); setEdit({ ...ref, _nuevo: true, _meta: meta }); }} />;
  if (edit) return <EditarRef r={edit} onSave={guardar} onDelete={borrar} onCancel={() => setEdit(null)} />;

  return (<div>
    <div className="between" style={{ marginTop: 8 }}><div><p className="eyebrow" style={{ margin: 0 }}>{st.biblio.length} referencias{porRevisar ? " · " + porRevisar + " sin revisar" : ""}</p><h1>Base de evidencia</h1></div>
      <button className="btn sm ghost" onClick={onClose}>Cerrar</button></div>
    <div className="row" style={{ margin: "12px 0", gap: 6 }}>
      <button className={"chip" + (vista === "plan" ? " on" : "")} style={{ flex: 1 }} onClick={() => setVista("plan")}>Decisiones</button>
      <button className={"chip" + (vista === "refs" ? " on" : "")} style={{ flex: 1 }} onClick={() => setVista("refs")}>Referencias</button>
      <button className={"chip" + (vista === "ia" ? " on" : "")} style={{ flex: 1 }} onClick={() => setVista("ia")}>Razonamiento</button>
      {esAdmin && <button className={"chip" + (vista === "admin" ? " on" : "")} style={{ flex: 1 }} onClick={() => setVista("admin")}>Admin</button>}
    </div>

    {vista === "plan" && (<>
      {P.plan ? (<>
        <div className="card"><h3>Riesgo estructural</h3>
          <div className="row" style={{ marginTop: 8 }}>
            <div className="mono" style={{ fontSize: 30, color: P.plan.riesgo.score >= 6 ? "var(--alert)" : P.plan.riesgo.score >= 3 ? "var(--gym)" : "var(--ok)" }}>{P.plan.riesgo.score}</div>
            <span className="muted">/10</span>
            <p className="sm" style={{ margin: 0, flex: 1 }}>{P.plan.riesgo.causas.length ? P.plan.riesgo.causas.join("; ") + "." : "Sin factores de riesgo declarados."}</p>
          </div>
          <p className="xs muted" style={{ margin: "9px 0 0" }}>Esta puntuación es una heurística de planificación construida a partir de tus respuestas, no un diagnóstico ni una predicción validada de lesión. La calcula el motor: la IA no puede modificarla.</p>
        </div>
        {adaptacionesActivas(P.plan).length > 0 && (<div className="card"><h3>Adaptaciones por tu historial</h3>
          {adaptacionesActivas(P.plan).map((a, i, arr) => (<div key={i} style={{ padding: "9px 0", borderBottom: i < arr.length - 1 ? "1px solid var(--line)" : 0 }}>
            <span className="tag alert">{a.z}</span>{a.fuente === "ia" && <span className="tag" style={{ marginLeft: 5 }}>IA</span>}
            <p className="sm" style={{ margin: "6px 0 0" }}>{a.a}</p></div>))}
        </div>)}
        {decisionesActivas(P.plan).map((d, i) => (<div className="card" key={i}>
          <div className="between"><div className="disp" style={{ fontSize: 17, flex: 1 }}>{d.t}</div>
            {d.fuente === "ia" && <span className="tag">IA</span>}</div>
          <p className="sm muted" style={{ margin: "6px 0 0" }}>{d.p}</p>
          <RefChips ids={d.refs} biblio={st.biblio} onOpen={(r) => setEdit(r)} />
        </div>))}
      </>) : <p className="sm muted">Completa un perfil para ver las decisiones de su plan.</p>}
    </>)}

    {vista === "refs" && (<>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar: sóleo, taper, proteína…" style={{ fontFamily: "'IBM Plex Sans',sans-serif", marginBottom: 8 }} />
      <div className="row" style={{ overflowX: "auto", paddingBottom: 6, marginBottom: 6 }}>
        {temas.map((t) => <button key={t} className={"chip" + (filtro === t ? " on" : "")} style={{ whiteSpace: "nowrap", padding: "7px 11px" }} onClick={() => setFiltro(t)}>{t}</button>)}
      </div>
      <div className="row">
        <button className="btn primary" style={{ flex: 1 }} onClick={() => setImportando(true)}>Importar PDF</button>
        <button className="btn ghost" style={{ flex: 1 }} onClick={() => setEdit(normRef({ _nuevo: true }))}>+ Manual</button>
      </div>
      <div style={{ height: 12 }} />
      {!lista.length && <p className="sm muted">Nada coincide con esa búsqueda.</p>}
      {lista.map((b) => (<div className="card" key={b.id} style={{ borderColor: b.revisado === false ? "var(--alert)" : "var(--line)" }}>
        <div className="between"><span className="mono sm">{b.autores || "Sin autor"} ({b.anio})</span>
          <div className="row" style={{ gap: 4 }}>{b.origen === "pdf" && <span className="tag">PDF</span>}<span className={"tag " + gradoColor(b.grado)}>{b.grado}</span></div></div>
        <p className="sm" style={{ margin: "6px 0 4px" }}>{b.titulo}</p>
        <p className="xs muted" style={{ margin: 0 }}>{b.fuente}{b.tema ? " · " + b.tema : ""}{b.doi ? " · " + b.doi : ""}</p>
        {b.poblacion && <p className="xs muted" style={{ margin: "4px 0 0" }}>Población: {b.poblacion}</p>}
        {b.aplicacion && <p className="xs" style={{ margin: "7px 0 0", color: "var(--evid)" }}>Aplicación: {b.aplicacion}</p>}
        {b.limites && <p className="xs muted" style={{ margin: "5px 0 0" }}>Límites: {b.limites}</p>}
        {b.revisado === false && <p className="xs" style={{ margin: "7px 0 0", color: "var(--alert)" }}>Ficha propuesta por IA, sin revisar.</p>}
        <button className="btn sm ghost" style={{ marginTop: 9 }} onClick={() => setEdit(b)}>Editar</button>
      </div>))}
      <p className="xs muted">Las referencias de partida proceden de tu revisión bibliográfica previa y no llevan DOI. Comprueba autoría, título y DOI antes de citarlas en cualquier trabajo formal: aquí sirven para justificar decisiones de entrenamiento, no como cita académica verificada. Lo mismo vale para las fichas generadas desde PDF: el modelo puede equivocarse leyendo.</p>
    </>)}

    {vista === "ia" && <Razonamiento st={st} P={P} update={update} notify={notify} />}

    {/* Revisar una ficha reutiliza el mismo editor y el mismo guardar() que el
        resto de la biblioteca: guardar marca revisado=true en PostgreSQL.   */}
    {vista === "admin" && esAdmin && <PanelAdmin notify={notify}
      onRevisar={(fila) => setEdit(normRef({ ...documentoDesdeAPI(fila), archivo: fila.storage_key || "" }))} />}
  </div>);
}

/* ============================================================
   NUTRICIÓN — INTERFAZ
   ============================================================ */
const TIPO_TOMA = { pre: { l: "Antes", c: "gym" }, durante: { l: "Durante", c: "run" }, post: { l: "Después", c: "ok" }, base: { l: "Reparto", c: "" }, fibra: { l: "Fibra", c: "" } };

function BarraMacros({ o }) {
  const kp = o.prot * 4, kc = o.ch * 4, kg = o.gras * 9, tot = kp + kc + kg || 1;
  const seg = [["Proteína", kp, "var(--ok)"], ["Carbohidrato", kc, "var(--run)"], ["Grasa", kg, "var(--gym)"]];
  return (<div>
    <div style={{ display: "flex", height: 9, borderRadius: 5, overflow: "hidden", border: "1px solid var(--line)" }}>
      {seg.map(([n, v, c]) => <div key={n} title={n} style={{ width: (v / tot * 100) + "%", background: c }} />)}
    </div>
    <div className="row" style={{ marginTop: 7, gap: 12, flexWrap: "wrap" }}>
      {[["Proteína", o.prot], ["Carbohidrato", o.ch], ["Grasa", o.gras]].map(([n, v], i) => (
        <span key={n} className="xs"><span style={{ color: seg[i][2] }}>■</span> {n} <span className="mono">{v} g</span></span>))}
    </div>
  </div>);
}

/* Tarjeta compacta para la pestaña Hoy */
function NutricionHoy({ st, P, curW, wk, setPantalla }) {
  if (!P.perfil.peso) return null;
  const n = nutricionDia(st, P, curW, wk.fuera ? 0 : wk.dayIdx);
  const graves = n.avisos.filter((a) => a.n === "alta");
  return (<div className="card">
    <div className="between"><h3>Nutrición de hoy</h3>
      <span className="mono sm">{n.obj.kcal} kcal</span></div>
    <p className="xs muted" style={{ margin: "2px 0 9px" }}>
      {n.obj.minutos ? n.obj.minutos + " min de entreno · " + MOMENTOS.find((m) => m.k === n.momento).l.toLowerCase() : "Sin sesión hoy"}
    </p>
    <BarraMacros o={n.obj} />
    <div style={{ height: 12 }} />
    {n.crono.slice(0, 3).map((t) => (<div key={t.id} style={{ borderLeft: "2px solid var(--line)", paddingLeft: 10, marginBottom: 9 }}>
      <div className="row" style={{ gap: 6 }}><span className={"tag " + (TIPO_TOMA[t.tipo] || {}).c}>{(TIPO_TOMA[t.tipo] || {}).l}</span><span className="xs muted">{t.hora}</span></div>
      <p className="sm" style={{ margin: "4px 0 0" }}>{t.que}</p>
    </div>))}
    {graves.map((a, i) => <p key={i} className="xs" style={{ color: "var(--alert)", margin: "6px 0 0" }}>{a.t}: {a.d}</p>)}
    <button className="btn ghost sm" style={{ marginTop: 6 }} onClick={() => setPantalla("nutricion")}>Ver el día completo</button>
  </div>);
}

/* Línea por día dentro del planificador semanal */
function NutriLinea({ P, w, codes }) {
  if (!P.perfil.peso) return null;
  const n = nutriDeCodigos(P, w, codes);
  const pre = n.crono.find((t) => t.tipo === "pre");
  return (<div style={{ marginTop: 6, padding: "7px 9px", background: "var(--ink)", border: "1px solid var(--line)", borderRadius: 8 }}>
    <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
      <span className="mono xs">{n.obj.kcal} kcal</span>
      <span className="xs muted">P {n.obj.prot} · CH {n.obj.ch} · G {n.obj.gras} g</span>
    </div>
    {pre && <p className="xs" style={{ margin: "5px 0 0", color: "var(--evid)" }}>{pre.hora}: {pre.que.slice(0, 95)}{pre.que.length > 95 ? "…" : ""}</p>}
  </div>);
}

function Nutricion({ st, P, update, notify, curW, today, wk, onClose }) {
  const [vista, setVista] = useState("hoy");
  const [dia, setDia] = useState(wk.fuera ? 0 : wk.dayIdx);
  const [cat, setCat] = useState("desayuno");
  const [nuevo, setNuevo] = useState("");
  const cfg = P.nutriConfig || {};
  const comidas = P.comidas || {};
  const n = nutricionDia(st, P, curW, dia);
  const sem = useMemo(() => resumenSemanaNutricion(st, P, curW), [P.id, curW, P.weeks, P.nutriConfig]);

  const setCfg = (k, v) => update((s) => { const pr = s.perfiles[P.id];
    pr.nutriConfig = { ...(pr.nutriConfig || {}), [k]: v }; return s; });
  const addComida = () => { if (!nuevo.trim()) return;
    update((s) => { const pr = s.perfiles[P.id]; if (!pr.comidas) pr.comidas = {};
      pr.comidas[cat] = [...(pr.comidas[cat] || []), nuevo.trim()]; return s; });
    setNuevo(""); notify("Opción añadida."); };
  const delComida = (i) => update((s) => { s.perfiles[P.id].comidas[cat].splice(i, 1); return s; });
  const cargarEjemplo = () => { update((s) => { s.perfiles[P.id].comidas = JSON.parse(JSON.stringify(PLAN_COMIDAS_SEED)); return s; }); notify("Catálogo de ejemplo cargado. Edítalo a tu gusto."); };

  return (<div>
    <div className="between" style={{ marginTop: 8 }}><div><p className="eyebrow" style={{ margin: 0 }}>Semana {curW} · {n.fase}</p><h1>Nutrición</h1></div>
      <button className="btn sm ghost" onClick={onClose}>Cerrar</button></div>

    <div className="row" style={{ margin: "12px 0", gap: 6 }}>
      {[["hoy", "Día"], ["semana", "Semana"], ["plan", "Mi plan"], ["como", "Cómo se calcula"]].map(([k, l]) =>
        <button key={k} className={"chip" + (vista === k ? " on" : "")} style={{ flex: 1 }} onClick={() => setVista(k)}>{l}</button>)}
    </div>

    {/* ---------- DÍA ---------- */}
    {vista === "hoy" && (<>
      <div className="row" style={{ gap: 4, marginBottom: 10 }}>
        {DSHORT.map((d, i) => <button key={i} className={"chip" + (dia === i ? " on" : "")} style={{ flex: 1, padding: "8px 0" }} onClick={() => setDia(i)}>{d}</button>)}
      </div>

      <div className="card">
        <div className="between"><h3>{DAYS[dia]}</h3><span className="mono" style={{ fontSize: 22 }}>{n.obj.kcal}<span className="muted sm"> kcal</span></span></div>
        <p className="xs muted" style={{ margin: "2px 0 10px" }}>
          {n.sesiones.length ? n.sesiones.map((x) => x.code + " (" + x.dur + "′)").join(" + ") + " · " + MOMENTOS.find((m) => m.k === n.momento).l.toLowerCase() : "Día sin entreno"}
        </p>
        <BarraMacros o={n.obj} />
        <div className="grid2" style={{ marginTop: 12, gap: 8 }}>
          <Metric l="Fibra" v={n.obj.fibra + " g"} />
          <Metric l="Líquidos" v={n.obj.agua + " L"} />
        </div>
        {n.obj.fijado && <p className="xs muted" style={{ margin: "9px 0 0" }}>Cifra fijada por ti. El cálculo automático para hoy habría dado {n.obj.calculado} kcal.</p>}
      </div>

      {n.avisos.map((a, i) => (<div className="card" key={i} style={{ borderColor: a.n === "alta" ? "var(--alert)" : "var(--line)" }}>
        <span className={"tag " + (a.n === "alta" ? "alert" : a.n === "media" ? "gym" : "")}>{a.t}</span>
        <p className="sm" style={{ margin: "7px 0 0" }}>{a.d}</p>
      </div>))}

      <span className="eyebrow" style={{ display: "block", margin: "16px 0 8px" }}>Cronograma</span>
      {n.crono.map((t) => (<div className="card" key={t.id}>
        <div className="row" style={{ gap: 7 }}>
          <span className={"tag " + (TIPO_TOMA[t.tipo] || {}).c}>{(TIPO_TOMA[t.tipo] || {}).l}</span>
          <span className="mono xs muted">{t.hora}</span>
        </div>
        <div className="disp" style={{ fontSize: 16, marginTop: 7 }}>{t.titulo}</div>
        <p className="sm" style={{ margin: "5px 0 0" }}>{t.que}</p>
        <p className="xs muted" style={{ margin: "7px 0 0" }}>{t.porque}</p>
        <RefChips ids={t.refs} biblio={st.biblio} onOpen={() => { }} />
        {t.tipo === "pre" && (comidas.pre || []).length > 0 && (
          <p className="xs" style={{ margin: "8px 0 0", color: "var(--evid)" }}>De tu plan: {(comidas.pre || []).join(" · ")}</p>)}
        {(t.tipo === "post" || t.tipo === "base") && (comidas[t.hora.toLowerCase().includes("desayuno") ? "desayuno" : "comida"] || []).length > 0 && (
          <p className="xs" style={{ margin: "8px 0 0", color: "var(--evid)" }}>Ejemplo de tu plan: {(comidas[t.hora.toLowerCase().includes("desayuno") ? "desayuno" : "comida"] || [])[0]}</p>)}
      </div>))}
    </>)}

    {/* ---------- SEMANA ---------- */}
    {vista === "semana" && (<>
      <div className="card">
        <h3>Media de la semana</h3>
        <div className="grid2" style={{ marginTop: 9, gap: 8 }}>
          <Metric l="kcal / día" v={sem.mediaKcal} />
          <Metric l="Proteína" v={sem.mediaProt + " g"} />
          <Metric l="Rango" v={sem.minKcal + "–" + sem.maxKcal} />
          <Metric l="Entreno" v={sem.totalMin + " min"} />
        </div>
        <p className="xs muted" style={{ margin: "10px 0 0" }}>
          Las calorías varían con la sesión del día: la media semanal es lo que importa, no cuadrar cada día por separado.
        </p>
      </div>
      {sem.dias.map((d) => (<div className="card flat" key={d.dia}>
        <div className="between">
          <div><span className="eyebrow" style={{ margin: 0 }}>{DAYS[d.dia]}</span>
            <p className="sm" style={{ margin: "3px 0 0" }}>{d.sesiones}{d.min ? " · " + d.min + "′" : ""}</p></div>
          <div style={{ textAlign: "right" }}><span className="mono">{d.kcal}</span><span className="muted xs"> kcal</span>
            <p className="xs muted" style={{ margin: 0 }}>CH {d.ch} g</p></div>
        </div>
      </div>))}
    </>)}

    {/* ---------- MI PLAN ---------- */}
    {vista === "plan" && (<>
      {!Object.keys(comidas).length ? (<div className="card">
        <h3>Aún no tienes catálogo</h3>
        <p className="sm muted">El módulo funciona igual sin él: te da cantidades y momentos. El catálogo sirve para que las recomendaciones citen tus propias comidas en vez de hablar en abstracto.</p>
        <button className="btn primary" style={{ marginTop: 8 }} onClick={cargarEjemplo}>Cargar un catálogo de ejemplo</button>
        <p className="xs muted" style={{ marginTop: 8 }}>Se carga un plan mediterráneo completo que después editas entero.</p>
      </div>) : (<>
        {comidas.estructura && (<div className="card flat"><span className="eyebrow">Estructura del plato</span>
          <p className="sm" style={{ margin: "5px 0 0" }}>{comidas.estructura}</p>
          {comidas.notas && <p className="xs muted" style={{ margin: "6px 0 0" }}>{comidas.notas}</p>}</div>)}
        <div className="row" style={{ overflowX: "auto", padding: "4px 0 8px" }}>
          {CATEGORIAS_COMIDA.map((c) => <button key={c.k} className={"chip" + (cat === c.k ? " on" : "")} style={{ whiteSpace: "nowrap", padding: "7px 11px" }} onClick={() => setCat(c.k)}>{c.l}</button>)}
        </div>
        <p className="xs muted">{(CATEGORIAS_COMIDA.find((c) => c.k === cat) || {}).ayuda}</p>
        {(comidas[cat] || []).map((x, i) => (<div className="card flat" key={i}>
          <div className="between"><p className="sm" style={{ margin: 0, flex: 1 }}>{x}</p>
            <button className="btn ghost sm" onClick={() => delComida(i)}>Quitar</button></div>
        </div>))}
        <div className="row" style={{ marginTop: 8 }}>
          <textarea rows="1" value={nuevo} onChange={(e) => setNuevo(e.target.value)} placeholder="Añadir opción…" style={{ fontFamily: "'IBM Plex Sans',sans-serif", resize: "none" }} />
          <button className="btn primary" style={{ width: 90 }} onClick={addComida}>Añadir</button>
        </div>
        {!!(comidas.fijos || []).length && (<div className="card" style={{ marginTop: 12 }}><h3>Fijos semanales</h3>
          {comidas.fijos.map((f, i) => <p key={i} className="sm" style={{ margin: "5px 0 0" }}>· {f}</p>)}</div>)}
        {comidas.flexible && (<div className="card flat"><span className="eyebrow">Comida flexible</span>
          <p className="sm" style={{ margin: "5px 0 0" }}>{comidas.flexible}</p></div>)}
      </>)}
    </>)}

    {/* ---------- CÓMO SE CALCULA ---------- */}
    {vista === "como" && (<>
      <div className="card">
        <h3>Tu gasto</h3>
        <p className="sm" style={{ marginTop: 6 }}>Metabolismo basal <span className="mono">{n.obj.bm.kcal} kcal</span> por {n.obj.bm.metodo}
          {n.obj.bm.magra ? ", a partir de " + n.obj.bm.magra + " kg de masa magra" : ""}.</p>
        <p className="sm">Actividad diaria sin entrenar × <span className="mono">{n.obj.neat}</span> → <span className="mono">{n.obj.base} kcal</span>.</p>
        <p className="sm">Al gasto base se le suma el de la sesión del día. Por eso un día de tirada larga y uno de descanso no piden lo mismo.</p>
        <p className="xs muted">El porcentaje de grasa lo estimaste tú: si está mal, el basal se desplaza. Es una estimación, no una medida.</p>
      </div>

      <div className="card">
        <h3>Ajustar a mano</h3>
        <p className="xs muted" style={{ marginTop: 0 }}>Si sigues una pauta de un profesional, fíjala aquí y el módulo respetará tu cifra en vez de la calculada.</p>
        <label>Calorías fijas por día</label>
        <input type="number" value={cfg.kcalFijo || ""} onChange={(e) => setCfg("kcalFijo", e.target.value ? +e.target.value : null)} placeholder={"Automático (" + n.obj.calculado + " hoy)"} />
        <div style={{ height: 9 }} />
        <label>Proteína · g por kg de peso</label>
        <input type="number" step="0.05" value={cfg.protGkg || ""} onChange={(e) => setCfg("protGkg", e.target.value ? +e.target.value : null)} placeholder={"Automático (" + n.obj.gkg + ")"} />
        <p className="xs muted" style={{ marginTop: 8 }}>Hoy sale {n.obj.prot} g. El suelo de seguridad se sigue aplicando aunque fijes una cifra más baja: el módulo la subirá y te avisará.</p>
      </div>

      <div className="card">
        <h3>Lo que este módulo no hace</h3>
        <p className="sm" style={{ marginTop: 6 }}>No diagnostica nada, no trata problemas digestivos ni intolerancias, y no sustituye a un dietista-nutricionista. Si tienes síntomas digestivos persistentes, pérdida de peso involuntaria o cualquier bandera médica, eso lo valora un profesional sanitario antes que una aplicación.</p>
        <p className="sm">Tampoco propone déficits agresivos: hay un suelo calórico por debajo del cual se niega a bajar, aunque se lo pidas.</p>
      </div>

      <span className="eyebrow" style={{ display: "block", margin: "16px 0 8px" }}>Evidencia que sostiene el módulo</span>
      {st.biblio.filter((b) => b.tema === "Nutrición").map((b) => (<div className="card flat" key={b.id}>
        <div className="between"><span className="mono xs">{b.autores.split(",")[0]} {b.anio}</span><span className={"tag " + gradoColor(b.grado)}>{b.grado}</span></div>
        <p className="sm" style={{ margin: "5px 0 0" }}>{b.titulo}</p>
        {b.aplicacion && <p className="xs" style={{ margin: "6px 0 0", color: "var(--evid)" }}>{b.aplicacion}</p>}
        {b.limites && <p className="xs muted" style={{ margin: "5px 0 0" }}>Límites: {b.limites}</p>}
      </div>))}
      <p className="xs muted">Ninguna lleva DOI: proceden de la carga inicial y hay que verificarlas antes de citarlas formalmente. Importa los PDF originales desde la base de evidencia para tener la ficha completa.</p>
    </>)}
  </div>);
}

/* ============================================================
   EDITOR DE RUTINAS DE GIMNASIO
   ============================================================ */
function EditorRutinas({ st, P, update, notify, onClose, curW }) {
  const plan = P.plan, perfil = P.perfil;
  const codes = plan.gymCodes || ["GYM A", "GYM B"];
  const [code, setCode] = useState(codes[0]);
  const [anadir, setAnadir] = useState(false);
  const [nuevoEj, setNuevoEj] = useState(null);
  const cat = catalogoEj(P);
  const equip = perfil.equipamiento === "Gimnasio completo" ? "full" : perfil.equipamiento === "En casa (peso corporal y gomas)" ? "casa" : "basico";

  const rut = (P.rutinas && P.rutinas[code]) || null;
  const vista = gymSession(plan, perfil, curW, code, P);
  const lista = rut ? rut.ej : vista.ej.map((e) => ({ pat: e.pat, s: e.s, r: e.r, rir: e.rir, key: e.key, nota: e.nota }));
  const durEstim = Math.round(lista.reduce((a, e) => a + (+e.s || 0), 0) * 3.2 + 8);

  // Toda edición parte de la rutina que estás viendo: si aún no la habías
  // tocado, se materializa la generada y a partir de ahí es tuya.
  const editar = (fn) => update((s) => {
    const pr = s.perfiles[P.id];
    if (!pr.rutinas) pr.rutinas = {};
    if (!pr.rutinas[code]) pr.rutinas[code] = { code, foco: vista.foco, pesado: vista.pesado, ej: lista.map((e) => ({ ...e })), editada: true };
    fn(pr.rutinas[code], pr);
    pr.rutinas[code].modificada = iso(new Date());
    setTimeout(() => respaldarRutinas(s, pr), 0);   // respaldo silencioso
    return s;
  });

  const mover = (i, d) => editar((r) => { const j = i + d; if (j < 0 || j >= r.ej.length) return;
    const t = r.ej[i]; r.ej[i] = r.ej[j]; r.ej[j] = t; });
  const quitar = (i) => editar((r) => { r.ej.splice(i, 1); });
  const campo = (i, k, v) => editar((r) => { r.ej[i] = { ...r.ej[i], [k]: v }; });
  const meter = (pat) => { editar((r) => { r.ej.push({ pat, s: 3, r: "8-12", rir: "2", key: false }); }); setAnadir(false); notify("Ejercicio añadido."); };
  const restaurar = () => { update((s) => { delete s.perfiles[P.id].rutinas[code]; setTimeout(() => respaldarRutinas(s, s.perfiles[P.id]), 0); return s; }); notify("Rutina restaurada a la generada."); };

  const crearPropio = (f) => {
    const id = "propio_" + uid();
    update((s) => { const pr = s.perfiles[P.id];
      if (!pr.ejercicios) pr.ejercicios = {};
      pr.ejercicios[id] = { g: f.g || "Otro", full: f.n, basico: f.n, casa: f.n, inc: +f.inc || 2.5, propio: true };
      return s; });
    setNuevoEj(null); setTimeout(() => meter(id), 0);
  };

  if (nuevoEj) return <NuevoEjercicio onSave={crearPropio} onCancel={() => setNuevoEj(null)} />;

  if (anadir) {
    const porGrupo = {};
    Object.entries(cat).forEach(([k, v]) => { if (lista.some((e) => e.pat === k)) return;
      (porGrupo[v.g] = porGrupo[v.g] || []).push([k, v]); });
    return (<div>
      <div className="between" style={{ marginTop: 8 }}><h1>Añadir a {code}</h1><button className="btn sm ghost" onClick={() => setAnadir(false)}>Cancelar</button></div>
      <button className="btn primary" onClick={() => setNuevoEj({})}>Crear un ejercicio que no está en la lista</button>
      <div style={{ height: 12 }} />
      {Object.keys(porGrupo).sort().map((g) => (<div className="card" key={g}>
        <span className="eyebrow">{g}</span>
        {porGrupo[g].map(([k, v]) => (<button key={k} className="btn ghost sm" style={{ width: "100%", textAlign: "left", marginTop: 6, textTransform: "none", fontFamily: "'IBM Plex Sans',sans-serif", letterSpacing: 0 }} onClick={() => meter(k)}>
          {v[equip] || v.full}{v.propio ? " · propio" : ""}</button>))}
      </div>))}
    </div>);
  }

  return (<div>
    <div className="between" style={{ marginTop: 8 }}><div><p className="eyebrow" style={{ margin: 0 }}>Semana {curW} · {vista.mod}</p><h1>Mis rutinas</h1></div>
      <button className="btn sm ghost" onClick={onClose}>Cerrar</button></div>

    <div className="row" style={{ margin: "12px 0", gap: 6 }}>
      {codes.map((c) => <button key={c} className={"chip" + (code === c ? " on" : "")} style={{ flex: 1 }} onClick={() => setCode(c)}>{c}{P.rutinas && P.rutinas[c] ? " ·" : ""}</button>)}
    </div>

    <div className="card flat">
      <div className="between"><span className="eyebrow" style={{ margin: 0 }}>{vista.foco}</span>
        <span className={"tag " + (durEstim > (+perfil.minGym || 70) + 5 ? "alert" : "ok")}>{durEstim} min</span></div>
      <p className="xs muted" style={{ margin: "7px 0 0" }}>
        {rut ? "Rutina editada por ti. No se recorta por tiempo: decides tú qué quitar." : "Rutina generada. Al hacer el primer cambio pasa a ser tuya y deja de recortarse automáticamente."}
        {" "}Tienes {perfil.minGym} min. Se estima a 3,2 min por serie contando descansos.
      </p>
    </div>

    {!!vista.avisos.length && (<div className="card" style={{ borderColor: "var(--alert)" }}>
      <span className="tag alert">El motor ha intervenido</span>
      {vista.avisos.map((a, i) => <p key={i} className="sm" style={{ margin: "7px 0 0" }}>{a}</p>)}
      <p className="xs muted" style={{ margin: "8px 0 0" }}>El trabajo derivado de tu historial de lesiones se reañade siempre. Puedes cambiarle series y repeticiones, pero no eliminarlo.</p>
    </div>)}

    {lista.map((e, i) => { const info = cat[e.pat] || {};
      return (<div className="card" key={i}>
        <div className="between">
          <div style={{ flex: 1 }}>
            <div className="disp" style={{ fontSize: 16 }}>{exName(e.pat, equip, cat)}</div>
            <span className="xs muted">{info.g || "—"}{info.propio ? " · propio" : ""}</span>
          </div>
          <div className="row" style={{ gap: 3 }}>
            <button className="icobtn" title="Subir" onClick={() => mover(i, -1)} disabled={i === 0}>↑</button>
            <button className="icobtn" title="Bajar" onClick={() => mover(i, 1)} disabled={i === lista.length - 1}>↓</button>
          </div>
        </div>
        <div className="row" style={{ marginTop: 9, gap: 7 }}>
          <div style={{ flex: 1 }}><label>Series</label><input type="number" min="1" max="8" value={e.s} onChange={(ev) => campo(i, "s", clamp(+ev.target.value || 1, 1, 8))} /></div>
          <div style={{ flex: 1 }}><label>Reps</label><input value={e.r} onChange={(ev) => campo(i, "r", ev.target.value)} placeholder="8-12" /></div>
          <div style={{ flex: 1 }}><label>RIR</label><input value={e.rir} onChange={(ev) => campo(i, "rir", ev.target.value)} placeholder="2" /></div>
        </div>
        <div className="row" style={{ marginTop: 9 }}>
          <button className={"chip" + (e.key ? " on" : "")} style={{ flex: 1 }} onClick={() => campo(i, "key", !e.key)}>{e.key ? "◆ Prioritario" : "Marcar prioritario"}</button>
          <button className="btn danger sm" onClick={() => quitar(i)}>Quitar</button>
        </div>
        {e.nota && <p className="xs" style={{ margin: "8px 0 0", color: "var(--evid)" }}>{e.nota}</p>}
      </div>); })}

    <div className="row" style={{ marginTop: 4 }}>
      <button className="btn primary" style={{ flex: 1 }} onClick={() => setAnadir(true)}>+ Añadir ejercicio</button>
      {rut && <button className="btn ghost" onClick={restaurar}>Restaurar</button>}
    </div>
    <p className="xs muted">Los ejercicios marcados como prioritarios no se tocan cuando el plan entra en fase de mantenimiento: se les recortan series a los demás y a ellos no. Lo que registres se sigue asociando al nombre del ejercicio, así que la progresión de carga se mantiene aunque cambies el orden.</p>
  </div>);
}

function NuevoEjercicio({ onSave, onCancel }) {
  const [f, setF] = useState({ n: "", g: "", inc: 2.5 });
  const s = (k, v) => setF((p) => ({ ...p, [k]: v }));
  return (<div>
    <div className="between" style={{ marginTop: 8 }}><h1>Ejercicio propio</h1><button className="btn sm ghost" onClick={onCancel}>Cancelar</button></div>
    <div className="card">
      <label>Nombre</label>
      <input value={f.n} onChange={(e) => s("n", e.target.value)} placeholder="Peso muerto sumo con trap bar" style={{ fontFamily: "'IBM Plex Sans',sans-serif" }} />
      <div style={{ height: 9 }} /><label>Grupo o función</label>
      <input value={f.g} onChange={(e) => s("g", e.target.value)} placeholder="Isquios/glúteo" style={{ fontFamily: "'IBM Plex Sans',sans-serif" }} />
      <div className="row" style={{ overflowX: "auto", marginTop: 7, paddingBottom: 4 }}>
        {GRUPOS.map((g) => <button key={g} className={"chip" + (f.g === g ? " on" : "")} style={{ whiteSpace: "nowrap", padding: "6px 10px" }} onClick={() => s("g", g)}>{g}</button>)}
      </div>
      <div style={{ height: 9 }} /><label>Incremento de carga · kg</label>
      <input type="number" step="0.5" value={f.inc} onChange={(e) => s("inc", e.target.value)} />
      <p className="xs muted" style={{ marginTop: 7 }}>Cuánto sube el sistema cuando completas todas las series en el tope del rango. 2,5 kg para tren superior, 5 kg para básicos de pierna, 1 kg para trabajo pequeño. Pon 0 si progresas por repeticiones o dificultad en vez de por peso.</p>
    </div>
    <button className="btn primary" onClick={() => f.n.trim() && onSave(f)} disabled={!f.n.trim()}>Crear y añadir a la rutina</button>
  </div>);
}

/* ---------- IMPORTADOR DE PDF ---------- */
function ImportarPDF({ onListo, onCancel, notify }) {
  const [fase, setFase] = useState("elegir");   // elegir | leyendo | analizando | error
  const [prog, setProg] = useState("");
  const [err, setErr] = useState("");
  const inputRef = useRef(null);

  const procesar = async (file) => {
    if (!file) return;
    if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) { setErr("Ese archivo no es un PDF."); setFase("error"); return; }
    try {
      setFase("leyendo"); setProg("Abriendo el documento…");
      const { texto, paginas, leidas } = await extraerTextoPDF(file, { onProgreso: (i, n) => setProg("Leyendo página " + i + " de " + n + "…") });
      if (texto.replace(/\s/g, "").length < 400) throw new Error("Apenas se ha extraído texto. Puede que sea un PDF escaneado como imagen: necesitaría OCR, que esta versión no hace.");
      setFase("analizando"); setProg("Clasificando el estudio y redactando su aplicación práctica…");
      const ref = await analizarPDF(texto, file.name);
      ref.paginas = paginas;
      onListo(ref, { paginas, leidas });
    } catch (e) { setErr(e.message || String(e)); setFase("error"); }
  };

  return (<div>
    <div className="between" style={{ marginTop: 8 }}><h1>Importar PDF</h1><button className="btn sm ghost" onClick={onCancel}>Cancelar</button></div>
    <input ref={inputRef} type="file" accept="application/pdf,.pdf" style={{ display: "none" }} onChange={(e) => procesar(e.target.files && e.target.files[0])} />

    {fase === "elegir" && (<>
      <div className="card">
        <p className="sm" style={{ marginTop: 0 }}>Se lee el texto del PDF en tu propio navegador y se envía solo ese texto para clasificarlo. El archivo no se sube a ningún sitio ni se guarda: lo que queda en la biblioteca es la ficha estructurada.</p>
        <p className="xs muted">Se leen como máximo las primeras 14 páginas. Para un artículo completo suele bastar con resumen, métodos y discusión. Los PDF escaneados como imagen no funcionan: no llevan texto que extraer.</p>
        <button className="btn primary" style={{ marginTop: 10 }} onClick={() => inputRef.current && inputRef.current.click()}>Elegir archivo PDF</button>
      </div>
      <p className="xs muted">Después de analizarlo verás la ficha propuesta para revisarla. Nada entra en la biblioteca sin que tú lo confirmes.</p>
    </>)}

    {(fase === "leyendo" || fase === "analizando") && (<div className="card">
      <span className="eyebrow">{fase === "leyendo" ? "Extrayendo texto" : "Analizando"}</span>
      <p className="sm" style={{ margin: "8px 0 0" }}>{prog}</p>
      {fase === "analizando" && <p className="xs muted">Esto tarda unos segundos.</p>}
    </div>)}

    {fase === "error" && (<div className="card" style={{ borderColor: "var(--alert)" }}>
      <span className="tag alert">No se pudo importar</span>
      <p className="sm" style={{ margin: "8px 0" }}>{err}</p>
      <button className="btn ghost sm" onClick={() => { setErr(""); setFase("elegir"); }}>Probar con otro archivo</button>
    </div>)}
  </div>);
}

/* ---------- REVISIÓN DEL RAZONAMIENTO IA ---------- */
function Razonamiento({ st, P, update, notify }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const ia = (P.plan && P.plan.ia) || null;

  const generar = async () => {
    setBusy(true); setErr("");
    try {
      const response = await fetch("/api/coach/decisiones", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ persistir: true }),
      });
      const r = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(r.message || `HTTP ${response.status}`);
      update((s) => { s.perfiles[P.id].plan.ia = r; return s; });
      notify("Razonamiento generado. Revísalo antes de aplicarlo.");
    } catch (e) { setErr(e.message || String(e)); }
    finally { setBusy(false); }
  };

  const resolver = (tipo, id, estado) => {
    update((s) => { const arr = s.perfiles[P.id].plan.ia[tipo];
      const i = arr.findIndex((x) => x.id === id); if (i >= 0) arr[i].estado = estado; return s; });
  };
  const todas = (tipo, estado) => {
    update((s) => { s.perfiles[P.id].plan.ia[tipo].forEach((x) => { x.estado = estado; }); return s; });
    notify(estado === "aceptada" ? "Todas aceptadas." : "Todas rechazadas.");
  };

  const conf = { alta: "ok", media: "gym", baja: "alert" };

  return (<div>
    <div className="card flat">
      <p className="sm" style={{ marginTop: 0 }}>La estructura del plan —semanas, techo de tirada larga, descargas, riesgo— la calcula el motor y no la toca la IA. Lo que se genera aquí es el <strong>razonamiento</strong>: por qué esa estructura tiene sentido para ti, apoyado en tu biblioteca, y matices que caben dentro de ella.</p>
      <p className="xs muted">Nada se aplica hasta que lo aceptas. Lo aceptado pasa a las decisiones del plan y al contexto del coach.</p>
      <button className="btn primary" onClick={generar} disabled={busy} style={{ marginTop: 8 }}>
        {busy ? "Razonando sobre tu biblioteca…" : ia ? "Regenerar razonamiento" : "Generar razonamiento con IA"}
      </button>
      {st.biblio.length < 5 && <p className="xs muted" style={{ marginTop: 8 }}>Con {st.biblio.length} referencias el razonamiento será pobre. Importa más bibliografía para que tenga de dónde tirar.</p>}
    </div>

    {err && (<div className="card" style={{ borderColor: "var(--alert)" }}>
      <span className="tag alert">Sin conexión con la IA</span>
      <p className="sm" style={{ margin: "8px 0 0" }}>{err}</p>
      <p className="xs muted">Tu plan sigue funcionando con las decisiones deterministas. Comprueba la sesión y la configuración del proveedor de IA.</p>
    </div>)}

    {ia && (<>
      <p className="eyebrow" style={{ marginTop: 16 }}>{ia.generado ? `Generado el ${ia.generado} · ` : ""}{(ia.fragmentosUsados || ia.refsUsadas || []).length} fragmentos consultados</p>

      {!!(ia.avisos || []).length && (<div className="card" style={{ borderColor: "var(--alert)" }}>
        <span className="tag alert">Guardarraíles</span>
        {ia.avisos.map((a, i) => <p key={i} className="xs" style={{ margin: "6px 0 0" }}>{a}</p>)}
      </div>)}

      {!!(ia.decisiones || []).length && (<>
        <div className="between" style={{ margin: "14px 0 6px" }}>
          <span className="eyebrow" style={{ margin: 0 }}>Decisiones propuestas</span>
          <div className="row" style={{ gap: 6 }}>
            <button className="btn sm ghost" onClick={() => todas("decisiones", "aceptada")}>Aceptar todas</button>
            <button className="btn sm ghost" onClick={() => todas("decisiones", "rechazada")}>Rechazar</button>
          </div>
        </div>
        {ia.decisiones.map((d) => (<div className="card" key={d.id} style={{ borderColor: d.estado === "aceptada" ? "var(--ok)" : d.estado === "rechazada" ? "var(--line)" : d.invade ? "var(--alert)" : "var(--line)", opacity: d.estado === "rechazada" ? .5 : 1 }}>
          <div className="between"><div className="disp" style={{ fontSize: 16, flex: 1 }}>{d.t}</div>
            <span className={"tag " + (conf[d.confianza] || "")}>{d.confianza}</span></div>
          <p className="sm muted" style={{ margin: "6px 0 0" }}>{d.p}</p>
          {d.sinRespaldo && <div style={{ marginTop: 8 }}><span className="tag alert">Sin respaldo</span><p className="xs" style={{ margin: "5px 0 0", color: "var(--alert)" }}>No hay ningún fragmento que sostenga esta afirmación.</p></div>}
          {d.invade && <p className="xs" style={{ margin: "7px 0 0", color: "var(--alert)" }}>Roza la estructura de seguridad. Aunque la aceptes, no cambia ningún número del plan.</p>}
          <RefChips citas={d.citas} ids={d.refs} biblio={st.biblio} />
          {d.estado === "pendiente"
            ? (<div className="row" style={{ marginTop: 9 }}>
                <button className="btn primary sm" style={{ flex: 1 }} onClick={() => resolver("decisiones", d.id, "aceptada")}>Aceptar</button>
                <button className="btn ghost sm" style={{ flex: 1 }} onClick={() => resolver("decisiones", d.id, "rechazada")}>Rechazar</button></div>)
            : (<div className="row" style={{ marginTop: 9 }}><span className={"tag " + (d.estado === "aceptada" ? "ok" : "")}>{d.estado === "aceptada" ? "En tu plan" : "Rechazada"}</span>
                <button className="btn ghost sm" onClick={() => resolver("decisiones", d.id, "pendiente")}>Deshacer</button></div>)}
        </div>))}
      </>)}

      {!!(ia.adaptaciones || []).length && (<>
        <span className="eyebrow" style={{ display: "block", margin: "16px 0 6px" }}>Adaptaciones propuestas</span>
        {ia.adaptaciones.map((a) => (<div className="card" key={a.id} style={{ opacity: a.estado === "rechazada" ? .5 : 1 }}>
          <span className="tag alert">{a.z}</span>
          <p className="sm" style={{ margin: "6px 0 0" }}>{a.a}</p>
          {a.estado === "pendiente"
            ? (<div className="row" style={{ marginTop: 9 }}>
                <button className="btn primary sm" style={{ flex: 1 }} onClick={() => resolver("adaptaciones", a.id, "aceptada")}>Aceptar</button>
                <button className="btn ghost sm" style={{ flex: 1 }} onClick={() => resolver("adaptaciones", a.id, "rechazada")}>Rechazar</button></div>)
            : (<div className="row" style={{ marginTop: 9 }}><span className={"tag " + (a.estado === "aceptada" ? "ok" : "")}>{a.estado === "aceptada" ? "En tu plan" : "Rechazada"}</span>
                <button className="btn ghost sm" onClick={() => resolver("adaptaciones", a.id, "pendiente")}>Deshacer</button></div>)}
        </div>))}
      </>)}

      {!!(ia.ajustes || []).length && (<>
        <span className="eyebrow" style={{ display: "block", margin: "16px 0 6px" }}>Matices sugeridos</span>
        {ia.ajustes.map((a) => (<div className="card flat" key={a.id}>
          <span className="mono xs">{a.campo}</span>
          <p className="sm" style={{ margin: "5px 0 0" }}>{a.valor}</p>
          <p className="xs muted" style={{ margin: "4px 0 0" }}>{a.motivo}</p>
        </div>))}
      </>)}

      {!!(ia.evidenciaMixta || []).length && (<>
        <span className="eyebrow" style={{ display: "block", margin: "16px 0 6px" }}>Evidencia mixta</span>
        {ia.evidenciaMixta.map((grupo, indice) => <div className="card" key={`${grupo.tema}-${indice}`} style={{ borderColor: "var(--gym)" }}>
          <div className="between"><h3 style={{ color: "var(--paper)" }}>{grupo.tema}</h3><span className="tag gym">Resultados en conflicto</span></div>
          <p className="xs muted">Los estudios no apuntan en una sola dirección. Se muestran las posiciones por separado, sin promediarlas.</p>
          {(Array.isArray(grupo.posiciones) ? grupo.posiciones : []).map((posicion, posIndex) => <div className="card flat" key={posIndex} style={{ borderColor: "var(--line)", marginTop: 8 }}>
            <span className="tag">Posición {posIndex + 1}</span>
            <p className="sm" style={{ margin: "7px 0 0" }}>{posicion.resumen}</p>
            {posicion.sinRespaldo && <p className="xs" style={{ color: "var(--alert)" }}>Sin respaldo verificable.</p>}
            <RefChips citas={posicion.citas} ids={posicion.refs} biblio={st.biblio} />
          </div>)}
        </div>)}
      </>)}

      {!!(ia.sinRespaldo || []).length && (<div className="card" style={{ marginTop: 14 }}>
        <h3>Declarado sin respaldo</h3>
        <p className="xs muted" style={{ marginTop: 0 }}>La propia IA reconoce que esto es práctica habitual, no evidencia:</p>
        {ia.sinRespaldo.map((x, i) => <p key={i} className="sm" style={{ margin: "6px 0 0" }}>· {x}</p>)}
      </div>)}
    </>)}

    {!ia && !busy && !err && <p className="sm muted">Todavía no has generado razonamiento. El plan funciona igualmente con sus decisiones deterministas.</p>}
  </div>);
}

/* ---------- ADMINISTRACIÓN DE LA BIBLIOTECA (solo rol admin) ----------
   La ingesta de PDF vive en el servidor (docs/roadmap/fase-05-ingesta-pdf.md):
   aquí solo se manda el archivo y se muestra lo que devuelve. El troceado, la
   extracción y la ficha no se calculan en el navegador.                      */
const SECCION_ES = { abstract: "Resumen", introduction: "Introducción", methods: "Métodos", results: "Resultados", discussion: "Discusión", conclusion: "Conclusión", other: "Otras" };

function PanelAdmin({ notify, onRevisar }) {
  const [estado, setEstado] = useState(null);        // { r2, ia, maxBytes }
  const [pendientes, setPendientes] = useState([]);
  const [subiendo, setSubiendo] = useState(false);
  const [ultima, setUltima] = useState(null);        // resultado de la última subida
  const [error, setError] = useState("");
  const [fragmentos, setFragmentos] = useState(null);

  const cargar = async () => {
    try {
      const [e, p] = await Promise.all([
        fetch("/api/admin/storage/estado", { credentials: "same-origin" }).then((r) => r.json()),
        fetch("/api/admin/documents/pending", { credentials: "same-origin" }).then((r) => r.json()),
      ]);
      setEstado(e); setPendientes(p.documents || []);
    } catch { setError("No se pudo consultar el estado de administración."); }
  };
  useEffect(() => { cargar(); }, []);

  const subir = async (file) => {
    if (!file) return;
    setSubiendo(true); setError(""); setUltima(null);
    try {
      /* El PDF va como cuerpo binario, no como formulario: el servidor no
         necesita el nombre del archivo para nada crítico (la clave en R2 sale
         del hash), solo para mostrarlo y para el prompt de la ficha.         */
      const r = await fetch("/api/admin/documents/upload", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/pdf", "X-Nombre-Archivo": encodeURIComponent(file.name) },
        body: file,
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.message || `HTTP ${r.status}`);
      setUltima(data);
      notify(`PDF procesado: ${data.chunks} fragmentos. Revisa la ficha antes de que el coach pueda citarlo.`);
      await cargar();
    } catch (e) { setError(e.message); }
    finally { setSubiendo(false); }
  };

  const verFragmentos = async (doc) => {
    try {
      const r = await fetch(`/api/admin/documents/${encodeURIComponent(doc.id)}/chunks`, { credentials: "same-origin" });
      const data = await r.json();
      setFragmentos({ doc, chunks: data.chunks || [] });
    } catch { notify("No se pudieron cargar los fragmentos."); }
  };

  if (fragmentos) return (<div>
    <div className="between" style={{ marginTop: 8 }}>
      <div><p className="eyebrow" style={{ margin: 0 }}>{fragmentos.chunks.length} fragmentos</p><h1 style={{ fontSize: 22 }}>{fragmentos.doc.titulo || "Sin título"}</h1></div>
      <button className="btn sm ghost" onClick={() => setFragmentos(null)}>Volver</button></div>
    {fragmentos.chunks.map((c) => (<div className="card flat" key={c.id}>
      <div className="between"><span className="tag">{SECCION_ES[c.seccion] || c.seccion}</span>
        <span className="xs muted mono">pág. {c.pagina_inicio}{c.pagina_fin !== c.pagina_inicio ? "-" + c.pagina_fin : ""} · {c.num_tokens} tokens</span></div>
      <p className="xs" style={{ margin: "7px 0 0", whiteSpace: "pre-wrap" }}>{c.texto}</p>
    </div>))}
  </div>);

  return (<div>
    {estado && !estado.r2 && (<div className="card" style={{ borderColor: "var(--alert)" }}>
      <span className="tag alert">Almacenamiento sin configurar</span>
      <p className="sm" style={{ margin: "8px 0 0" }}>Faltan las credenciales de R2 en el servidor. Sin ellas no se puede subir ningún PDF, porque el original hay que conservarlo para poder reprocesar la biblioteca más adelante.</p>
    </div>)}
    {estado && estado.r2 && !estado.ia && (<div className="card" style={{ borderColor: "var(--gym)" }}>
      <p className="sm" style={{ margin: 0 }}>No hay proveedor de IA configurado: los PDF se trocearán igual, pero la ficha habrá que rellenarla a mano.</p>
    </div>)}

    <div className="card">
      <h3>Subir un artículo</h3>
      <p className="xs muted" style={{ margin: "4px 0 10px" }}>
        PDF con capa de texto, hasta {estado ? Math.round(estado.maxBytes / 1024 / 1024) : 50} MB. Los escaneados sin texto se rechazan: este flujo no hace OCR.
      </p>
      <input type="file" accept="application/pdf" disabled={subiendo || (estado && !estado.r2)}
        onChange={(e) => { subir(e.target.files[0]); e.target.value = ""; }} />
      {subiendo && <p className="sm" style={{ marginTop: 10 }}>Extrayendo texto, troceando y clasificando… puede tardar medio minuto.</p>}
      {error && <p className="xs" style={{ color: "var(--alert)", marginTop: 10 }}>{error}</p>}
    </div>

    {ultima && (<div className="card" style={{ borderColor: "var(--ok)" }}>
      <span className="tag ok">Procesado</span>
      <p className="sm" style={{ margin: "8px 0 4px" }}>{ultima.documento.titulo || "Sin título extraído"}</p>
      <p className="xs muted" style={{ margin: 0 }}>
        {ultima.numPaginas} páginas · {ultima.chunks} fragmentos · {Object.entries(ultima.secciones).map(([s, n]) => `${SECCION_ES[s] || s}: ${n}`).join(" · ")}
      </p>
      {ultima.aviso && <p className="xs" style={{ color: "var(--alert)", margin: "8px 0 0" }}>{ultima.aviso}</p>}
    </div>)}

    <div className="between" style={{ margin: "16px 0 8px" }}>
      <h3 style={{ margin: 0 }}>Pendientes de revisión</h3>
      <button className="btn sm ghost" onClick={cargar}>Actualizar</button>
    </div>
    {!pendientes.length && <p className="sm muted">Nada pendiente. Todo lo subido está revisado.</p>}
    {pendientes.map((d) => (<div className="card" key={d.id} style={{ borderColor: "var(--alert)" }}>
      <div className="between"><span className="mono sm">{d.autores || "Sin autor"} ({d.anio || "s. f."})</span>
        <span className="xs muted mono">{d.num_chunks} fragmentos</span></div>
      <p className="sm" style={{ margin: "6px 0 4px" }}>{d.titulo || "Sin título extraído"}</p>
      <p className="xs muted" style={{ margin: 0 }}>{d.fuente_revista || "sin fuente"}{d.doi ? " · " + d.doi : ""}</p>
      <p className="xs" style={{ margin: "6px 0 0", color: d.study_type ? "var(--evid)" : "var(--alert)" }}>
        {d.study_type ? `${d.study_type} · ${d.evidence_grade || "sin grado"}${d.population_type ? " · " + d.population_type : ""}${d.sample_size ? " · n=" + d.sample_size : ""}` : "Sin clasificar: rellena tipo de estudio y grado al revisar."}
      </p>
      <div className="row" style={{ marginTop: 9, gap: 6 }}>
        <button className="btn primary sm" onClick={() => onRevisar(d)}>Revisar ficha</button>
        <button className="btn ghost sm" onClick={() => verFragmentos(d)}>Ver fragmentos</button>
        <a className="btn ghost sm" href={`/api/admin/documents/${encodeURIComponent(d.id)}/pdf`} target="_blank" rel="noreferrer">PDF original</a>
      </div>
    </div>))}
    <p className="xs muted">Un documento sin revisar no participa en las respuestas del coach. Al guardar la ficha queda confirmado y pasa a estar disponible.</p>
  </div>);
}

function EditarRef({ r, onSave, onDelete, onCancel }) {
  const [f, setF] = useState(normRef(r));
  const [avanzado, setAvanzado] = useState(!!r.resumenIA);
  const s = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const nuevo = !!r._nuevo;
  return (<div>
    <div className="between" style={{ marginTop: 8 }}><h1>{nuevo ? "Nueva referencia" : "Referencia"}</h1><button className="btn sm ghost" onClick={onCancel}>Cancelar</button></div>
    {r.origen === "pdf" && r.revisado === false && (<div className="card" style={{ borderColor: "var(--alert)" }}>
      <span className="tag alert">Propuesta desde PDF</span>
      <p className="sm" style={{ margin: "8px 0 0" }}>Ficha extraída de <span className="mono xs">{r.archivo}</span>{r._meta ? " (" + r._meta.leidas + " de " + r._meta.paginas + " páginas leídas)" : ""}. Revisa sobre todo el año, el DOI y la aplicación práctica antes de guardar.</p>
    </div>)}
    <div className="card">
      <label>Autores</label><input value={f.autores} onChange={(e) => s("autores", e.target.value)} placeholder="Apellido, N. y cols." style={{ fontFamily: "'IBM Plex Sans',sans-serif" }} />
      <div style={{ height: 9 }} /><div className="grid2">
        <div><label>Año</label><input type="number" value={f.anio} onChange={(e) => s("anio", +e.target.value)} /></div>
        <div><label>Tema</label><input value={f.tema} onChange={(e) => s("tema", e.target.value)} placeholder="Volumen, Fuerza…" style={{ fontFamily: "'IBM Plex Sans',sans-serif" }} /></div>
      </div>
      <div className="row" style={{ overflowX: "auto", marginTop: 7, paddingBottom: 4 }}>
        {TEMAS_SUG.map((t) => <button key={t} className={"chip" + (f.tema === t ? " on" : "")} style={{ whiteSpace: "nowrap", padding: "6px 10px" }} onClick={() => s("tema", t)}>{t}</button>)}
      </div>
      <div style={{ height: 9 }} /><label>Título</label>
      <textarea rows="2" value={f.titulo} onChange={(e) => s("titulo", e.target.value)} style={{ fontFamily: "'IBM Plex Sans',sans-serif" }} />
      <div style={{ height: 9 }} /><label>Fuente</label>
      <input value={f.fuente} onChange={(e) => s("fuente", e.target.value)} placeholder="Revista, tipo de estudio" style={{ fontFamily: "'IBM Plex Sans',sans-serif" }} />
      <div style={{ height: 9 }} /><label>DOI o enlace</label><input value={f.doi} onChange={(e) => s("doi", e.target.value)} style={{ fontSize: 13 }} />
      <div style={{ height: 9 }} /><label>Grado de evidencia</label>
      <div className="grid2">{GRADOS.map((g) => <button key={g} className={"chip" + (f.grado === g ? " on" : "")} onClick={() => s("grado", g)}>{g}</button>)}</div>
      <div style={{ height: 9 }} /><label>Aplicación práctica</label>
      <textarea rows="3" value={f.aplicacion} onChange={(e) => s("aplicacion", e.target.value)} placeholder="Qué decisión de entrenamiento justifica y con qué límites" style={{ fontFamily: "'IBM Plex Sans',sans-serif" }} />
      <p className="xs muted" style={{ marginTop: 8 }}>Lo que escribas en «aplicación» es lo que el coach usará al razonar. Sé concreto y honesto con los límites del estudio.</p>
    </div>

    <button className="btn ghost sm" onClick={() => setAvanzado(!avanzado)}>{avanzado ? "Ocultar" : "Mostrar"} campos de contexto</button>
    {avanzado && (<div className="card" style={{ marginTop: 10 }}>
      <label>Palabras clave (separadas por comas)</label>
      <input value={(f.tags || []).join(", ")} onChange={(e) => s("tags", e.target.value.split(",").map((x) => x.trim()).filter(Boolean))} placeholder="sóleo, tendón, excéntrico" style={{ fontFamily: "'IBM Plex Sans',sans-serif" }} />
      <p className="xs muted" style={{ margin: "5px 0 0" }}>Las usa el buscador interno para decidir qué referencias mandar a la IA en cada consulta.</p>
      {/* Tipo de estudio y grado son ejes distintos a propósito: el diseño del
          estudio no determina por sí solo la confianza que merece.          */}
      <div style={{ height: 9 }} /><label>Tipo de estudio</label>
      <select value={f.studyType || ""} onChange={(e) => s("studyType", e.target.value || null)}>
        {STUDY_TYPES_UI.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
      <div style={{ height: 9 }} /><div className="grid2">
        <div><label>Población (tipo)</label>
          <select value={f.populationType || ""} onChange={(e) => s("populationType", e.target.value || null)}>
            {POPULATION_TYPES_UI.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select></div>
        <div><label>Tamaño de muestra</label>
          <input type="number" min="1" value={f.sampleSize ?? ""} placeholder="24"
            onChange={(e) => s("sampleSize", e.target.value === "" ? null : Math.trunc(+e.target.value))} /></div>
      </div>
      <div style={{ height: 9 }} /><label>Población estudiada</label>
      <input value={f.poblacion} onChange={(e) => s("poblacion", e.target.value)} placeholder="n=24, hombres entrenados, 20-30 años" style={{ fontFamily: "'IBM Plex Sans',sans-serif" }} />
      <div style={{ height: 9 }} /><label>Qué encontró</label>
      <textarea rows="3" value={f.resumenIA} onChange={(e) => s("resumenIA", e.target.value)} style={{ fontFamily: "'IBM Plex Sans',sans-serif" }} />
      <div style={{ height: 9 }} /><label>Límites</label>
      <textarea rows="2" value={f.limites} onChange={(e) => s("limites", e.target.value)} placeholder="Por qué no se puede generalizar" style={{ fontFamily: "'IBM Plex Sans',sans-serif" }} />
    </div>)}

    <div className="row" style={{ marginTop: 12 }}><button className="btn primary" onClick={() => onSave(f)}>{nuevo ? "Añadir a la biblioteca" : "Guardar"}</button>
      {!nuevo && <button className="btn danger" onClick={() => onDelete(f.id)}>Eliminar</button>}</div>
  </div>);
}

/* ============================================================
   AJUSTES
   ============================================================ */
function Ajustes({ st, P, update, notify, onClose, setPantalla, today, onLogout, user }) {
  const [url, setUrl] = useState(st.config.sheetsUrl || "");
  const [test, setTest] = useState(null); const [busy, setBusy] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [accountBusy, setAccountBusy] = useState(false);
  const comp = completeness(P.perfil);
  const guardar = () => { update((s) => { s.config.sheetsUrl = url.trim(); return s; }); notify("URL guardada."); };
  const probar = async () => { setBusy(true); setTest(null); setTest(await pushToSheets(url.trim(), "Config", [{ fecha: today, clave: "prueba", valor: "conexión desde Hybrid Coach" }])); setBusy(false); };
  const sincronizar = async () => {
    if (!st.config.sheetsUrl) return notify("Configura primero la URL del Apps Script.");
    setBusy(true); const u = st.config.sheetsUrl; const tag = (rows) => rows.map((r) => ({ ...r, perfil: P.nombre }));
    const res = [await pushToSheets(u, "Running", tag(P.running)), await pushToSheets(u, "Fuerza", tag(P.strength)),
      await pushToSheets(u, "Feedback", tag(P.checkins)), await pushToSheets(u, "Recovery", tag(P.recovery)),
      await pushToSheets(u, "Cambios_Plan", tag(P.changes)), await pushToSheets(u, "Bibliografia", st.biblio)];
    setBusy(false); update((s) => { s.config.lastSync = new Date().toISOString(); return s; });
    notify(res.every((x) => x.ok) ? "Todo sincronizado con Google Sheets." : "Sincronización parcial: " + (res.find((x) => !x.ok) || {}).msg);
  };
  const exportar = () => { const blob = new Blob([JSON.stringify(st, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "hybridcoach-" + today + ".json"; a.click(); };
  const exportarCuenta = async () => {
    setAccountBusy(true);
    try {
      const response = await fetch("/api/auth/export", { credentials: "same-origin" });
      if (!response.ok) throw new Error("No se pudo preparar la exportación");
      const blob = await response.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `hybridcoach-cuenta-${today}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      notify("Exportación completa descargada.");
    } catch (error) { notify(error.message); } finally { setAccountBusy(false); }
  };
  const cambiarPassword = async () => {
    if (newPassword.length < 12) return notify("La contraseña nueva debe tener al menos 12 caracteres.");
    setAccountBusy(true);
    try {
      const response = await fetch("/api/auth/change-password", { method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword, newPassword }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || "No se pudo cambiar la contraseña");
      setCurrentPassword(""); setNewPassword(""); notify("Contraseña actualizada; las demás sesiones se han cerrado.");
    } catch (error) { notify(error.message); } finally { setAccountBusy(false); }
  };
  const borrarCuenta = async () => {
    if (deleteConfirmation !== "BORRAR") return notify("Escribe BORRAR para confirmar.");
    setAccountBusy(true);
    try {
      const response = await fetch("/api/auth/account", { method: "DELETE", credentials: "same-origin",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: deletePassword }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || "No se pudo borrar la cuenta");
      localStorage.removeItem(`${KEY_PREFIX}:${user.id}`);
      await onLogout();
    } catch (error) { notify(error.message); setAccountBusy(false); }
  };
  const [confReg, setConfReg] = useState(false);
  const regenerar = () => { if (!confReg) { setConfReg(true); return; }
    update((s) => { const p = s.perfiles[P.id]; p.plan = buildPlan(p.perfil, today); p.weeks = {};
      p.changes.push({ fecha: today, semana: 0, plan_original: "—", cambio: "Plan regenerado", motivo: "Cambios en el perfil", datos: "riesgo " + p.plan.riesgo.score + "/10" }); return s; });
    notify("Plan regenerado."); onClose();
  };

  return (<div>
    <div className="between" style={{ marginTop: 8 }}><h1>Ajustes</h1><button className="btn sm ghost" onClick={onClose}>Cerrar</button></div>
    <div className="card">
      <div className="between"><h3>Perfil de {P.nombre}</h3><span className="tag">{comp.pct}% completo</span></div>
      <div className="prog" style={{ margin: "10px 0" }}><span style={{ width: comp.pct + "%" }} /></div>
      {comp.faltan.length > 0 && <p className="xs muted">Pendiente: {comp.faltan.map((q) => q.l).join(", ")}.</p>}
      <button className="btn sm" onClick={() => setPantalla("wizard")}>Editar respuestas</button>
      <div style={{ height: 8 }} />
      <button className="btn sm ghost" style={{ width: "100%" }} onClick={regenerar}>{confReg ? "Confirmar: se borran las semanas planificadas" : "Regenerar plan con el perfil actual"}</button>
    </div>
    <div className="card"><h3>Google Sheets</h3>
      <p className="sm muted">Pega la URL del Apps Script desplegado (termina en <span className="mono">/exec</span>). Sin ella, todo se guarda dentro de la aplicación.</p>
      <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://script.google.com/macros/s/…/exec" style={{ fontSize: 13 }} />
      <div style={{ height: 9 }} />
      <div className="row"><button className="btn sm" style={{ flex: 1 }} onClick={guardar}>Guardar</button>
        <button className="btn sm" style={{ flex: 1 }} onClick={probar} disabled={busy || !url}>Probar conexión</button></div>
      {test && <p className="sm" style={{ color: test.ok ? "var(--ok)" : "var(--alert)", marginBottom: 0 }}>{test.ok ? "Conectado." : "No conecta: " + test.msg}</p>}
      <div style={{ height: 9 }} />
      <button className="btn ghost sm" style={{ width: "100%" }} onClick={sincronizar} disabled={busy}>Sincronizar este perfil</button>
      {st.config.lastSync && <p className="xs muted" style={{ marginBottom: 0 }}>Última sincronización: {new Date(st.config.lastSync).toLocaleString("es-ES")}</p>}
    </div>
    <div className="card"><h3>Strava</h3>
      <p className="sm muted" style={{ marginBottom: 8 }}>La importación automática necesita el Apps Script desplegado: la clave secreta no puede vivir dentro de esta aplicación.</p>
      <span className="tag">Requiere configuración externa</span>
    </div>
    <div className="card"><h3>Tus datos</h3>
      <div className="grid2" style={{ marginBottom: 10 }}>
        <Metric l="carreras" v={P.running.length} /><Metric l="series" v={P.strength.length} />
        <Metric l="check-ins" v={P.checkins.length} /><Metric l="referencias" v={st.biblio.length} />
      </div>
      <button className="btn ghost sm" style={{ width: "100%" }} onClick={exportar}>Descargar copia de todo (JSON)</button>
      <div style={{ height: 8 }} />
      <button className="btn ghost sm" style={{ width: "100%" }} onClick={exportarCuenta} disabled={accountBusy}>Exportar cuenta desde PostgreSQL</button>
    </div>
    <div className="card"><h3>Seguridad de la cuenta</h3>
      <label className="xs muted">CONTRASEÑA ACTUAL</label>
      <input type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
      <div style={{ height: 8 }} />
      <label className="xs muted">CONTRASEÑA NUEVA · MÍNIMO 12 CARACTERES</label>
      <input type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
      <div style={{ height: 9 }} />
      <button className="btn sm" style={{ width: "100%" }} onClick={cambiarPassword} disabled={accountBusy || !currentPassword || !newPassword}>Cambiar contraseña</button>
    </div>
    <div className="card" style={{ borderColor: "var(--alert)" }}><h3>Borrar cuenta</h3>
      <p className="sm muted">Elimina la cuenta y sus datos privados de PostgreSQL. Descarga antes una exportación. Esta acción no se puede deshacer desde la aplicación.</p>
      <input type="password" autoComplete="current-password" value={deletePassword} onChange={(e) => setDeletePassword(e.target.value)} placeholder="Contraseña actual" />
      <div style={{ height: 8 }} />
      <input value={deleteConfirmation} onChange={(e) => setDeleteConfirmation(e.target.value)} placeholder="Escribe BORRAR" />
      <div style={{ height: 9 }} />
      <button className="btn danger sm" style={{ width: "100%" }} onClick={borrarCuenta} disabled={accountBusy || !deletePassword || deleteConfirmation !== "BORRAR"}>Borrar definitivamente mi cuenta</button>
    </div>
    <p className="xs muted" style={{ paddingBottom: 16 }}>Hybrid Coach organiza entrenamiento. No diagnostica lesiones ni sustituye a un profesional sanitario. Si tienes dolor persistente, en reposo o que empeora al entrenar, consúltalo.</p>
  </div>);
}
