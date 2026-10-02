CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ============ TABLES ============
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.workspaces TO authenticated;
GRANT ALL ON public.workspaces TO service_role;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.workspace_members (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX ON public.workspace_members(user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_members TO authenticated;
GRANT ALL ON public.workspace_members TO service_role;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  is_demo boolean NOT NULL DEFAULT false,
  retention_days int NOT NULL DEFAULT 30 CHECK (retention_days BETWEEN 1 AND 365),
  environments text[] NOT NULL DEFAULT ARRAY['production','staging','development'],
  default_environment text NOT NULL DEFAULT 'production',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.projects(workspace_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO authenticated;
GRANT ALL ON public.projects TO service_role;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  prefix text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX ON public.api_keys(project_id);
-- key_hash is never readable by clients
GRANT SELECT (id, project_id, name, prefix, created_by, created_at, last_used_at, revoked_at) ON public.api_keys TO authenticated;
GRANT UPDATE (revoked_at, name) ON public.api_keys TO authenticated;
GRANT ALL ON public.api_keys TO service_role;
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.traces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  trace_id text NOT NULL,
  ts timestamptz NOT NULL DEFAULT now(),
  provider text NOT NULL,
  model text NOT NULL,
  status text NOT NULL CHECK (status IN ('success','error')),
  status_code int,
  error_message text,
  latency_ms int NOT NULL CHECK (latency_ms >= 0),
  input_tokens int NOT NULL DEFAULT 0,
  output_tokens int NOT NULL DEFAULT 0,
  cost_usd numeric(14,6) NOT NULL DEFAULT 0,
  environment text NOT NULL DEFAULT 'production',
  route text,
  tags text[] NOT NULL DEFAULT '{}',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_synthetic boolean NOT NULL DEFAULT false,
  api_key_id uuid REFERENCES public.api_keys(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX traces_project_ts_idx ON public.traces(project_id, ts DESC);
CREATE INDEX traces_trace_id_idx ON public.traces(project_id, trace_id);
CREATE INDEX traces_api_key_created_idx ON public.traces(api_key_id, created_at);
GRANT SELECT, DELETE ON public.traces TO authenticated;
GRANT ALL ON public.traces TO service_role;
ALTER TABLE public.traces ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.spans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trace_row_id uuid NOT NULL REFERENCES public.traces(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'internal',
  start_offset_ms int NOT NULL DEFAULT 0,
  duration_ms int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'ok',
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX ON public.spans(trace_row_id);
GRANT SELECT ON public.spans TO authenticated;
GRANT ALL ON public.spans TO service_role;
ALTER TABLE public.spans ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.anomalies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('latency_spike','error_rate_jump','token_explosion','cost_spike')),
  severity text NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  metric text NOT NULL,
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  observed double precision NOT NULL,
  baseline double precision NOT NULL,
  score double precision NOT NULL,
  method text NOT NULL,
  reason text NOT NULL,
  suggestions text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, kind, window_start)
);
CREATE INDEX ON public.anomalies(project_id, window_start DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.anomalies TO authenticated;
GRANT ALL ON public.anomalies TO service_role;
ALTER TABLE public.anomalies ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.daily_metrics (
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  day date NOT NULL,
  requests int NOT NULL,
  errors int NOT NULL,
  p50_ms double precision,
  p95_ms double precision,
  p99_ms double precision,
  input_tokens bigint NOT NULL,
  output_tokens bigint NOT NULL,
  cost_usd numeric(14,6) NOT NULL,
  PRIMARY KEY (project_id, day)
);
GRANT SELECT ON public.daily_metrics TO authenticated;
GRANT ALL ON public.daily_metrics TO service_role;
ALTER TABLE public.daily_metrics ENABLE ROW LEVEL SECURITY;

-- ============ ACCESS HELPERS (security definer avoids RLS recursion) ============
CREATE OR REPLACE FUNCTION public.is_workspace_member(_ws uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id = _ws AND user_id = auth.uid())
$$;
CREATE OR REPLACE FUNCTION public.is_workspace_admin(_ws uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id = _ws AND user_id = auth.uid() AND role IN ('owner','admin'))
$$;
CREATE OR REPLACE FUNCTION public.can_access_project(_p uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM projects p JOIN workspace_members m ON m.workspace_id = p.workspace_id
                 WHERE p.id = _p AND m.user_id = auth.uid())
$$;
CREATE OR REPLACE FUNCTION public.is_project_admin(_p uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM projects p JOIN workspace_members m ON m.workspace_id = p.workspace_id
                 WHERE p.id = _p AND m.user_id = auth.uid() AND m.role IN ('owner','admin'))
$$;

-- ============ POLICIES ============
CREATE POLICY "own profile read" ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY "own profile insert" ON public.profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
CREATE POLICY "own profile update" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid());

CREATE POLICY "members read workspace" ON public.workspaces FOR SELECT TO authenticated USING (public.is_workspace_member(id));
CREATE POLICY "admins update workspace" ON public.workspaces FOR UPDATE TO authenticated USING (public.is_workspace_admin(id));

CREATE POLICY "members read members" ON public.workspace_members FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));
CREATE POLICY "admins manage members" ON public.workspace_members FOR ALL TO authenticated
  USING (public.is_workspace_admin(workspace_id)) WITH CHECK (public.is_workspace_admin(workspace_id));

CREATE POLICY "members read projects" ON public.projects FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));
CREATE POLICY "admins insert projects" ON public.projects FOR INSERT TO authenticated WITH CHECK (public.is_workspace_admin(workspace_id));
CREATE POLICY "admins update projects" ON public.projects FOR UPDATE TO authenticated USING (public.is_workspace_admin(workspace_id));
CREATE POLICY "admins delete projects" ON public.projects FOR DELETE TO authenticated USING (public.is_workspace_admin(workspace_id));

CREATE POLICY "members read keys" ON public.api_keys FOR SELECT TO authenticated USING (public.can_access_project(project_id));
CREATE POLICY "admins revoke keys" ON public.api_keys FOR UPDATE TO authenticated USING (public.is_project_admin(project_id));

CREATE POLICY "members read traces" ON public.traces FOR SELECT TO authenticated USING (public.can_access_project(project_id));
CREATE POLICY "admins delete traces" ON public.traces FOR DELETE TO authenticated USING (public.is_project_admin(project_id));
CREATE POLICY "members read spans" ON public.spans FOR SELECT TO authenticated USING (public.can_access_project(project_id));
CREATE POLICY "members read metrics" ON public.daily_metrics FOR SELECT TO authenticated USING (public.can_access_project(project_id));

CREATE POLICY "members read anomalies" ON public.anomalies FOR SELECT TO authenticated USING (public.can_access_project(project_id));
CREATE POLICY "members write anomalies" ON public.anomalies FOR INSERT TO authenticated WITH CHECK (public.can_access_project(project_id));
CREATE POLICY "members update anomalies" ON public.anomalies FOR UPDATE TO authenticated USING (public.can_access_project(project_id));
CREATE POLICY "admins delete anomalies" ON public.anomalies FOR DELETE TO authenticated USING (public.is_project_admin(project_id));

-- ============ WORKSPACE BOOTSTRAP ============
CREATE OR REPLACE FUNCTION public.create_workspace(_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _ws uuid; _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF length(trim(coalesce(_name,''))) < 2 THEN RAISE EXCEPTION 'workspace name too short'; END IF;
  INSERT INTO workspaces(name, created_by) VALUES (left(trim(_name), 60), _uid) RETURNING id INTO _ws;
  INSERT INTO workspace_members(workspace_id, user_id, role) VALUES (_ws, _uid, 'owner');
  INSERT INTO projects(workspace_id, name) VALUES (_ws, 'Default project');
  RETURN _ws;
END $$;

CREATE OR REPLACE FUNCTION public.bootstrap_workspace()
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _ws uuid; _uid uuid := auth.uid(); _email text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT workspace_id INTO _ws FROM workspace_members WHERE user_id = _uid ORDER BY created_at LIMIT 1;
  IF _ws IS NOT NULL THEN RETURN _ws; END IF;
  _email := coalesce(auth.jwt() ->> 'email', 'engineer');
  INSERT INTO profiles(id, display_name) VALUES (_uid, split_part(_email, '@', 1)) ON CONFLICT (id) DO NOTHING;
  INSERT INTO workspaces(name, created_by) VALUES (split_part(_email, '@', 1) || '''s workspace', _uid) RETURNING id INTO _ws;
  INSERT INTO workspace_members(workspace_id, user_id, role) VALUES (_ws, _uid, 'owner');
  INSERT INTO projects(workspace_id, name, is_demo) VALUES (_ws, 'Demo: support-assistant', true);
  RETURN _ws;
END $$;

-- ============ API KEYS (plaintext returned once, only SHA-256 stored) ============
CREATE OR REPLACE FUNCTION public.create_api_key(_project uuid, _name text)
RETURNS TABLE(id uuid, api_key text, prefix text) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE _key text; _id uuid; _prefix text;
BEGIN
  IF NOT public.is_project_admin(_project) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF length(trim(coalesce(_name,''))) < 2 THEN RAISE EXCEPTION 'name too short'; END IF;
  _key := 'tf_live_' || encode(extensions.gen_random_bytes(24), 'hex');
  _prefix := left(_key, 14);
  INSERT INTO api_keys(project_id, name, prefix, key_hash, created_by)
  VALUES (_project, left(trim(_name), 60), _prefix, encode(extensions.digest(_key, 'sha256'), 'hex'), auth.uid())
  RETURNING api_keys.id INTO _id;
  RETURN QUERY SELECT _id, _key, _prefix;
END $$;

-- ============ INGESTION (called by /api/v1/traces after Zod validation) ============
CREATE OR REPLACE FUNCTION public.ingest_trace(_api_key text, _payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE _k record; _recent int; _row uuid; _tid text; _limit int := 600;
BEGIN
  SELECT k.id, k.project_id INTO _k FROM api_keys k
   WHERE k.key_hash = encode(extensions.digest(coalesce(_api_key,''), 'sha256'), 'hex') AND k.revoked_at IS NULL;
  IF _k.id IS NULL THEN RETURN jsonb_build_object('error','invalid_api_key'); END IF;
  SELECT count(*) INTO _recent FROM traces WHERE api_key_id = _k.id AND created_at > now() - interval '1 minute';
  IF _recent >= _limit THEN RETURN jsonb_build_object('error','rate_limited','limit_per_minute',_limit); END IF;

  _tid := coalesce(nullif(_payload->>'trace_id',''), 'tr_' || encode(extensions.gen_random_bytes(10), 'hex'));
  INSERT INTO traces(project_id, trace_id, ts, provider, model, status, status_code, error_message, latency_ms,
                     input_tokens, output_tokens, cost_usd, environment, route, tags, metadata, api_key_id)
  VALUES (_k.project_id, _tid,
    coalesce((_payload->>'timestamp')::timestamptz, now()),
    _payload->>'provider', _payload->>'model', _payload->>'status',
    (_payload->>'status_code')::int, _payload->>'error_message',
    (_payload->>'latency_ms')::int,
    coalesce((_payload->>'input_tokens')::int, 0), coalesce((_payload->>'output_tokens')::int, 0),
    coalesce((_payload->>'cost_usd')::numeric, 0),
    coalesce(_payload->>'environment', 'production'), _payload->>'route',
    coalesce(ARRAY(SELECT jsonb_array_elements_text(_payload->'tags')), '{}'),
    coalesce(_payload->'metadata', '{}'::jsonb), _k.id)
  RETURNING traces.id INTO _row;

  IF jsonb_typeof(_payload->'spans') = 'array' THEN
    INSERT INTO spans(trace_row_id, project_id, name, kind, start_offset_ms, duration_ms, status, attributes)
    SELECT _row, _k.project_id, s->>'name', coalesce(s->>'kind','internal'),
           coalesce((s->>'start_offset_ms')::int,0), coalesce((s->>'duration_ms')::int,0),
           coalesce(s->>'status','ok'), coalesce(s->'attributes','{}'::jsonb)
    FROM jsonb_array_elements(_payload->'spans') s;
  END IF;
  UPDATE api_keys SET last_used_at = now() WHERE api_keys.id = _k.id;
  RETURN jsonb_build_object('id', _row, 'trace_id', _tid);
END $$;

-- ============ AGGREGATION HELPERS (security invoker: RLS applies) ============
CREATE OR REPLACE FUNCTION public.project_summary(_project uuid, _since timestamptz, _until timestamptz DEFAULT now())
RETURNS TABLE(requests bigint, errors bigint, success_rate double precision, p50_ms double precision, p95_ms double precision,
              p99_ms double precision, input_tokens bigint, output_tokens bigint, cost_usd double precision)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT count(*), count(*) FILTER (WHERE status='error'),
         CASE WHEN count(*)=0 THEN NULL ELSE 1 - (count(*) FILTER (WHERE status='error'))::double precision / count(*) END,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms),
         percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms),
         percentile_cont(0.99) WITHIN GROUP (ORDER BY latency_ms),
         coalesce(sum(input_tokens),0)::bigint, coalesce(sum(output_tokens),0)::bigint, coalesce(sum(cost_usd),0)::double precision
  FROM traces WHERE project_id = _project AND ts >= _since AND ts < _until
$$;

CREATE OR REPLACE FUNCTION public.metric_series(_project uuid, _since timestamptz, _bucket text DEFAULT 'hour')
RETURNS TABLE(bucket timestamptz, requests bigint, errors bigint, p50_ms double precision, p95_ms double precision,
              p99_ms double precision, avg_tokens double precision, total_tokens bigint, cost_usd double precision)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT date_trunc(CASE WHEN _bucket IN ('hour','day') THEN _bucket ELSE 'hour' END, ts) AS b,
         count(*), count(*) FILTER (WHERE status='error'),
         percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms),
         percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms),
         percentile_cont(0.99) WITHIN GROUP (ORDER BY latency_ms),
         avg(input_tokens + output_tokens)::double precision,
         sum(input_tokens + output_tokens)::bigint, sum(cost_usd)::double precision
  FROM traces WHERE project_id = _project AND ts >= _since
  GROUP BY b ORDER BY b
$$;

CREATE OR REPLACE FUNCTION public.model_breakdown(_project uuid, _since timestamptz)
RETURNS TABLE(provider text, model text, requests bigint, error_rate double precision, p50_ms double precision,
              p95_ms double precision, avg_cost_usd double precision, total_cost_usd double precision, total_tokens bigint)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT provider, model, count(*),
         (count(*) FILTER (WHERE status='error'))::double precision / count(*),
         percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms),
         percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms),
         avg(cost_usd)::double precision, sum(cost_usd)::double precision,
         sum(input_tokens + output_tokens)::bigint
  FROM traces WHERE project_id = _project AND ts >= _since
  GROUP BY provider, model ORDER BY sum(cost_usd) DESC
$$;

CREATE OR REPLACE FUNCTION public.refresh_daily_metrics(_project uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.can_access_project(_project) THEN RAISE EXCEPTION 'forbidden'; END IF;
  DELETE FROM daily_metrics WHERE project_id = _project;
  INSERT INTO daily_metrics
  SELECT _project, (ts AT TIME ZONE 'UTC')::date, count(*), count(*) FILTER (WHERE status='error'),
         percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms),
         percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms),
         percentile_cont(0.99) WITHIN GROUP (ORDER BY latency_ms),
         sum(input_tokens), sum(output_tokens), sum(cost_usd)
  FROM traces WHERE project_id = _project GROUP BY 2;
END $$;

CREATE OR REPLACE FUNCTION public.apply_retention(_project uuid)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _days int; _n int;
BEGIN
  IF NOT public.is_project_admin(_project) THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT retention_days INTO _days FROM projects WHERE id = _project;
  DELETE FROM traces WHERE project_id = _project AND ts < now() - make_interval(days => _days);
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END $$;

-- ============ SYNTHETIC TELEMETRY GENERATOR ============
-- Deterministic (setseed) synthetic data with four injected incidents so
-- anomaly detection has real signal. Every row is flagged is_synthetic.
CREATE OR REPLACE FUNCTION public.generate_demo_telemetry(_project uuid, _days int DEFAULT 7)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE _n int; _now timestamptz := date_trunc('minute', now());
BEGIN
  IF NOT public.is_project_admin(_project) THEN RAISE EXCEPTION 'forbidden'; END IF;
  _days := greatest(1, least(_days, 14));
  _n := _days * 24 * 16;
  DELETE FROM traces WHERE project_id = _project AND is_synthetic;
  DELETE FROM anomalies WHERE project_id = _project;
  PERFORM setseed(0.42);

  INSERT INTO traces(project_id, trace_id, ts, provider, model, status, status_code, error_message, latency_ms,
                     input_tokens, output_tokens, cost_usd, environment, route, tags, metadata, is_synthetic)
  SELECT _project,
         'tr_' || substr(md5(_project::text || s.g::text), 1, 20),
         s.ts, m.provider, m.model,
         CASE WHEN c.is_err THEN 'error' ELSE 'success' END,
         CASE WHEN c.is_err THEN (ARRAY[429,500,503,504])[1 + floor(s.r5*4)::int] ELSE 200 END,
         CASE WHEN c.is_err THEN (ARRAY['rate limit exceeded','upstream internal error','service unavailable','gateway timeout'])[1 + floor(s.r5*4)::int] END,
         c.lat, c.in_tok, c.out_tok,
         round(((c.in_tok * m.in_price + c.out_tok * m.out_price) / 1000000.0)::numeric, 6),
         CASE WHEN s.env_r < 0.75 THEN 'production' WHEN s.env_r < 0.92 THEN 'staging' ELSE 'development' END,
         s.route,
         ARRAY[s.route, 'synthetic'],
         jsonb_build_object('synthetic', true, 'region', (ARRAY['us-east-1','eu-west-1','ap-south-1'])[1 + floor(s.r3*3)::int],
                            'user_tier', CASE WHEN s.r4 < 0.2 THEN 'enterprise' ELSE 'standard' END,
                            'temperature', round((s.r1*0.9)::numeric, 2), 'sdk', 'traceforge-demo-generator'),
         true
  FROM (
    SELECT g, r1, r2, r3, r4, r5, env_r, ts,
           (ARRAY['chat.completion','rag.answer','summarize.docs','classify.ticket','extract.entities'])[1 + floor(route_r*5)::int] AS route,
           CASE WHEN ts BETWEEN _now - interval '11 hours' AND _now - interval '9 hours' AND r2 < 0.7 THEN 3
                ELSE 1 + floor(model_r*7)::int END AS mi
    FROM (SELECT g, random() r1, random() r2, random() r3, random() r4, random() r5, random() env_r,
                 random() route_r, random() model_r,
                 _now - (random() * _days * 86400) * interval '1 second' AS ts
          FROM generate_series(1, _n) g) raw
  ) s
  JOIN (VALUES
    (1,'openai','gpt-4o',2.5,10.0,900),
    (2,'openai','gpt-4o-mini',0.15,0.6,450),
    (3,'anthropic','claude-3.5-sonnet',3.0,15.0,1100),
    (4,'anthropic','claude-3-haiku',0.25,1.25,380),
    (5,'google','gemini-1.5-pro',1.25,5.0,1000),
    (6,'google','gemini-1.5-flash',0.075,0.3,320),
    (7,'mistral','mistral-large',2.0,6.0,850)
  ) m(idx, provider, model, in_price, out_price, base_lat) ON m.idx = s.mi
  CROSS JOIN LATERAL (
    SELECT s.ts BETWEEN _now - interval '50 hours' AND _now - interval '48 hours' AS lat_spike,
           s.ts BETWEEN _now - interval '30 hours' AND _now - interval '29 hours' AS err_burst,
           s.ts BETWEEN _now - interval '74 hours' AND _now - interval '72 hours' AS tok_burst,
           s.ts BETWEEN _now - interval '11 hours' AND _now - interval '9 hours' AS cost_spike
  ) f
  CROSS JOIN LATERAL (
    SELECT (s.r5 < CASE WHEN f.err_burst THEN 0.38 ELSE 0.025 END) AS is_err,
           (200 + floor(s.r3 * 1800))::int * CASE WHEN f.cost_spike THEN 4 ELSE 1 END AS in_tok_raw,
           (60 + floor(s.r4 * 600))::int * CASE WHEN f.tok_burst THEN 9 ELSE 1 END AS out_tok_raw
  ) e
  CROSS JOIN LATERAL (
    SELECT e.is_err,
           e.in_tok_raw AS in_tok,
           CASE WHEN e.is_err THEN 0 ELSE e.out_tok_raw END AS out_tok,
           greatest(40, (m.base_lat * (0.6 + s.r1 * 0.8) * (1 + e.out_tok_raw / 2500.0)
                     * CASE WHEN s.r2 > 0.97 THEN 2.8 ELSE 1 END
                     * CASE WHEN f.lat_spike THEN 4.2 ELSE 1 END
                     * CASE WHEN e.is_err THEN 0.5 ELSE 1 END))::int AS lat
  ) c;

  INSERT INTO spans(trace_row_id, project_id, name, kind, start_offset_ms, duration_ms, status, attributes)
  SELECT t.id, t.project_id, sp.name, sp.kind,
         (t.latency_ms * sp.start_frac)::int, greatest(1, (t.latency_ms * sp.dur_frac)::int),
         CASE WHEN sp.name = 'llm.call' AND t.status = 'error' THEN 'error' ELSE 'ok' END,
         CASE WHEN sp.name = 'llm.call' THEN jsonb_build_object('provider', t.provider, 'model', t.model,
                'input_tokens', t.input_tokens, 'output_tokens', t.output_tokens)
              WHEN sp.name = 'retrieval.vector_search' THEN jsonb_build_object('top_k', 8, 'index', 'kb-articles')
              ELSE '{}'::jsonb END
  FROM traces t
  CROSS JOIN (VALUES ('request.received','server',0.0,0.01),
                     ('retrieval.vector_search','retrieval',0.01,0.12),
                     ('prompt.build','internal',0.13,0.03),
                     ('llm.call','llm',0.16,0.78),
                     ('response.parse','internal',0.94,0.05)) sp(name, kind, start_frac, dur_frac)
  WHERE t.project_id = _project AND t.is_synthetic;

  PERFORM public.refresh_daily_metrics(_project);
  RETURN _n;
END $$;

CREATE OR REPLACE FUNCTION public.clear_demo_telemetry(_project uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_project_admin(_project) THEN RAISE EXCEPTION 'forbidden'; END IF;
  DELETE FROM traces WHERE project_id = _project AND is_synthetic;
  DELETE FROM anomalies WHERE project_id = _project;
  PERFORM public.refresh_daily_metrics(_project);
END $$;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_workspace_member(uuid), public.is_workspace_admin(uuid),
  public.can_access_project(uuid), public.is_project_admin(uuid), public.create_workspace(text),
  public.bootstrap_workspace(), public.create_api_key(uuid, text), public.project_summary(uuid, timestamptz, timestamptz),
  public.metric_series(uuid, timestamptz, text), public.model_breakdown(uuid, timestamptz),
  public.refresh_daily_metrics(uuid), public.apply_retention(uuid), public.generate_demo_telemetry(uuid, int),
  public.clear_demo_telemetry(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_trace(text, jsonb) TO anon, authenticated;