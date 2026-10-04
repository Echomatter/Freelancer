import { randomBytes } from "node:crypto";
import path from "node:path";
import { stat } from "node:fs/promises";
import { readRuntimeText, removeState,writeState } from '../backend/tools/runtime/state-database.mjs';
import { createActivityReader } from "./activity.mjs";
import { createApplication } from "./application.mjs";
import { startHost } from "./host.mjs";
import { retainOwnershipUntilClosed } from './native-lifecycle.mjs';
import { startServer } from "./http.mjs";
import { acquireLock } from "./lock.mjs";
import { createObserver } from "./observer.mjs";
import { createOpenCodeEventCoordinator } from './opencode-event-coordinator.mjs';
import { createRemoteAccess } from "./remote-access.mjs";
import { resolveRuntimeConfig,runtimeEnv } from "./runtime-config.mjs";
import { rememberWebPort,savedWebPort } from "./web-port.mjs";
import { assertFreshRuntimeRoot, createLocalDataStore } from './data/store.mjs';
import { readRestoreRecoveryState } from './data/recovery.mjs';

// ── Fresh runtime bootstrap ────────────────────────────────────────────
// All paths resolve from the source tree. No runtime.json, no
// freelancer-root.txt locator, no global toolkit plugin leakage.
const config = resolveRuntimeConfig();
const { backendRoot } = config;
// Private process capability, never included in bootstrap or model prompts.
process.env.FREELANCER_GIT_BRIDGE = randomBytes(32).toString("hex");
const releaseLock = await acquireLock(path.join(backendRoot, ".state/webpage"));
let host, app, webPort, remoteAccess, recovery;
const webPortFile = path.join(backendRoot, '.state/webpage/port.json');
try {
  assertFreshRuntimeRoot(config.dataRoot, config.runtimeID);
  const initialData = createLocalDataStore(config.dataRoot);
  try { initialData.initializeFreshRuntime(config.runtimeID); }
  finally { initialData.close(); }
  recovery = readRestoreRecoveryState(config.dataRoot);

  // Activate the registered empty per-user database before any app or native
  // OpenCode plugin can read state. Native OpenCode config and data paths stay
  // inherited and unchanged.
  Object.assign(process.env, runtimeEnv(config));
  webPort = await savedWebPort(webPortFile, process.env.FREELANCER_WEB_PORT);
  remoteAccess = await createRemoteAccess({ file: path.join(backendRoot, '.state/remote-access.json') });
  host = await startHost({ backendRoot, config });
  app = createApplication({ backendRoot, host, dataRoot: config.dataRoot,
    automaticWorkAllowed: !recovery.automaticWorkBlocked });
  const settings = await app.store.read('settings');
  const selectedProject = settings.projects.find(row => row.id === settings.lastProjectID) ?? settings.projects[0];
  if (selectedProject) {
    // The saved project is the first bootstrap scope on restart. Use the
    // original native startup budget rather than adding another full window.
    let present = false;
    try { present = (await stat(selectedProject.directory)).isDirectory(); }
    catch (error) { if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error; }
    // A missing saved folder can still be managed through the existing UI.
    if (present) {
      const remaining = host.remainingStartupMs();
      if (remaining <= 0) throw Error('OpenCode project initialization exceeded the startup deadline.');
      await host.ensureReady({ directory: selectedProject.directory, timeoutMs: remaining });
    }
  }
  host.remainingStartupMs();
} catch (e) {
  await app?.modelData?.close();
  await app?.modelRatings?.close();
  const cleanup = [
    () => app?.history?.close(), () => app?.indexJobs?.close(),
    () => app?.gitProjects?.close(), () => app?.store?.flush(),
    () => app?.modelData?.close(), () => app?.modelRatings?.close(), () => app?.localData?.close(),
    () => remoteAccess?.close(),
  ];
  await Promise.allSettled(cleanup.map(close => Promise.resolve().then(close)));
  let closeError;
  try { await host?.close(); } catch (error) { closeError = error; }
  const uncertain = closeError ?? (e.code === 'OPENCODE_SHUTDOWN_UNCONFIRMED' ? e : undefined);
  if (uncertain) await retainOwnershipUntilClosed(uncertain, host?.whenClosed ?? uncertain.whenClosed);
  await releaseLock();
  if (closeError) throw new AggregateError([e, closeError], 'Freelancer startup failed; native shutdown exceeded its confirmation deadline.');
  throw e;
}
const observer = createObserver({ host, store: app.store });
const warehouseEvents = createOpenCodeEventCoordinator({ host, store: app.store, history: app.history });
observer.start();
warehouseEvents.start();
// Reuse the backend collector. Manual refresh joins the same in-flight request.
const refreshUsage = () => void app.refreshUsage().catch(() => {});
refreshUsage();
const usageTimer = setInterval(refreshUsage, 5 * 60 * 1000);
usageTimer.unref();
let runtime;
const shutdownToken = randomBytes(32).toString("hex");
let closing = false;
let shutdownPromise;
const shutdown = () => shutdownPromise ??= (async () => {
  closing = true;
  clearInterval(usageTimer);
  try { await warehouseEvents.stop(); } catch (error) { console.error("OpenCode warehouse event shutdown failed", error); }
  try { await runtime?.close(); } catch (error) { console.error("Freelancer server cleanup failed", error); }
  try { await host.close(); }
  catch (error) { await retainOwnershipUntilClosed(error, host.whenClosed ?? error.whenClosed); }
  try { await observer.stop(); } catch (error) { console.error("Activity observer shutdown failed", error); }
  try { await app.store.flush(); } catch (error) { console.error("Settings flush failed", error); }
  removeState(launchFile);
  await releaseLock();
})();
const launchFile = path.join(backendRoot, ".state/webpage/launch.json");
try {
  runtime = await startServer({
    application: app,
    readActivity: createActivityReader({ project: app.project, host }),
    assets: path.resolve(config.appRoot, "dist"),
    port: webPort,
    remoteAccess,
    shutdownToken,
    onShutdown: () => { void shutdown(); },
    timers: !recovery.automaticWorkBlocked,
    recoveryDataHome: config.dataRoot,
  });
} catch (e) {
  clearInterval(usageTimer);
  await app.modelData?.close();
  await app.modelRatings?.close();
  const cleanup = [
    () => warehouseEvents.stop(), () => app.history?.close(),
    () => app.indexJobs?.close(), () => app.gitProjects?.close(),
    () => app.store.flush(), () => app.modelData?.close(), () => app.modelRatings?.close(),
    () => app.localData?.close(), () => observer.stop(),
  ];
  await Promise.allSettled(cleanup.map(close => Promise.resolve().then(close)));
  try { await host.close(); }
  catch (error) { await retainOwnershipUntilClosed(error, host.whenClosed ?? error.whenClosed); }
  await releaseLock();
  throw e;
}
await rememberWebPort(webPortFile, webPort);
console.log(JSON.stringify({ url: runtime.url, pid: process.pid }));
writeState(launchFile, { url: runtime.url, lanUrl: runtime.lanUrl, pid: process.pid, appRoot: config.appRoot, shutdownToken });
process.on("SIGINT", () => { void shutdown(); });
process.on("SIGTERM", () => { void shutdown(); });
