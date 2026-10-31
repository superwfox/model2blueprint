<script setup lang="ts">
import LatticeCorners from './LatticeCorners.vue';
import ToolIcon from './ToolIcon.vue';

withDefaults(defineProps<{ expanded?: boolean }>(), { expanded: undefined });
</script>

<template>
  <button class="lattice-button" :class="{ 'menu-open': expanded }" :aria-expanded="expanded">
    <ToolIcon v-if="expanded" name="collapse" /><slot v-else name="icon" /><slot /><LatticeCorners />
  </button>
</template>
