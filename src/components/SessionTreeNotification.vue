<script lang="ts" setup>
import { NotificationState } from '@/services/notification-state'
</script>

<template>
  <div
    v-if="NotificationState.message"
    class="sessiontree-notification"
    role="alert"
  >
    {{ NotificationState.message }}
  </div>
</template>

<style scoped>
.sessiontree-notification {
  background: rgb(42, 34, 24);
  border: 1px solid rgb(170, 124, 62);
  border-radius: 6px;
  box-sizing: border-box;
  bottom: 44px;
  color: rgb(245, 225, 190);
  font-size: 12px;
  left: 8px;
  line-height: 1.45;
  max-height: calc(100% - 60px);
  overflow-wrap: anywhere;
  overflow-y: auto;
  padding: 10px 12px;
  pointer-events: auto;
  position: absolute;
  right: 8px;
  white-space: pre-line;
  z-index: 100;
}
</style>
