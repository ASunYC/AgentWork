import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const prismaCli = require.resolve('prisma/build/index.js');
const schema = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../prisma/schema.prisma',
);

const child = spawn(
  process.execPath,
  [prismaCli, 'migrate', 'deploy', '--schema', schema],
  { stdio: 'inherit', env: process.env },
);

child.on('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`Prisma migrate terminated by ${signal}`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
