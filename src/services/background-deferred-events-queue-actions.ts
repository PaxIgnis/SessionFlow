import { DeferredEventsQueue } from '@/services/background-deferred-events-queue'

/**
 * Initialized deferred events queue for windows and tabs.
 * This queue is used to store events that should be executed later,
 * typically after the window or tab is added to the session tree.
 */
export function initializeDeferredEventsQueue(): void {
  DeferredEventsQueue.windows = new Map()
  DeferredEventsQueue.tabs = new Map()
}

/**
 * Adds a deferred event for a specific window.
 *
 * @param windowId The ID of the window to which the event should be added
 * @param event The function to be executed later
 */
export function addDeferredWindowEvent(
  windowId: number,
  event: () => void
): void {
  // Ensure the window ID exists in the queue
  if (!DeferredEventsQueue.windows.has(windowId)) {
    DeferredEventsQueue.windows.set(windowId, [])
  }

  DeferredEventsQueue.windows.get(windowId)?.push(event)
}

/**
 * Adds a deferred event for a specific tab.
 *
 * @param tabId The ID of the tab to which the event should be added
 * @param event The function to be executed later
 */
export function addDeferredTabEvent(tabId: number, event: () => void): void {
  // Ensure the tab ID exists in the queue
  if (!DeferredEventsQueue.tabs.has(tabId)) {
    DeferredEventsQueue.tabs.set(tabId, [])
  }
  DeferredEventsQueue.tabs.get(tabId)?.push(event)
}

/**
 * Processes all deferred events for a specific window.
 *
 * @param windowId The ID of the window for which to process deferred events
 */
export function processDeferredWindowEvents(windowId: number): void {
  const events = DeferredEventsQueue.windows.get(windowId)
  if (events) {
    DeferredEventsQueue.windows.delete(windowId)
    events.forEach((event) => event())
  }
}

/**
 * Processes all deferred events for a specific tab.
 *
 * @param tabId The ID of the tab for which to process deferred events
 */
export function processDeferredTabEvents(tabId: number): void {
  const events = DeferredEventsQueue.tabs.get(tabId)
  if (events) {
    DeferredEventsQueue.tabs.delete(tabId)
    events.forEach((event) => event())
  }
}
