<script setup lang="ts">
defineEmits<{
  addNote: []
  addSeparator: []
  newWindow: []
  newTab: []
  openSettings: []
}>()
</script>

<template>
  <nav
    class="session-tree-toolbar"
    aria-label="Tree actions"
    @click.stop
  >
    <button
      class="toolbar-button"
      type="button"
      aria-label="Add note"
      title="Add note"
      @click="$emit('addNote')"
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path d="M5 3.5h9l4 4V20.5H5z" />
        <path d="M14 3.5v4h4M8 14h6M11 11v6" />
      </svg>
    </button>

    <button
      class="toolbar-button"
      type="button"
      aria-label="Add separator"
      title="Add separator"
      @click="$emit('addSeparator')"
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path d="M3 15h18M12 4v7M8.5 7.5h7" />
      </svg>
    </button>

    <button
      class="toolbar-button"
      type="button"
      aria-label="New window"
      title="New window"
      @click="$emit('newWindow')"
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <rect
          x="3.5"
          y="4.5"
          width="17"
          height="15"
          rx="1"
        />
        <path d="M3.5 8.5h17M12 11.5v5M9.5 14h5" />
      </svg>
    </button>

    <button
      class="toolbar-button"
      type="button"
      aria-label="New tab"
      title="New tab"
      @click="$emit('newTab')"
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path d="M3.5 7.5h6l1.5 2h9.5v10h-17zM13 13v4M11 15h4" />
      </svg>
    </button>

    <button
      class="toolbar-button"
      type="button"
      aria-label="Settings"
      title="Settings"
      @click="$emit('openSettings')"
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <circle
          cx="12"
          cy="12"
          r="3"
        />
        <path
          d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.4 1a8 8 0 0 0-2-1.2L14.2 3h-4.1l-.3 2.7a8 8 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.4-1a8 8 0 0 0 2 1.2l.3 2.7h4.1l.3-2.7a8 8 0 0 0 2-1.2l2.4 1 2-3.4-2-1.5A7 7 0 0 0 19 12z"
        />
      </svg>
    </button>
  </nav>
</template>

<style scoped>
.session-tree-toolbar {
  z-index: 30;
  display: flex;
  flex: 0 0 42px;
  align-items: stretch;
  width: 100%;
  border-top: 1px solid var(--options-list-divider-color);
  background-color: var(--background-color-primary);
}

.toolbar-button {
  display: flex;
  flex: 1 1 0;
  align-items: center;
  justify-content: center;
  min-width: 36px;
  margin: 0;
  padding: 8px;
  border: 0;
  color: var(--list-icon-foreground);
  background: transparent;
  cursor: pointer;
}

.toolbar-button:hover {
  color: var(--list-item-active-foreground);
  background-color: var(--list-item-hover-background);
}

.toolbar-button:active {
  background-color: var(--list-item-selected-background);
}

.toolbar-button:focus-visible {
  outline: 2px solid var(--list-item-open-foreground);
  outline-offset: -3px;
}

.toolbar-button svg {
  width: 22px;
  height: 22px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
}
</style>
