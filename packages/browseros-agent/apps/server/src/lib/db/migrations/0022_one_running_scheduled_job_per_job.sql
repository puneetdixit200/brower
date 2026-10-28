-- Duplicate unresolved runs represent uncertain execution state. Fail them closed
-- before installing the durable per-job running lock.
UPDATE scheduled_job_runs
SET status = 'failed',
    error = 'Execution state is uncertain after overlapping scheduled runs'
WHERE status = 'running'
  AND job_id IN (
    SELECT job_id
    FROM scheduled_job_runs
    WHERE status = 'running'
    GROUP BY job_id
    HAVING COUNT(*) > 1
  );
--> statement-breakpoint
CREATE UNIQUE INDEX `scheduled_job_runs_one_running_per_job`
ON `scheduled_job_runs` (`job_id`) WHERE `status` = 'running';
