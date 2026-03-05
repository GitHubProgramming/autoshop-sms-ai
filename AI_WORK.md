TASK FOR CLAUDE CODE



Goal:

Fix Docker build failing in apps/api.



Problem:

TypeScript build fails with bullmq + ioredis type conflict.



Error example:

Type 'Redis' is not assignable to type 'ConnectionOptions'



Files involved:

apps/api/src/queues/redis.ts

apps/api/src/workers/sms-inbound.worker.ts

apps/api/src/routes/webhooks/stripe.ts



Required fixes:



1\. BullMQ must use ConnectionOptions object instead of passing new Redis() instance.



Example:



const connection = {

  host: process.env.REDIS\_HOST || 'redis',

  port: Number(process.env.REDIS\_PORT || 6379)

};



Use this connection object for:

Queue

Worker

QueueEvents



2\. Fix Stripe webhook typing:



const obj = event.data.object as any;

const tenantId = obj?.metadata?.tenant\_id;



Acceptance criteria:



docker compose build api  → succeeds

docker compose up -d → API container runs




CURRENT TASK (do not do anything else)



Fix Docker build failing in apps/api.



Build error:

\- bullmq + ioredis TypeScript type conflict: "Type 'Redis' is not assignable to type 'ConnectionOptions'"

\- stripe webhook typing: "tenant\_id does not exist on type {}"



Constraints:

\- Minimal changes only. No refactors.

\- Do NOT change business logic.

\- Do NOT run npm audit fix --force.



Target files:

\- apps/api/src/queues/redis.ts

\- apps/api/src/workers/sms-inbound.worker.ts

\- apps/api/src/routes/webhooks/stripe.ts



Acceptance:

\- docker compose -f infra/docker-compose.yml build api  succeeds

\- docker compose -f infra/docker-compose.yml up -d  starts api container

