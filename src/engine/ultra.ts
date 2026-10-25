/**
 * Ultra Enhanced mode: its own engine, separate from Classic and Enhanced, with
 * evolution (inherited, mutating traits), seasons and events you can trigger.
 *
 * Species are handled generically through SPECIES and DIET, so more of them can be
 * added without touching the movement or breeding code.
 */
import { Rng } from "./rng";

export type SpeciesKey = "fish" | "sharks";
/** Order matters: it is the species index used in the engine and in paint(). */
export const SPECIES: SpeciesKey[] = ["fish", "sharks"];
/** Who each species eats. Fish graze algae when the food chain is on. */
export const DIET: Record<SpeciesKey, SpeciesKey[]> = {
  fish: [],
  sharks: ["fish"],
};
export const SPECIES_LABEL: Record<SpeciesKey, string> = { fish: "Fish", sharks: "Sharks" };

export type Trait = "speed" | "sight" | "lifespan";
export const TRAITS: Trait[] = ["speed", "sight", "lifespan"];
const TRAIT_LIMITS: Record<Trait, [number, number]> = { speed: [0.2, 4], sight: [0, 8], lifespan: [3, 5000] };

export interface UltraSpecies {
  start: number;
  breedAge: number;
  /** Starting lifespan (the lifespan trait evolves from here). */
  maxAge: number;
  breedChance: number;
  litterSize: number;
  breedCooldown: number;
  /** Starting sight in cells. */
  sight: number;
  /** Starting speed: moves per iteration (fractions are a chance of one more). */
  speed: number;
  startEnergy: number;
  maxEnergy: number;
  /** Energy from one meal (one fish for sharks, one patch of algae for fish). */
  energyPerMeal: number;
  /** Hunts when energy is below this fraction of max energy. */
  hungerThreshold: number;
  /** Needs at least this fraction of max energy to breed. */
  breedEnergy: number;
  /** Chance it swims away from a predator it can see. */
  fleeChance: number;
}

export interface UltraSettings {
  width: number;
  height: number;
  wrap: boolean;
  /** Stop after this many iterations (0 = no limit). */
  maxTicks: number;
  species: Record<SpeciesKey, UltraSpecies>;
  algae: {
    /** Fish must graze algae to survive. */
    enabled: boolean;
    startCover: number;
    /** Average iterations for a grazed patch to grow back, before seasons. */
    regrowTime: number;
  };
  evolution: {
    enabled: boolean;
    /** Typical size of a mutation, as a fraction of the parent's value. */
    mutation: number;
    /**
     * How much good traits cost: speed and sight burn energy (or cut breeding for
     * creatures that don't need food), and a longer life means fewer babies.
     */
    tradeOff: number;
  };
  seasons: {
    enabled: boolean;
    /** Iterations in one year. */
    yearLength: number;
    /** How far algae growth swings either side of normal (0-1). */
    strength: number;
  };
  events: {
    /** Average iterations between random events (0 = only when you press a button). */
    randomEvery: number;
    disease: { spread: number; lethality: number; duration: number };
    boats: { width: number; catchChance: number; bycatch: number };
    heatwave: { length: number };
  };
  seed: number;
}

const species = (s: Partial<UltraSpecies>): UltraSpecies => ({
  start: 100,
  breedAge: 3,
  maxAge: 40,
  breedChance: 0.5,
  litterSize: 1,
  breedCooldown: 2,
  sight: 2,
  speed: 1,
  startEnergy: 8,
  maxEnergy: 15,
  energyPerMeal: 4,
  hungerThreshold: 0.7,
  breedEnergy: 0.3,
  fleeChance: 0.5,
  ...s,
});

export const ULTRA_DEFAULTS: Omit<UltraSettings, "seed"> = {
  width: 60,
  height: 40,
  wrap: true,
  maxTicks: 0,
  species: {
    fish: species({ start: 600, breedAge: 3, maxAge: 40, breedChance: 0.6, breedCooldown: 2, sight: 2, fleeChance: 0.5, breedEnergy: 0.3 }),
    sharks: species({
      start: 60,
      breedAge: 10,
      maxAge: 120,
      breedChance: 0.5,
      breedCooldown: 12,
      sight: 1,
      startEnergy: 4,
      maxEnergy: 4,
      energyPerMeal: 2,
      hungerThreshold: 0.7,
      breedEnergy: 0.5,
      fleeChance: 0,
    }),
  },
  algae: { enabled: true, startCover: 0.6, regrowTime: 12 },
  evolution: { enabled: true, mutation: 0.08, tradeOff: 0.5 },
  seasons: { enabled: true, yearLength: 120, strength: 0.7 },
  events: {
    randomEvery: 0,
    disease: { spread: 0.25, lethality: 0.08, duration: 20 },
    boats: { width: 3, catchChance: 0.5, bycatch: 0.1 },
    heatwave: { length: 30 },
  },
};

export type DeathCause = "eaten" | "oldAge" | "starved" | "disease" | "caught";
export interface SpeciesEvents {
  born: number;
  eaten: number;
  oldAge: number;
  starved: number;
  disease: number;
  caught: number;
}
export type UltraEvents = Record<SpeciesKey, SpeciesEvents> & { algaeEaten: number };

function emptyEvents(): UltraEvents {
  const e = { algaeEaten: 0 } as UltraEvents;
  for (const k of SPECIES) e[k] = { born: 0, eaten: 0, oldAge: 0, starved: 0, disease: 0, caught: 0 };
  return e;
}

export type EventKind = "disease" | "boat" | "heatwave";
export type Season = "spring" | "summer" | "autumn" | "winter";
export interface LoggedEvent {
  tick: number;
  kind: EventKind;
  detail: string;
}

interface Genes {
  speed: number;
  sight: number;
  lifespan: number;
}

interface Creature {
  sp: number;
  alive: boolean;
  age: number;
  energy: number;
  cooldown: number;
  cell: number;
  actedAt: number;
  genes: Genes;
  generation: number;
  /** 0 healthy, >0 iterations since infection, -1 recovered and immune. */
  sick: number;
}

/** Averages over the living members of one species. */
export interface TraitStats {
  count: number;
  speed: number;
  sight: number;
  lifespan: number;
  generation: number;
}

/** Cell values written by paint(). Creatures are 2 + species index; SICK is or-ed on. */
export const PAINT_WATER = 0;
export const PAINT_ALGAE = 1;
export const PAINT_SPECIES = 2;
export const PAINT_SICK = 0x40;

const MOORE = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1], [0, 1],
  [1, -1], [1, 0], [1, 1],
];

export class UltraSimulation {
  readonly width: number;
  readonly height: number;
  tick = 0;
  readonly settings: UltraSettings;

  private rng: Rng;
  private creatures: Creature[] = [];
  private grid: (Creature | null)[];
  /** 1 = algae on this cell. */
  private algae: Uint8Array;
  private ended = false;
  private events: UltraEvents = emptyEvents();
  private specs: UltraSpecies[];
  /** For each species index, the species indices that eat it. */
  private predatorsOf: number[][];
  private preyOf: number[][];
  private heatLeft = 0;
  private boatList: { x: number }[] = [];
  private log: LoggedEvent[] = [];

  constructor(settings: UltraSettings) {
    this.settings = structuredClone(settings);
    this.width = Math.max(5, Math.floor(settings.width));
    this.height = Math.max(5, Math.floor(settings.height));
    this.rng = new Rng(settings.seed);
    this.specs = SPECIES.map((k) => this.settings.species[k]);
    this.preyOf = SPECIES.map((k) => DIET[k].map((p) => SPECIES.indexOf(p)));
    this.predatorsOf = SPECIES.map((_, i) => SPECIES.flatMap((_k, j) => (this.preyOf[j].includes(i) ? [j] : [])));
    const cells = this.width * this.height;
    this.grid = new Array(cells).fill(null);
    this.algae = new Uint8Array(cells);
    for (let i = 0; i < cells; i++) this.algae[i] = this.rng.chance(this.settings.algae.startCover) ? 1 : 0;

    const free = this.rng.shuffle([...Array(cells).keys()]);
    SPECIES.forEach((_, i) => {
      const n = Math.min(Math.floor(this.specs[i].start), free.length);
      for (let k = 0; k < n; k++) this.spawn(i, free.pop()!, null);
    });
  }

  // ---------- helpers ----------

  private gauss(): number {
    const u = 1 - this.rng.next();
    const v = this.rng.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  private mutate(trait: Trait, value: number): number {
    const evo = this.settings.evolution;
    if (!evo.enabled) return value;
    const [lo, hi] = TRAIT_LIMITS[trait];
    // Sight can start at 0, so it mutates by a fraction of a cell rather than a fraction of itself.
    const scale = trait === "sight" ? Math.max(1, value) : value;
    return Math.min(hi, Math.max(lo, value + this.gauss() * evo.mutation * scale));
  }

  private baseGenes(sp: number): Genes {
    const s = this.specs[sp];
    return { speed: s.speed, sight: s.sight, lifespan: s.maxAge };
  }

  /** `parents` null means a starting creature: mixed ages and, with evolution, a little variety. */
  private spawn(sp: number, cell: number, parent: Creature | null): void {
    const s = this.specs[sp];
    const from = parent ? parent.genes : this.baseGenes(sp);
    const genes: Genes = {
      speed: this.mutate("speed", from.speed),
      sight: this.mutate("sight", from.sight),
      lifespan: this.mutate("lifespan", from.lifespan),
    };
    const c: Creature = {
      sp,
      alive: true,
      age: parent ? 0 : this.rng.int(Math.max(1, Math.floor(genes.lifespan))),
      energy: s.startEnergy,
      cooldown: parent ? s.breedCooldown : this.rng.int(s.breedCooldown + 1),
      cell,
      actedAt: this.tick,
      genes,
      generation: parent ? parent.generation + 1 : 0,
      sick: 0,
    };
    this.creatures.push(c);
    this.grid[cell] = c;
    if (parent) this.events[SPECIES[sp]].born++;
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
    for (const [dy, dx] of MOORE) {
      const ny = this.wrapCoord(y + dy, this.height);
      const nx = this.wrapCoord(x + dx, this.width);
      if (ny !== null && nx !== null) out.push(ny * this.width + nx);
    }
    return out;
  }

  private distance(a: number, b: number): number {
    let dy = Math.abs(Math.floor(a / this.width) - Math.floor(b / this.width));
    let dx = Math.abs((a % this.width) - (b % this.width));
    if (this.settings.wrap) {
      dy = Math.min(dy, this.height - dy);
      dx = Math.min(dx, this.width - dx);
    }
    return Math.max(dy, dx);
  }

  /** Nearest creature of one of `kinds` within `range` cells, or null. */
  private nearest(cell: number, kinds: number[], range: number): number | null {
    if (range <= 0 || !kinds.length) return null;
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
        if (other && kinds.includes(other.sp)) {
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
    if (c.alive) this.events[SPECIES[c.sp]][cause]++;
    c.alive = false;
    if (this.grid[c.cell] === c) this.grid[c.cell] = null;
  }

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
    const here = this.distance(c.cell, goal);
    if ((away && bestScore <= here) || (!away && -bestScore >= here)) return false;
    this.moveTo(c, this.pick(best)!);
    return true;
  }

  private wander(c: Creature): void {
    const to = this.pick(this.emptyNeighbours(c.cell));
    if (to !== undefined) this.moveTo(c, to);
  }

  /** Whether this species has to eat (fish only do when the algae food chain is on). */
  private eats(sp: number): boolean {
    return this.preyOf[sp].length > 0 || this.settings.algae.enabled;
  }

  /** Speed and sight above the starting value, relative to it. */
  private upkeep(c: Creature): number {
    const base = this.baseGenes(c.sp);
    const t = this.settings.evolution.tradeOff;
    return t * ((c.genes.speed - base.speed) / base.speed + (0.5 * (c.genes.sight - base.sight)) / Math.max(1, base.sight));
  }

  private breedChance(c: Creature): number {
    const s = this.specs[c.sp];
    let p = s.breedChance;
    const t = this.settings.evolution.tradeOff;
    // A longer life is paid for with fewer babies, a shorter one with more.
    p *= Math.min(2, Math.max(0.05, 1 - (t * (c.genes.lifespan - s.maxAge)) / s.maxAge));
    // Creatures that don't need food pay for speed and sight in babies instead.
    if (!this.eats(c.sp)) p /= Math.max(0.2, 1 + this.upkeep(c));
    if (this.heatLeft > 0) p *= 0.5;
    return p;
  }

  private tryBreed(c: Creature, fromCell: number): void {
    const s = this.specs[c.sp];
    if (c.age < s.breedAge || c.cooldown > 0 || c.sick > 0) return;
    if (this.eats(c.sp) && c.energy < s.breedEnergy * s.maxEnergy) return;
    if (!this.rng.chance(this.breedChance(c))) return;
    let placed = 0;
    for (let k = 0; k < s.litterSize; k++) {
      const cell = this.grid[fromCell] === null ? fromCell : this.pick(this.emptyNeighbours(c.cell));
      if (cell === undefined) break;
      this.spawn(c.sp, cell, c);
      placed++;
    }
    if (placed) c.cooldown = s.breedCooldown;
  }

  private graze(c: Creature): void {
    const s = this.specs[c.sp];
    if (c.sp !== 0 || !this.settings.algae.enabled || !this.algae[c.cell] || c.energy >= s.maxEnergy) return;
    this.algae[c.cell] = 0;
    this.events.algaeEaten++;
    c.energy = Math.min(s.maxEnergy, c.energy + s.energyPerMeal);
  }

  /** One move: flee, hunt or wander. Returns false once the creature has eaten (its turn ends). */
  private moveOnce(c: Creature): boolean {
    const s = this.specs[c.sp];
    const sight = Math.round(c.genes.sight);
    const threats = this.predatorsOf[c.sp];
    if (threats.length && s.fleeChance > 0 && this.rng.chance(s.fleeChance)) {
      const threat = this.nearest(c.cell, threats, Math.max(1, sight));
      if (threat !== null && this.stepRelative(c, threat, true)) return true;
    }
    const prey = this.preyOf[c.sp];
    if (prey.length && c.energy < s.hungerThreshold * s.maxEnergy) {
      const meal = this.pick(
        this.neighbours(c.cell)
          .map((n) => this.grid[n])
          .filter((o): o is Creature => !!o && o.alive && prey.includes(o.sp)),
      );
      if (meal) {
        const cell = meal.cell;
        this.die(meal, "eaten");
        c.energy = Math.min(s.maxEnergy, c.energy + s.energyPerMeal);
        this.moveTo(c, cell);
        return false;
      }
      const target = this.nearest(c.cell, prey, sight);
      if (target !== null && this.stepRelative(c, target, false)) return true;
    }
    this.wander(c);
    this.graze(c);
    return true;
  }

  private act(c: Creature): void {
    const from = c.cell;
    const speed = c.genes.speed;
    const moves = Math.floor(speed) + (this.rng.chance(speed % 1) ? 1 : 0);
    for (let m = 0; m < moves; m++) if (!this.moveOnce(c)) break;
    this.graze(c);
    this.tryBreed(c, from);
  }

  private spreadDisease(c: Creature): void {
    const d = this.settings.events.disease;
    for (const n of this.neighbours(c.cell)) {
      const o = this.grid[n];
      if (o && o.sp === c.sp && o.sick === 0 && this.rng.chance(d.spread)) o.sick = 1;
    }
  }

  // ---------- seasons and events ----------

  /** Where we are in the year, 0-1. */
  yearPhase(): number {
    const len = Math.max(4, this.settings.seasons.yearLength);
    return (this.tick % len) / len;
  }

  season(): Season | null {
    if (!this.settings.seasons.enabled) return null;
    return (["spring", "summer", "autumn", "winter"] as const)[Math.floor(this.yearPhase() * 4)];
  }

  /** Algae growth now, relative to normal: peaks mid-summer, lowest mid-winter. */
  growthFactor(): number {
    let f = 1;
    const s = this.settings.seasons;
    if (s.enabled) f = Math.max(0, 1 + s.strength * Math.sin(2 * Math.PI * (this.yearPhase() - 0.125)));
    if (this.heatLeft > 0) f *= 0.2;
    return f;
  }

  /** Start an event now. Disease needs the species it should strike. */
  trigger(kind: EventKind, target: SpeciesKey = "fish"): void {
    const ev = this.settings.events;
    if (kind === "disease") {
      const sp = SPECIES.indexOf(target);
      const pool = this.creatures.filter((c) => c.alive && c.sp === sp && c.sick === 0);
      this.rng.shuffle(pool);
      const n = Math.max(1, Math.round(pool.length * 0.03));
      for (const c of pool.slice(0, n)) c.sick = 1;
      this.log.push({ tick: this.tick, kind, detail: `Disease among the ${SPECIES_LABEL[target].toLowerCase()}` });
    } else if (kind === "boat") {
      this.boatList.push({ x: -ev.boats.width });
      this.log.push({ tick: this.tick, kind, detail: "Fishing boat" });
    } else {
      this.heatLeft = Math.max(this.heatLeft, ev.heatwave.length);
      this.log.push({ tick: this.tick, kind, detail: "Heatwave" });
    }
  }

  heatwaveLeft(): number {
    return this.heatLeft;
  }

  /** Left edge of each boat's net, in cells. */
  boats(): number[] {
    return this.boatList.map((b) => b.x);
  }

  /** Every event so far, oldest first. */
  eventLog(): LoggedEvent[] {
    return this.log;
  }

  private runEvents(): void {
    const ev = this.settings.events;
    if (ev.randomEvery > 0 && this.rng.chance(1 / ev.randomEvery)) {
      const kind = this.pick<EventKind>(["disease", "boat", "heatwave"])!;
      this.trigger(kind, this.pick(SPECIES)!);
    }
    // Boats drag a net down the full height, one column per iteration.
    for (const b of this.boatList) {
      b.x++;
      for (let dx = 0; dx < ev.boats.width; dx++) {
        const x = b.x + dx;
        if (x < 0 || x >= this.width) continue;
        for (let y = 0; y < this.height; y++) {
          const c = this.grid[y * this.width + x];
          if (!c) continue;
          const p = c.sp === 0 ? ev.boats.catchChance : ev.boats.bycatch;
          if (this.rng.chance(p)) this.die(c, "caught");
        }
      }
    }
    this.boatList = this.boatList.filter((b) => b.x < this.width);
  }

  // ---------- the iteration ----------

  step(): void {
    if (this.ended) return;
    this.tick++;
    this.events = emptyEvents();
    this.runEvents();
    const order = this.rng.shuffle(this.creatures.filter((c) => c.alive));
    const disease = this.settings.events.disease;
    const heat = this.heatLeft > 0 ? 0.5 : 0;

    for (const c of order) {
      if (!c.alive || c.actedAt === this.tick) continue;
      c.actedAt = this.tick;
      c.age++;
      if (c.cooldown > 0) c.cooldown--;
      if (c.age > c.genes.lifespan) {
        this.die(c, "oldAge");
        continue;
      }
      if (c.sick > 0) {
        if (this.rng.chance(disease.lethality)) {
          this.die(c, "disease");
          continue;
        }
        this.spreadDisease(c);
        if (++c.sick > disease.duration) c.sick = -1;
      }
      if (this.eats(c.sp)) {
        c.energy -= Math.max(0.2, 1 + this.upkeep(c)) + heat;
        if (c.energy <= 0) {
          this.die(c, "starved");
          continue;
        }
      }
      this.act(c);
    }

    if (this.settings.algae.enabled) {
      const p = this.growthFactor() / Math.max(1, this.settings.algae.regrowTime);
      for (let i = 0; i < this.algae.length; i++) {
        if (!this.algae[i]) {
          if (this.rng.chance(p)) this.algae[i] = 1;
        } else if (this.heatLeft > 0 && this.rng.chance(0.03)) this.algae[i] = 0;
      }
    }
    if (this.heatLeft > 0) this.heatLeft--;

    if (this.tick % 20 === 0) this.creatures = this.creatures.filter((c) => c.alive);

    const n = this.counts();
    const predators = SPECIES.some((k, i) => i > 0 && this.specs[i].start > 0 && n[k] > 0);
    if (n.fish === 0 || !predators) this.ended = true;
    if (this.settings.maxTicks > 0 && this.tick >= this.settings.maxTicks) this.ended = true;
  }

  // ---------- reading the state ----------

  counts(): Record<SpeciesKey, number> {
    const out = Object.fromEntries(SPECIES.map((k) => [k, 0])) as Record<SpeciesKey, number>;
    for (const c of this.creatures) if (c.alive) out[SPECIES[c.sp]]++;
    return out;
  }

  /** Whether every species that started with some creatures is still alive. */
  allSurvive(): boolean {
    const n = this.counts();
    return SPECIES.every((k, i) => this.specs[i].start <= 0 || n[k] > 0);
  }

  traitStats(): Record<SpeciesKey, TraitStats> {
    const out = {} as Record<SpeciesKey, TraitStats>;
    for (const k of SPECIES) out[k] = { count: 0, speed: 0, sight: 0, lifespan: 0, generation: 0 };
    for (const c of this.creatures) {
      if (!c.alive) continue;
      const t = out[SPECIES[c.sp]];
      t.count++;
      t.speed += c.genes.speed;
      t.sight += c.genes.sight;
      t.lifespan += c.genes.lifespan;
      t.generation += c.generation;
    }
    for (const k of SPECIES) {
      const t = out[k];
      if (t.count) {
        t.speed /= t.count;
        t.sight /= t.count;
        t.lifespan /= t.count;
        t.generation /= t.count;
      }
    }
    return out;
  }

  /** One trait for every living creature of a species, for histograms. */
  traitValues(sp: SpeciesKey, trait: Trait): number[] {
    const i = SPECIES.indexOf(sp);
    return this.creatures.filter((c) => c.alive && c.sp === i).map((c) => c.genes[trait]);
  }

  /** Each creature's trait value relative to its species' starting value, by cell (NaN when empty). */
  paintTrait(out: Float32Array, trait: Trait): void {
    out.fill(NaN);
    for (const c of this.creatures) {
      if (!c.alive) continue;
      const base = this.baseGenes(c.sp)[trait];
      out[c.cell] = trait === "sight" ? c.genes.sight - base : c.genes[trait] / base - 1;
    }
  }

  paint(out: Uint8Array): void {
    const showAlgae = this.settings.algae.enabled;
    for (let i = 0; i < this.grid.length; i++) {
      const c = this.grid[i];
      if (c) out[i] = (PAINT_SPECIES + c.sp) | (c.sick > 0 ? PAINT_SICK : 0);
      else out[i] = showAlgae && this.algae[i] ? PAINT_ALGAE : PAINT_WATER;
    }
  }

  algaeCells(): number | null {
    if (!this.settings.algae.enabled) return null;
    let n = 0;
    for (const v of this.algae) n += v;
    return n;
  }

  sickCount(): number {
    let n = 0;
    for (const c of this.creatures) if (c.alive && c.sick > 0) n++;
    return n;
  }

  lastEvents(): UltraEvents {
    return this.events;
  }

  finished(): boolean {
    return this.ended;
  }
}
