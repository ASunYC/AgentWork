import { resolve } from 'node:path';
import { loadWorkspaceEnv, workspaceRoot } from './env.mjs';
import { runNode } from './run-node.mjs';

try {
  loadWorkspaceEnv();
  const [entry, ...args] = process.argv.slice(2);
  if (!entry) throw new Error('A Node.js entrypoint is required');
  runNode([resolve(workspaceRoot, entry), ...args], {
    cwd: workspaceRoot,
    env: process.env,
  });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
