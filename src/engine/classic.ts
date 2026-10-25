/**
 * Classic mode: a port of Module1 from the original "SnF - v4.xls" (Excel/VBA).
 *
 * Two rule sets:
 *  - "exact":    reproduces the VBA as written, including its bugs (see README).
 *  - "intended": the same model with those bugs fixed.
 *
 * Variable names follow the VBA loosely so the two can be compared side by side
 * (Flow, Direction, Breed, KillDead, SwapPL).
 */
import { Rng } from "./rng";
import { EMPTY, FISH, SHARK, type Counts, type Family, type Simulation } from "./types";

export type ClassicRules = "exact" | "intended";

export interface ClassicSettings {
  rules: ClassicRules;
  /** Pond is size x size (21 in the original). */
  size: number;
  fishStart: number;
  sharkStart: number;
  fishBreedAge: number;
  sharkBreedAge: number;
  fishAgeLimit: number;
  sharkAgeLimit: number;
  /** Shark energy when full; sharks lose 1 per iteration (the "Starvation Rate"). */
  starvation: number;
  /** Iterations per press of the Run button in Excel (pauses after each block). */
  iterationsPerRun: number;
  seed: number;
}

export const CLASSIC_DEFAULTS: Omit<ClassicSettings, "seed"> = {
  rules: "exact",
  size: 21,
  fishStart: 220,
  sharkStart: 22,
  fishBreedAge: 1,
  sharkBreedAge: 5,
  fishAgeLimit: 35,
  sharkAgeLimit: 100,
  starvation: 10,
  iterationsPerRun: 200,
};

interface Creature {
  family: Family | typeof EMPTY;
  alive: boolean;
  age: number;
  breedAge: number;
  maxAge: number;
  energy: number;
  energyRefresh: number;
  cell: number;
}

/** Index 0 stands for "nobody", like PAT(0) in the VBA: family 0, age 0, breed age 0. */
function nobody(): Creature {
  return { family: EMPTY, alive: false, age: 0, breedAge: 0, maxAge: 0, energy: 0, energyRefresh: 0, cell: -1 };
}

/** VBA's Round() uses banker's rounding. */
export function vbaRound(v: number): number {
  const f = Math.floor(v);
  const diff = v - f;
  if (diff > 0.5) return f + 1;
  if (diff < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

const NO_GOAL = 0;
const FEED = 1;
const BREED = 2;

export class ClassicSimulation implements Simulation {
  readonly width: number;
  readonly height: number;
  tick = 0;
  readonly settings: ClassicSettings;

  private rng: Rng;
  private creatures: Creature[] = [nobody()];
  /** Cell -> creature index (0 = empty). In "exact" rules this goes stale, as in the VBA. */
  private occ: Int32Array;
  private ended = false;

  constructor(settings: ClassicSettings) {
    this.settings = { ...settings };
    this.width = this.height = settings.size;
    this.rng = new Rng(settings.seed);
    this.occ = new Int32Array(settings.size * settings.size);
    this.populate();
  }

  private get exact(): boolean {
    return this.settings.rules === "exact";
  }

  /** Sub Start: drop fish and sharks on random empty cells, picking the species at random each time. */
  private populate(): void {
    const cells = this.occ.length;
    let fn = Math.max(0, Math.floor(this.settings.fishStart));
    let sn = Math.max(0, Math.floor(this.settings.sharkStart));
    // The VBA loops forever if the pond is overfull; trim instead.
    if (fn + sn > cells) {
      sn = Math.min(sn, cells);
      fn = cells - sn;
    }
    while (fn + sn > 0) {
      const rn = this.rng.int(2) === 0 ? FISH : SHARK;
      let cell: number;
      do cell = this.rng.int(cells);
      while (this.occ[cell] !== 0);
      if (rn === FISH && fn > 0) {
        fn--;
        this.breed(FISH, cell);
      } else if (rn === SHARK && sn > 0) {
        sn--;
        this.breed(SHARK, cell);
      }
    }
  }

  /** Sub Breed: append a new creature at `cell`. */
  private breed(family: Family, cell: number): void {
    const s = this.settings;
    const isFish = family === FISH;
    this.creatures.push({
      family,
      alive: true,
      age: 1,
      breedAge: isFish ? s.fishBreedAge : s.sharkBreedAge,
      maxAge: isFish ? s.fishAgeLimit : s.sharkAgeLimit,
      energy: isFish ? 1 : s.starvation,
      energyRefresh: isFish ? 0 : s.starvation,
      cell,
    });
    this.occ[cell] = this.creatures.length - 1;
  }

  /**
   * Excel's AllMove ran a block of iterations, then saved live creatures to the
   * "Data" sheet; the next press read them back in (ReadIn). That rebuilt the
   * location map from scratch, which also cleared any stale entries.
   */
  private readIn(): void {
    const live = this.creatures.filter((c, i) => i > 0 && c.alive);
    this.creatures = [nobody(), ...live];
    this.occ.fill(0);
    this.creatures.forEach((c, i) => {
      if (i > 0) this.occ[c.cell] = i;
    });
  }

  step(): void {
    if (this.ended) return;
    if (this.tick > 0 && this.tick % this.settings.iterationsPerRun === 0) this.readIn();
    // "For Pi = 1 To Pi_Max": the bound is fixed at the start, so babies act next iteration.
    const end = this.creatures.length;
    for (let i = 1; i < end; i++) {
      if (this.creatures[i].alive) this.flow(i);
    }
    this.tick++;
    const { fish, sharks } = this.counts();
    if (fish === 0 || sharks === 0) this.ended = true;
  }

  /** Sub Flow: one creature's turn. */
  private flow(i: number): void {
    const c = this.creatures[i];
    const cr = this.creatures;
    let target = -1;
    let success = false;

    if (c.family === SHARK) {
      if (c.energy < vbaRound(c.energyRefresh * 0.6)) {
        // Hungry: look round the 3x3 block for a fish.
        for (let t = 1; t <= 9; t++) {
          target = this.direction(c, FEED, t);
          if (cr[this.occ[target]].family === FISH) {
            success = true;
            break;
          }
        }
      } else {
        // Fed: look for another shark. In the VBA this also matches the shark's own cell.
        for (let t = 1; t <= 9; t++) {
          target = this.direction(c, BREED, t);
          const o = this.occ[target];
          if (cr[o].family === c.family && (this.exact || o !== i)) {
            success = true;
            break;
          }
        }
      }
    }
    if (!success) target = this.direction(c, NO_GOAL, 0);

    let o = this.occ[target];
    if (o === 0) {
      this.move(i, target);
    } else {
      // Sharks eat (the shark stays where it is).
      if (cr[o].family !== c.family && c.family === SHARK) {
        cr[o].alive = false;
        this.occ[target] = 0;
        c.energy = c.energyRefresh;
        o = 0;
      }
      // Breeding. The VBA tests for a *different* family, so fish breed when they bump
      // into sharks, and a shark breeds after every meal (the emptied cell is "family 0").
      const mate = cr[o];
      const partnerOk = this.exact ? mate.family !== c.family : o !== 0 && o !== i && mate.family === c.family;
      if (partnerOk && mate.age >= mate.breedAge && c.age >= c.breedAge) {
        for (let tries = 0; tries < 5; tries++) {
          const cell = this.rng.int(this.occ.length);
          if (this.occ[cell] === 0) {
            this.breed(c.family as Family, cell);
            break;
          }
        }
      }
    }

    // Ageing
    if (c.age > c.maxAge) this.killDead(i);
    else c.age++;

    // Shark energy
    if (c.family === SHARK) {
      if (c.energy <= 1) this.killDead(i);
      else c.energy--;
    }
  }

  /**
   * Sub SwapPL + the clean-up after it. The VBA clears the *new* cell instead of the
   * old one, so in "exact" rules the creature leaves a ghost behind and its real cell
   * looks empty to everyone else.
   */
  private move(i: number, target: number): void {
    const c = this.creatures[i];
    if (this.exact) {
      this.occ[target] = 0;
    } else {
      if (this.occ[c.cell] === i) this.occ[c.cell] = 0;
      this.occ[target] = i;
    }
    c.cell = target;
  }

  private killDead(i: number): void {
    const c = this.creatures[i];
    c.alive = false;
    if (this.exact || this.occ[c.cell] === i) this.occ[c.cell] = 0;
  }

  /**
   * Sub Direction. Directions are laid out
   *   1 2 3
   *   4 5 6
   *   7 8 9
   * with 5 meaning "stay put". With a goal, try direction `tNo`; if it is off the pond
   * try the next one, and after 9 give up and go random. Without a goal, pick at random
   * until the cell is on the pond.
   */
  private direction(c: Creature, goal: number, tNo: number): number {
    const n = this.width;
    const y = Math.floor(c.cell / n);
    const x = c.cell % n;
    let rd = 0;
    let retry = false;
    for (;;) {
      if (goal !== NO_GOAL) {
        if (retry) {
          if (rd === 9) {
            goal = NO_GOAL;
            rd = this.rng.int(9) + 1;
          } else rd++;
        } else rd = tNo;
      } else rd = this.rng.int(9) + 1;

      retry =
        (y <= 0 && rd <= 3) ||
        (y >= n - 1 && rd >= 7) ||
        (x <= 0 && rd % 3 === 1) ||
        (x >= n - 1 && rd % 3 === 0);
      if (!retry) {
        const dy = Math.floor((rd - 1) / 3) - 1;
        const dx = ((rd - 1) % 3) - 1;
        return (y + dy) * n + (x + dx);
      }
    }
  }

  counts(): Counts {
    let fish = 0;
    let sharks = 0;
    for (let i = 1; i < this.creatures.length; i++) {
      const c = this.creatures[i];
      if (!c.alive) continue;
      if (c.family === FISH) fish++;
      else sharks++;
    }
    return { fish, sharks };
  }

  paint(out: Uint8Array): void {
    out.fill(EMPTY);
    // Later creatures paint over earlier ones; in "exact" rules two can share a cell.
    for (let i = 1; i < this.creatures.length; i++) {
      const c = this.creatures[i];
      if (c.alive) out[c.cell] = c.family;
    }
  }

  finished(): boolean {
    return this.ended;
  }

  atPausePoint(): boolean {
    return this.tick > 0 && this.tick % this.settings.iterationsPerRun === 0;
  }

  /** For tests: live creatures the location map doesn't point to (0 = map is accurate). */
  mapMismatches(): number {
    let n = 0;
    this.creatures.forEach((c, i) => {
      if (i > 0 && c.alive && this.occ[c.cell] !== i) n++;
    });
    return n;
  }
}
