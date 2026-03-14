import { FastifyInstance } from "fastify";
import { detectBookingIntent } from "../../services/booking-intent";

/**
 * POST /internal/booking-intent
 *
 * Accepts AI response + customer message, returns structured booking intent.
 * Designed for n8n WF-002 to call instead of inline keyword matching.
 *
 * Body: { aiResponse: string, customerMessage: string }
 * Returns: BookingIntentResult
 */
export async function bookingIntentRoute(app: FastifyInstance) {
  app.post("/booking-intent", async (request, reply) => {
    const { aiResponse, customerMessage } = request.body as {
      aiResponse?: string;
      customerMessage?: string;
    };

    if (
      typeof aiResponse !== "string" ||
      typeof customerMessage !== "string"
    ) {
      return reply.status(400).send({
        error: "aiResponse and customerMessage are required strings",
      });
    }

    const result = detectBookingIntent(aiResponse, customerMessage);
    return reply.status(200).send(result);
  });
}
