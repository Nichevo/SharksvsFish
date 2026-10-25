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
  /** Births and deaths during the last iteration. */
  lastEvents(): TickEvents;
  /** Every living creature's species, age and sex. */
  individuals(): Individual[];
  /** Whether creatures have a sex (enhanced mode with sexes switched on). */
  hasSexes(): boolean;
  /** Oldest age each species can reach, for scaling the age charts. */
  ageLimits(): { fish: number; sharks: number };
}

export const NO_SEX = 0;
export const MALE = 1;
export const FEMALE = 2;
export type Sex = typeof NO_SEX | typeof MALE | typeof FEMALE;

/** What happened during the last iteration. */
export interface TickEvents {
  fishBorn: number;
  sharksBorn: number;
  fishEaten: number;
  fishOldAge: number;
  fishStarved: number;
  sharksOldAge: number;
  sharksStarved: number;
}

export type DeathCause = "eaten" | "oldAge" | "starved";

export function emptyEvents(): TickEvents {
  return { fishBorn: 0, sharksBorn: 0, fishEaten: 0, fishOldAge: 0, fishStarved: 0, sharksOldAge: 0, sharksStarved: 0 };
}

export function recordDeath(e: TickEvents, family: Family, cause: DeathCause): void {
  if (family === FISH) {
    if (cause === "eaten") e.fishEaten++;
    else if (cause === "oldAge") e.fishOldAge++;
    else e.fishStarved++;
  } else if (cause === "oldAge") e.sharksOldAge++;
  else e.sharksStarved++;
}

export function recordBirth(e: TickEvents, family: Family): void {
  if (family === FISH) e.fishBorn++;
  else e.sharksBorn++;
}

/** One living creature, for the age and sex charts. */
export interface Individual {
  family: Family;
  age: number;
  sex: Sex;
}
