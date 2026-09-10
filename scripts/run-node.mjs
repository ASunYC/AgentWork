import { spawn, execFileSync } from 'node:child_process';

export function runNode(args, options = {}) {
  const child = spawn(process.execPath, args, {
    stdio: 'inherit',
    windowsHide: true,
    detached: process.platform !== 'win32',
    ...options,
  });
  let stopped = false;
  const stop = () => {
    if (stopped || !child.pid) return;
    stopped = true;
    try {
      if (process.platform === 'win32')
        execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
        });
      else process.kill(-child.pid, 'SIGTERM');
    } catch {
      /* The owned child may already have exited. */
    }
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  child.once('error', () => {
    console.error('Could not start the requested local service');
    process.exitCode = 1;
  });
  child.once('exit', (code) => {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    process.exitCode = stopped ? 0 : (code ?? 1);
  });
  return child;
}
