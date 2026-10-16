import { spawn } from 'node:child_process';

// Clipboard commands per platform, tried in order; Linux varies by display server.
const CLIPBOARD_COMMANDS = {
  darwin: [['pbcopy']],
  win32: [['clip']],
  linux: [['wl-copy'], ['xclip', '-selection', 'clipboard'], ['xsel', '--clipboard', '--input']],
};

function pipeTo([command, ...args], text) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'ignore', 'ignore'] });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}`))));
    child.stdin.end(text);
  });
}

export async function copyToClipboard(text, platform = process.platform) {
  for (const command of CLIPBOARD_COMMANDS[platform] ?? []) {
    try {
      return await pipeTo(command, text);
    } catch (error) {
      // A missing command means try the next one; any other failure is real.
      if (error.code !== 'ENOENT') throw error;
    }
  }
  throw new Error(`No clipboard command found for ${platform}; run without --copy and copy the output yourself`);
}
