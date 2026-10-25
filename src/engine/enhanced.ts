/**
 * Enhanced mode: a cleaner, configurable predator-prey model built from the same
 * ideas as the classic one, with many more knobs.
 */
import { Rng } from "./rng";
import {
  ALGAE,
  FISH_FEMALE,
  SHARK_FEMALE,
  EMPTY,
  FEMALE,
  FISH,
  MALE,
  NO_SEX,
  SHARK,
  emptyEvents,
  recordBirth,
  recordDeath,
  type Counts,
  type DeathCause,
  type Family,
  type Individual,
  type Sex,
  type Simulation,
  type TickEvents,
} from "./types";

export interface SpeciesSettings {
  start: number;
  breedAge: number;
  maxAge: number;
  /** Chance a breeding attempt succeeds (0-1). */
  breedChance: number;
  /** Babies per successful breeding. */
  litterSize: number;
  /** Iterations a parent must wait between litters. */
  breedCooldown: number;
  /** true: needs an adult partner next to it. false: breeds alone (Wa-Tor style). */
  needsMate: boolean;
  /** How many cells away it can see (0 = only neighbours count). */
  sight: number;
}

export interface SharkSettings extends SpeciesSettings {
  startEnergy: number;
  maxEnergy: number;
  energyPerMeal: number;
  /** Hunts when energy is below this fraction of max energy (1 = always hunts). */
  hungerThreshold: number;
  /** Move into the fish's cell when eating. */
  moveOnEat: boolean;
  /** Needs at least this fraction of max energy to breed (0 = any). */
  breedEnergy: number;
}

export interface FishSettings extends SpeciesSettings {
  /** Chance a fish that can see a shark swims away from it. */
  fleeChance: number;
}

export interface AlgaeSettings {
  /** Fish need to eat algae to survive. */
  enabled: boolean;
  /** Iterations for eaten algae to grow back. */
  regrowTime: number;
  /** Fraction of cells with algae at the start (0-1). */
  startCover: number;
  fishStartEnergy: number;
  fishMaxEnergy: number;
  energyPerAlgae: number;
}

export interface EnhancedSettings {
  width: number;
  height: number;
  /** Edges wrap round (a torus) instead of being walls. */
  wrap: boolean;
  /** 8 neighbours (Moore) or 4 (von Neumann). */
  neighbourhood: "moore" | "vonNeumann";
  /** Creatures may choose to stay put when moving randomly. */
  allowStay: boolean;
  /** Where babies go. */
  offspring: "adjacent" | "anywhere";
  /** Process creatures in a fresh random order each iteration instead of age order. */
  shuffleOrder: boolean;
  /** Stop after this many iterations (0 = no limit). */
  maxTicks: number;
  /**
   * Creatures are male or female. Partners must be of the opposite sex, and when a
   * species breeds alone only its females have young.
   */
  sexes: boolean;
  /** Share of babies born female (0-1). */
  femaleShare: number;
  fish: FishSettings;
  sharks: SharkSettings;
  algae: AlgaeSettings;
  seed: number;
}

export const ENHANCED_DEFAULTS: Omit<EnhancedSettings, "seed"> = {
  width: 60,
  height: 40,
  wrap: true,
  neighbourhood: "moore",
  allowStay: false,
  offspring: "adjacent",
  shuffleOrder: true,
  maxTicks: 0,
  sexes: false,
  femaleShare: 0.5,
  fish: {
    start: 600,
    breedAge: 3,
    maxAge: 40,
    breedChance: 0.5,
    litterSize: 1,
    breedCooldown: 2,
    needsMate: false,
    sight: 2,
    fleeChance: 0.5,
  },
  sharks: {
    start: 60,
    breedAge: 10,
    maxAge: 120,
    breedChance: 0.5,
    litterSize: 1,
    breedCooldown: 12,
    needsMate: false,
    sight: 1,
    startEnergy: 4,
    maxEnergy: 4,
    energyPerMeal: 2,
    hungerThreshold: 0.7,
    moveOnEat: true,
    breedEnergy: 0.5,
  },
  algae: {
    enabled: false,
    regrowTime: 12,
    startCover: 0.6,
    fishStartEnergy: 8,
    fishMaxEnergy: 15,
    energyPerAlgae: 4,
  },
};

interface Creature {
  family: Family;
  alive: boolean;
  age: number;
  sex: Sex;
  energy: number;
  cooldown: number;
  cell: number;
  /** Iteration this creature last acted, so a creature that moves isn't processed twice. */
  actedAt: number;
}

const MOORE = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1], [0, 1],
  [1, -1], [1, 0], [1, 1],
];
const VON_NEUMANN = [[-1, 0], [0, -1], [0, 1], [1, 0]];

export class EnhancedSimulation implements Simulation {
  readonly width: number;
  readonly height: number;
  tick = 0;
  readonly settings: EnhancedSettings;

  private rng: Rng;
  private creatures: Creature[] = [];
  /** Cell -> creature, or null. */
  private grid: (Creature | null)[];
  /** Cell -> iterations until algae is back (0 = algae present). */
  private algae: Int16Array;
  private offsets: number[][];
  private ended = false;
  private events: TickEvents = emptyEvents();

  constructor(settings: EnhancedSettings) {
    this.settings = structuredClone(settings);
    this.width = Math.max(3, Math.floor(settings.width));
    this.height = Math.max(3, Math.floor(settings.height));
    this.rng = new Rng(settings.seed);
    const cells = this.width * this.height;
    this.grid = new Array(cells).fill(null);
    this.algae = new Int16Array(cells);
    this.offsets = settings.neighbourhood === "moore" ? MOORE : VON_NEUMANN;

    const a = this.settings.algae;
    for (let i = 0; i < cells; i++) {
      this.algae[i] = this.rng.chance(a.startCover) ? 0 : 1 + this.rng.int(Math.max(1, a.regrowTime));
    }

    const free = this.rng.shuffle([...Array(cells).keys()]);
    const sharks = Math.min(Math.floor(settings.sharks.start), cells);
    const fish = Math.min(Math.floor(settings.fish.start), cells - sharks);
    for (let i = 0; i < fish; i++) this.spawn(FISH, free.pop()!, true);
    for (let i = 0; i < sharks; i++) this.spawn(SHARK, free.pop()!, true);
  }

  private spec(f: Family): SpeciesSettings {
    return f === FISH ? this.settings.fish : this.settings.sharks;
  }

  private spawn(family: Family, cell: number, initial = false): void {
    const s = this.settings;
    const spec = this.spec(family);
    const c: Creature = {
      family,
      alive: true,
      // Starting creatures get mixed ages so they don't all breed and die in lock-step.
      age: initial ? this.rng.int(Math.max(1, spec.maxAge)) : 0,
      sex: s.sexes ? (this.rng.chance(s.femaleShare) ? FEMALE : MALE) : NO_SEX,
      energy: family === SHARK ? s.sharks.startEnergy : s.algae.fishStartEnergy,
      cooldown: initial ? this.rng.int(spec.breedCooldown + 1) : spec.breedCooldown,
      cell,
      actedAt: this.tick,
    };
    this.creatures.push(c);
    this.grid[cell] = c;
    if (!initial) recordBirth(this.events, family);
  }

  private wrapCoord(v: number, n: number): number | null {
    if (v >= 0 && v < n) return v;
    if (!this.settings.wrap) return null;
    return ((v % n) + n) % n;
  }

  private neighbours(cell: number): number[] {
    const y = Math.floor(cell / this.width);
    const x = cell % this.width;
    const out: number[] = [];
    for (const [dy, dx] of this.offsets) {
      const ny = this.wrapCoord(y + dy, this.height);
      const nx = this.wrapCoord(x + dx, this.width);
      if (ny !== null && nx !== null) out.push(ny * this.width + nx);
    }
    return out;
  }

  /** Chebyshev distance, wrap-aware. */
  private distance(a: number, b: number): number {
    let dy = Math.abs(Math.floor(a / this.width) - Math.floor(b / this.width));
    let dx = Math.abs((a % this.width) - (b % this.width));
    if (this.settings.wrap) {
      dy = Math.min(dy, this.height - dy);
      dx = Math.min(dx, this.width - dx);
    }
    return Math.max(dy, dx);
  }

  /** Nearest creature of `family` within `range` cells, or null. */
  private nearest(cell: number, family: Family, range: number): number | null {
    if (range <= 0) return null;
    const y = Math.floor(cell / this.width);
    const x = cell % this.width;
    let best: number | null = null;
    let bestD = Infinity;
    for (let dy = -range; dy <= range; dy++) {
      const ny = this.wrapCoord(y + dy, this.height);
      if (ny === null) continue;
      for (let dx = -range; dx <= range; dx++) {
        if (dy === 0 && dx === 0) continue;
        const nx = this.wrapCoord(x + dx, this.width);
        if (nx === null) continue;
        const other = this.grid[ny * this.width + nx];
        if (other && other.family === family) {
          const d = Math.max(Math.abs(dy), Math.abs(dx));
          if (d < bestD || (d === bestD && this.rng.chance(0.5))) {
            bestD = d;
            best = other.cell;
          }
        }
      }
    }
    return best;
  }

  private pick<T>(items: T[]): T | undefined {
    return items.length ? items[this.rng.int(items.length)] : undefined;
  }

  private emptyNeighbours(cell: number): number[] {
    return this.neighbours(cell).filter((n) => this.grid[n] === null);
  }

  private moveTo(c: Creature, cell: number): void {
    this.grid[c.cell] = null;
    c.cell = cell;
    this.grid[cell] = c;
  }

  private die(c: Creature, cause: DeathCause): void {
    if (c.alive) recordDeath(this.events, c.family, cause);
    c.alive = false;
    if (this.grid[c.cell] === c) this.grid[c.cell] = null;
  }

  /** Step to the empty neighbour that brings us closest to (or furthest from) `goal`. */
  private stepRelative(c: Creature, goal: number, away: boolean): boolean {
    const options = this.emptyNeighbours(c.cell);
    if (!options.length) return false;
    let best: number[] = [];
    let bestScore = -Infinity;
    for (const n of options) {
      const d = this.distance(n, goal);
      const score = away ? d : -d;
      if (score > bestScore) {
        bestScore = score;
        best = [n];
      } else if (score === bestScore) best.push(n);
    }
    // Don't "flee" into a cell that's no further away than staying put.
    const here = this.distance(c.cell, goal);
    if ((away && bestScore <= here) || (!away && -bestScore >= here)) return false;
    this.moveTo(c, this.pick(best)!);
    return true;
  }

  private wander(c: Creature): void {
    const options = this.emptyNeighbours(c.cell);
    if (this.settings.allowStay) options.push(c.cell);
    const to = this.pick(options);
    if (to !== undefined && to !== c.cell) this.moveTo(c, to);
  }

  private tryBreed(c: Creature, fromCell: number): void {
    const spec = this.spec(c.family);
    if (c.age < spec.breedAge || c.cooldown > 0) return;
    const sexes = this.settings.sexes;
    if (sexes && !spec.needsMate && c.sex !== FEMALE) return;
    if (c.family === SHARK && c.energy < this.settings.sharks.breedEnergy * this.settings.sharks.maxEnergy) return;
    let mate: Creature | undefined;
    if (spec.needsMate) {
      mate = this.pick(
        this.neighbours(c.cell)
          .map((n) => this.grid[n])
          .filter(
            (o): o is Creature =>
              !!o &&
              o !== c &&
              o.family === c.family &&
              (!sexes || o.sex !== c.sex) &&
              o.age >= spec.breedAge &&
              o.cooldown <= 0,
          ),
      );
      if (!mate) return;
    }
    if (!this.rng.chance(spec.breedChance)) return;

    let placed = 0;
    for (let k = 0; k < spec.litterSize; k++) {
      let cell: number | undefined;
      if (this.settings.offspring === "adjacent") {
        // The cell just left is a natural spot (as in Wa-Tor), then any empty neighbour.
        cell = this.grid[fromCell] === null ? fromCell : this.pick(this.emptyNeighbours(c.cell));
      } else {
        for (let tries = 0; tries < 10 && cell === undefined; tries++) {
          const r = this.rng.int(this.grid.length);
          if (this.grid[r] === null) cell = r;
        }
      }
      if (cell === undefined) break;
      this.spawn(c.family, cell);
      placed++;
    }
    if (placed) {
      c.cooldown = spec.breedCooldown;
      if (mate) mate.cooldown = spec.breedCooldown;
    }
  }

  private actShark(c: Creature): void {
    const s = this.settings.sharks;
    const from = c.cell;
    const hungry = c.energy < s.hungerThreshold * s.maxEnergy;
    let moved = false;
    if (hungry) {
      const prey = this.pick(
        this.neighbours(c.cell)
          .map((n) => this.grid[n])
          .filter((o): o is Creature => !!o && o.alive && o.family === FISH),
      );
      if (prey) {
        const preyCell = prey.cell;
        this.die(prey, "eaten");
        c.energy = Math.min(s.maxEnergy, c.energy + s.energyPerMeal);
        if (s.moveOnEat) this.moveTo(c, preyCell);
        moved = true;
      } else {
        const target = this.nearest(c.cell, FISH, s.sight);
        if (target !== null) moved = this.stepRelative(c, target, false);
      }
    } else if (s.needsMate && c.age >= s.breedAge && c.cooldown <= 0) {
      const mate = this.nearest(c.cell, SHARK, s.sight);
      if (mate !== null && this.distance(c.cell, mate) > 1) moved = this.stepRelative(c, mate, false);
      else moved = mate !== null;
    }
    if (!moved) this.wander(c);
    this.tryBreed(c, from);
  }

  private actFish(c: Creature): void {
    const f = this.settings.fish;
    const from = c.cell;
    let moved = false;
    if (f.fleeChance > 0 && this.rng.chance(f.fleeChance)) {
      const threat = this.nearest(c.cell, SHARK, Math.max(1, f.sight));
      if (threat !== null) moved = this.stepRelative(c, threat, true);
    }
    if (!moved) this.wander(c);
    const a = this.settings.algae;
    if (a.enabled && this.algae[c.cell] === 0) {
      this.algae[c.cell] = Math.max(1, a.regrowTime);
      c.energy = Math.min(a.fishMaxEnergy, c.energy + a.energyPerAlgae);
    }
    this.tryBreed(c, from);
  }

  step(): void {
    if (this.ended) return;
    this.tick++;
    this.events = emptyEvents();
    const order = this.creatures.filter((c) => c.alive);
    if (this.settings.shuffleOrder) this.rng.shuffle(order);

    for (const c of order) {
      if (!c.alive || c.actedAt === this.tick) continue;
      c.actedAt = this.tick;
      c.age++;
      if (c.cooldown > 0) c.cooldown--;
      if (c.age > this.spec(c.family).maxAge) {
        this.die(c, "oldAge");
        continue;
      }
      if (c.family === SHARK || this.settings.algae.enabled) {
        c.energy--;
        if (c.energy <= 0) {
          this.die(c, "starved");
          continue;
        }
      }
      if (c.family === SHARK) this.actShark(c);
      else this.actFish(c);
    }

    if (this.settings.algae.enabled) {
      for (let i = 0; i < this.algae.length; i++) if (this.algae[i] > 0) this.algae[i]--;
    }

    // Drop the dead now and then so the list doesn't grow forever.
    if (this.tick % 20 === 0) this.creatures = this.creatures.filter((c) => c.alive);

    const { fish, sharks } = this.counts();
    if (fish === 0 || sharks === 0) this.ended = true;
    if (this.settings.maxTicks > 0 && this.tick >= this.settings.maxTicks) this.ended = true;
  }

  counts(): Counts {
    let fish = 0;
    let sharks = 0;
    for (const c of this.creatures) {
      if (!c.alive) continue;
      if (c.family === FISH) fish++;
      else sharks++;
    }
    return { fish, sharks };
  }

  paint(out: Uint8Array): void {
    const showAlgae = this.settings.algae.enabled;
    for (let i = 0; i < this.grid.length; i++) {
      const c = this.grid[i];
      if (c) out[i] = c.sex === FEMALE ? (c.family === FISH ? FISH_FEMALE : SHARK_FEMALE) : c.family;
      else out[i] = showAlgae && this.algae[i] === 0 ? ALGAE : EMPTY;
    }
  }

  finished(): boolean {
    return this.ended;
  }

  atPausePoint(): boolean {
    return false;
  }

  lastEvents(): TickEvents {
    return this.events;
  }

  individuals(): Individual[] {
    return this.creatures.filter((c) => c.alive).map((c) => ({ family: c.family, age: c.age, sex: c.sex }));
  }

  hasSexes(): boolean {
    return this.settings.sexes;
  }

  ageLimits(): { fish: number; sharks: number } {
    return { fish: this.settings.fish.maxAge, sharks: this.settings.sharks.maxAge };
  }
}
