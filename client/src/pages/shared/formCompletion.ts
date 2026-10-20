export type FormCompletionItem = {
  label: string;
  target: string;
  group?: string;
};

/** Equal section weights keep progress stable when a section gains more fields. */
export function formCompletionProgress(
  items: FormCompletionItem[],
  groups: readonly string[],
): number {
  if (!groups.length) return items.length ? 0 : 100;
  const incomplete = new Set(
    items
      .map((item) => item.group)
      .filter((group) => groups.includes(group ?? "")),
  );
  return Math.round(((groups.length - incomplete.size) * 100) / groups.length);
}

export function focusFormField(targetId: string) {
  const target = document.getElementById(targetId);
  if (!target) return;
  const editor = target.closest<HTMLElement>("[hidden][id]");
  const editButton = editor?.id
    ? document.querySelector<HTMLButtonElement>(
        `button[aria-controls="${CSS.escape(editor.id)}"]`,
      )
    : null;
  if (editButton) {
    editButton.click();
    window.requestAnimationFrame(() => focusFormField(targetId));
    return;
  }
  for (
    let parent = target.parentElement;
    parent;
    parent = parent.parentElement
  ) {
    if (parent instanceof HTMLDetailsElement) parent.open = true;
  }
  target.scrollIntoView({
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "instant"
      : "smooth",
    block: "center",
  });
  target.focus({ preventScroll: true });
  target.classList.remove("form-field-highlight");
  window.requestAnimationFrame(() =>
    target.classList.add("form-field-highlight"),
  );
}
