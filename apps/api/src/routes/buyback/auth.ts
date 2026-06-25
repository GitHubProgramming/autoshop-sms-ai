import { FastifyInstance } from "fastify";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { query } from "../../db/client";

const SignupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().optional(),
  timezone: z.string().optional(),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function bbAuthRoute(app: FastifyInstance) {
  app.post("/signup", async (request, reply) => {
    const parsed = SignupSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Validation failed",
        details: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
    }

    const { email, password, name, timezone } = parsed.data;

    const existing = await query(
      `SELECT id FROM buyback_users WHERE email = $1`,
      [email.toLowerCase()]
    ) as any[];
    if (existing.length > 0) {
      return reply.status(409).send({ error: "Email already registered." });
    }

    const hash = await bcrypt.hash(password, 10);
    const rows = await query(
      `INSERT INTO buyback_users (email, password_hash, name, timezone)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, name, timezone`,
      [email.toLowerCase(), hash, name || null, timezone || "Europe/Vilnius"]
    ) as any[];

    const user = rows[0];
    const token = app.jwt.sign(
      { userId: user.id, email: user.email },
      { expiresIn: "30d" }
    );

    return reply.status(201).send({ token, user });
  });

  app.post("/login", async (request, reply) => {
    const parsed = LoginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Validation failed",
        details: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
    }

    const { email, password } = parsed.data;

    const rows = await query(
      `SELECT id, email, name, password_hash, timezone FROM buyback_users WHERE email = $1`,
      [email.toLowerCase()]
    ) as any[];
    if (rows.length === 0) {
      return reply.status(401).send({ error: "Invalid email or password." });
    }

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return reply.status(401).send({ error: "Invalid email or password." });
    }

    const token = app.jwt.sign(
      { userId: user.id, email: user.email },
      { expiresIn: "30d" }
    );

    return reply.send({
      token,
      user: { id: user.id, email: user.email, name: user.name, timezone: user.timezone },
    });
  });
}
