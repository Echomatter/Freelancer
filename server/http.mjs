import { readJsonBody } from './http-body.mjs';
import http from "node:http";
import { once } from "node:events";
import { timingSafeEqual } from "node:crypto";
import { createSender } from "./sender.mjs";
import { createGoals } from './goals.mjs';
import { createSchedules } from "./schedules.mjs";
import { savedTheme, themeDocument } from "./theme.mjs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { isLocalDataUnavailable } from "./data/store.mjs";
import { privateIPv4 } from "./lan.mjs";
import { createRemoteAccess } from "./remote-access.mjs";

const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".json": "application/json",
};
const isLoopbackRemote = (remote) =>
  remote === "127.0.0.1" || remote === "::ffff:127.0.0.1" || remote === "::1";
const safeEqual = (supplied, expected) => {
  const a = Buffer.from(supplied), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

export async function startServer({ application: app, assets, port = 0, readActivity, shutdownToken, onShutdown, remoteAccess, timers = true }) {
  const history = app.history;
  let goals;
  const sender = createSender(app, { beforeSend: history?.ensureWritable, executionFor: (p, s) => goals?.executionFor(p, s) });
  app.sender = sender;
  await sender.ready;
  if (app.goalTree) { goals = createGoals(app, { sender }); await goals.ready; }
  const schedules = createSchedules(app, { sender, readActivity });
  await schedules.ready;
  await app.gitProjects?.recover();
  let origin;
  const remote = remoteAccess ?? await createRemoteAccess();
  const handleRequest = async (req, res, publicWeb = false) => {
    const send = (status, value, type = "application/json", cache = "no-store") => {
      const headers = {
        "Content-Type": type,
        "Cache-Control": cache,
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      };
      if (publicWeb) headers["Strict-Transport-Security"] = "max-age=31536000";
      const payload = type === "application/json" ? JSON.stringify(value) : value;
      res.writeHead(status, headers);
      res.end(payload);
    };
    try {
      const host = String(req.headers.host ?? "");
      const loopback = isLoopbackRemote(req.socket.remoteAddress);
      let requestOrigin;
      if (publicWeb) {
        const publicOrigin = remote.webOrigin;
        if (!loopback || !publicOrigin || host !== new URL(publicOrigin).host)
          return send(403, { error: "Public web access is available only through its verified HTTPS tunnel." });
        requestOrigin = publicOrigin;
      } else {
        if (!loopback && !privateIPv4(req.socket.remoteAddress))
          return send(403, { error: "Local network access only" });
        if (host !== new URL(origin).host && (!remote.origin || host !== new URL(remote.origin).host))
          return send(403, { error: "Local application only" });
        if (!loopback && host === new URL(origin).host)
          return send(403, { error: "Local application only" });
        requestOrigin = remote.origin && host === new URL(remote.origin).host ? remote.origin : origin;
      }
      const url = new URL(req.url, requestOrigin),
        route = url.pathname;
      if (publicWeb && route.startsWith('/api/') && req.headers.origin && req.headers.origin !== requestOrigin)
        return send(403, { error: 'Cross-origin requests are not allowed.' });
      if (route === "/__shutdown" && req.method === "POST") {
        const supplied = String(req.headers["x-freelancer-shutdown"] ?? "");
        if (!loopback || requestOrigin !== origin || !shutdownToken || !safeEqual(supplied, shutdownToken))
          return send(403, { error: "Local application only" });
        res.writeHead(202, { "Cache-Control": "no-store" });
        res.end();
        setImmediate(() => onShutdown?.());
        return;
      }
      if (route.startsWith("/api/")) {
        const supplied = String(req.headers["x-freelancer-git-bridge"] ?? "");
        const expected = process.env.FREELANCER_GIT_BRIDGE || "";
        const lanApi = publicWeb || requestOrigin !== origin || !loopback;
        const pairingRequest = lanApi && route === '/api/access/pair' && req.method === 'POST';
        const lanTokenOk = !lanApi || pairingRequest || remote.authenticate(req, res, publicWeb ? 'web' : 'lan');
        const agentBridge = loopback && !lanApi && ["/api/git/agent", "/api/goals/checkpoint", "/api/delegates/handoff"].includes(route) && !!expected && safeEqual(supplied, expected);
        if (
          (!agentBridge && req.headers["x-freelancer-client"] !== "webpage") ||
          (req.headers.origin && req.headers.origin !== requestOrigin) ||
          req.headers["sec-fetch-site"] === "cross-site" ||
          !lanTokenOk
        )
          return send(403, { error: !lanTokenOk
            ? "Pair this device from Application settings - Remote access on your computer."
            : "Open Freelancer to continue" });
        const body = await readJsonBody(req, route);
        if (pairingRequest) {
          const paired = await remote.pair(body, publicWeb ? 'web' : 'lan');
          res.setHeader('Set-Cookie', paired.cookie);
          return send(200, { name: paired.name, expiresAt: paired.expiresAt });
        }
        if (route === '/api/access/session' && req.method === 'GET') return send(200, { authenticated: true });
        if (route.startsWith('/api/remote-access')) {
          if (lanApi) return send(403, { error: 'Manage remote access on this computer.' });
          if (route === '/api/remote-access' && req.method === 'GET') return send(200, remote.status());
          if (route === '/api/remote-access' && req.method === 'PUT') return send(200, await remote.configure(body));
          if (route === '/api/remote-access/web' && req.method === 'PUT') return send(200, await remote.configureWeb(body));
          if (route === '/api/remote-access/pairing' && req.method === 'POST') return send(200, await remote.pairLink(body.transport));
          if (route === '/api/remote-access/pairing' && req.method === 'DELETE') return send(200, await remote.cancelPairing());
          if (route === '/api/remote-access/devices' && req.method === 'DELETE') return send(200, await remote.revoke(body.id));
          return send(404, { error: 'Action not found' });
        }
        if (route === '/api/view-state' && ['GET', 'PUT'].includes(req.method)) {
          if (req.method === 'GET') return send(200, (await app.store.read('settings')).viewState ?? {});
          const data = await app.store.update('settings', settings => {
            const previous = settings.viewState ?? {};
            if (body.migrate && previous.migrated) return settings;
            const lastChats = { ...previous.lastChats };
            for (const [project, session] of Object.entries(body.lastChats ?? {})) {
              if (typeof session !== 'string' || project.length > 200 || session.length > 200) throw Error('Invalid chat preference');
              lastChats[project] = session;
            }
            return { ...settings, viewState: { ...previous, migrated: true, lastChats,
              ...(typeof body.navigationCollapsed === 'boolean' ? { navigationCollapsed: body.navigationCollapsed } : {}) } };
          });
          return send(200, data.viewState);
        }
        const queryProject = url.searchParams.get("project");
        if (queryProject && body.project && queryProject !== body.project)
          return send(400, { error: "Project does not match request body" });
        const project = queryProject ?? body.project;
        if (route === '/api/delegates/handoff') {
          if (!agentBridge || req.method !== 'POST') return send(403, { error: 'Native delegate tool only' });
          const work = await app.workerHandoff(body);
          const row = await sender.enqueue(work.project, work.session, work.input, work.execution);
          return send(200, { status: 'worker_handoff', worker: work.session, delivery: body.delivery, handoff: row,
            note: 'Saved for delivery. HTTP acknowledgement is not evidence the worker has received or acted on this input. Inspect the worker transcript.' });
        }
        if (route === '/api/goals/checkpoint') {
          if (!agentBridge || req.method !== 'POST') return send(403, { error: 'Native goal tool only' });
          return send(200, await goals.checkpoint(body));
        }
        if (route === '/api/goals' && req.method === 'GET') return send(200, await goals.list(project));
        if (route === '/api/goals' && req.method === 'POST') return send(200, await goals.create(project, body));
        if (route === '/api/goals' && req.method === 'PUT') return send(200, await goals.update(project, body));
        if (route === '/api/goals/action' && req.method === 'POST') {
          if (['start','resume'].includes(body.action)) return send(200, await goals.start(project, body.id));
          if (body.action === 'stop') return send(200, await goals.stop(project, body.id));
          if (['archive','restore'].includes(body.action)) return send(200, await goals.archive(project, body.id, body.action === 'archive'));
          throw Error('Unknown goal action.');
        }
        if (route === "/api/git/agent") {
          if (!agentBridge || req.method !== "POST") return send(403, { error: "Native Git tool only" });
          return send(200, await app.gitAgentAction(body));
        }
        if (route === "/api/git" && req.method === "GET") return send(200, await app.gitProjects.inspect(project));
        if (route === "/api/git/defaults" && req.method === "PUT") return send(200, await app.gitProjects.updateDefaults(body));
        if (route === "/api/git/policy" && req.method === "PUT") return send(200, await app.gitProjects.updatePolicy(project, body));
        if (route === "/api/git/initialize" && req.method === "POST") return send(200, await app.gitProjects.initialize(project, body));
        if (route === "/api/git/identity" && req.method === "PUT") return send(200, await app.gitProjects.updateIdentity(project, body));
        if (route === "/api/git/bind" && req.method === "POST") return send(200, await app.gitProjects.bind(project, body));
        if (route === "/api/git/setup" && req.method === "POST") return send(200, await app.gitProjects.setup(project, body));
        if (route === "/api/git/preview" && req.method === "POST") return send(200, await app.gitProjects.preview(project, body));
        if (route === "/api/git/request" && req.method === "POST") return send(200, body.planID
          ? await app.gitProjects.requestExecute(project, body, { origin: "panel" })
          : await app.gitProjects.requestPreview(project, body, { origin: "panel" }));
        if (route === "/api/git/execute" && req.method === "POST") return send(200, await app.gitProjects.execute(project, body, { origin: "panel" }));
        if (req.method === "GET" && route === "/api/activity" && readActivity)
          return send(200, await readActivity(project));
        if (req.method === 'GET' && route === '/api/capabilities')
          return send(200, await app.capabilities(project, {
            sessionID: url.searchParams.get('session') || undefined,
            agent: url.searchParams.get('agent') || undefined,
            model: url.searchParams.get('model') || undefined,
          }));
        if (req.method === "GET" && route === "/api/bootstrap")
          return send(
            200,
            await (async () => {
              const result = await app.bootstrap(project, url.searchParams.get("session"));
              if (goals && result.project) {
                result.goals = await goals.list(result.project.id);
                result.sessions = result.sessions.map(s => ({ ...s, goal: result.goals.find(g => g.session === s.id) }));
              }
              return history ? history.decorateBootstrap(result) : result;
            })(),
          );
        if (req.method === "GET" && route === "/api/models/ratings")
          return send(200, { job: app.modelRatings.status() });
        if (req.method === "POST" && route === "/api/models/ratings")
          return send(200, { job: await app.modelRatings.start(project, body.model, body.retry, body.variant, body.free === true) });
        if (req.method === 'POST' && route === '/api/models/ratings/stop')
          return send(200, { job: await app.modelRatings.stop(body.id) });
        if (req.method === "POST" && route === "/api/models/ratings/dismiss")
          return send(200, { job: app.modelRatings.dismiss(body.id) });
        if (route === '/api/index/jobs' && req.method === 'GET')
          return send(200, { job: app.indexJobs.status() });
        if (route === '/api/index/jobs' && req.method === 'POST')
          return send(200, { job: await app.indexJobs.start(body.kind, body.project, body.retry) });
        if (route === '/api/index/jobs/stop' && req.method === 'POST')
          return send(200, { job: app.indexJobs.stop(body.id) });
        if (route === '/api/index/jobs/dismiss' && req.method === 'POST')
          return send(200, { job: app.indexJobs.dismiss(body.id) });
        if (req.method === "POST" && route === "/api/projects")
          return send(200, await app.addProject(body.directory));
        if (req.method === 'GET' && route === '/api/projects/folders')
          return send(200, await app.listProjectFolders(url.searchParams.get('directory') ?? ''));
        if (req.method === 'POST' && route === '/api/projects/import-preview') {
          // Existing projects need no catalog scan; let the client reopen them
          // immediately through the ordinary project path.
          const settings = await app.store.read('settings');
          const directory = await import('node:fs/promises').then(fs => fs.realpath(body.directory));
          const existing = settings.projects.find(row => (process.platform === 'win32'
            ? row.directory.replace(/^\\\\\?\\/, '').toLowerCase() === directory.replace(/^\\\\\?\\/, '').toLowerCase()
            : row.directory === directory));
          if (existing && !body.sourceDirectory) return send(200, { existing, directory, chats: [], notice: 'This project is already set up. Import is offered only for new projects.' });
          return send(200, await app.chatgpt.preview(body.directory, body.sourceDirectory));
        }
        if (req.method === 'POST' && route === '/api/projects/setup')
          return send(200, await app.chatgpt.complete(body.token, body.selected));
        if (req.method === 'POST' && route === '/api/chat/imported/continue')
          return send(200, await sender.organize(project, () => app.chatgpt.resume(project, body.session)));
        if (req.method === "POST" && route === "/api/content-index/rebuild")
          return send(200, await app.rebuildContentIndex());
        if (req.method === "PATCH" && route === "/api/projects")
          return send(200, await app.updateProject(body.project, body));
        if (req.method === "DELETE" && route === "/api/projects")
          return send(200, await sender.organize(body.project, async (pending) => {
            if (goals && (await goals.list(body.project)).some(g => !g.archived)) throw Error('Archive this project’s goals before removing it.');
            if (pending.length) throw Error("Resolve queued or uncertain messages before removing this project.");
            return app.removeProject(body.project);
          }));
        if (req.method === "PUT" && route === "/api/projects/selection")
          return send(200, await app.selectProject(body.project));
        if (req.method === "GET" && route === "/api/chat") {
          const id = url.searchParams.get("session");
          const timings = [];
          let result;
          if (url.searchParams.get("preview") === "1") result = await app.chatPreview(project, id);
          else try { result = await app.chat(project, id, { onTiming: (name, ms) => timings.push(`${name};dur=${ms.toFixed(1)}`) }); }
          catch (error) {
            if (!isLocalDataUnavailable(error)) throw error;
            result = await app.chatTranscript(project, id, error.message);
          }
          if (history && id) void history.indexCurrent(project, id, result.messages).catch(() => {});
          if (goals && id) { const g = await goals.forSession(project, id); if (g) { const { captured, ...visible } = g; result.goal = visible; } }
          if (timings.length) res.setHeader('Server-Timing', timings.join(', '));
          return send(200, result);
        }
        if (req.method === "POST" && route === "/api/chats") {
          return send(200, await sender.organize(project, async () => {
            await history?.ensureWritable(project);
            return app.createChat(project, body.title);
          }));
        }
        if (req.method === "PATCH" && route === "/api/chat") {
          const goal = await goals?.forSession(project, body.session);
          return send(200, goal ? await goals.update(project, { id: goal.id, revision: goal.revision, objective: goal.objective, title: body.title }) : await app.changeChat(project, body.session, body));
        }
        if (req.method === "POST" && route === "/api/chat/action") {
          return send(200, await sender.organize(project, async () => {
            if (await goals?.forSession(project, body.session)) throw Error('Goal chats keep one conversation. Manage this goal in Project settings.');
            await history?.ensureWritable(project, body.session);
            return app.sessionAction(project, body.session, body.action, body);
          }));
        }
        if (req.method === "GET" && route === "/api/files")
          return send(
            200,
            await app.files(
              project,
              url.searchParams.get("path") ?? "",
              url.searchParams.get("content") === "true",
            ),
          );
        if (history) {
          const session = url.searchParams.get("session") ?? body.session ?? "";
          if (route === "/api/index/stats" && req.method === "GET")
            return send(200, await history.indexStats());
          if (route === "/api/index/search" && req.method === "GET")
            return send(200, await history.searchFiles(url.searchParams.get("q") ?? "", {
              project: url.searchParams.get("project") ?? "",
            }));
          if (route === "/api/index/maintenance" && req.method === "POST")
            return send(200, await history.maintainIndex(body.operation));
          if (route === "/api/history/search" && req.method === "GET")
            return send(200, await history.searchChats(url.searchParams.get("q") ?? "", {
              project: url.searchParams.get("project") ?? "", model: url.searchParams.get("model") ?? "",
            }));
          if (route === "/api/history/index" && req.method === "POST")
            return send(200, await history.rebuildChatSearch());
          if (route === "/api/history" && req.method === "GET") {
            const result = await history.list(project, Object.fromEntries(url.searchParams));
            const rows = await goals?.list(project) ?? [];
            result.sessions = result.sessions.map(s => ({ ...s, goal: rows.find(g => g.session === s.id) }));
            return send(200, result);
          }
          if (route === "/api/history/pin" && req.method === "PUT")
            return send(200, await history.pin(project, session, body));
          if (route === "/api/history/archive" && req.method === "PUT") {
            if (await goals?.forSession(project, session)) throw Error('Archive or restore this goal from Project settings → Goals to keep its chat together.');
            return send(200, await history.archive(project, session, body, sender.organize));
          }
          if (route === "/api/history/project" && req.method === "PUT") {
            if (body.archived && goals && (await goals.list(project)).some(g => !g.archived)) throw Error('Archive this project’s goals first.');
            return send(200, await history.archiveProject(project, body, sender.organize));
          }
          if (route === "/api/history/export" && req.method === "POST")
            return send(200, await history.export(project, body));
          if (route === "/api/drafts" && req.method === "GET")
            return send(200, await history.draft(project, session));
          if (route === "/api/drafts" && req.method === "PUT")
            return send(200, await history.saveDraft(project, session, body));
          if (route === "/api/drafts/rebind" && req.method === "POST")
            return send(200, await history.rebindDraft(project, body));
          if (route === "/api/storage" && req.method === "GET")
            return send(200, await history.storage());
          if (route === "/api/storage/open" && req.method === "POST")
            return send(200, await history.openLocation(body.location));
        }
        if (req.method === "GET" && route === "/api/sender")
          return send(200, await sender.list(project, url.searchParams.get("session")));
        if (req.method === "GET" && route === "/api/schedules")
          return send(200, await schedules.list());
        if (req.method === "POST" && route === "/api/schedules")
          return send(200, await schedules.create(body));
        if (req.method === "PUT" && route === "/api/schedules")
          return send(200, await schedules.update(body));
        if (req.method === "DELETE" && route === "/api/schedules")
          return send(200, await schedules.delete(body.id));
        if (req.method === "POST" && route === "/api/sender")
          return send(200, await sender.enqueue(project, body.session, body));
        if (req.method === "PATCH" && route === "/api/sender")
          return send(200, await sender.edit(project, body.session, body.id, body.text, body.version));
        if (req.method === "DELETE" && route === "/api/sender")
          return send(200, await sender.cancel(project, body.session, body.id));
        if (req.method === "POST" && route === "/api/send")
          return send(200, await sender.send(project, body.session, body));
        if (req.method === "POST" && route === "/api/stop") {
          const goal = await goals?.forSession(project, body.session);
          return send(200, goal && (goal.status === 'running' || goal.transition || goal.unsettled) ? await goals.stop(project, goal.id) : await sender.stop(project, body.session));
        }
        if (req.method === "POST" && route === "/api/respond")
          return send(
            200,
            await app.respond(project, body.type, body.id, body.response),
          );
        if (req.method === "PUT" && route === "/api/session-defaults")
          return send(200, await app.saveSessionDefaults(project, body));
        if (req.method === 'GET' && route === '/api/context-settings')
          return send(200, await app.contextSettings.read(project));
        if (req.method === 'PUT' && route === '/api/context-settings')
          return send(200, await app.contextSettings.save(project, body));
        if (req.method === "GET" && route === "/api/preferences")
          return send(200, await app.readPreferences(project, url.searchParams.get("session")));
        if (req.method === "PUT" && route === "/api/preferences")
          return send(200, await app.savePreferences(project, body));
        if (req.method === "POST" && route === "/api/usage/refresh")
          return send(200, await app.refreshUsage());
        if (req.method === "PUT" && route === "/api/plans")
          return send(200, await app.savePlans(body));
        if (req.method === "PUT" && route === "/api/appearance")
          return send(200, await app.saveAppearance(body));
        if (req.method === "GET" && route === "/api/auth")
          return send(200, await app.authMethods());
        if (req.method === "POST" && route === "/api/auth")
          return send(200, await app.auth(body.provider, body.action, body));
        if (req.method === "PUT" && route === "/api/agents")
          return send(200, await app.saveAgent(body));
        if (req.method === "DELETE" && route === "/api/agents")
          return send(200, await app.removeAgent(body.id));
        if (req.method === "GET" && route === "/api/events") {
          const abort = new AbortController();
          res.on("close", () => abort.abort());
          const stream = await app.events(project, abort.signal);
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
          });
          try {
            for await (const chunk of stream) {
              if (abort.signal.aborted) break;
              if (!res.write(chunk))
                await once(res, "drain", { signal: abort.signal });
            }
          } catch {
            /* Client disconnects and frontend reconnects. */
          } finally {
            res.end();
          }
          return;
        }
        return send(404, { error: "Action not found" });
      }
      if (req.method !== "GET")
        return send(405, { error: "Method not allowed" });
      if (
        (req.headers.origin && req.headers.origin !== requestOrigin) ||
        (req.headers["sec-fetch-site"] === "cross-site" &&
          !(
            route === "/" &&
            req.headers["sec-fetch-mode"] === "navigate" &&
            req.headers["sec-fetch-dest"] === "document"
          ))
      )
        return send(403, { error: "Local application only" });
      const relative =
        route === "/" ? "index.html" : decodeURIComponent(route.slice(1));
      const file = path.resolve(assets, relative);
      if (!file.startsWith(path.resolve(assets) + path.sep))
        return send(403, { error: "Invalid asset" });
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      );
      const content = await readFile(file);
      return send(
        200,
        path.extname(file) === ".html" ? themeDocument(content.toString("utf8"), await savedTheme(app.store)) : content,
        types[path.extname(file)] ?? "application/octet-stream",
        /^assets\/[\w-]+-[\w-]{8,}\.(?:js|css)$/.test(relative)
          ? "public, max-age=31536000, immutable" : "no-store",
      );
    } catch (e) {
      if (res.headersSent) {
        res.end();
        return;
      }
      const status =
        Number.isInteger(e.status) && e.status >= 400 && e.status <= 599
          ? e.status
          : e.code === "ENOENT"
            ? 404
            : 400;
      const code =
        e.code === "ENOENT"
          ? "NOT_FOUND"
          : typeof e.code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(e.code)
            ? e.code
            : status === 409
              ? "CONFLICT"
              : status === 401
                ? "AUTHENTICATION_REQUIRED"
                : status === 429
                  ? "RATE_LIMITED"
                  : status >= 500
                    ? "UPSTREAM_FAILURE"
                    : "REQUEST_FAILED";
      send(status, {
        error: e.message ?? "Could not complete that action",
        code,
      });
    }
  };
  const localHandler = (req, res) => { void handleRequest(req, res); };
  const publicHandler = (req, res) => { void handleRequest(req, res, true); };
  const server = http.createServer(localHandler);
  let disposal;
  const dispose = () => disposal ??= (async () => {
    await remote.close();
    await schedules.close();
    await goals?.close();
    await sender.close();
    await app.indexJobs?.close();
    history?.close();
    app.modelRatings?.close();
    await app.gitProjects?.close();
    app.localData?.close();
  })();
  server.once("close", () => { void dispose().catch(() => {}); });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  await remote.start(localHandler, publicHandler);
  if (timers) sender.start();
  if (timers) schedules.start();
  if (timers) goals?.startTimer();
  return {
    server, url: origin, get lanUrl() { return remote.origin || undefined; }, sender, schedules, goals,
    async close() {
      if (server.listening) {
        await new Promise(resolve => {
          server.close(resolve);
          server.closeAllConnections();
        });
      }
      await dispose();
    },
  };
}
