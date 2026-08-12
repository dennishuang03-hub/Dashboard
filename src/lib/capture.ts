/**
 * "A picture is being taken."
 *
 * One boolean, and the reason it needs to be a shared, subscribable one rather
 * than a class on `<body>` is the charts.
 *
 * A PNG export pins the page to a fixed 1480px so the image never depends on how
 * wide the window happened to be. Everything laid out in CSS follows that
 * immediately. The charts do not: each measures its own container with a
 * `ResizeObserver` and re-renders in a different *shape* below 560px, so
 * following the pinned width means observer fires → React sets state → React
 * commits → the SVG re-renders. That chain is asynchronous, and the capture was
 * racing it — on a phone the shot went out with a portrait chart stretched
 * across a desktop-width page, bars running past the panel.
 *
 * Waiting longer only makes the race less likely, never won. So the charts stop
 * inferring it: they are *told* the page is being photographed, they re-render
 * synchronously when told, and they treat that as "not narrow" whatever their
 * box currently measures. The measurement is about to be wrong for one frame;
 * the instruction never is.
 *
 * `useSyncExternalStore` rather than a context: this is read by leaf components
 * in two different trees and written by a plain async function in `lib/`, and
 * threading a provider through both to carry one boolean would be more moving
 * parts than the boolean.
 */
let capturing = false
const subs = new Set<() => void>()

export function setCapturing(next: boolean): void {
  if (capturing === next) return
  capturing = next
  /* Copied before iterating: a subscriber that unsubscribes while being
     notified would otherwise mutate the set mid-loop. */
  for (const fn of [...subs]) fn()
}

export function subscribeCapture(fn: () => void): () => void {
  subs.add(fn)
  return () => { subs.delete(fn) }
}

export const isCapturing = (): boolean => capturing

/** Server snapshot for `useSyncExternalStore` — nothing is ever being
 *  photographed during a render that has no browser. */
export const notCapturing = (): boolean => false
