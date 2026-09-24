import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { createSender } from "./sender.mjs";
import { savedTheme, themeDocument } from "./theme.mjs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { isLocalDataUnavailable } from "./data/store.mjs";

const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};
export async function startServer({ application: app, assets, port = 0, readActivity, shutdownToken, onShutdown }) {
  const history = app.history;
  const sender = createSender(app, { beforeSend: history?.ensureWritable });
  await sender.ready;
  await app.gitProjects?.recover();
  let origin;
  const server = http.createServer(async (req, res) => {
    const send = (status, value, type = "application/json") => {
      res.writeHead(status, {
        "Content-Type": type,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      });
      res.end(type === "application/json" ? JSON.stringify(value) : value);
    };
    try {
      if (req.headers.host !== new URL(origin).host)
        return send(403, { error: "Local application only" });
      const url = new URL(req.url, origin),
        route = url.pathname;
      if (route === "/__shutdown" && req.method === "POST") {
        const supplied = String(req.headers["x-freelancer-shutdown"] ?? "");
        const remote = req.socket.remoteAddress;
        const loopback = remote === "127.0.0.1" || remote === "::ffff:127.0.0.1" || remote === "::1";
        if (!loopback || !shutdownToken || supplied.length !== shutdownToken.length ||
          !timingSafeEqual(Buffer.from(supplied), Buffer.from(shutdownToken)))
          return send(403, { error: "Local application only" });
        res.writeHead(202, { "Cache-Control": "no-store" });
        res.end();
        setImmediate(() => onShutdown?.());
        return;
      }
      if (route.startsWith("/api/")) {
        const supplied = String(req.headers["x-freelancer-git-bridge"] ?? "");
        const expected = process.env.FREELANCER_GIT_BRIDGE || "";
        const agentBridge = route === "/api/git/agent" && !!expected && supplied.length === expected.length && timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
        if (
          (!agentBridge && req.headers["x-freelancer-client"] !== "webpage") ||
          (req.headers.origin && req.headers.origin !== origin) ||
          req.headers["sec-fetch-site"] === "cross-site"
        )
          return send(403, { error: "Open Freelancer to continue" });
        let body = {};
        if (!["GET", "HEAD"].includes(req.method)) {
          let bytes = 0,
            chunks = [];
          for await (const chunk of req) {
            bytes += chunk.length;
            if (bytes > (route === "/api/send" ? 9 : 1) * 1024 * 1024)
              return send(413, { error: "Message is too large" });
            chunks.push(chunk);
          }
          body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
        }
        const project = url.searchParams.get("project") ?? body.project;
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
        if (route === "/api/git/execute" && req.method === "POST") return send(200, await app.gitProjects.execute(project, body, { origin: "panel" }));
        if (req.method === "GET" && route === "/api/activity" && readActivity)
          return send(200, await readActivity(project));
        if (req.method === "GET" && route === "/api/bootstrap")
          return send(
            200,
            await (async () => {
              const result = await app.bootstrap(project, url.searchParams.get("session"));
              return history ? history.decorateBootstrap(result) : result;
            })(),
          );
        if (req.method === "GET" && route === "/api/models/ratings")
          return send(200, { job: app.modelRatings.status() });
        if (req.method === "POST" && route === "/api/models/ratings")
          return send(200, { job: await app.modelRatings.start(project, body.model, body.retry, body.variant) });
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
            if (pending.length) throw Error("Resolve queued or uncertain messages before removing this project.");
            return app.removeProject(body.project);
          }));
        if (req.method === "PUT" && route === "/api/projects/selection")
          return send(200, await app.selectProject(body.project));
        if (req.method === "GET" && route === "/api/chat") {
          const id = url.searchParams.get("session");
          let result;
          try { result = await app.chat(project, id); }
          catch (error) {
            if (!isLocalDataUnavailable(error)) throw error;
            result = await app.chatTranscript(project, id, error.message);
          }
          if (history && id) void history.indexCurrent(project, id, result.messages).catch(() => {});
          return send(200, result);
        }
        if (req.method === "POST" && route === "/api/chats") {
          return send(200, await sender.organize(project, async () => {
            await history?.ensureWritable(project);
            return app.createChat(project, body.title);
          }));
        }
        if (req.method === "PATCH" && route === "/api/chat")
          return send(200, await app.changeChat(project, body.session, body));
        if (req.method === "POST" && route === "/api/chat/action") {
          return send(200, await sender.organize(project, async () => {
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
          if (route === "/api/index/maintenance" && req.method === "POST")
            return send(200, await history.maintainIndex(body.operation));
          if (route === "/api/history/search" && req.method === "GET")
            return send(200, await history.searchChats(url.searchParams.get("q") ?? "", {
              project: url.searchParams.get("project") ?? "", model: url.searchParams.get("model") ?? "",
            }));
          if (route === "/api/history/index" && req.method === "POST")
            return send(200, await history.rebuildChatSearch());
          if (route === "/api/history" && req.method === "GET")
            return send(200, await history.list(project, Object.fromEntries(url.searchParams)));
          if (route === "/api/history/pin" && req.method === "PUT")
            return send(200, await history.pin(project, session, body));
          if (route === "/api/history/archive" && req.method === "PUT")
            return send(200, await history.archive(project, session, body, sender.organize));
          if (route === "/api/history/project" && req.method === "PUT")
            return send(200, await history.archiveProject(project, body, sender.organize));
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
        if (req.method === "POST" && route === "/api/sender")
          return send(200, await sender.enqueue(project, body.session, body));
        if (req.method === "DELETE" && route === "/api/sender")
          return send(200, await sender.cancel(project, body.session, body.id));
        if (req.method === "POST" && route === "/api/send")
          return send(200, await sender.send(project, body.session, body));
        if (req.method === "POST" && route === "/api/stop")
          return send(200, await sender.stop(project, body.session));
        if (req.method === "POST" && route === "/api/respond")
          return send(
            200,
            await app.respond(project, body.type, body.id, body.response),
          );
        if (req.method === "PUT" && route === "/api/session-defaults")
          return send(200, await app.saveSessionDefaults(project, body));
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
        if (req.method === "PUT" && route === "/api/workflows")
          return send(200, await app.saveWorkflow(body));
        if (req.method === "PUT" && route === "/api/agents")
          return send(200, await app.saveAgent(body));
        if (req.method === "DELETE" && route === "/api/agents")
          return send(200, await app.removeAgent(body.id));
        if (req.method === "DELETE" && route === "/api/workflows")
          return send(200, await app.removeWorkflow(body.id));
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
              if (!res.write(chunk))
                await new Promise((resolve) => res.once("drain", resolve));
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
        (req.headers.origin && req.headers.origin !== origin) ||
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
  });
  let disposal;
  const dispose = () => disposal ??= (async () => {
    await sender.close();
    await app.indexJobs?.close();
    history?.close();
    app.modelRatings?.close();
    await app.gitProjects?.close();
  })();
  server.once("close", () => { void dispose().catch(() => {}); });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  sender.start();
  return {
    server, url: origin, sender,
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
