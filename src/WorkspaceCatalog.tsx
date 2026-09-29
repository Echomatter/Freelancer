import { ProviderText } from "./ProviderColors";
import { useEffect, useRef, useState } from "react";
import {
  Bot,
  Code2,
  Search,
  Palette,
  Plus,
  Pencil,
  ArrowUpRight,
  Trash2,
} from "lucide-react";
import { Button, PageCloseButton, PageHeading, Panel, Field, Badge } from "./echoflex/Controls";
import { api } from "./api";
import {
  agentDefaults,
  modelVariant,
} from "../domain/workspace.mjs";

import { ParentModelFields, agentModelID } from "./ModelSetup";

const icons = { engineer: Code2, researcher: Search, designer: Palette };
export function WorkspaceCatalog({
  data,
  run,
  refresh,
  onUse,
  onClose,
}: {
  data: any;
  run: (fn: () => Promise<any>) => Promise<void>;
  refresh: () => Promise<void>;
  onUse: (item: any) => void;
  onClose: () => void;
}) {
  const kind = "agents";
  const [edit, setEdit] = useState<any>(null),
    [search, setSearch] = useState(""),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const nameInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setError("");
    if (edit) nameInput.current?.focus();
  }, [!!edit]);
  const rows = data.settings.agents.filter((x) =>
    `${x.name} ${x.prompt}`.toLowerCase().includes(search.toLowerCase()),
  );
  const update = (key, value) =>
    setEdit((e) => ({
      ...e,
      [key]: value,
      ...(key === "models" ? { variant: "inherit" } : {}),
    }));
  const defaults = agentDefaults;
  async function save() {
    setSaving(true);
    try {
      const preferences = data.snapshot.preferences?.defaults ?? data.snapshot.preferences?.preferences;
      await api(kind, {
        ...edit,
        variant: edit.model === "auto" ? "inherit" : modelVariant(
          data.models.find((m) => m.id === edit.model)?.variants,
          edit.variant,
          preferences?.reasoningVariant,
        ),
      }, "PUT");
      await refresh();
      setEdit(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save. Try again.");
    }
    setSaving(false);
  }
  async function remove() {
    setSaving(true);
    try {
      await api(kind, { id: edit.id }, "DELETE");
      await refresh();
      setEdit(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove. Try again.");
    }
    setSaving(false);
  }
  return (
    <div className="page catalog-page" key={kind}>
      {!edit && <>
      <PageHeading title="Agents" icon={Bot} help="agents"
        actions={<>
          <Button
            variant="primary"
            onClick={() =>
              setEdit({
                name: "",
                prompt: "",
                response: "balanced",
                approach: "practical",
                model: agentModelID(),
                variant: "inherit",
              })
            }
          >
            <Plus size={17} />
            Add agent
          </Button>
          <PageCloseButton onClick={onClose} />
        </>} />
      <label className="search catalog-search">
        <Search size={16} />
        <input
          aria-label="Find agents"
          placeholder="Find an agent…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      <div className="model-grid catalog-grid">
        {rows.map((item) => {
          const Icon = icons[item.id] ?? Bot;
          return (
            <Panel className="catalog-card" key={item.id}>
              <div className="balance-row">
                <span className="catalog-icon">
                  <Icon size={24} />
                </span>
                <Badge>
                  {defaults.some((d) => d.id === item.id)
                    ? "Default"
                    : "Custom"}
                </Badge>
              </div>
              <h2>{item.name}</h2>
              <p className="catalog-description">
                {item.prompt || "Start with your own instructions."}
              </p>
              <div className="catalog-tags">
                  <Badge>{item.approach}</Badge>
                  <Badge>{item.response}</Badge>
                  <Badge><ProviderText provider={agentModelID(item.model)}>
                    {data.models.find((m) => m.id === agentModelID(item.model))?.name ??
                      (agentModelID(item.model) === "auto" ? "Choose per assignment" : agentModelID(item.model))}
                  </ProviderText></Badge>
              </div>
              <div className="action-row">
                <Button onClick={() => onUse(item)}>
                  Use agent
                  <ArrowUpRight size={14} />
                </Button>
                <Button
                  variant="quiet"
                  aria-label={`Edit ${item.name}`}
                  onClick={() =>
                    setEdit({
                      ...structuredClone(item),
                      model: agentModelID(item.model),
                    })
                  }
                >
                  <Pencil size={15} />
                  Edit
                </Button>
              </div>
            </Panel>
          );
        })}
      </div>
      {!rows.length && search && (
        <p className="empty-results">No matches. Try another search.</p>
      )}
      </>}
      {edit && <section
        aria-label="Agent editor"
        className="catalog-editor"
      >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <PageHeading title={`${edit.id ? "Edit" : "New"} agent`} icon={Bot} help="agents"
              actions={<PageCloseButton label="Close editor" onClick={() => setEdit(null)} />} />
            {error && (
              <p className="notice error" role="alert">
                {error}
              </p>
            )}
            <Field label="Name">
              <input
                autoFocus
                ref={nameInput}
                required
                maxLength={80}
                value={edit.name}
                onChange={(e) => update("name", e.target.value)}
              />
            </Field>
            <Field label="Prompt">
              <textarea
                required
                rows={6}
                maxLength={20000}
                value={edit.prompt}
                onChange={(e) => update("prompt", e.target.value)}
                placeholder="What should this agent bring to the work?"
              />
            </Field>
                <ParentModelFields
                  allowAutomatic
                  data={data}
                  model={edit.model ?? ""}
                  variant={edit.variant ?? "inherit"}
                  onModel={(v) =>
                    setEdit((e) => ({ ...e, model: v, variant: "" }))
                  }
                  onVariant={(v) => update("variant", v)}
                />
                <div className="editor-columns">
                  <Field label="Response style">
                    <select
                      value={edit.response}
                      onChange={(e) => update("response", e.target.value)}
                    >
                      {["concise", "balanced", "detailed"].map((x) => (
                        <option key={x} value={x}>
                          {x[0].toUpperCase() + x.slice(1)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Approach">
                    <select
                      value={edit.approach}
                      onChange={(e) => update("approach", e.target.value)}
                    >
                      {["practical", "thorough", "creative"].map((x) => (
                        <option key={x} value={x}>
                          {x[0].toUpperCase() + x.slice(1)}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
            <div className="editor-footer">
              {edit.id && !defaults.some((d) => d.id === edit.id) && (
                <Button
                  type="button"
                  variant="quiet"
                  disabled={saving}
                  onClick={() => void remove()}
                >
                  <Trash2 size={15} /> Delete
                </Button>
              )}
              <Button
                type="button"
                variant="quiet"
                onClick={() => setEdit(null)}
              >
                Cancel
              </Button>
              <Button variant="primary" type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save agent"}
              </Button>
            </div>
          </form>
      </section>}
    </div>
  );
}
