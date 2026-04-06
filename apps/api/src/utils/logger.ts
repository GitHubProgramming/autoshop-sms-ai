import pino from "pino";

/** Create a named pino logger for workers and services that run outside Fastify request context. */
export function createLogger(name: string) {
  return pino({ name });
}
