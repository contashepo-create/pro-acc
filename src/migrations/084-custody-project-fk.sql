-- 084: custodies.project_id had no foreign key to projects in environments
-- provisioned from supabase-full-schema.sql (migration 012's ALTER was not
-- consolidated into it). The custodies route embeds `projects(name)`;
-- PostgREST refuses the embed without a discoverable relationship, so every
-- GET /api/custodies failed with a 500.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='custodies' AND column_name='project_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.contype='f'
      AND c.conrelid='public.custodies'::regclass
      AND c.confrelid='public.projects'::regclass
  ) THEN
    IF EXISTS (
      SELECT 1 FROM custodies c
      WHERE c.project_id IS NOT NULL
        AND NOT EXISTS(SELECT 1 FROM projects p WHERE p.id=c.project_id)
    ) THEN
      RAISE EXCEPTION 'custodies.project_id contains orphan values; resolve them before adding the FK';
    END IF;
    ALTER TABLE public.custodies
      ADD CONSTRAINT custodies_project_fk
      FOREIGN KEY (project_id) REFERENCES public.projects(id);
  END IF;
END;
$$;
