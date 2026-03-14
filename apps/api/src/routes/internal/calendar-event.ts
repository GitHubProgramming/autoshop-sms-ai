import { FastifyInstance } from "fastify";
import { z } from "zod";
import { createCalendarEvent } from "../../services/google-calendar";

const BodySchema = z.object({
  tenantId: z.string().uuid(),
  appointmentId: z.string().uuid(),
  customerPhone: z.string().min(1),
  customerName: z.string().nullable().optional(),
  serviceType: z.string().min(1),
  scheduledAt: z.string().min(1),
  durationMinutes: z.number().int().positive().optional(),
  timeZone: z.string().optional(),
});

/**
 * POST /internal/calendar-event
 *
 * Creates a Google Calendar event for an appointment and updates the
 * appointment record with the event ID.
 *
 * Called by n8n WF-004 (calendar-sync) or directly after booking detection.
 * Internal only — NOT exposed externally (nginx does not proxy /internal/).
 */
export async function calendarEventRoute(app: FastifyInstance) {
  app.post("/calendar-event", async (request, reply) => {
    const parsed = BodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Validation failed",
        details: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
    }

    const result = await createCalendarEvent(parsed.data);

    request.log.info(
      {
        tenantId: parsed.data.tenantId,
        appointmentId: parsed.data.appointmentId,
        success: result.success,
        googleEventId: result.googleEventId,
      },
      result.success
        ? "Calendar event created"
        : `Calendar event failed: ${result.error}`
    );

    const status = result.success ? 200 : 502;
    return reply.status(status).send(result);
  });
}
