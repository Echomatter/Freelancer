import { HelpHint } from "./HelpHint";
import { memo, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Check, Dices, Trash2 } from 'lucide-react';
import { api } from './api';
import { applyTheme, resolveTheme, lightPalettes, darkPalettes, paletteStyles, paletteStyle, customThemePalette } from '../domain/theme.mjs';
import { generateCustomTheme } from '../domain/custom-themes.mjs';
import type { ColorPatch, CustomTheme } from './ProviderColors';
const emptyThemes: CustomTheme[] = [];
const PaletteMini = memo(function PaletteMini({ palette }: { palette: any }) {
  return <span className="palette-mini" style={(paletteStyles[palette.id] ?? paletteStyle(palette)) as CSSProperties} aria-hidden="true">
    <span className="palette-mini-nav"><b /></span><span className="palette-mini-main"><i /><i /><span className="palette-mini-card"><b /></span></span>
  </span>;
});
export function ThemePicker({ theme, customThemes = emptyThemes, refresh, onSaved }: { theme?: string; customThemes?: CustomTheme[]; refresh: () => Promise<any>; onSaved?: (patch: ColorPatch) => void }) {
  const initial = () => resolveTheme(theme ?? (typeof document === 'undefined' ? undefined : document.documentElement.dataset.theme), customThemes);
  const [value, setValue] = useState(initial), [pending, setPending] = useState(false), [error, setError] = useState('');
  const saving = useRef(false);
  useEffect(() => { if (!saving.current && theme !== undefined) setValue(resolveTheme(theme, customThemes)); }, [theme, customThemes]);
  async function save(next: string) {
    if (saving.current || next === value) return;
    const previous = value;
    saving.current = true; setPending(true); setError('');
    // Preview before the round trip so the workspace responds at click time.
    applyTheme(next, document.documentElement, customThemes); setValue(next);
    try {
      const result = await api('appearance', { theme: next }, 'PUT');
      if (result?.saved !== true || result.theme !== next)
        throw Error('Theme was not confirmed. Restart Freelancer and try again.');
      onSaved?.({ theme: next });
      void refresh().catch(() => {});
    } catch (e) {
      applyTheme(previous, document.documentElement, customThemes); setValue(previous);
      setError(e instanceof Error ? e.message : 'Theme could not be saved.');
    }
    finally { saving.current = false; setPending(false); }
  }
  const [expanded, setExpanded] = useState({ light: true, dark: true, custom: true });
  const [draft, setDraft] = useState<CustomTheme | null>(null), [name, setName] = useState('');
  const [mode, setMode] = useState('any');
  const recent = useRef<CustomTheme[]>([]);
  function roll(reveal = false) {
    setError('');
    try {
      const next = generateCustomTheme({ mode, saved: customThemes, avoid: recent.current }) as CustomTheme;
      recent.current = [...recent.current.slice(-7), next];
      setDraft(next);
      if (reveal) setExpanded({ light: false, dark: false, custom: true });
    } catch (e) { setError(e instanceof Error ? e.message : 'Try rolling again.'); }
  }
  async function saveCustom(removeCustomTheme?: string) {
    if (saving.current || (!draft && !removeCustomTheme)) return;
    saving.current = true; setPending(true); setError('');
    try {
      const candidate = draft && { ...draft, name: name.trim() || draft.name };
      const result = await api('appearance', removeCustomTheme ? { removeCustomTheme } : { customTheme: candidate, theme: candidate!.id }, 'PUT');
      if (result?.saved !== true || !Array.isArray(result.customThemes) || typeof result.theme !== 'string')
        throw Error('Theme was not confirmed. Please try again.');
      applyTheme(result.theme, document.documentElement, result.customThemes); setValue(result.theme);
      onSaved?.({ theme: result.theme, customThemes: result.customThemes });
      if (!removeCustomTheme) { setDraft(null); setName(''); }
      void refresh().catch(() => {});
    } catch (e) { setError(e instanceof Error ? e.message : 'Theme could not be saved.'); }
    finally { saving.current = false; setPending(false); }
  }
  const groups = [{ mode: 'light', heading: 'Light themes', palettes: lightPalettes }, { mode: 'dark', heading: 'Dark themes', palettes: darkPalettes }] as const;
  return <section className="palette-picker" aria-labelledby="theme-picker-heading">
    <div className="palette-title"><h3 id="theme-picker-heading" aria-label="Theme">Theme</h3>
      <button type="button" className="button" disabled={pending || customThemes.length >= 64} onClick={() => roll(true)}><Dices size={16} />Create a theme</button></div>
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
            <PaletteMini palette={p} />
            <span className="palette-name"><strong>{p.name}</strong>{value === p.id && <Check size={16} aria-hidden="true" />}</span>
          </button>)}
        </div>}
    </div>)}
    <div className="palette-group custom-themes">
      <h4 className="palette-group-heading"><button type="button" className="palette-group-toggle" aria-expanded={expanded.custom}
        onClick={() => setExpanded(current => ({ ...current, custom: !current.custom }))}>
        <span>Custom themes ({customThemes.length})</span><span aria-hidden="true">{expanded.custom ? '−' : '+'}</span>
      </button></h4>
      {expanded.custom && <>
        <p className="palette-intro">Roll something new. Keep a palette you love, with a name of your own.</p>
        <div className="theme-roll-controls">
          <label>Style<select aria-label="Generated theme style" value={mode} disabled={pending} onChange={event => setMode(event.target.value)}>
            <option value="any">Surprise me</option><option value="light">Light</option><option value="dark">Dark</option>
          </select></label>
          <button type="button" className="button" disabled={pending || customThemes.length >= 64} onClick={() => roll()}><Dices size={17} />{draft ? 'Regenerate' : 'Generate theme'}</button>
        </div>
        {draft && <div className="custom-theme-draft">
          <div className="custom-theme-preview" style={paletteStyle(customThemePalette(draft)) as CSSProperties} aria-label="Custom theme preview">
            <PaletteMini palette={customThemePalette(draft)} />
            <div className="custom-theme-sample"><strong>A fresh perspective</strong><p>Space for your next idea.</p>
              <span className="custom-theme-sample-card">Clear details. Comfortable contrast.</span><span className="custom-theme-sample-action">Let's make something</span></div>
          </div>
          <div className="custom-theme-save">
            <small role="status">{draft.mode === 'light' ? 'Light' : 'Dark'} palette · Readability checked · Unsaved</small>
            <label>Theme name (optional)<input aria-label="Theme name (optional)" maxLength={48} value={name} placeholder={draft.name} disabled={pending} onChange={event => setName(event.target.value)} /></label>
            <div className="theme-roll-controls"><button type="button" className="button primary" disabled={pending} onClick={() => void saveCustom()}>Save &amp; use</button>
              <button type="button" className="button" disabled={pending} onClick={() => { setDraft(null); setName(''); setError(''); }}>Discard</button></div>
          </div>
        </div>}
        {customThemes.length >= 64 && <p className="palette-intro">Your collection is full. Remove a theme to make room for another.</p>}
        <div className="palette-options" role="group" aria-label="Custom themes">
          {customThemes.map(p => <div className="custom-theme-option" key={p.id}>
            <button type="button" className="palette-option" disabled={pending} aria-label={`Use ${p.name} palette`} aria-pressed={value === p.id} onClick={() => void save(p.id)}>
              <PaletteMini palette={customThemePalette(p)} /><span className="palette-name"><strong>{p.name}</strong>{value === p.id && <Check size={16} aria-hidden="true" />}</span>
            </button>
            <button type="button" className="custom-theme-remove" disabled={pending} aria-label={`Remove ${p.name} theme`} title={`Remove ${p.name}`} onClick={() => void saveCustom(p.id)}><Trash2 size={14} /></button>
          </div>)}
        </div>
      </>}
    </div>
    {pending && <small role="status">Saving theme…</small>}
    {error && <p className="notice error" role="alert">{error}</p>}
    <div className="card-help"><HelpHint topic="theme" /></div>
  </section>;
}
