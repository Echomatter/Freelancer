import { execFile } from 'node:child_process';
const prefix = 'dpapi-current-user:v1:';

// Only opaque, current-user protected bytes enter SQLite. The key travels over
// stdin, never command arguments, settings exports, diagnostic text or prompts.
export function createModelDataVault({ platform = process.platform, execImpl = execFile } = {}) {
  const available = platform === 'win32';
  async function transform(value, protect) {
    if (!available) throw Object.assign(Error('Secure key storage requires Windows. Configure ARTIFICIAL_ANALYSIS_API_KEY in the server environment instead.'), { status: 503 });
    const script = [
      "$ErrorActionPreference='Stop'",
      'Add-Type -AssemblyName System.Security',
      '$bytes=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())',
      '$scope=[Security.Cryptography.DataProtectionScope]::CurrentUser',
      protect
        ? '$result=[Security.Cryptography.ProtectedData]::Protect($bytes,$null,$scope)'
        : '$result=[Security.Cryptography.ProtectedData]::Unprotect($bytes,$null,$scope)',
      '[Console]::Out.Write([Convert]::ToBase64String($result))',
      '[Array]::Clear($bytes,0,$bytes.Length)',
    ].join('\n');
    try {
      const encoded = Buffer.from(script, 'utf16le').toString('base64');
      // execFile has no input option: write to its pipe without involving a shell.
      let child;
      const output = await new Promise((resolve, reject) => {
        child = execImpl('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
          { windowsHide: true, timeout: 10000, maxBuffer: 65536, encoding: 'utf8' },
          (error, stdout) => error ? reject(error) : resolve(stdout));
        child.stdin.end(value);
      });
      if (typeof output !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(output.trim())) throw Error('Invalid protected output.');
      return output.trim();
    } catch { throw Object.assign(Error('Windows protected key storage failed. The key was not saved or disclosed.'), { status: 503 }); }
  }
  return {
    available,
    async seal(key) { return prefix + await transform(Buffer.from(key, 'utf8').toString('base64'), true); },
    async open(ciphertext) {
      if (typeof ciphertext !== 'string' || !ciphertext.startsWith(prefix)) throw Error('Stored model-data credential is not protected.');
      return Buffer.from(await transform(ciphertext.slice(prefix.length), false), 'base64').toString('utf8');
    },
  };
}
