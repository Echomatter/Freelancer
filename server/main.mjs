import { randomBytes } from "node:crypto";
import path from "node:path";
import { readRuntimeText, removeState,writeState } from '../backend/tools/runtime/state-database.mjs';
import { createActivityReader } from "./activity.mjs";
import { createApplication } from "./application.mjs";
import { startHost } from "./host.mjs";
import { startServer } from "./http.mjs";
import { acquireLock } from "./lock.mjs";
import { createObserver } from "./observer.mjs";
import { createRemoteAccess } from "./remote-access.mjs";
import { resolveRuntimeConfig,runtimeEnv } from "./runtime-config.mjs";
import { rememberWebPort,savedWebPort } from "./web-port.mjs";

// ── Startup migration ──────────────────────────────────────────────────
// All paths resolve from the source tree. No runtime.json, no
// freelancer-root.txt locator, no global toolkit plugin leakage.
const config = resolveRuntimeConfig();
const { backendRoot } = config;

// Expose runtime root to local plugins and tools loaded later in this
// process (delegation, content_index, etc.).
Object.assign(process.env, runtimeEnv(config));
// Private process capability, never included in bootstrap or model prompts.
process.env.FREELANCER_GIT_BRIDGE = randomBytes(32).toString("hex");
const webPortFile = path.join(backendRoot, '.state/webpage/port.json');
const webPort = await savedWebPort(webPortFile, process.env.FREELANCER_WEB_PORT);
const remoteAccess = await createRemoteAccess({ file: path.join(backendRoot, '.state/remote-access.json') });

const releaseLock = await acquireLock(path.join(backendRoot, ".state/webpage"));
let host;
try {
  host = await startHost({ backendRoot, config });
} catch (e) {
  await releaseLock();
  throw e;
}
const app = createApplication({ backendRoot, host, dataRoot: config.dataRoot });
const observer = createObserver({ host, store: app.store });
observer.start();
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
  try { await runtime?.close(); } catch (error) { console.error("Freelancer server cleanup failed", error); }
  try { host.stop(); } catch (error) { console.error("OpenCode shutdown failed", error); }
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
  });
} catch (e) {
  clearInterval(usageTimer);
  app.modelRatings?.close();
  app.localData?.close();
  host.stop();
  await observer.stop();
  await releaseLock();
  throw e;
}
await rememberWebPort(webPortFile, webPort);
console.log(JSON.stringify({ url: runtime.url, pid: process.pid }));
writeState(launchFile, { url: runtime.url, lanUrl: runtime.lanUrl, pid: process.pid, appRoot: config.appRoot, shutdownToken });
process.on("SIGINT", () => { void shutdown(); });
process.on("SIGTERM", () => { void shutdown(); });
