-- FIRST: deploy health-worker and set its HEALTH_CRON_SECRET environment secret.
-- THEN: replace the placeholder value below with the SAME secret.
-- Run in Supabase SQL Editor. Never put the real secret into Git or frontend files.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select vault.create_secret('https://ywkeuvdhtrmhtsugbntj.supabase.co', 'get_web_health_project_url');
select vault.create_secret('REPLACE_WITH_YOUR_RANDOM_CRON_SECRET', 'get_web_health_cron_secret');

select cron.schedule(
  'get-web-health-tick',
  '* * * * *',
  $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'get_web_health_project_url') || '/functions/v1/health-worker',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'get_web_health_cron_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 110000
    );
  $job$
);

-- Keep only 7 days of check history to bound database growth.
select cron.schedule(
  'get-web-health-cleanup', '17 3 * * *',
  $job$ delete from public.health_checks where checked_at < now() - interval '7 days'; $job$
);

-- Verify after the first minute:
-- select * from public.scheduler_status;
-- select jobname, schedule, active from cron.job where jobname like 'get-web-health-%';
-- select status, return_message from cron.job_run_details order by start_time desc limit 5;
