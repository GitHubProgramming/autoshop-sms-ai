import { FastifyInstance } from "fastify";
import { z } from "zod";
import { createAppointment } from "../../services/appointments";

const BodySchema = z.object({
  tenantId: z.string().uuid(),
  conversationId: z.string().uuid().nullable().optional(),
  customerPhone: z.string().min(1),
  customerName: z.string().nullable().optional(),
  serviceType: z.string().nullable().optional(),
  scheduledAt: z.string().min(1),
  durationMinutes: z.number().int().positive().optional(),
  notes: z.string().nullable().optional(),
});

/**
 * POST /internal/appointments
 *
 * Creates (or upserts) an appointment record after booking intent is detected.
 * When conversationId is provided, enforces one appointment per conversation.
 *
 * Called by n8n WF-002 (ai-booking-worker) or directly after booking detection.
 * Internal only — NOT exposed externally (nginx does not proxy /internal/).
 */
export async function appointmentsRoute(app: FastifyInstance) {
  app.post("/appointments", async (request, reply) => {
    const parsed = BodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Validation failed",
        details: parsed.error.issues.map(
          (i) => `${i.path.join(".")}: ${i.message}`
        ),
      });
    }

    const result = await createAppointment(parsed.data);

    request.log.info(
      {
        tenantId: parsed.data.tenantId,
        conversationId: parsed.data.conversationId,
        success: result.success,
        upserted: result.upserted,
        appointmentId: result.appointment?.id,
      },
      result.success
        ? `Appointment ${result.upserted ? "updated" : "created"}`
        : `Appointment creation failed: ${result.error}`
    );

    if (!result.success) {
      const status = result.error === "Tenant not found" ? 404 : 500;
      return reply.status(status).send(result);
    }

    const status = result.upserted ? 200 : 201;
    return reply.status(status).send(result);
  });
}
