<script setup lang="ts">
defineProps<{ name: 'upload' | 'palette' | 'convert' | 'slice' | 'fit' | 'download' | 'cancel' | 'cube' | 'collapse' | 'clock' | 'horizontal' | 'vertical' | 'person' | 'undo' | 'redo' | 'brush' }>();
const paths = {
  brush: 'm14 4 6 6M4 20l2-6L17 3l4 4L10 18l-6 2Z',
  upload: 'M12 17V5m-4 4 4-4 4 4M5 16v4h14v-4',
  undo: 'M9 5 3 11l6 6M3 11h10a7 7 0 0 1 7 7',
  redo: 'm15 5 6 6-6 6m6-6H11a7 7 0 0 0-7 7',
  convert: 'M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 3M18 18a8 8 0 0 1-13-3',
  slice: 'm3 12 9-5 9 5-9 5-9-5Zm0 5 9 5 9-5M12 2v5',
  fit: 'M4 9V4h5m6 0h5v5m0 6v5h-5M9 20H4v-5',
  download: 'M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4',
  cancel: 'm6 6 12 12M6 18 18 6',
  collapse: 'm6 14 6-6 6 6',
  clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 7v5l3 2',
  horizontal: 'M3 12h18M7 8l-4 4 4 4m10-8 4 4-4 4',
  vertical: 'M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4',
  person: 'M15 5a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM8 21v-5H5l2-7h10l2 7h-3v5',
  cube: 'm12 2 9 5v10l-9 5-9-5V7l9-5Zm0 10 9-5M12 12 3 7m9 5v10',
  palette: 'M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1-3.7c-1.5-1-.7-3.3 1.1-3.3H18a3 3 0 0 0 3-3c0-4.4-4-8-9-8Z',
};
</script>

<template>
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <template v-if="name === 'palette'"><circle cx="8" cy="8" r="1" /><circle cx="15" cy="7" r="1" /><circle cx="6" cy="13" r="1" /></template>
    <path :d="paths[name]" />
  </svg>
</template>
