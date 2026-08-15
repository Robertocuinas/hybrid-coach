/* Adaptador de Open Food Facts.

   No necesita clave: la API es abierta. Lo que sí exige la licencia es un
   User-Agent propio que identifique la aplicación, y es requisito suyo, no una
   cortesía — las peticiones anónimas se limitan antes.

   Solo se piden los campos que se usan. Es lo que más reduce el tamaño de la
   respuesta y, en una API comunitaria y gratuita, no pedir de más es la forma
   básica de no abusar. */
import { FoodProvider, ATRIBUCION_OFF, normalizarAlimento } from "./types.js";

const BASE = "https://world.openfoodfacts.org";
const CAMPOS = [
  "code", "product_name", "brands", "quantity", "product_quantity", "serving_size",
  "nutriments", "allergens_tags", "ingredients_text", "image_url",
].join(",");

export class OpenFoodFactsProvider extends FoodProvider {
  constructor({ userAgent, idioma = "es", fetchImpl = fetch, timeoutMs = 8000 } = {}) {
    super();
    this.userAgent = userAgent;
    this.idioma = idioma;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  capabilities() {
    return { provider: "openfoodfacts", codigoBarras: true, atribucion: ATRIBUCION_OFF };
  }

  async pedir(url) {
    const respuesta = await this.fetchImpl(url, {
      headers: { accept: "application/json", "user-agent": this.userAgent },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!respuesta.ok) {
      const error = new Error(
        respuesta.status === 429
          ? "Open Food Facts ha aplicado un límite temporal de peticiones"
          : `Open Food Facts respondió ${respuesta.status}`
      );
      error.status = respuesta.status;
      throw error;
    }
    return respuesta.json();
  }

  /* Búsqueda por texto. Se restringe al idioma configurado para que "pollo"
     no devuelva sobre todo productos de otros países. */
  async buscar(texto, { limite = 10 } = {}) {
    const consulta = String(texto || "").trim();
    if (!consulta) return [];

    const url = new URL(`${BASE}/cgi/search.pl`);
    url.searchParams.set("search_terms", consulta);
    url.searchParams.set("search_simple", "1");
    url.searchParams.set("action", "process");
    url.searchParams.set("json", "1");
    url.searchParams.set("page_size", String(Math.min(30, Math.max(1, limite))));
    url.searchParams.set("fields", CAMPOS);
    url.searchParams.set("lc", this.idioma);

    const datos = await this.pedir(url.toString());
    return (datos?.products || [])
      .map((bruto) => normalizarAlimento(bruto, { provider: "openfoodfacts" }))
      .filter(Boolean);
  }

  /* El código de barras es la vía fiable: identifica un producto concreto en
     vez de una coincidencia textual. */
  async porCodigoBarras(codigo) {
    const limpio = String(codigo || "").replace(/\D/g, "");
    if (!limpio) return null;

    const datos = await this.pedir(`${BASE}/api/v2/product/${limpio}.json?fields=${CAMPOS}`);
    /* status 0 significa "no encontrado", y llega con HTTP 200: comprobar solo
       el código de estado daría un producto vacío por bueno. */
    if (!datos || datos.status === 0 || !datos.product) return null;
    return normalizarAlimento(datos.product, { provider: "openfoodfacts" });
  }
}
