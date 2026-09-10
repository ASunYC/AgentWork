import { createServer } from 'node:http';
import { prisma, ProjectEventEngine } from '@agentwork/database';
import { WebhookDeliveryEngine } from './webhook-delivery.js';

const secret = process.env.WEBHOOK_SIGNING_SECRET;
if (!secret) throw new Error('WEBHOOK_SIGNING_SECRET is required');
const engine = new WebhookDeliveryEngine(prisma, secret);
const projectEvents = new ProjectEventEngine(prisma);
let stopping = false;
const health = createServer(async (req, res) => {
  let ready = !stopping;
  if (ready && req.url === '/ready') {
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      ready = false;
    }
  }
  const status = ready ? 'ok' : stopping ? 'stopping' : 'unavailable';
  res.writeHead(ready ? 200 : 503, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ status, service: 'worker' }));
});
health.listen(Number(process.env.WORKER_HEALTH_PORT ?? 3002));

const run = async () => {
  while (!stopping) {
    try {
      const projectBatch = await projectEvents.runBatch();
      if (projectBatch.delivered || projectBatch.failed)
        console.info(
          JSON.stringify({
            level: projectBatch.failed ? 'warn' : 'info',
            event: 'project.events',
            ...projectBatch,
          }),
        );
      await engine.materialize();
      const delivery = await engine.claim();
      if (delivery) {
        await engine.deliver(delivery);
        console.info(
          JSON.stringify({
            level: 'info',
            event: 'webhook.delivery',
            delivery_id: delivery.id,
          }),
        );
      } else if (!projectBatch.delivered && !projectBatch.failed)
        await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'worker.loop',
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      if (!stopping) await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
};
const shutdown = async (signal: string) => {
  if (stopping) return;
  stopping = true;
  console.info(
    JSON.stringify({ level: 'info', event: 'worker.shutdown', signal }),
  );
  health.close();
  await loop;
  await prisma.$disconnect();
};
const loop = run();
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
