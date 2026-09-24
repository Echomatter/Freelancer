import { useEffect, useId, useRef, useState } from 'react';
import { Check, RotateCcw } from 'lucide-react';
import { api } from './api';
import { Button } from './echoflex/Controls';
import { normalizeColor } from '../domain/color.mjs';
import { providerColor, providerColorPresets, providerDefaults, providerTokens } from '../domain/provider-colors.mjs';
import { useColorAppearance, type ColorPatch } from './ProviderColors';

export function ProviderColorPicker({ provider, name, onSaved }: {
  provider: string; name: string; onSaved: (patch: ColorPatch) => void;
}) {
  const appearance = useColorAppearance(), stored = providerColor(provider, appearance.providerColors);
  const [draft, setDraft] = useState(stored), [pending, setPending] = useState(false), [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const saving = useRef(false), dirty = useRef(false), mounted = useRef(true);
  const id = useId();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (!dirty.current && !saving.current) setDraft(stored); }, [stored]);
  let valid: string | null = null;
  try { valid = normalizeColor(draft); } catch { /* The editable value may be incomplete. */ }
  const preview = valid ?? stored;
  function choose(value: string) { dirty.current = true; setDraft(value); setError(''); setMessage(''); }
  async function save(reset = false) {
    if (saving.current || (!reset && !valid)) return;
    const color = reset ? null : valid;
    saving.current = true; setPending(true); setError(''); setMessage('');
    try {
      const result = await api('appearance', { providerColors: { [provider]: color } }, 'PUT');
      const confirmed = result?.providerColors;
      if (result?.saved !== true || !confirmed || (reset ? Object.hasOwn(confirmed, provider) : confirmed[provider] !== color))
        throw Error('Color was not confirmed. Restart Freelancer and try again.');
      // Report only this key. Out-of-order acknowledgements from different cards
      // cannot restore older values for another provider or its billing settings.
      onSaved({ providerColors: { [provider]: color } });
      if (mounted.current) {
        dirty.current = false; setDraft(color ?? providerDefaults[provider]); setMessage(reset ? 'Default color restored.' : 'Provider color saved.');
      }
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : 'Color could not be saved.'); }
    finally { saving.current = false; if (mounted.current) setPending(false); }
  }
  return <fieldset className="provider-color-picker" disabled={pending} aria-describedby={`${id}-help`}>
    <legend>{name} color</legend>
    <p id={`${id}-help`}>Choose a color for this provider and its models. Text shades adjust to your palette for readability.</p>
    <div className="provider-color-presets" role="group" aria-label={`${name} color presets`}>
      {providerColorPresets.map(p => <button type="button" key={p.name} aria-label={`${name}: ${p.name}`} aria-pressed={valid === p.color}
        onClick={() => choose(p.color)} className="color-preset">
        <span className="color-swatch" style={{ background: p.color }} aria-hidden="true" /><span>{p.name}</span>{valid === p.color && <Check size={14} aria-hidden="true" />}
      </button>)}
    </div>
    <div className="provider-color-custom">
      <label>Custom color<input type="color" value={preview} onChange={e => choose(e.target.value)} aria-label={`${name} custom color`} /></label>
      <label>Hex color<input value={draft} maxLength={7} spellCheck={false} autoComplete="off" aria-label={`${name} hex color`}
        aria-invalid={!valid} onChange={e => choose(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void save(); } }} /></label>
      <div className="provider-color-preview" style={providerTokens(provider, { ...appearance, providerColors: { [provider]: preview } })} aria-label={`${name} color preview`}>
        <span className="provider-preview-icon" aria-hidden="true">{name[0]}</span><span><strong>{name}</strong><small>Model name preview</small></span>
      </div>
    </div>
    {!valid && <small className="color-validation">Enter a hex color such as #2563eb.</small>}
    <div className="provider-color-actions">
      <Button type="button" onClick={() => void save()} disabled={pending || !valid || (valid === stored && !dirty.current)}>Save color<Check size={14} /></Button>
      <Button type="button" variant="quiet" onClick={() => void save(true)} disabled={pending}><RotateCcw size={14} />Use default</Button>
      <span role="status">{pending ? 'Saving color…' : message}</span>
    </div>
    {error && <p className="notice error" role="alert">{error}</p>}
  </fieldset>;
}
