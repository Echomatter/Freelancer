// Keep the existing direct entry point for local scripts.
import { runContracts } from './test-contracts.mjs';
process.exitCode = await runContracts(['--suite', 'fast', ...process.argv.slice(2)]);
