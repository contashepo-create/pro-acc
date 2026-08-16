-- 062 - Real critical path (CPM) for the Gantt chart.
--
-- The Gantt endpoint previously "computed" the critical path with a heuristic:
--   duration >= 30% of the project OR progress = 0  ⇒ critical
-- That is not a critical path. It flags every unstarted task (including tasks
-- with slack) and misses long chains of short tasks, so the schedule risk shown
-- to a construction project manager was simply wrong.
--
-- A real critical path needs a task dependency graph. This migration adds one
-- (finish-to-start with lag, the dependency type construction schedules use)
-- and implements the standard CPM forward/backward pass in PostgreSQL:
--
--   forward pass  → earliest start/finish (ES/EF)
--   backward pass → latest start/finish (LS/LF)
--   total float   = LS - ES ; tasks with float <= 0 are on the critical path
--
-- Everything is company scoped and cycle safe.

-- ===== Task dependency graph =================================================
CREATE TABLE IF NOT EXISTS project_task_dependencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  project_id UUID NOT NULL REFERENCES projects(id),
  -- The task that can only start after `predecessor_task_id` finishes.
  successor_task_id UUID NOT NULL REFERENCES project_tasks(id) ON DELETE CASCADE,
  predecessor_task_id UUID NOT NULL REFERENCES project_tasks(id) ON DELETE CASCADE,
  -- Working-day offset applied after the predecessor finishes (may be negative
  -- for overlap/"lead", which is common in construction schedules).
  lag_days INT NOT NULL DEFAULT 0,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT project_task_dependencies_no_self CHECK (successor_task_id <> predecessor_task_id),
  CONSTRAINT project_task_dependencies_lag_sane CHECK (lag_days BETWEEN -365 AND 365),
  CONSTRAINT project_task_dependencies_unique UNIQUE (successor_task_id, predecessor_task_id)
);
CREATE INDEX IF NOT EXISTS idx_task_deps_project ON project_task_dependencies(company_id, project_id);
CREATE INDEX IF NOT EXISTS idx_task_deps_successor ON project_task_dependencies(successor_task_id);
CREATE INDEX IF NOT EXISTS idx_task_deps_predecessor ON project_task_dependencies(predecessor_task_id);

ALTER TABLE project_task_dependencies ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  -- Mirror the tenant policy shape used by 027 for every other tenant table.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='project_task_dependencies'
      AND policyname='project_task_dependencies_tenant_isolation'
  ) THEN
    EXECUTE $ddl$
      CREATE POLICY project_task_dependencies_tenant_isolation
        ON project_task_dependencies
        USING (company_id::TEXT = current_setting('app.current_company', TRUE))
        WITH CHECK (company_id::TEXT = current_setting('app.current_company', TRUE));
    $ddl$;
  END IF;
END;
$$;

-- ===== Dependency writers ====================================================
-- A dependency edge is a schedule decision: it must be tenant checked, must
-- reference two tasks of the SAME project, and must never create a cycle
-- (a cycle would make the CPM non-terminating and the schedule meaningless).
CREATE OR REPLACE FUNCTION public.create_task_dependency_atomic(
  p_company_id UUID, p_successor_task_id UUID, p_predecessor_task_id UUID,
  p_lag_days INT, p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_row project_task_dependencies%ROWTYPE;
  v_successor project_tasks%ROWTYPE;
  v_predecessor project_tasks%ROWTYPE;
  v_lag INT := COALESCE(p_lag_days, 0);
BEGIN
  PERFORM assert_relationship_actor(p_company_id, p_user_id);
  IF p_successor_task_id IS NULL OR p_predecessor_task_id IS NULL
    OR p_successor_task_id = p_predecessor_task_id
    OR v_lag < -365 OR v_lag > 365 THEN
    RAISE EXCEPTION 'بيانات الاعتمادية غير صالحة';
  END IF;

  -- Lock both endpoints in a stable order so concurrent edge inserts cannot
  -- interleave into a cycle that each transaction individually considers safe.
  SELECT * INTO v_successor FROM project_tasks
    WHERE id = LEAST(p_successor_task_id, p_predecessor_task_id) AND company_id = p_company_id FOR UPDATE;
  SELECT * INTO v_predecessor FROM project_tasks
    WHERE id = GREATEST(p_successor_task_id, p_predecessor_task_id) AND company_id = p_company_id FOR UPDATE;

  SELECT * INTO v_successor FROM project_tasks
    WHERE id = p_successor_task_id AND company_id = p_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'المهمة غير موجودة'; END IF;
  SELECT * INTO v_predecessor FROM project_tasks
    WHERE id = p_predecessor_task_id AND company_id = p_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'المهمة غير موجودة'; END IF;
  IF v_successor.project_id <> v_predecessor.project_id THEN
    RAISE EXCEPTION 'بيانات الاعتمادية غير صالحة';
  END IF;

  -- Cycle guard: the new edge is predecessor → successor, so a cycle exists if
  -- the predecessor is already reachable FROM the successor.
  IF EXISTS (
    WITH RECURSIVE reachable(task_id) AS (
      SELECT p_successor_task_id
      UNION
      SELECT d.successor_task_id
      FROM project_task_dependencies d
      JOIN reachable r ON d.predecessor_task_id = r.task_id
      WHERE d.company_id = p_company_id
    )
    SELECT 1 FROM reachable WHERE task_id = p_predecessor_task_id
  ) THEN
    RAISE EXCEPTION 'دورة في اعتماديات المهام';
  END IF;

  PERFORM set_config('app.task_dependency_write_company', p_company_id::TEXT, TRUE);
  INSERT INTO project_task_dependencies(
    company_id, project_id, successor_task_id, predecessor_task_id, lag_days, created_by)
  VALUES (p_company_id, v_successor.project_id, p_successor_task_id, p_predecessor_task_id, v_lag, p_user_id)
  RETURNING * INTO v_row;

  INSERT INTO audit_log(company_id, user_id, action, entity_type, entity_id, new_values)
  VALUES (p_company_id, p_user_id, 'create', 'project_task_dependency', v_row.id, to_jsonb(v_row));
  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_task_dependency_atomic(
  p_company_id UUID, p_dependency_id UUID, p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_row project_task_dependencies%ROWTYPE;
BEGIN
  PERFORM assert_relationship_actor(p_company_id, p_user_id);
  SELECT * INTO v_row FROM project_task_dependencies
    WHERE id = p_dependency_id AND company_id = p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الاعتمادية غير موجودة'; END IF;

  PERFORM set_config('app.task_dependency_write_company', p_company_id::TEXT, TRUE);
  DELETE FROM project_task_dependencies WHERE id = p_dependency_id AND company_id = p_company_id;
  INSERT INTO audit_log(company_id, user_id, action, entity_type, entity_id, old_values)
  VALUES (p_company_id, p_user_id, 'delete', 'project_task_dependency', v_row.id, to_jsonb(v_row));
  RETURN to_jsonb(v_row);
END;
$$;

-- Direct writes bypass the tenant + cycle checks above, so block them the same
-- way project budgets are protected.
CREATE OR REPLACE FUNCTION public.guard_task_dependency_write()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_company UUID := COALESCE(NEW.company_id, OLD.company_id);
BEGIN
  IF TG_OP='UPDATE' AND NEW.company_id IS DISTINCT FROM OLD.company_id THEN
    RAISE EXCEPTION 'dependency company is immutable';
  END IF;
  IF current_setting('app.business_data_reset', TRUE) = v_company::TEXT THEN
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  -- ON DELETE CASCADE from project_tasks must stay possible when a task is
  -- removed through its own audited function.
  IF TG_OP='DELETE' AND current_setting('app.relationship_write_company', TRUE) = v_company::TEXT THEN
    RETURN OLD;
  END IF;
  IF current_setting('app.task_dependency_write_company', TRUE) IS DISTINCT FROM v_company::TEXT THEN
    RAISE EXCEPTION 'task dependencies require audited functions';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_task_dependency_write ON project_task_dependencies;
CREATE TRIGGER trg_guard_task_dependency_write
BEFORE INSERT OR UPDATE OR DELETE ON project_task_dependencies
FOR EACH ROW EXECUTE FUNCTION public.guard_task_dependency_write();

-- ===== Critical path (CPM) ===================================================
-- Standard CPM over the finish-to-start graph, in calendar days.
--
--   duration = end_date - start_date + 1  (inclusive, matching the UI)
--   ES(t) = max(EF(pred) + lag)  over predecessors, else 0
--   EF(t) = ES(t) + duration
--   LF(t) = min(LS(succ) - lag)  over successors, else project finish
--   LS(t) = LF(t) - duration
--   total_float = LS - ES ; critical ⇔ total_float <= 0
--
-- Tasks with no dependency edges at all are scheduled by their own dates and
-- are only critical when they genuinely finish at the project end date.
CREATE OR REPLACE FUNCTION public.get_project_critical_path(
  p_company_id UUID, p_project_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public STABLE AS $$
DECLARE v_result JSONB;
BEGIN
  IF p_company_id IS NULL OR p_project_id IS NULL THEN
    RETURN jsonb_build_object('tasks', '[]'::JSONB, 'criticalPath', '[]'::JSONB, 'hasCycle', FALSE);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM projects WHERE id = p_project_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('tasks', '[]'::JSONB, 'criticalPath', '[]'::JSONB, 'hasCycle', FALSE);
  END IF;

  WITH RECURSIVE
  task AS (
    SELECT t.id, t.name, t.start_date, t.end_date,
           GREATEST((t.end_date - t.start_date) + 1, 1) AS duration,
           COALESCE(t.progress, 0) AS progress
    FROM project_tasks t
    WHERE t.company_id = p_company_id AND t.project_id = p_project_id
  ),
  edge AS (
    -- Only edges whose BOTH endpoints are inside this project/tenant.
    SELECT d.successor_task_id, d.predecessor_task_id, d.lag_days
    FROM project_task_dependencies d
    JOIN task s ON s.id = d.successor_task_id
    JOIN task p ON p.id = d.predecessor_task_id
    WHERE d.company_id = p_company_id AND d.project_id = p_project_id
  ),
  -- Forward pass. Depth is bounded by the task count, which also makes a
  -- (guarded-against but defensively handled) cycle terminate.
  forward(id, duration, ef, depth) AS (
    SELECT t.id, t.duration, t.duration, 1
    FROM task t
    WHERE NOT EXISTS (SELECT 1 FROM edge e WHERE e.successor_task_id = t.id)
    UNION ALL
    SELECT t.id, t.duration, f.ef + e.lag_days + t.duration, f.depth + 1
    FROM forward f
    JOIN edge e ON e.predecessor_task_id = f.id
    JOIN task t ON t.id = e.successor_task_id
    WHERE f.depth <= (SELECT count(*) FROM task)
  ),
  early AS (
    SELECT t.id, t.duration, COALESCE(MAX(f.ef), t.duration) AS ef
    FROM task t LEFT JOIN forward f ON f.id = t.id
    GROUP BY t.id, t.duration
  ),
  finish AS (SELECT COALESCE(MAX(ef), 0) AS project_finish FROM early),
  -- Backward pass from the project finish.
  backward(id, duration, ls, depth) AS (
    SELECT e.id, e.duration, (SELECT project_finish FROM finish) - e.duration, 1
    FROM early e
    WHERE NOT EXISTS (SELECT 1 FROM edge d WHERE d.predecessor_task_id = e.id)
    UNION ALL
    SELECT e.id, e.duration, b.ls - d.lag_days - e.duration, b.depth + 1
    FROM backward b
    JOIN edge d ON d.successor_task_id = b.id
    JOIN early e ON e.id = d.predecessor_task_id
    WHERE b.depth <= (SELECT count(*) FROM task)
  ),
  late AS (
    SELECT e.id, e.duration, e.ef,
           COALESCE(MIN(b.ls), (SELECT project_finish FROM finish) - e.duration) AS ls
    FROM early e LEFT JOIN backward b ON b.id = e.id
    GROUP BY e.id, e.duration, e.ef
  ),
  scheduled AS (
    SELECT l.id, t.name, t.start_date, t.end_date, l.duration, t.progress,
           l.ef - l.duration AS es, l.ef, l.ls, l.ls + l.duration AS lf,
           l.ls - (l.ef - l.duration) AS total_float
    FROM late l JOIN task t ON t.id = l.id
  )
  SELECT jsonb_build_object(
    'tasks', COALESCE(jsonb_agg(jsonb_build_object(
      'id', s.id, 'name', s.name,
      'earliestStart', s.es, 'earliestFinish', s.ef,
      'latestStart', s.ls, 'latestFinish', s.lf,
      'totalFloat', s.total_float,
      'isCritical', s.total_float <= 0
    ) ORDER BY s.es, s.end_date), '[]'::JSONB),
    'criticalPath', COALESCE((
      SELECT jsonb_agg(c.id ORDER BY c.es, c.end_date)
      FROM scheduled c WHERE c.total_float <= 0
    ), '[]'::JSONB),
    'projectDuration', (SELECT project_finish FROM finish),
    'hasCycle', FALSE
  ) INTO v_result
  FROM scheduled s;

  RETURN COALESCE(v_result,
    jsonb_build_object('tasks', '[]'::JSONB, 'criticalPath', '[]'::JSONB, 'hasCycle', FALSE));
END;
$$;

REVOKE ALL ON FUNCTION public.create_task_dependency_atomic(UUID,UUID,UUID,INT,UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_task_dependency_atomic(UUID,UUID,UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_project_critical_path(UUID,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_task_dependency_atomic(UUID,UUID,UUID,INT,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_task_dependency_atomic(UUID,UUID,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_project_critical_path(UUID,UUID) TO service_role;
