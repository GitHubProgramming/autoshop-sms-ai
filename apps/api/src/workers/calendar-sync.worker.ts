import { Worker, Job } from "bullmq";
import { bullmqConnection as connection } from "../queues/redis";
import { moveToDeadLetter } from "../queues/dead-letter";
import { createCalendarEvent, type CalendarEventInput } from "../services/google-calendar";
import { raiseAlert } from "../services/pipeline-alerts";
import { query } from "../db/client";
import { createLogger } from "../utils/logger";

const log = createLogger("calendar-sync-worker");

/**
 * BullMQ worker: retries failed Google Calendar sync jobs.
 *
 * When calendar sync fails during the booking flow (process-sms),
 * a retry job is enqueued here with exponential backoff. On success,
 * the appointment is upgraded to CONFIRMED_CALENDAR. On final failure
 * (all retries exhausted), a critical pipeline alert is raised.
 *
 * Job data: CalendarEventInput (tenantId, appointmentId, etc.)
 */
export function startCalendarSyncWorker(): Worker {
  const worker = new Worker(
    "calendar-sync",
    async (job: Job<CalendarEventInput>) => {
      const input = job.data;
      log.info(
        { appointmentId: input.appointmentId, attempt: job.attemptsMade + 1 },
        "Retrying calendar sync"
      );

      const result = await createCalendarEvent(input);

      if (!result.calendarSynced) {
        throw new Error(result.error ?? "Calendar sync failed");
      }

      // Success — upgrade appointment to CONFIRMED_CALENDAR
      try {
        await query(
          `UPDATE appointments SET booking_state = 'CONFIRMED_CALENDAR' WHERE id = $1 AND tenant_id = $2`,
          [input.appointmentId, input.tenantId]
        );
      } catch {
        // Non-fatal: event was created even if state update fails
      }

      log.info(
        { appointmentId: input.appointmentId, googleEventId: result.googleEventId },
        "Calendar sync succeeded"
      );
    },
    {
      connection,
      concurrency: 5,
    }
  );

  worker.on("completed", (job) => {
    log.info(
      { jobId: job.id, appointmentId: job.data.appointmentId },
      "Job completed — appointment synced"
    );
  });

  worker.on("failed", (job, err) => {
    log.error(
      { jobId: job?.id, attempt: job?.attemptsMade, err: err.message },
      "Job failed"
    );

    // Raise critical alert when all retries exhausted
    const attempts = job?.attemptsMade ?? 0;
    const maxAttempts = job?.opts?.attempts ?? 4;
    if (attempts >= maxAttempts) {
      const input = job?.data as CalendarEventInput | undefined;
      raiseAlert({
        tenantId: input?.tenantId ?? null,
        traceId: null,
        severity: "critical",
        alertType: "calendar_sync_failed",
        summary: `Calendar sync failed after ${maxAttempts} retries for appointment ${input?.appointmentId ?? "unknown"}`,
        details: err.message,
      }).catch(() => { /* non-fatal */ });

      // Preserve in dead letter queue for inspection/replay
      moveToDeadLetter("calendar-sync", job, err);
    }
  });

  return worker;
}
