import { providerCatalog } from "../domain/costs.mjs";

const supported = new Set(providerCatalog.map((provider) => provider.id));
const number = (value) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
const string = (value) => (typeof value === "string" ? value : undefined);

// OpenCode's internal provider response can include credential material. Only
// these presentation fields may cross the application boundary, including for
// nested models. Never spread an upstream provider or model into a response.
export function publicCatalog(value) {
  const all = (value.all ?? [])
    .filter((provider) => supported.has(provider.id))
    .map((provider) => ({
      id: provider.id,
      name: providerCatalog.find((p) => p.id === provider.id).name,
      models: Object.fromEntries(
        Object.entries(provider.models ?? {})
          .filter(
            ([, model]) =>
              provider.id !== "opencode" ||
              (model.cost?.input === 0 && model.cost?.output === 0),
          )
          .map(([id, model]) => [
            id,
            {
              id,
              name: string(model.name) ?? id,
              status: string(model.status),
              variants: Object.keys(model.variants ?? {}).filter(
                (key) =>
                  /^[\w-]{1,80}$/.test(key) &&
                  model.variants[key]?.disabled !== true,
              ),
              limit: {
                context: number(model.limit?.context),
                output: number(model.limit?.output),
              },
              cost: {
                input: number(model.cost?.input),
                output: number(model.cost?.output),
              },
              capabilities: {
                toolcall:
                  model.capabilities?.toolcall === true ||
                  model.toolcall === true,
              },
            },
          ]),
      ),
    }));
  return {
    all,
    connected: (value.connected ?? []).filter((id) => supported.has(id)),
  };
}
