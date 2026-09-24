import { ProviderSelect } from "./ProviderColors";
import { Field } from "./echoflex/Controls";
import { workspaceModels, modelVariant } from "../domain/workspace.mjs";

export function ModelIntelligence({
  variants = [],
  value = "",
  onChange,
  compact = false,
  disabled = false,
}: {
  variants?: string[];
  value?: string;
  onChange: (value: string) => void;
  compact?: boolean;
  disabled?: boolean;
}) {
  if (!variants.length) return null;
  return (
    <label className={compact ? "composer-choice" : "field"}>
      <span>Intelligence</span>
      <select
        aria-label="Intelligence"
        disabled={disabled}
        value={modelVariant(variants, value)}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Default</option>
        {variants.map((v) => (
          <option key={v} value={v}>
            {v[0].toUpperCase() + v.slice(1)}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Intelligence({
  value = "inherit",
  variants = [],
  onChange,
}: {
  value?: string;
  variants?: string[];
  onChange: (value: string) => void;
}) {
  return (
    <Field label="Intelligence">
      <select
        value={value === "inherit" ? "" : value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Model default</option>
        {variants.map((v) => (
          <option key={v} value={v}>
            {v[0].toUpperCase() + v.slice(1)}
          </option>
        ))}
        {value && value !== "inherit" && !variants.includes(value) && (
          <option value={value}>{value} · Unavailable</option>
        )}
      </select>
    </Field>
  );
}

export function ParentModelFields({
  data,
  model,
  variant,
  onModel,
  onVariant,
  defaults = false,
  allowAutomatic = false,
}: {
  data: any;
  model: string;
  variant: string;
  onModel: (value: string) => void;
  onVariant: (value: string) => void;
  defaults?: boolean;
  allowAutomatic?: boolean;
}) {
  const models = workspaceModels(data.models, data.providers.connected);
  const selected = data.models.find((m) => m.id === model);
  const variants = selected?.variants ?? [];
  const preferences =
    data.snapshot.preferences?.defaults ??
    data.snapshot.preferences?.preferences;
  return (
    <div className={variants.length ? "editor-columns" : "parent-model-only"}>
      <Field label={allowAutomatic ? "Default model" : "Parent model"}>
        <ProviderSelect
          provider={model}
          required
          value={model}
          onChange={(e) => onModel(e.target.value)}
        >
          <option value="" disabled>
            Choose a model
          </option>
          {allowAutomatic && <option value="auto">Choose per assignment</option>}
          {data.providers.all.map((p) => (
            <optgroup key={p.id} label={p.name}>
              {models
                .filter((m) => m.provider === p.id)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
            </optgroup>
          ))}
          {model && model !== "auto" && !models.some((m) => m.id === model) && (
            <option value={model}>{model} · Unavailable</option>
          )}
        </ProviderSelect>
      </Field>
      <ModelIntelligence
        value={modelVariant(variants, variant, preferences?.reasoningVariant)}
        variants={variants}
        onChange={onVariant}
      />
    </div>
  );
}

export function agentModelID(model?: string) {
  return model && model !== "inherit" ? model : "auto";
}
