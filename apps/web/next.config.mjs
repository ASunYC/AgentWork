import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Native Windows builds can run with `next start` without symlink privileges.
  // Linux containers retain the self-contained deployment output.
  output:
    process.platform !== 'win32' || process.env.NEXT_STANDALONE === 'true'
      ? 'standalone'
      : undefined,
  experimental: { outputFileTracingRoot: workspaceRoot },
  transpilePackages: ['@agentwork/ui'],
};

export default nextConfig;
