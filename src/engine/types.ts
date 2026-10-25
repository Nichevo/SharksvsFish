export const EMPTY = 0;
export const FISH = 1;
export const SHARK = 2;
/** Empty cell with algae on it (enhanced mode only). */
export const ALGAE = 3;

export type Family = typeof FISH | typeof SHARK;

export interface Counts {
  fish: number;
  sharks: number;
}

/** What the UI needs from any simulation engine. */
export interface Simulation {
  readonly width: number;
  readonly height: number;
  /** Iterations completed so far. */
  readonly tick: number;
  /** Advance one iteration. */
  step(): void;
  counts(): Counts;
  /** Write one value per cell (EMPTY / FISH / SHARK / ALGAE) into `out`. */
  paint(out: Uint8Array): void;
  /** True when the run has ended (a species died out or a tick limit was reached). */
  finished(): boolean;
  /** True when the UI should pause, e.g. at the end of a classic 200-iteration run. */
  atPausePoint(): boolean;
}
