-- TraceForge AI security hardening for the authenticated live workspace.
-- Apply after 001_traceforge.sql.

-- UPDATE policies explicitly constrain both the existing row and the new row.
DROP POLICY IF EXISTS "own profile update" ON public.profiles;
CREATE POLICY "own profile update"
ON public.profiles FOR UPDATE TO authenticated
USING ((select auth.uid()) = id)
WITH CHECK ((select auth.uid()) = id);

DROP POLICY IF EXISTS "admins update workspace" ON public.workspaces;
CREATE POLICY "admins update workspace"
ON public.workspaces FOR UPDATE TO authenticated
USING (public.is_workspace_admin(id))
WITH CHECK (public.is_workspace_admin(id));

DROP POLICY IF EXISTS "admins update projects" ON public.projects;
CREATE POLICY "admins update projects"
ON public.projects FOR UPDATE TO authenticated
USING (public.is_workspace_admin(workspace_id))
WITH CHECK (public.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "admins revoke keys" ON public.api_keys;
CREATE POLICY "admins revoke keys"
ON public.api_keys FOR UPDATE TO authenticated
USING (public.is_project_admin(project_id))
WITH CHECK (public.is_project_admin(project_id));

DROP POLICY IF EXISTS "members update anomalies" ON public.anomalies;
CREATE POLICY "members update anomalies"
ON public.anomalies FOR UPDATE TO authenticated
USING (public.can_access_project(project_id))
WITH CHECK (public.can_access_project(project_id));

-- The frontend only needs the non-sensitive API-key columns.
REVOKE ALL ON public.api_keys FROM authenticated;
GRANT SELECT (id, project_id, name, prefix, created_by, created_at, last_used_at, revoked_at)
  ON public.api_keys TO authenticated;
GRANT UPDATE (revoked_at, name) ON public.api_keys TO authenticated;

-- Explicit table privileges for Data API access.
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT, UPDATE ON public.workspaces TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_members TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO authenticated;
GRANT SELECT, DELETE ON public.traces TO authenticated;
GRANT SELECT ON public.spans TO authenticated;
GRANT SELECT ON public.daily_metrics TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.anomalies TO authenticated;

-- Defense in depth: API-key hashes remain inaccessible from browser roles.
REVOKE SELECT (key_hash) ON public.api_keys FROM anon, authenticated;

-- Keep privileged helpers off PUBLIC/anon. The live app calls only authenticated helpers.
REVOKE EXECUTE ON FUNCTION public.create_workspace(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.bootstrap_workspace() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_api_key(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.generate_demo_telemetry(uuid, int) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.clear_demo_telemetry(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_workspace(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bootstrap_workspace() TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_api_key(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_demo_telemetry(uuid, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.clear_demo_telemetry(uuid) TO authenticated;
