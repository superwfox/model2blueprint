import { onBeforeUnmount, onDeactivated, ref, watch } from 'vue';

/** Keep newer local input when an earlier worker reply arrives. Only valid drafts are submitted. */
export function useAutoDraft<T extends { id: string }>(source: () => T | undefined, validate: (value: T) => void, submit: (value: T) => void) {
  const draft = ref<T>() as import('vue').Ref<T | undefined>, error = ref('');
  const sent = new Set<string>(); let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => { clearTimeout(timer); timer = undefined; };
  function flush(): void {
    cancel(); const value = draft.value; if (!value) return;
    try {
      const plain = JSON.parse(JSON.stringify(value)) as T; validate(plain); error.value = '';
      const signature = JSON.stringify(plain);
      if (signature === JSON.stringify(source()) || sent.has(signature)) return;
      sent.add(signature); submit(plain);
    } catch (reason) { error.value = reason instanceof Error ? reason.message : '请输入有效参数。'; }
  }
  watch(() => JSON.stringify(source()), () => {
    const value = source(), signature = JSON.stringify(value);
    if (value?.id === draft.value?.id && signature && sent.delete(signature)) return;
    cancel(); sent.clear(); draft.value = value ? JSON.parse(JSON.stringify(value)) as T : undefined; error.value = '';
  }, { immediate: true, flush: 'sync' });
  watch(draft, () => { cancel(); timer = setTimeout(flush, 180); }, { deep: true });
  onDeactivated(cancel); onBeforeUnmount(cancel);
  return { draft, error, flush };
}
