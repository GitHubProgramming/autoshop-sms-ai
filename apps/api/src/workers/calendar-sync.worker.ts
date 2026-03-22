import { Worker, Job } from "bullmq";
import { bullmqConnection as connection } from "../queues/redis";
import { moveToDeadLetter } from "../queues/dead-letter";
import { createCalendarEvent, type CalendarEventInput } from "../services/google-calendar";
import { raiseAlert } from "../services/pipeline-alerts";
import { query } from "../db/client";

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
      console.info(
        `[calendar-sync-worker] Retrying calendar sync for appointment ${input.appointmentId} (attempt ${job.attemptsMade + 1})`
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

      console.info(
        `[calendar-sync-worker] Calendar sync succeeded for appointment ${input.appointmentId} (event: ${result.googleEventId})`
      );
    },
    {
      connection,
      concurrency: 5,
    }
  );

  worker.on("completed", (job) => {
    console.info(
      `[calendar-sync-worker] job ${job.id} completed — appointment ${job.data.appointmentId} synced`
    );
  });

  worker.on("failed", (job, err) => {
    console.error(
      `[calendar-sync-worker] job ${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`
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
