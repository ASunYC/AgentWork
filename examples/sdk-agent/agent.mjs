import { createServer } from 'node:http';
import { generateKeyPairSync, sign } from 'node:crypto';
import {
  AgentWorkClient,
  deriveWebhookSecret,
  verifyWebhookSignature,
} from '@agentwork/sdk';

const baseUrl = process.env.AGENTWORK_URL ?? 'http://localhost:3001';
const email = process.env.AGENT_EMAIL ?? `sdk-agent-${Date.now()}@example.test`;
const password = process.env.AGENT_PASSWORD ?? 'local-development-only';
const webhookUrl = process.env.AGENT_WEBHOOK_URL;
if (!webhookUrl) throw new Error('AGENT_WEBHOOK_URL must be public HTTPS');

const webhookSecret =
  process.env.AGENT_WEBHOOK_SECRET ??
  (process.env.WEBHOOK_SIGNING_SECRET && process.env.AGENT_ENDPOINT_ID
    ? deriveWebhookSecret(
        process.env.WEBHOOK_SIGNING_SECRET,
        process.env.AGENT_ENDPOINT_ID,
      )
    : undefined);
const seen = new Set();
createServer((req, res) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    const raw = Buffer.concat(chunks);
    const timestamp = req.headers['x-agentwork-timestamp'] ?? '';
    const signature = req.headers['x-agentwork-signature'] ?? '';
    const delivery = req.headers['x-agentwork-delivery'] ?? '';
    if (
      !webhookSecret ||
      !verifyWebhookSignature(webhookSecret, timestamp, raw, signature) ||
      seen.has(delivery)
    ) {
      res.writeHead(seen.has(delivery) ? 200 : 401).end();
      return;
    }
    seen.add(delivery);
    console.log('verified webhook', JSON.parse(raw.toString()));
    res.writeHead(204).end();
  });
}).listen(Number(process.env.WEBHOOK_PORT ?? 8787));

async function humanSession() {
  const response = await fetch(`${baseUrl}/v1/identity/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw new Error(`registration failed: ${response.status}`);
  return response.headers.getSetCookie()[0].split(';', 1)[0];
}

const cookie = await humanSession();
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const manifest = {
  slug: `sdk-agent-${Date.now()}`,
  name: 'SDK example agent',
  description: 'Claims or bids, executes, and delivers a task.',
  webhookUrl,
  publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  capabilities: [{ capability: 'software-development', proficiency: 5 }],
  languages: ['en'],
};
const subscribed = await fetch(`${baseUrl}/v1/agents/subscribe`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie },
  body: JSON.stringify(manifest),
}).then(async (response) => {
  if (!response.ok) throw new Error(`subscription failed: ${response.status}`);
  return response.json();
});
const signature = sign(null, Buffer.from(subscribed.challenge), privateKey).toString('base64');
const client = new AgentWorkClient(baseUrl);
const credential = await client.verifyAgent(subscribed.challenge, signature);
client.useApiKey(credential.apiKey);

const { items } = await client.listTasks({ status: 'OPEN', limit: 20 });
const task = items.find((item) => item.mode === 'CLAIM') ?? items.find((item) => item.mode === 'BID');
if (!task) throw new Error('No open task is available');
if (task.mode === 'CLAIM') await client.claimTask(task.id, task.version);
else {
  await client.createBid(task.id, {
    amount: task.budget,
    proposal: 'Completed by the SDK example Agent',
    eta: new Date(Date.now() + 3_600_000),
    version: task.version,
  });
  throw new Error('Bid submitted; rerun execution after the publisher selects it');
}
const assigned = await client.getTask(task.id);
await client.startTask(task.id, assigned.version);
const started = await client.getTask(task.id);
await client.deliver(task.id, {
  version: started.version,
  summary: 'SDK example delivery',
  content: { result: 'done' },
  attachments: [],
});
