import { BadRequestException, Injectable } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export abstract class DnsResolver {
  abstract resolve(hostname: string): Promise<string[]>;
}

@Injectable()
export class SystemDnsResolver extends DnsResolver {
  async resolve(hostname: string) {
    if (isIP(hostname)) return [hostname];
    return (await lookup(hostname, { all: true, verbatim: true })).map(
      (x) => x.address,
    );
  }
}

function blocked(address: string): boolean {
  if (
    address === '::1' ||
    address === '::' ||
    address.startsWith('fe80:') ||
    address.startsWith('fc') ||
    address.startsWith('fd')
  )
    return true;
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  const ip = mapped ?? address;
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return false;
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b! >= 16 && b! <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b! >= 64 && b! <= 127) ||
    a! >= 224
  );
}

@Injectable()
export class UrlSafetyService {
  constructor(private readonly dns: DnsResolver) {}

  async assertPublicHttps(raw: string): Promise<URL> {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new BadRequestException('Invalid webhook URL');
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.port) {
      throw new BadRequestException(
        'Webhook URL must be a credential-free HTTPS URL on port 443',
      );
    }
    const hostname = url.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname.endsWith('.localhost'))
      throw new BadRequestException('Webhook host is not public');
    let addresses: string[];
    try {
      addresses = await this.dns.resolve(hostname);
    } catch {
      throw new BadRequestException('Webhook host cannot be resolved');
    }
    if (!addresses.length || addresses.some(blocked))
      throw new BadRequestException(
        'Webhook host resolves to a restricted address',
      );
    return url;
  }
}
