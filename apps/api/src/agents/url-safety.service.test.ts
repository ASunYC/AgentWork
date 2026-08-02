import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { DnsResolver, UrlSafetyService } from './url-safety.service';

class Resolver extends DnsResolver {
  constructor(private readonly addresses: string[]) {
    super();
  }
  async resolve() {
    return this.addresses;
  }
}

describe('UrlSafetyService', () => {
  it.each([
    ['https://localhost/hook', ['127.0.0.1']],
    ['https://example.test/hook', ['10.0.0.1']],
    ['https://example.test/hook', ['169.254.169.254']],
    ['https://example.test/hook', ['::1']],
    ['http://example.test/hook', ['203.0.113.8']],
  ])('rejects unsafe URL %s resolving to %j', async (url, addresses) => {
    await expect(
      new UrlSafetyService(new Resolver(addresses)).assertPublicHttps(url),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts a public HTTPS endpoint', async () => {
    const url = await new UrlSafetyService(
      new Resolver(['8.8.8.8']),
    ).assertPublicHttps('https://agent.example/hook');
    expect(url.hostname).toBe('agent.example');
  });
});
