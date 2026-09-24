import { rename } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

// Windows may reject an atomic replacement while another handle has the target
// open. Retry only that rename, using the same fully written temporary file.
// Never unlink the destination, repeat the mutation, or retry unrelated errors.
const waits = [20, 40, 80, 160, 320];
const lockErrors = new Set(["EPERM", "EACCES", "EBUSY"]);
export async function replaceFile(
  source,
  target,
  { move = rename, sleep = delay, platform = process.platform } = {},
) {
  for (let attempt = 0; ; attempt++) {
    try {
      await move(source, target);
      return;
    } catch (error) {
      if (
        platform !== "win32" ||
        !lockErrors.has(error.code) ||
        attempt >= waits.length
      ) throw error;
      await sleep(waits[attempt]);
    }
  }
}
