import { execFileSync } from 'node:child_process';

function dpapi(operation, input) {
  const method = operation === 'protect' ? 'Protect' : 'Unprotect';
  const script = `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $inputBytes=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); $outputBytes=[Security.Cryptography.ProtectedData]::${method}($inputBytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($outputBytes))`;
  try {
    return execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      {
        input,
        encoding: 'utf8',
        windowsHide: true,
        timeout: 15000,
        maxBuffer: 1024 * 1024,
      },
    ).trim();
  } catch {
    throw new Error(
      'Windows could not protect or unlock Agent credentials. Use the original Windows user or restore an encrypted recovery backup in a new profile.',
    );
  }
}

export function sealCredentials(state, origin) {
  if (process.platform !== 'win32') return state;
  return {
    format: 'agentwork-dpapi-v1',
    protected: dpapi(
      'protect',
      Buffer.from(JSON.stringify({ origin, state })).toString('base64'),
    ),
  };
}

export function openCredentials(record, origin) {
  if (record.format !== undefined && record.format !== 'agentwork-dpapi-v1')
    throw new Error(
      'Unsupported credential storage format; no migration was attempted',
    );
  if (record.format !== 'agentwork-dpapi-v1') return record;
  if (process.platform !== 'win32')
    throw new Error(
      'These credentials belong to a Windows user; use device enrollment or an encrypted recovery backup',
    );
  const data = JSON.parse(
    Buffer.from(dpapi('unprotect', record.protected), 'base64').toString(
      'utf8',
    ),
  );
  if (data.origin !== origin)
    throw new Error('Credentials belong to another AgentWork platform');
  return data.state;
}
