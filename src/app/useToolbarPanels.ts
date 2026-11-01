import { onBeforeUnmount, ref } from 'vue';

/** Keep content measurable until its grid/height collapse transition finishes. */
export function useToolbarPanels<T extends string>(initial: T) {
  const panel = ref<T>(initial), expanded = ref(false), shown = ref<T>();
  const expansion = ref<HTMLElement>();
  let opener: HTMLElement | undefined;
  let closing: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => { clearTimeout(closing); closing = undefined; };
  function release(): void { cancel(); if (!expanded.value) shown.value = undefined; }
  function close(): void {
    if (expansion.value?.contains(document.activeElement)) {
      if (opener?.isConnected) opener.focus();
      else if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    }
    expanded.value = false; cancel();
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) release();
    else closing = setTimeout(release, 400);
  }
  function toggle(value: T, event: Event): void {
    if (expanded.value && panel.value === value) { close(); return; }
    opener = event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined;
    cancel(); panel.value = value; shown.value = value; expanded.value = true;
  }
  function settled(event: TransitionEvent): void {
    if (event.target === event.currentTarget && (event.propertyName === 'grid-template-rows' || event.propertyName === 'height')) release();
  }
  onBeforeUnmount(cancel);
  return { panel, expanded, shown, expansion, toggle, close, settled };
}
