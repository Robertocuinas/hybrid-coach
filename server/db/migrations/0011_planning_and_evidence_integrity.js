/* Invariantes posteriores al planificador semanal.

   - Una ficha bibliográfica no es evidencia hasta que tiene fragmentos reales
     y una persona la confirma.
   - planning_context_version invalida propuestas cuando cambian datos del
     atleta entre generación y aceptación. */
export const shorthands = undefined;

export async function up(pgm) {
  pgm.sql(`ALTER TABLE athlete_profiles
    ADD COLUMN IF NOT EXISTS planning_context_version bigint NOT NULL DEFAULT 0;`);

  /* No existe una marca histórica que distinga revisión humana de la
     autoaprobación antigua del extractor. La opción segura es volver a pedir
     confirmación para todos los PDF y desactivar cualquier ficha sin chunks. */
  pgm.sql(`UPDATE documents d
       SET revisado = false
     WHERE d.origen = 'pdf'
        OR NOT EXISTS (
          SELECT 1 FROM document_chunks dc WHERE dc.document_id = d.id
        );`);

  pgm.sql(`CREATE OR REPLACE FUNCTION require_chunks_before_document_review()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.revisado = true AND NOT EXISTS (
        SELECT 1 FROM document_chunks dc WHERE dc.document_id = NEW.id
      ) THEN
        RAISE EXCEPTION 'un documento sin fragmentos no puede marcarse como revisado'
          USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END;
    $$;`);
  pgm.sql(`DROP TRIGGER IF EXISTS trg_documents_require_chunks ON documents;`);
  pgm.sql(`CREATE TRIGGER trg_documents_require_chunks
    BEFORE INSERT OR UPDATE OF revisado ON documents
    FOR EACH ROW EXECUTE FUNCTION require_chunks_before_document_review();`);

  pgm.sql(`CREATE OR REPLACE FUNCTION unreview_document_without_chunks()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      UPDATE documents d
         SET revisado = false
       WHERE d.id = OLD.document_id
         AND NOT EXISTS (
           SELECT 1 FROM document_chunks dc WHERE dc.document_id = OLD.document_id
         );
      RETURN OLD;
    END;
    $$;`);
  pgm.sql(`DROP TRIGGER IF EXISTS trg_chunks_keep_review_invariant ON document_chunks;`);
  pgm.sql(`CREATE TRIGGER trg_chunks_keep_review_invariant
    AFTER DELETE ON document_chunks
    FOR EACH ROW EXECUTE FUNCTION unreview_document_without_chunks();`);

  /* Cualquier cambio en el perfil o en entradas que alteran la planificación
     incrementa una versión monotónica. El borrador guarda esa versión y la
     aceptación falla con 409 si ya no coincide. */
  pgm.sql(`CREATE OR REPLACE FUNCTION bump_athlete_planning_version()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      NEW.planning_context_version = OLD.planning_context_version + 1;
      RETURN NEW;
    END;
    $$;`);
  pgm.sql(`DROP TRIGGER IF EXISTS trg_athlete_planning_version ON athlete_profiles;`);
  pgm.sql(`CREATE TRIGGER trg_athlete_planning_version
    BEFORE UPDATE ON athlete_profiles
    FOR EACH ROW EXECUTE FUNCTION bump_athlete_planning_version();`);

  pgm.sql(`CREATE OR REPLACE FUNCTION touch_athlete_planning_context()
    RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE
      profile_id uuid;
    BEGIN
      profile_id := COALESCE(NEW.athlete_profile_id, OLD.athlete_profile_id);
      UPDATE athlete_profiles
         SET updated_at = now()
       WHERE id = profile_id;
      RETURN COALESCE(NEW, OLD);
    END;
    $$;`);
  for (const table of ["injuries", "availability", "completed_sessions", "recovery_logs", "feedback_logs"]) {
    pgm.sql(`DROP TRIGGER IF EXISTS trg_${table}_touch_planning_context ON ${table};`);
    pgm.sql(`CREATE TRIGGER trg_${table}_touch_planning_context
      AFTER INSERT OR UPDATE OR DELETE ON ${table}
      FOR EACH ROW EXECUTE FUNCTION touch_athlete_planning_context();`);
  }

  pgm.sql(`CREATE OR REPLACE FUNCTION touch_completed_session_owner()
    RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE
      completed_id uuid;
      profile_id uuid;
    BEGIN
      completed_id := COALESCE(NEW.completed_session_id, OLD.completed_session_id);
      SELECT athlete_profile_id INTO profile_id
        FROM completed_sessions WHERE id = completed_id;
      IF profile_id IS NOT NULL THEN
        UPDATE athlete_profiles SET updated_at = now() WHERE id = profile_id;
      END IF;
      RETURN COALESCE(NEW, OLD);
    END;
    $$;`);
  for (const table of ["running_sessions", "strength_sessions"]) {
    pgm.sql(`DROP TRIGGER IF EXISTS trg_${table}_touch_planning_context ON ${table};`);
    pgm.sql(`CREATE TRIGGER trg_${table}_touch_planning_context
      AFTER INSERT OR UPDATE OR DELETE ON ${table}
      FOR EACH ROW EXECUTE FUNCTION touch_completed_session_owner();`);
  }

  pgm.sql(`CREATE OR REPLACE FUNCTION touch_strength_set_owner()
    RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE
      session_id uuid;
      profile_id uuid;
    BEGIN
      session_id := COALESCE(NEW.strength_session_id, OLD.strength_session_id);
      SELECT cs.athlete_profile_id INTO profile_id
        FROM strength_sessions ss
        JOIN completed_sessions cs ON cs.id = ss.completed_session_id
       WHERE ss.id = session_id;
      IF profile_id IS NOT NULL THEN
        UPDATE athlete_profiles SET updated_at = now() WHERE id = profile_id;
      END IF;
      RETURN COALESCE(NEW, OLD);
    END;
    $$;`);
  pgm.sql(`DROP TRIGGER IF EXISTS trg_strength_sets_touch_planning_context ON strength_sets;`);
  pgm.sql(`CREATE TRIGGER trg_strength_sets_touch_planning_context
    AFTER INSERT OR UPDATE OR DELETE ON strength_sets
    FOR EACH ROW EXECUTE FUNCTION touch_strength_set_owner();`);
}

export async function down(pgm) {
  pgm.sql(`DROP TRIGGER IF EXISTS trg_strength_sets_touch_planning_context ON strength_sets;`);
  for (const table of ["running_sessions", "strength_sessions"]) {
    pgm.sql(`DROP TRIGGER IF EXISTS trg_${table}_touch_planning_context ON ${table};`);
  }
  for (const table of ["injuries", "availability", "completed_sessions", "recovery_logs", "feedback_logs"]) {
    pgm.sql(`DROP TRIGGER IF EXISTS trg_${table}_touch_planning_context ON ${table};`);
  }
  pgm.sql(`DROP TRIGGER IF EXISTS trg_athlete_planning_version ON athlete_profiles;`);
  pgm.sql(`DROP TRIGGER IF EXISTS trg_chunks_keep_review_invariant ON document_chunks;`);
  pgm.sql(`DROP TRIGGER IF EXISTS trg_documents_require_chunks ON documents;`);
  pgm.sql(`DROP FUNCTION IF EXISTS touch_strength_set_owner();`);
  pgm.sql(`DROP FUNCTION IF EXISTS touch_completed_session_owner();`);
  pgm.sql(`DROP FUNCTION IF EXISTS touch_athlete_planning_context();`);
  pgm.sql(`DROP FUNCTION IF EXISTS bump_athlete_planning_version();`);
  pgm.sql(`DROP FUNCTION IF EXISTS unreview_document_without_chunks();`);
  pgm.sql(`DROP FUNCTION IF EXISTS require_chunks_before_document_review();`);
  pgm.sql(`ALTER TABLE athlete_profiles DROP COLUMN IF EXISTS planning_context_version;`);
}
