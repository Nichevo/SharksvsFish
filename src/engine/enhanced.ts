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

export interface TerrainSettings {
  /** Undersea mountains rising from the sea bed (the bottom of the pond). */
  mountains: boolean;
  /** How high the tallest peaks reach, as a share of the depth (0-1). */
  mountainHeight: number;
  /** Scattered rocks out in open water. */
  rocks: boolean;
  /** Share of the water that becomes rock (0-1). */
  rockCover: number;
  /** Reefs: fish can hide in them, sharks can't swim in. */
  reefs: boolean;
  /** Share of the open water that becomes reef (0-1). */
  reefCover: number;
  /** Chance a shark's attack on a fish hiding in a reef fails. */
  hideChance: number;
}

/** Values for one depth band. Multipliers are 1 for "no change". */
export interface ZoneBand {
  name: string;
  /** Multiplies the fish breeding chance. */
  fishBreed: number;
  /** Multiplies the shark breeding chance. */
  sharkBreed: number;
  /** Added to shark sight (negative: darker water). */
  sharkSight: number;
  /** Multiplies the energy creatures burn each iteration (sharks, and fish when algae is on). */
  energyUse: number;
  /** Multiplies how fast algae grows back (0 = no algae here). */
  algaeGrowth: number;
}

export interface ZoneSettings {
  /** Split the ocean into depth bands, top to bottom, each with its own values. */
  enabled: boolean;
  bands: ZoneBand[];
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
  terrain: TerrainSettings;
  zones: ZoneSettings;
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
  terrain: {
    mountains: false,
    mountainHeight: 0.45,
    rocks: false,
    rockCover: 0.12,
    reefs: false,
    reefCover: 0.08,
    hideChance: 0.8,
  },
  zones: {
    enabled: false,
    bands: [
      { name: "Surface", fishBreed: 1.4, sharkBreed: 1, sharkSight: 1, energyUse: 1, algaeGrowth: 2 },
      { name: "Middle", fishBreed: 1, sharkBreed: 1, sharkSight: 0, energyUse: 1, algaeGrowth: 1 },
      { name: "Deep", fishBreed: 0.6, sharkBreed: 1, sharkSight: -1, energyUse: 0.6, algaeGrowth: 0 },
    ],
  },
};

/** Terrain cell values. */
export const OPEN = 0;
export const ROCK = 1;
export const REEF = 2;

export interface ZoneCount {
  name: string;
  fish: number;
  sharks: number;
}

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

  protected rng: Rng;
  protected creatures: Creature[] = [];
  /** Cell -> creature, or null. */
  protected grid: (Creature | null)[];
  /** Cell -> iterations until algae is back (0 = algae present). */
  protected algae: Int16Array;
  protected offsets: number[][];
  /** Cell -> OPEN / ROCK / REEF. */
  protected terrain: Uint8Array;
  /** Cell -> depth band index (all 0 when zones are off). */
  protected zones: Uint8Array;
  private ended = false;
  private events: TickEvents = emptyEvents();

  constructor(settings: EnhancedSettings) {
    this.settings = structuredClone(settings);
    this.width = Math.max(3, Math.floor(settings.width));
    this.height = Math.max(3, Math.floor(settings.height));
    this.rng = new Rng(settings.seed);
    const cells = this.cellCount();
    this.grid = new Array(cells).fill(null);
    this.algae = new Int16Array(cells);
    this.offsets = settings.neighbourhood === "moore" ? MOORE : VON_NEUMANN;
    this.terrain = new Uint8Array(cells);
    this.zones = new Uint8Array(cells);
    this.settings.terrain ??= structuredClone(ENHANCED_DEFAULTS.terrain);
    this.settings.zones ??= structuredClone(ENHANCED_DEFAULTS.zones);
    if (this.settings.zones.enabled && this.settings.zones.bands.length) {
      for (let i = 0; i < cells; i++) this.zones[i] = this.zoneOf(i);
    }
    // Terrain has its own random numbers so switching it off leaves runs unchanged.
    this.setUpTerrain(new Rng((settings.seed ^ 0x5bd1e995) >>> 0));

    const a = this.settings.algae;
    for (let i = 0; i < cells; i++) {
      this.algae[i] = this.rng.chance(a.startCover) ? 0 : 1 + this.rng.int(Math.max(1, a.regrowTime));
    }

    const free = this.rng.shuffle([...Array(cells).keys()]).filter((i) => this.terrain[i] === OPEN);
    const room = free.length;
    const sharks = Math.min(Math.floor(settings.sharks.start), room);
    const fish = Math.min(Math.floor(settings.fish.start), room - sharks);
    for (let i = 0; i < fish; i++) this.spawn(FISH, free.pop()!, true);
    for (let i = 0; i < sharks; i++) this.spawn(SHARK, free.pop()!, true);
  }

  private spec(f: Family): SpeciesSettings {
    return f === FISH ? this.settings.fish : this.settings.sharks;
  }

  // ---------- zones and terrain (shared with the 3D cube, which overrides the geometry) ----------

  /** Depth band of a cell: equal bands of rows, row 0 is the surface. */
  protected zoneOf(cell: number): number {
    const bands = this.settings.zones.bands.length;
    const y = Math.floor(cell / this.width);
    return Math.min(bands - 1, Math.floor((y * bands) / this.height));
  }

  /** The band a cell is in, or null when zones are off. */
  protected zone(cell: number): ZoneBand | null {
    const z = this.settings.zones;
    return z.enabled && z.bands.length ? z.bands[this.zones[cell]] : null;
  }

  /** Whether a creature of `family` may swim into `cell` (ignoring who is already there). */
  protected isOpen(cell: number, family: Family = FISH): boolean {
    const t = this.terrain[cell];
    return t === OPEN || (t === REEF && family === FISH);
  }

  /** Number of cells in the pond. */
  protected cellCount(): number {
    return this.width * this.height;
  }

  /** True when a creature of `family` in `cell` can't be seen by others looking for it (fish in a reef). */
  protected hiddenFrom(cell: number, family: Family): boolean {
    return family === FISH && this.terrain[cell] === REEF;
  }

  /** Lays out the pond's terrain into this.terrain: sea-bed mountains, then rocks, then reefs. */
  protected setUpTerrain(rng: Rng): void {
    const t = this.settings.terrain;
    if (t.mountains && t.mountainHeight > 0) this.raiseMountains(rng);
    if (t.rocks && t.rockCover > 0) this.growPatches(rng, ROCK, t.rockCover);
    if (t.reefs && t.reefCover > 0) this.growPatches(rng, REEF, t.reefCover);
  }

  /** Sea-bed heights for each column, in cells, from a few overlapping peaks. */
  protected seabedHeights(rng: Rng, columns: number, maxHeight: number): number[] {
    const peaks = 2 + rng.int(3);
    const tops = Array.from({ length: peaks }, () => ({
      x: rng.next() * columns,
      height: (0.4 + 0.6 * rng.next()) * maxHeight,
      spread: (0.08 + 0.12 * rng.next()) * columns,
    }));
    const out: number[] = [];
    for (let x = 0; x < columns; x++) {
      let top = 0;
      for (const p of tops) {
        let dx = Math.abs(x - p.x);
        if (this.settings.wrap) dx = Math.min(dx, columns - dx);
        top = Math.max(top, p.height * Math.exp(-((dx / p.spread) ** 2)));
      }
      out.push(top + rng.next() * 1.5 - 0.5);
    }
    return out;
  }

  /** Fills rock up from the bottom row to each column's sea-bed height. */
  protected raiseMountains(rng: Rng): void {
    const { width: w, height: h } = this;
    const heights = this.seabedHeights(rng, w, this.settings.terrain.mountainHeight * h);
    for (let x = 0; x < w; x++) {
      for (let y = h - 1; y >= 0 && h - y <= heights[x]; y--) this.terrain[y * w + x] = ROCK;
    }
  }

  /** Turn about `cover` of the open cells into clumps of `kind`. */
  protected growPatches(rng: Rng, kind: number, cover: number): void {
    const open = [...this.terrain.keys()].filter((i) => this.terrain[i] === OPEN);
    let todo = Math.round(open.length * Math.min(1, cover));
    const seeds = Math.max(1, Math.round(todo / 18));
    const frontier: number[] = [];
    for (let k = 0; k < seeds && open.length; k++) frontier.push(open[rng.int(open.length)]);
    while (todo > 0 && frontier.length) {
      const i = rng.int(frontier.length);
      const cell = frontier[i];
      frontier[i] = frontier[frontier.length - 1];
      frontier.pop();
      if (this.terrain[cell] !== OPEN) continue;
      this.terrain[cell] = kind;
      todo--;
      for (const n of this.neighbours(cell)) if (this.terrain[n] === OPEN && rng.chance(0.6)) frontier.push(n);
      if (!frontier.length && todo > 0) {
        const left = open.filter((c) => this.terrain[c] === OPEN);
        if (left.length) frontier.push(left[rng.int(left.length)]);
      }
    }
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

  protected neighbours(cell: number): number[] {
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
  protected distance(a: number, b: number): number {
    let dy = Math.abs(Math.floor(a / this.width) - Math.floor(b / this.width));
    let dx = Math.abs((a % this.width) - (b % this.width));
    if (this.settings.wrap) {
      dy = Math.min(dy, this.height - dy);
      dx = Math.min(dx, this.width - dx);
    }
    return Math.max(dy, dx);
  }

  /** Nearest creature of `family` within `range` cells, or null. */
  protected nearest(cell: number, family: Family, range: number): number | null {
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
        if (other && other.family === family && !this.hiddenFrom(other.cell, family)) {
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

  private emptyNeighbours(cell: number, family: Family = FISH): number[] {
    return this.neighbours(cell).filter((n) => this.grid[n] === null && this.isOpen(n, family));
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
    const options = this.emptyNeighbours(c.cell, c.family);
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
    const options = this.emptyNeighbours(c.cell, c.family);
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
    const band = this.zone(c.cell);
    const chance = spec.breedChance * (band ? (c.family === FISH ? band.fishBreed : band.sharkBreed) : 1);
    if (!this.rng.chance(chance)) return;

    let placed = 0;
    for (let k = 0; k < spec.litterSize; k++) {
      let cell: number | undefined;
      if (this.settings.offspring === "adjacent") {
        // The cell just left is a natural spot (as in Wa-Tor), then any empty neighbour.
        cell =
          this.grid[fromCell] === null && this.isOpen(fromCell, c.family)
            ? fromCell
            : this.pick(this.emptyNeighbours(c.cell, c.family));
      } else {
        for (let tries = 0; tries < 10 && cell === undefined; tries++) {
          const r = this.rng.int(this.grid.length);
          if (this.grid[r] === null && this.isOpen(r, c.family)) cell = r;
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
      const hidden = prey !== undefined && this.terrain[prey.cell] === REEF;
      if (prey && hidden && this.rng.chance(this.settings.terrain.hideChance)) {
        // The fish ducked into the reef. The shark spent its turn trying.
        moved = true;
      } else if (prey) {
        const preyCell = prey.cell;
        this.die(prey, "eaten");
        c.energy = Math.min(s.maxEnergy, c.energy + s.energyPerMeal);
        if (s.moveOnEat && this.isOpen(preyCell, SHARK)) this.moveTo(c, preyCell);
        moved = true;
      } else {
        const sight = Math.max(0, s.sight + (this.zone(c.cell)?.sharkSight ?? 0));
        const target = this.nearest(c.cell, FISH, sight);
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
    if (a.enabled && this.algae[c.cell] === 0 && this.terrain[c.cell] === OPEN) {
      this.algae[c.cell] = Math.max(1, a.regrowTime);
      this.events.algaeEaten++;
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
        c.energy -= this.zone(c.cell)?.energyUse ?? 1;
        if (c.energy <= 0) {
          this.die(c, "starved");
          continue;
        }
      }
      if (c.family === SHARK) this.actShark(c);
      else this.actFish(c);
    }

    if (this.settings.algae.enabled) {
      if (this.settings.zones.enabled) this.regrowByZone();
      else for (let i = 0; i < this.algae.length; i++) if (this.algae[i] > 0) this.algae[i]--;
    }

    // Drop the dead now and then so the list doesn't grow forever.
    if (this.tick % 20 === 0) this.creatures = this.creatures.filter((c) => c.alive);

    const { fish, sharks } = this.counts();
    if (fish === 0 || sharks === 0) this.ended = true;
    if (this.settings.maxTicks > 0 && this.tick >= this.settings.maxTicks) this.ended = true;
  }

  /** Algae regrowth where each band grows at its own speed (fractions carry over as a chance). */
  private regrowByZone(): void {
    for (let i = 0; i < this.algae.length; i++) {
      if (this.algae[i] <= 0) continue;
      const g = this.zone(i)?.algaeGrowth ?? 1;
      const whole = Math.floor(g);
      const steps = whole + (g > whole && this.rng.chance(g - whole) ? 1 : 0);
      this.algae[i] = Math.max(0, this.algae[i] - steps);
    }
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
      else out[i] = showAlgae && this.algae[i] === 0 && this.terrain[i] === OPEN ? ALGAE : EMPTY;
    }
  }

  finished(): boolean {
    return this.ended;
  }

  atPausePoint(): boolean {
    return false;
  }

  algaeCells(): number | null {
    if (!this.settings.algae.enabled) return null;
    let n = 0;
    for (let i = 0; i < this.algae.length; i++) if (this.algae[i] === 0 && this.terrain[i] === OPEN) n++;
    return n;
  }

  /** Cell -> OPEN / ROCK / REEF, or null when there is no terrain. */
  terrainMap(): Uint8Array | null {
    const t = this.settings.terrain;
    return t.mountains || t.rocks || t.reefs ? this.terrain : null;
  }

  /** Cell -> depth band, or null when zones are off. */
  zoneMap(): Uint8Array | null {
    return this.settings.zones.enabled && this.settings.zones.bands.length ? this.zones : null;
  }

  /** Living fish and sharks in each depth band, or null when zones are off. */
  zoneCounts(): ZoneCount[] | null {
    if (!this.zoneMap()) return null;
    const out = this.settings.zones.bands.map((b) => ({ name: b.name, fish: 0, sharks: 0 }));
    for (const c of this.creatures) {
      if (!c.alive) continue;
      const z = out[this.zones[c.cell]];
      if (c.family === FISH) z.fish++;
      else z.sharks++;
    }
    return out;
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
