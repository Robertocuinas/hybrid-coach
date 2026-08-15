/* Registro de alimentos consumidos.

   Una sola tabla, no las seis que suele pedirse para esto. Las razones:

   - No hay `food_products` porque no hace falta cachear el catálogo: Open Food
     Facts se consulta al buscar y lo único que persiste es lo que el atleta
     dice haber comido. Menos datos ajenos guardados, menos superficie de
     licencia que cumplir.

   - Los macros se guardan como SNAPSHOT del momento del registro, no como
     referencia al producto. Si mañana alguien corrige la ficha de ese yogur en
     Open Food Facts, tu historial de hace tres meses no debe cambiar: era lo
     que comiste y lo que contaba entonces. La licencia ODbL permite almacenar,
     así que esto es legal además de correcto.

   - `provider` y `external_id` conservan la procedencia (§47): se sabe de
     dónde salió cada cifra y se puede volver a la ficha original.

   Los nulos son significativos: un producto sin proteína declarada guarda
   NULL, no 0. Sumar ceros haría que un total incompleto pareciera exacto. */
export const shorthands = undefined;

export async function up(pgm) {
  pgm.sql(`CREATE TABLE IF NOT EXISTS consumed_foods (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    athlete_profile_id uuid NOT NULL REFERENCES athlete_profiles(id) ON DELETE CASCADE,
    fecha date NOT NULL,
    momento text,
    provider text NOT NULL DEFAULT 'openfoodfacts',
    external_id text,
    nombre text NOT NULL,
    marca text,
    gramos numeric NOT NULL,
    kcal numeric,
    proteina_g numeric,
    carbohidrato_g numeric,
    grasa_g numeric,
    fibra_g numeric,
    /* Qué se registró: un alimento suelto o una receta completa. Se distingue
       desde el principio para no tener que migrar cuando entren las recetas. */
    tipo text NOT NULL DEFAULT 'alimento',
    creado_en timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT consumed_foods_gramos_check CHECK (gramos > 0 AND gramos <= 5000),
    CONSTRAINT consumed_foods_tipo_check CHECK (tipo IN ('alimento', 'receta')),
    CONSTRAINT consumed_foods_momento_check
      CHECK (momento IS NULL OR momento IN ('desayuno', 'comida', 'cena', 'snack')),
    CONSTRAINT consumed_foods_provider_check
      CHECK (provider IN ('openfoodfacts', 'themealdb', 'manual'))
  );`);

  /* El conteo diario es la consulta que se hace en cada carga de la pantalla
     de nutrición: perfil + fecha. */
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_consumed_foods_dia
    ON consumed_foods (athlete_profile_id, fecha DESC);`);
}

export async function down(pgm) {
  pgm.sql(`DROP TABLE IF EXISTS consumed_foods;`);
}
