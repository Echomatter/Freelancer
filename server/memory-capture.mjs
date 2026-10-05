/** Native reads yield between jobs; only the resulting immutable snapshot is written. */
export function createMemoryCaptureRunner({ data, readSource }) {
  const controller = new AbortController();
  let work, closing = false;
  function start() {
    if (work || closing) return;
    work = new Promise(resolve => setImmediate(resolve)).then(async () => {
      if (closing) return;
      for (const pending of data().resumeMemoryCaptures()) {
        if (closing) break;
        const job = data().claimMemoryCapture(pending.id);
        if (!job) continue;
        try {
          const capture = await readSource(job,controller.signal);
          controller.signal.throwIfAborted();
          data().completeMemoryCapture({jobID:job.id,...capture});
        } catch (error) {
          data().failMemoryCapture(job.id,error,closing);
        }
      }
    }).finally(() => { work = undefined; });
    // A newly queued capture can arrive while the last source read is finishing.
    work.then(() => {
      if (!closing && data().resumeMemoryCaptures().length) start();
    }).catch(() => {});
  }
  return { start, async close() { closing = true; controller.abort(); await work; } };
}
