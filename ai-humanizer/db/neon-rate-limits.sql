-- Run once in the Neon SQL editor, using the same database/role as DATABASE_URL.
-- Safe to rerun. This stores only hashed counter keys, counts, and expirations.
BEGIN;

CREATE TABLE IF NOT EXISTS public.toned_rate_limits (
  counter_key text PRIMARY KEY,
  request_count bigint NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  expires_at timestamptz NOT NULL,
  CONSTRAINT toned_rate_limits_key_format CHECK (
    counter_key ~ '^toned:stage:v1:client:[0-9a-f]{64}:[0-9]{1,16}$'
    OR counter_key ~ '^toned:stage:v1:global:[0-9]{1,16}$'
  )
);

CREATE INDEX IF NOT EXISTS toned_rate_limits_expiration
  ON public.toned_rate_limits (expires_at, counter_key);

CREATE OR REPLACE FUNCTION public.toned_consume_capacity(
  p_client_key text,
  p_global_key text,
  p_client_limit integer,
  p_global_limit integer,
  p_client_ttl integer,
  p_global_ttl integer
) RETURNS integer[]
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
SET lock_timeout = '3s'
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  client_count bigint;
  global_count bigint;
  client_expiration timestamptz;
  global_expiration timestamptz;
  created_global boolean;
BEGIN
  -- Keep keys in disjoint, bounded namespaces. Raw IPs and document text cannot
  -- accidentally become persisted identifiers through this interface.
  IF p_client_key IS NULL
      OR p_client_key !~ '^toned:stage:v1:client:[0-9a-f]{64}:[0-9]{1,16}$'
      OR p_global_key IS NULL
      OR p_global_key !~ '^toned:stage:v1:global:[0-9]{1,16}$'
      OR p_client_limit IS NULL OR p_client_limit NOT BETWEEN 1 AND 300
      OR p_global_limit IS NULL OR p_global_limit NOT BETWEEN 1 AND 100000
      OR p_client_ttl IS NULL OR p_client_ttl NOT BETWEEN 1 AND 3600
      OR p_global_ttl IS NULL OR p_global_ttl NOT BETWEEN 1 AND 86400 THEN
    RAISE EXCEPTION 'Invalid rate-limit parameters' USING ERRCODE = '22023';
  END IF;

  -- Every caller acquires the global row before the client row. Concurrent
  -- requests therefore cannot each spend the final shared allowance. Both
  -- checks and increments run in this one PostgreSQL transaction.
  INSERT INTO public.toned_rate_limits (counter_key, expires_at)
  VALUES (p_global_key, v_now + make_interval(secs => p_global_ttl))
  ON CONFLICT (counter_key) DO NOTHING
  RETURNING true INTO created_global;

  SELECT request_count, expires_at INTO global_count, global_expiration
  FROM public.toned_rate_limits WHERE counter_key = p_global_key FOR UPDATE;

  IF global_expiration <= v_now THEN global_count := 0; END IF;
  IF global_count >= p_global_limit THEN
    -- Do not allocate a new client row when the global budget is exhausted.
    -- An existing full client retains the same error priority as the Redis path.
    SELECT request_count, expires_at INTO client_count, client_expiration
    FROM public.toned_rate_limits WHERE counter_key = p_client_key FOR UPDATE;
    IF FOUND AND client_expiration > v_now AND client_count >= p_client_limit THEN
      RETURN ARRAY[0, p_client_ttl, 1];
    END IF;
    RETURN ARRAY[0, p_global_ttl, 2];
  END IF;

  INSERT INTO public.toned_rate_limits (counter_key, expires_at)
  VALUES (p_client_key, v_now + make_interval(secs => p_client_ttl))
  ON CONFLICT (counter_key) DO NOTHING;

  SELECT request_count, expires_at INTO client_count, client_expiration
  FROM public.toned_rate_limits WHERE counter_key = p_client_key FOR UPDATE;

  -- Cleanup follows active-row locking so it cannot invert the lock order.
  -- Bound work, skip other transactions' rows, and leave our active keys alone.
  DELETE FROM public.toned_rate_limits
  WHERE counter_key IN (
    SELECT counter_key FROM public.toned_rate_limits
    WHERE expires_at <= v_now AND counter_key NOT IN (p_client_key, p_global_key)
    ORDER BY expires_at, counter_key
    LIMIT 256
    FOR UPDATE SKIP LOCKED
  );

  -- An expired row left by bounded cleanup behaves like a missing Redis key.
  IF client_expiration <= v_now THEN client_count := 0; END IF;

  IF client_count >= p_client_limit THEN
    -- A client window can overlap UTC midnight. Do not retain a newly created
    -- zero-count global row when that existing client is already blocked.
    IF created_global THEN
      DELETE FROM public.toned_rate_limits WHERE counter_key = p_global_key;
    END IF;
    RETURN ARRAY[0, p_client_ttl, 1];
  END IF;

  UPDATE public.toned_rate_limits
  SET request_count = global_count + 1,
      expires_at = CASE WHEN global_expiration <= v_now
        THEN v_now + make_interval(secs => p_global_ttl) ELSE global_expiration END
  WHERE counter_key = p_global_key;

  UPDATE public.toned_rate_limits
  SET request_count = client_count + 1,
      expires_at = CASE WHEN client_expiration <= v_now
        THEN v_now + make_interval(secs => p_client_ttl) ELSE client_expiration END
  WHERE counter_key = p_client_key;

  RETURN ARRAY[1, 0, 0];
END;
$$;

-- The default Neon owner used to run this migration retains access. A separate
-- runtime role needs explicit table SELECT/INSERT/UPDATE/DELETE and function
-- EXECUTE grants; do not grant this API to every database role.
REVOKE ALL ON TABLE public.toned_rate_limits FROM PUBLIC;
REVOKE ALL ON FUNCTION public.toned_consume_capacity(text, text, integer, integer, integer, integer) FROM PUBLIC;

COMMIT;
