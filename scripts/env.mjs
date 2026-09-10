import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const workspaceRoot = fileURLToPath(new URL('../', import.meta.url));
export function loadWorkspaceEnv() {
  const file = process.env.AGENTWORK_ENV_FILE
    ? resolve(process.env.AGENTWORK_ENV_FILE)
    : resolve(workspaceRoot, '.env');
  if (!existsSync(file)) {
    if (process.env.AGENTWORK_ENV_FILE)
      throw new Error('The selected environment file does not exist');
    return;
  }
  if (typeof process.loadEnvFile !== 'function')
    throw new Error(
      'Use a current Node.js LTS release to load the local environment file',
    );
  process.loadEnvFile(file);
}
