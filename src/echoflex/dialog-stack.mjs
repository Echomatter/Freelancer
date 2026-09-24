// One native top-layer dialog at a time. Covered dialogs keep their React state.
const entries = [];
let current, overflow;
const focus = element => { if (element?.isConnected) element.focus({ preventScroll: true }); };
function activate(fallback) {
  // React can detach several portals in one commit before their effects clean up.
  const next = entries.filter(entry => entry.element.isConnected)
    .reduce((best, entry) => !best || entry.priority >= best.priority ? entry : best, null);
  if (next === current) return;
  if (current) {
    if (current.element.contains(document.activeElement)) current.focus = document.activeElement;
    if (current.element.open) current.element.close();
  }
  current = next;
  if (next) {
    next.element.showModal();
    const target = next.focus?.isConnected ? next.focus : next.initialFocus === 'first'
      ? next.element.querySelector('[autofocus]') ?? next.element.querySelector('.ef-dialog-body input:not(:disabled), .ef-dialog-body select:not(:disabled), .ef-dialog-body textarea:not(:disabled), .ef-dialog-body button:not(:disabled)') ?? next.element.querySelector('button:not(:disabled)')
      : next.element.querySelector('[data-dialog-heading]');
    focus(target ?? next.element);
  } else focus(fallback);
}

export function registerDialog(element, { priority = 0, initialFocus = 'heading' } = {}) {
  const entry = { element, priority, initialFocus, previous: document.activeElement, focus: null };
  if (!entries.length) { overflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; }
  entries.push(entry);
  activate();
  return () => {
    const index = entries.indexOf(entry);
    if (index >= 0) entries.splice(index, 1);
    activate(entry.previous);
    if (element.open) element.close();
    if (!entries.length) { document.body.style.overflow = overflow; overflow = undefined; }
  };
}

export function containDialogFocus(event) {
  if (event.key === 'Escape') { event.stopPropagation(); return; }
  if (event.key !== 'Tab') return;
  const element = event.currentTarget;
  const controls = [...element.querySelectorAll('button, input, select, textarea, a[href], [tabindex]')]
    .filter(node => node.tabIndex >= 0 && !node.matches(':disabled') && node.getClientRects().length);
  const first = controls[0], last = controls.at(-1);
  if (!first || !controls.includes(document.activeElement) ||
    (event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
    event.preventDefault();
    focus((event.shiftKey ? last : first) ?? element.querySelector('[data-dialog-heading]'));
  }
}
