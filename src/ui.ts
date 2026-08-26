/**
 * Holds the shared DOM references singleton (initialized once by main.ts).
 * Importing modules read `els` here instead of importing main.ts,
 * avoiding circular dependency.
 */
import { DomElements, initEls } from './dom.js';

let els: DomElements;

/** Initialize the DOM singleton (called once at startup). */
export function initUI(): void {
  els = initEls();
}

/** Get the shared DOM references (must call initUI first). */
export function getEls(): DomElements {
  return els;
}
