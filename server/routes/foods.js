/* Alimentos: búsqueda, registro de consumo y conteo del día.

   Reparto que no se mezcla:
     Open Food Facts → cuánto tiene un alimento.
     nutrition_targets → cuánto debería comer el atleta. Lo calcula el motor
                         determinista con su suelo de seguridad, y ninguna API
                         externa lo toca.
   Aquí solo se restan.

   Todas las sumas se hacen en código, nunca las hace un modelo. */
import express from "express";
import { pool } from "../db/repositories/_helpers.js";
import { requireAuth } from "../middleware/auth.js";
import { requireActiveProfile } from "../middleware/authorization.js";
import { createFoodProvider } from "../integrations/foods/factory.js";
import { macrosPara, totalDiario } from "../integrations/foods/types.js";
import { borrarConsumo, listarConsumoDelDia, registrarConsumo } from "../db/repositories/consumedFoods.js";
import { listMealCatalog } from "../db/repositories/nutrition.js";
import { generarRecomendacionDia } from "../domain/nutrition/diario.js";

const router = express.Router();
router.use(requireAuth, requireActiveProfile);

let alimentos = null, iniciado = false;
const getAlimentos = () => {
  if (!iniciado) { try { alimentos = createFoodProvider(); } catch { alimentos = null; } iniciado = true; }
  return alimentos;
};

const perfil = (req) => req.auth.athleteProfileId;
const HOY = () => new Date().toISOString().slice(0, 10);
const fechaValida = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : null);

/* La atribución viaja con cada respuesta que lleve datos del proveedor: la
   licencia exige mostrarla donde se muestren los datos, así que la interfaz
   siempre la tiene a mano sin tener que acordarse de importarla. */
const conAtribucion = (proveedor) => proveedor?.capabilities().atribucion || null;

router.get("/buscar", async (req, res, next) => {
  try {
    const proveedor = getAlimentos();
    if (!proveedor) return res.status(503).json({ ok: false, message: "La búsqueda de alimentos está desactivada en este servidor" });

    const texto = String(req.query.q || "").trim();
    if (!texto) return res.status(400).json({ ok: false, message: "Falta el texto de búsqueda" });

    const resultados = await proveedor.buscar(texto, { limite: 12 });
    res.json({ ok: true, alimentos: resultados, atribucion: conAtribucion(proveedor) });
  } catch (error) {
    /* Un fallo del proveedor externo no es un 500 nuestro: se informa y la
       pantalla mantiene lo que ya tenía, sin inventar alimentos. */
    if (error.status) return res.status(502).json({ ok: false, message: error.message });
    next(error);
  }
});

router.get("/codigo/:codigo", async (req, res, next) => {
  try {
    const proveedor = getAlimentos();
    if (!proveedor) return res.status(503).json({ ok: false, message: "La búsqueda de alimentos está desactivada en este servidor" });

    const alimento = await proveedor.porCodigoBarras(req.params.codigo);
    if (!alimento) return res.status(404).json({ ok: false, message: "Ese código de barras no está en Open Food Facts" });
    res.json({ ok: true, alimento, atribucion: conAtribucion(proveedor) });
  } catch (error) {
    if (error.status) return res.status(502).json({ ok: false, message: error.message });
    next(error);
  }
});

/* Registrar lo comido. Se recibe el alimento ya normalizado por la búsqueda:
   así el servidor no vuelve a llamar a la API por algo que el cliente acaba
   de recibir, y el snapshot es exactamente el que el atleta vio al elegir. */
router.post("/consumo", async (req, res, next) => {
  try {
    const { alimento, gramos, fecha, momento } = req.body || {};
    const dia = fechaValida(fecha) || HOY();
    const cantidad = Number(gramos);

    if (!alimento?.nombre) return res.status(400).json({ ok: false, message: "Falta el alimento" });
    if (!Number.isFinite(cantidad) || cantidad <= 0 || cantidad > 5000) {
      return res.status(400).json({ ok: false, message: "La cantidad debe estar entre 1 y 5000 gramos" });
    }

    const macros = macrosPara(alimento, cantidad) || {};
    const fila = await registrarConsumo(perfil(req), {
      fecha: dia,
      momento: ["desayuno", "comida", "cena", "snack"].includes(momento) ? momento : null,
      provider: alimento.provider || "manual",
      externalId: alimento.externalId || null,
      nombre: String(alimento.nombre).slice(0, 200),
      marca: alimento.marca ? String(alimento.marca).slice(0, 100) : null,
      gramos: cantidad,
      macros,
    });
    res.status(201).json({ ok: true, registro: fila });
  } catch (error) { next(error); }
});

router.delete("/consumo/:id", async (req, res, next) => {
  try {
    const borrado = await borrarConsumo(req.params.id, perfil(req));
    if (!borrado) return res.status(404).json({ ok: false, message: "Registro no encontrado" });
    res.json({ ok: true });
  } catch (error) { next(error); }
});

/* Objetivo, consumido y restante (§48). El objetivo sale de la tabla que
   calcula el motor; si no hay fila para ese día, se responde sin objetivo en
   vez de inventarse uno. */
router.get("/dia", async (req, res, next) => {
  try {
    const dia = fechaValida(req.query.fecha) || HOY();
    const registros = await listarConsumoDelDia(perfil(req), dia);

    const consumido = totalDiario(registros.map((r) => ({
      kcal: r.kcal === null ? null : Number(r.kcal),
      proteina: Number(r.proteina_g) || 0,
      carbohidrato: Number(r.carbohidrato_g) || 0,
      grasa: Number(r.grasa_g) || 0,
      fibra: Number(r.fibra_g) || 0,
    })));

    const { rows } = await pool.query(
      `SELECT kcal, proteina_g, carbohidrato_g, grasa_g FROM nutrition_targets
        WHERE athlete_profile_id = $1 AND fecha = $2 ORDER BY id LIMIT 1;`,
      [perfil(req), dia]
    );
    const objetivo = rows[0]
      ? { kcal: Number(rows[0].kcal), proteina: Number(rows[0].proteina_g), carbohidrato: Number(rows[0].carbohidrato_g), grasa: Number(rows[0].grasa_g) }
      : null;

    /* El restante puede ser negativo: haberse pasado es información, no un
       error que haya que ocultar con un cero. */
    const restante = objetivo ? {
      kcal: Math.round((objetivo.kcal - consumido.kcal) * 10) / 10,
      proteina: Math.round((objetivo.proteina - consumido.proteina) * 10) / 10,
      carbohidrato: Math.round((objetivo.carbohidrato - consumido.carbohidrato) * 10) / 10,
      grasa: Math.round((objetivo.grasa - consumido.grasa) * 10) / 10,
    } : null;

    res.json({ ok: true, fecha: dia, registros, consumido, objetivo, restante });
  } catch (error) { next(error); }
});

/* ============================================================
   RECOMENDACIÓN DIARIA DE COMIDAS (Fase 15)

   Une tres fundamentos y los declara en la respuesta:
     1. Base de datos  → objetivo de `nutrition_targets` del día, catálogo
                         propio del atleta (`meal_catalog`) y lo ya consumido
                         (`consumed_foods`) para el progreso.
     2. FOOD_PROVIDER  → Open Food Facts enriquece las opciones del catálogo
                         con macros REALES por 100 g. Si el proveedor cae o no
                         está configurado, se degrada al catálogo propio SIN
                         inventar macros y lo dice en `nota` + `fuente`.
     3. Evidencia      → cada toma lleva sus `citas` (ids n* de la bibliografía
                         de nutrición); la generación es determinista, no LLM.

   Contrato de salida (claro, 15.2):
     { ok, fecha, fuente, evidenciaSuficiente, contexto, objetivo, tomas[],
       consumido, restante, atribucion, nota } */
router.get("/recomendacion", async (req, res, next) => {
  try {
    const dia = fechaValida(req.query.fecha) || HOY();
    const contexto = typeof req.query.contexto === "string" ? req.query.contexto : "suave";

    /* 1. Objetivo del día: lo publica el motor determinista del cliente. Sin
       fila, la recomendación es genérica y se declara evidencia insuficiente. */
    const obj = await pool.query(
      `SELECT kcal, proteina_g, carbohidrato_g, grasa_g, fibra_g, agua_l
        FROM nutrition_targets WHERE athlete_profile_id = $1 AND fecha = $2
        ORDER BY id LIMIT 1;`,
      [perfil(req), dia]
    );
    const o = obj.rows[0];
    const objetivo = o
      ? { kcal: Number(o.kcal), proteina: Number(o.proteina_g), carbohidrato: Number(o.carbohidrato_g),
          grasa: Number(o.grasa_g), fibra: Number(o.fibra_g) || null, agua: Number(o.agua_l) || null }
      : null;

    /* Catálogo propio del atleta, agrupado por momento. */
    const filas = await listMealCatalog(perfil(req));
    const catalogo = { desayuno: [], comida: [], cena: [], snack: [] };
    for (const f of filas) if (f.categoria in catalogo) catalogo[f.categoria].push(f.opcion);

    /* 2. FOOD_PROVIDER: enriquecer hasta 8 opciones distintas con datos reales.
       Cualquier fallo de una opción se ignora (se queda sin enriquecer); si el
       proveedor entero falta, se degrada al catálogo propio. */
    const proveedor = getAlimentos();
    const alimentos = {};
    let fuente = "catalogo_propio";
    let nota = null;
    const nombres = [...new Set([...catalogo.desayuno, ...catalogo.comida, ...catalogo.cena, ...catalogo.snack])].slice(0, 8);
    if (proveedor) {
      let alguno = false;
      await Promise.all(nombres.map(async (nombre) => {
        try {
          const res = await proveedor.buscar(nombre, { limite: 1 });
          const a = res && res[0];
          if (a && a.por100g && a.por100g.kcal != null) { alimentos[nombre] = a; alguno = true; }
        } catch { /* falla esta opción: se queda sin enriquecer */ }
      }));
      if (alguno) fuente = "openfoodfacts";
      else nota = "Open Food Facts no devolvió datos en esta consulta: se muestra el catálogo propio sin macros.";
    } else {
      nota = "Open Food Facts no está disponible en este servidor: se usa el catálogo propio sin macros.";
    }

    /* 3. Generación determinista + citas. */
    const rec = generarRecomendacionDia({ objetivo, catalogo, alimentos, contexto });

    /* Progreso del día: lo ya consumido y lo que queda del objetivo. */
    const registros = await listarConsumoDelDia(perfil(req), dia);
    const consumido = totalDiario(registros.map((r) => ({
      kcal: r.kcal === null ? null : Number(r.kcal),
      proteina: Number(r.proteina_g) || 0,
      carbohidrato: Number(r.carbohidrato_g) || 0,
      grasa: Number(r.grasa_g) || 0,
      fibra: Number(r.fibra_g) || 0,
    })));
    const restante = objetivo ? {
      kcal: Math.round((objetivo.kcal - consumido.kcal) * 10) / 10,
      proteina: Math.round((objetivo.proteina - consumido.proteina) * 10) / 10,
      carbohidrato: Math.round((objetivo.carbohidrato - consumido.carbohidrato) * 10) / 10,
      grasa: Math.round((objetivo.grasa - consumido.grasa) * 10) / 10,
    } : null;

    const atribucion = fuente === "openfoodfacts" ? conAtribucion(proveedor) : null;

    res.json({
      ok: true, fecha: dia, fuente, evidenciaSuficiente: rec.evidenciaSuficiente,
      contexto: rec.contexto, objetivo, tomas: rec.tomas, consumido, restante,
      atribucion, nota,
    });
  } catch (error) { next(error); }
});

export default router;
