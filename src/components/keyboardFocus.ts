/** Who owns the keyboard right now: global shortcuts and camera keys step aside for focused controls. */

/** A text field has focus, so every key is text. */
export function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}

/** Widgets that use letters or arrow keys themselves (dialogs, the file tree, lists, tabs). */
const KEY_OWNERS = '[role="dialog"], [role="tree"], [role="listbox"], [role="menu"], [role="slider"], [role="radiogroup"], [role="tablist"], [role="grid"]';

/** True when a focused text field or widget should get the keys instead of the camera. */
export function keysOwnedElsewhere(): boolean {
  if (isTyping()) return true;
  const el = document.activeElement as HTMLElement | null;
  return !!el && el !== document.body && !!el.closest(KEY_OWNERS);
}

/** Focus is inside a modal dialog (search, help, the library), which owns its own keys. */
export function inDialog(): boolean {
  const el = document.activeElement as HTMLElement | null;
  return !!el && !!el.closest('[role="dialog"]');
}
