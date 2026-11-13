/** Petites aides pour construire l'interface sans bibliothèque. */
type Child = Node | string | null | undefined | false;

export interface Attrs {
  class?: string;
  text?: string;
  html?: never;
  id?: string;
  title?: string;
  type?: string;
  value?: string;
  placeholder?: string;
  disabled?: boolean;
  checked?: boolean;
  min?: string;
  max?: string;
  step?: string;
  maxlength?: number;
  style?: string;
  onclick?: (e: MouseEvent) => void;
  oninput?: (e: Event) => void;
  onchange?: (e: Event) => void;
  onsubmit?: (e: Event) => void;
  onkeydown?: (e: KeyboardEvent) => void;
  [data: `data-${string}`]: string;
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'text') el.textContent = String(v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'disabled' || k === 'checked') (el as unknown as Record<string, boolean>)[k] = Boolean(v);
    else if (k === 'value') (el as unknown as { value: string }).value = String(v);
    else el.setAttribute(k === 'maxlength' ? 'maxlength' : k, String(v));
  }
  for (const c of children) if (c) el.append(c);
  return el;
}

export function clear(el: HTMLElement): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function button(label: string, onclick: () => void, opts: { class?: string; disabled?: boolean; title?: string; id?: string } = {}): HTMLButtonElement {
  return h('button', { class: `btn ${opts.class ?? ''}`.trim(), type: 'button', text: label, onclick, disabled: opts.disabled, title: opts.title, id: opts.id });
}

/** Champ avec libellé. */
export function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  return h('label', { class: 'field' }, h('span', { class: 'field-label', text: label }), control, hint ? h('span', { class: 'field-hint', text: hint }) : null);
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(s / 3600);
  const min = Math.floor((s % 3600) / 60);
  if (hrs > 0) return `${hrs} h ${min.toString().padStart(2, '0')}`;
  return `${min} min ${(s % 60).toString().padStart(2, '0')} s`;
}
