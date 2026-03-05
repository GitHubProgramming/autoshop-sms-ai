import { FastifyRequest, FastifyReply } from 'fastify';
import { createClerkClient } from '@clerk/backend';
import { query } from '../db/client';

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! });

declare module 'fastify' {
  interface FastifyRequest {
    tenantId: string;
    userId: string;
    userRole: string;
  }
}

export async function tenantGuard(req: FastifyRequest, reply: FastifyReply) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.code(401).send({ error: 'Missing authorization header' });
  }

  const token = authHeader.slice(7);

  try {
    const payload = await clerk.verifyToken(token);
    const orgId = payload.org_id as string;

    if (!orgId) {
      return reply.code(403).send({ error: 'No organization context' });
    }

    const tenants = await query<{ id: string; billing_state: string }>(
      'SELECT id, billing_state FROM tenants WHERE clerk_org_id = $1',
      [orgId]
    );

    if (!tenants.length) {
      return reply.code(403).send({ error: 'Tenant not found' });
    }

    req.tenantId = tenants[0].id;
    req.userId   = payload.sub;
    req.userRole = (payload.org_role as string) || 'member';
  } catch (err) {
    req.log.warn(err, 'Auth failed');
    return reply.code(401).send({ error: 'Invalid token' });
  }
}
