import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHash, randomUUID, verify } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test(
  'official MCP client discovers tools, connects an Agent and sends validated/versioned commands over stdio',
  { timeout: 30_000 },
  async () => {
    const home = await mkdtemp(join(tmpdir(), 'agentwork-mcp-test-'));
    const challenges = new Map();
    const writes = [];
    const agent = { id: randomUUID(), slug: 'mcp-test', name: 'MCP Test' };
    const projectId = randomUUID();
    let origin;
    const api = createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length
        ? JSON.parse(Buffer.concat(chunks).toString())
        : undefined;
      let value;
      if (req.url === '/v2/access/challenge') {
        const id = randomUUID();
        const expiresAt = new Date(Date.now() + 300000).toISOString();
        const message = JSON.stringify({
          protocol: 'agentwork-connect-v2',
          audience: origin,
          challengeId: id,
          fingerprint: createHash('sha256')
            .update(body.publicKey)
            .digest('hex'),
          name: body.name,
          slug: body.slug,
          expiresAt,
        });
        challenges.set(id, { message, publicKey: body.publicKey });
        value = { challengeId: id, message, expiresAt };
      } else if (req.url === '/v2/access/connect') {
        const challenge = challenges.get(body.challengeId);
        assert.ok(
          verify(
            null,
            Buffer.from(challenge.message),
            challenge.publicKey,
            Buffer.from(body.signature, 'base64'),
          ),
        );
        value = {
          agent,
          installationId: randomUUID(),
          accessToken: 'aws_test_transport_secret',
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        };
      } else if (req.url === '/v2/access/me') {
        value = { agent, installationId: 'test-installation' };
      } else {
        assert.equal(
          req.headers.authorization,
          'Bearer aws_test_transport_secret',
        );
        if (req.method === 'POST') {
          writes.push({
            path: req.url,
            body,
            key: req.headers['idempotency-key'],
          });
          value = { id: projectId, version: 1, status: 'DRAFT' };
        } else value = { project: { id: projectId, workItems: [] } };
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(value));
    }).listen(0, '127.0.0.1');
    await once(api, 'listening');
    origin = `http://127.0.0.1:${api.address().port}`;
    const client = new Client({ name: 'agentwork-test', version: '1.0.0' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL('./main.mjs', import.meta.url))],
      env: { ...process.env, AGENTWORK_URL: origin, AGENTWORK_HOME: home },
      stderr: 'pipe',
    });
    try {
      await client.connect(transport);
      const catalog = await client.listTools();
      assert.equal(
        catalog.tools.find((t) => t.name === 'agentwork_context').annotations
          .readOnlyHint,
        true,
      );
      assert.equal(
        catalog.tools.find((t) => t.name === 'agentwork_task_command')
          .annotations.readOnlyHint,
        false,
      );
      const connected = await client.callTool({
        name: 'agentwork_connect',
        arguments: { name: agent.name, slug: agent.slug },
      });
      assert.equal(JSON.parse(connected.content[0].text).agent.id, agent.id);
      assert.doesNotMatch(
        JSON.stringify(connected),
        /PRIVATE KEY|accessToken|aws_test_transport_secret/,
      );
      const key = randomUUID();
      const created = await client.callTool({
        name: 'agentwork_task_create',
        arguments: {
          projectId,
          idempotencyKey: key,
          input: {
            title: 'MCP task',
            description: 'Implement the feature',
            acceptanceCriteria: 'Tests pass',
          },
        },
      });
      assert.equal(created.isError, undefined);
      assert.equal(writes[0].path, `/v2/projects/${projectId}/tasks`);
      assert.equal(writes[0].key, key);
      assert.equal(writes[0].body.acceptanceCriteria, 'Tests pass');
      let rejected = false;
      try {
        rejected =
          (
            await client.callTool({
              name: 'agentwork_task_command',
              arguments: {
                projectId,
                taskId: randomUUID(),
                idempotencyKey: randomUUID(),
                input: { action: 'claim' },
              },
            })
          ).isError === true;
      } catch {
        rejected = true;
      }
      assert.equal(rejected, true);
      assert.equal(writes.length, 1);
      await client.callTool({
        name: 'agentwork_task_command',
        arguments: {
          projectId,
          taskId: randomUUID(),
          idempotencyKey: randomUUID(),
          input: { action: 'claim', expectedVersion: 2 },
        },
      });
      assert.equal(writes[1].body.expectedVersion, 2);
    } finally {
      await client.close();
      await new Promise((resolve) => api.close(resolve));
      assert.ok(
        resolve(home).startsWith(resolve(tmpdir(), 'agentwork-mcp-test-')),
      );
      await rm(home, { recursive: true, force: true });
    }
  },
);
