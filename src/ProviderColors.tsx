import { Children, cloneElement, isValidElement, createContext, useContext, forwardRef, type ReactElement, type ReactNode, type CSSProperties, type HTMLAttributes, type SelectHTMLAttributes } from 'react';
import { providerID, providerTokens } from '../domain/provider-colors.mjs';

export type ColorAppearance = { theme?: string; providerColors?: Record<string, string> };
export type ColorPatch = { theme?: string; providerColors?: Record<string, string | null> };
export const AppearanceContext = createContext<ColorAppearance>({});
export const useColorAppearance = () => useContext(AppearanceContext);
export function providerAttributes(provider: unknown, appearance: ColorAppearance) {
  const id = providerID(provider);
  return id ? { 'data-provider': id, style: providerTokens(id, appearance) as CSSProperties } : {};
}
// Only identity-bearing text and surfaces consume provider tokens. Status badges,
// action buttons, errors and ordinary conversation text keep semantic colors.
export function ProviderText({ provider, children, mark = false }: { provider?: unknown; children: React.ReactNode; mark?: boolean }) {
  const appearance = useColorAppearance();
  return <span className="provider-identity" {...providerAttributes(provider, appearance)}>
    {mark && providerID(provider) && <span className="provider-dot" aria-hidden="true" />}{children}
  </span>;
}
export function ProviderScope({ provider, ...props }: HTMLAttributes<HTMLDivElement> & { provider?: unknown }) {
  const appearance = useColorAppearance();
  const attributes = providerAttributes(provider, appearance);
  return <div {...props} {...attributes} style={{ ...attributes.style, ...props.style }} />;
}
// Keep native select/keyboard behavior. Its closed selection uses provider ink;
// options remain neutral because OS-native popup styling is not portable.
export const ProviderSelect = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { provider?: unknown }>(
  function ProviderSelect({ provider, className = '', style, children, ...props }, ref) {
    const appearance = useColorAppearance();
    const attributes = providerAttributes(provider, appearance);
    const colorOptions = (nodes: ReactNode): ReactNode => Children.map(nodes, node => {
      if (!isValidElement(node)) return node;
      const element = node as ReactElement<any>;
      if (element.type === 'optgroup') return cloneElement(element, {}, colorOptions(element.props.children));
      if (element.type !== 'option') return node;
      const tokens = providerAttributes(element.props.value, appearance);
      return cloneElement(element, { ...tokens, style: { ...tokens.style, color: tokens.style ? 'var(--provider-fg)' : 'var(--text)', background: 'var(--paper)' } });
    });
    return <select ref={ref} {...props} {...attributes} className={`provider-select ${className}`} style={{ ...attributes.style, ...(attributes.style ? { color: 'var(--provider-fg)' } : {}), ...style }}>{colorOptions(children)}</select>;
  },
);
