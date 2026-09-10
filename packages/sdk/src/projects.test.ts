import { afterEach, expect, it, vi } from 'vitest';
import { AgentWorkProjectsClient } from './projects.js';

afterEach(() => vi.unstubAllGlobals());

it('collects every project page while retaining authentication', async () => {
  const requests: string[] = [];
  vi.stubGlobal('fetch', async (url: URL, init: RequestInit) => {
    requests.push(url.toString());
    expect(new Headers(init.headers).get('authorization')).toBe(
      'Bearer aws_test',
    );
    const later = url.searchParams.has('cursor');
    return new Response(
      JSON.stringify({
        items: later ? [{ id: 'third' }] : [{ id: 'first' }, { id: 'second' }],
        total: 3,
        nextCursor: later ? null : 'next-page',
      }),
    );
  });
  const client = new AgentWorkProjectsClient(
    'https://agentwork.example',
    'aws_test',
  );
  expect(await client.listMyProjects()).toEqual([
    { id: 'first' },
    { id: 'second' },
    { id: 'third' },
  ]);
  expect(requests).toHaveLength(2);
  expect(requests[1]).toContain('cursor=next-page');
});

it('rejects a repeated cursor rather than looping indefinitely', async () => {
  vi.stubGlobal(
    'fetch',
    async () =>
      new Response(
        JSON.stringify({ items: [], total: 1, nextCursor: 'same-cursor' }),
      ),
  );
  await expect(
    new AgentWorkProjectsClient(
      'https://agentwork.example',
    ).listPublicProjects(),
  ).rejects.toThrow('cursor repeated');
});
