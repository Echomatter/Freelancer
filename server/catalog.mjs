import { providerCatalog } from "../domain/costs.mjs";

const known = new Map(providerCatalog.map((provider) => [provider.id, provider]));
const providerID = value => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
const number = (value) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
const string = (value) => (typeof value === "string" ? value : undefined);
const boolean = (value) => (typeof value === "boolean" ? value : undefined);

// OpenCode owns the provider inventory. Copy only public presentation fields;
// never spread an upstream provider/model object or expose credential fields.
export function publicCatalog(value) {
  const all = (value.all ?? [])
    .filter((provider) => providerID(provider.id))
    .map((provider) => ({
      id: provider.id,
      name: string(provider.name) ?? known.get(provider.id)?.name ?? provider.id,
      models: Object.fromEntries(
        Object.entries(provider.models ?? {})
          .filter(([id]) => /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(id))
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
                toolcall: boolean(model.capabilities?.toolcall) ?? boolean(model.toolcall) ?? boolean(model.tool_call),
                reasoning: boolean(model.capabilities?.reasoning) ?? boolean(model.reasoning),
                input: {
                  image: boolean(model.capabilities?.input?.image) ??
                    (Array.isArray(model.modalities?.input) ? model.modalities.input.includes('image') : undefined),
                },
              },
            },
          ]),
      ),
    }));
  return {
    all,
    connected: (value.connected ?? []).filter(providerID),
  };
}
