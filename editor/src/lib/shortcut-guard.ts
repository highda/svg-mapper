// One guard for every global editor shortcut handler (#162): shortcuts must
// never steal keys from text entry, form controls or an open dialog.

const EDITABLE_ROLES = new Set(["textbox", "searchbox", "combobox", "listbox", "spinbutton", "slider", "menu", "menuitem", "option"]);

/** The element that really received the key, through open Shadow DOM. */
function keyTarget(event: KeyboardEvent): Element | null {
  const first = event.composedPath?.()[0];
  if (first instanceof Element) return first;
  return event.target instanceof Element ? event.target : null;
}

/** True when the key belongs to a text field, select, editable content or ARIA widget. */
export function isEditableTarget(event: KeyboardEvent): boolean {
  const el = keyTarget(event);
  if (!el) return false;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if ((el instanceof HTMLElement && el.isContentEditable) || el.closest('[contenteditable]:not([contenteditable="false"])')) return true;
  const role = el.getAttribute("role");
  return role !== null && EDITABLE_ROLES.has(role);
}

/** True when Space/Enter would activate the focused control (buttons, links, checkboxes). */
export function isActivatableTarget(event: KeyboardEvent): boolean {
  const el = keyTarget(event);
  if (!el) return false;
  return el.closest("button, a[href], summary, [role='button'], [role='tab'], [role='checkbox'], [role='switch']") !== null;
}

/** True while a modal dialog (help, recovery, samples, unsaved-changes) owns the keyboard. */
export function isModalOpen(): boolean {
  return document.querySelector('[aria-modal="true"]') !== null;
}

/** Common early exit for global editing shortcuts. */
export function shouldIgnoreShortcut(event: KeyboardEvent): boolean {
  return event.isComposing || event.defaultPrevented || isEditableTarget(event) || isModalOpen();
}
