import { useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { api } from './api';
import { Field } from './echoflex/Controls';
import { applyTheme, resolveTheme, palettes, themeStyle } from '../domain/theme.mjs';
import type { ColorPatch } from './ProviderColors';
export function ThemePicker({ theme, refresh, onSaved }: { theme?: string; refresh: () => Promise<any>; onSaved?: (patch: ColorPatch) => void }) {
  const initial = () => resolveTheme(theme ?? (typeof document === 'undefined' ? undefined : document.documentElement.dataset.theme));
  const [value, setValue] = useState(initial), [pending, setPending] = useState(false), [error, setError] = useState('');
  const saving = useRef(false);
  useEffect(() => { if (!saving.current && theme !== undefined) setValue(resolveTheme(theme)); }, [theme]);
  async function save(next: string) {
    if (saving.current || next === value) return;
    saving.current = true; setPending(true); setError('');
    try {
      const result = await api('appearance', { theme: next }, 'PUT');
      if (result?.saved !== true || result.theme !== next)
        throw Error('Theme was not confirmed. Restart Freelancer and try again.');
      onSaved?.({ theme: next });
      applyTheme(next); setValue(next);
      void refresh().catch(() => {});
    } catch (e) { setError(e instanceof Error ? e.message : 'Theme could not be saved.'); }
    finally { saving.current = false; setPending(false); }
  }
  return <section className="palette-picker" aria-label="Color palettes">
    <Field label="Theme"><select value={value} disabled={pending} onChange={e => void save(e.target.value)}>
      {palettes.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select></Field>
    <div className="palette-options">
      {palettes.map(p => <button type="button" key={p.id} disabled={pending} aria-label={`Use ${p.name} palette`} aria-pressed={value === p.id}
        className="palette-option" onClick={() => void save(p.id)}>
        <span className="palette-mini" style={themeStyle(p.id)} aria-hidden="true"><span className="palette-mini-nav" /><span className="palette-mini-main"><i /><i /><b /></span></span>
        <span className="palette-name"><strong>{p.name}</strong>{value === p.id && <Check size={16} aria-hidden="true" />}</span>
        <small>{p.description}</small>
      </button>)}
    </div>
    {pending && <small role="status">Saving theme…</small>}
    {error && <p className="notice error" role="alert">{error}</p>}
  </section>;
}
