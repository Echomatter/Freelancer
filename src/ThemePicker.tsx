import { useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { api } from './api';
import { applyTheme, resolveTheme, lightPalettes, darkPalettes, paletteStyles } from '../domain/theme.mjs';
import type { ColorPatch } from './ProviderColors';
export function ThemePicker({ theme, refresh, onSaved }: { theme?: string; refresh: () => Promise<any>; onSaved?: (patch: ColorPatch) => void }) {
  const initial = () => resolveTheme(theme ?? (typeof document === 'undefined' ? undefined : document.documentElement.dataset.theme));
  const [value, setValue] = useState(initial), [pending, setPending] = useState(false), [error, setError] = useState('');
  const saving = useRef(false);
  useEffect(() => { if (!saving.current && theme !== undefined) setValue(resolveTheme(theme)); }, [theme]);
  async function save(next: string) {
    if (saving.current || next === value) return;
    const previous = value;
    saving.current = true; setPending(true); setError('');
    // Preview before the round trip so the workspace responds at click time.
    applyTheme(next); setValue(next);
    try {
      const result = await api('appearance', { theme: next }, 'PUT');
      if (result?.saved !== true || result.theme !== next)
        throw Error('Theme was not confirmed. Restart Freelancer and try again.');
      onSaved?.({ theme: next });
      void refresh().catch(() => {});
    } catch (e) {
      applyTheme(previous); setValue(previous);
      setError(e instanceof Error ? e.message : 'Theme could not be saved.');
    }
    finally { saving.current = false; setPending(false); }
  }
  const [expanded, setExpanded] = useState({ light: true, dark: true });
  const groups = [{ mode: 'light', heading: 'Light themes', palettes: lightPalettes }, { mode: 'dark', heading: 'Dark themes', palettes: darkPalettes }] as const;
  return <section className="palette-picker" aria-labelledby="theme-picker-heading">
    <h3 id="theme-picker-heading">Theme</h3>
    <p className="palette-intro">Choose a palette. Themes are ordered by accent color in each group.</p>
    {groups.map(group => <div className="palette-group" key={group.mode}>
      <h4 className="palette-group-heading">
        <button type="button" className="palette-group-toggle" aria-expanded={expanded[group.mode]}
          onClick={() => setExpanded(current => ({ ...current, [group.mode]: !current[group.mode] }))}>
          <span>{group.heading} ({group.palettes.length})</span><span aria-hidden="true">{expanded[group.mode] ? '−' : '+'}</span>
        </button>
      </h4>
      {expanded[group.mode] && <div className="palette-options" role="group" aria-label={group.heading}>
          {group.palettes.map(p => <button type="button" key={p.id} disabled={pending} aria-label={`Use ${p.name} palette`} aria-pressed={value === p.id}
            className="palette-option" onClick={() => void save(p.id)}>
            <span className="palette-mini" style={paletteStyles[p.id]} aria-hidden="true"><span className="palette-mini-nav" /><span className="palette-mini-main"><i /><i /><b /></span></span>
            <span className="palette-name"><strong>{p.name}</strong>{value === p.id && <Check size={16} aria-hidden="true" />}</span>
            <small>{p.description}</small>
          </button>)}
        </div>}
    </div>)}
    {pending && <small role="status">Saving theme…</small>}
    {error && <p className="notice error" role="alert">{error}</p>}
  </section>;
}
