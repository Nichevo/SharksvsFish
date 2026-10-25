/**
 * 3D cube mode: the Enhanced rules, but the ocean is a cube of cells instead of a
 * flat grid. Only the geometry changes: who counts as a neighbour, how far apart
 * two cells are, how far a creature can see, which level is in which depth zone,
 * and how the seabed mountains are shaped.
 *
 * Cells are numbered x + width * (y + height * z). z is the level: 0 is the surface and
 * depth - 1 the seabed. The sides can wrap round, but the surface and seabed never do.
 */
import { ENHANCED_DEFAULTS, EnhancedSimulation, ROCK, type EnhancedSettings } from "./enhanced";
import type { Rng } from "./rng";
import type { Family } from "./types";

export interface CubeSettings extends EnhancedSettings {
  /** Levels from the surface to the seabed. */
  depth: number;
}

/** Every offset in the 3x3x3 block around a cell: 26 neighbours. */
const MOORE_3D: number[][] = [];
for (let dz = -1; dz <= 1; dz++)
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) if (dx || dy || dz) MOORE_3D.push([dz, dy, dx]);

/** Face neighbours only: up, down, left, right, front, back. */
const VON_NEUMANN_3D = [
  [-1, 0, 0], [1, 0, 0],
  [0, -1, 0], [0, 1, 0],
  [0, 0, -1], [0, 0, 1],
];

export const CUBE_DEFAULTS: Omit<CubeSettings, "seed"> = {
  ...structuredClone(ENHANCED_DEFAULTS),
  width: 16,
  height: 16,
  depth: 16,
  fish: { ...ENHANCED_DEFAULTS.fish, start: 1000 },
  // With 26 neighbours sharks find fish far more easily than on a flat grid, so they
  // breed less often and die younger or they eat every fish within ~200 iterations.
  sharks: { ...ENHANCED_DEFAULTS.sharks, start: 100, breedChance: 0.1, breedCooldown: 25, maxAge: 60 },
};

type CubePreset = Omit<CubeSettings, "seed">;

function cubePreset(changes: (p: CubePreset) => void): CubePreset {
  const p = structuredClone(CUBE_DEFAULTS);
  changes(p);
  return p;
}

export const CUBE_PRESETS: Record<string, { label: string; description: string; settings: CubePreset }> = {
  open: {
    label: "Open water",
    description: "A cube of open water: sharks hunt what they can see and fish sometimes flee, in all 26 directions.",
    settings: cubePreset(() => {}),
  },
  reef: {
    label: "Reefs and depths",
    description: "Seabed mountains, rocks and reefs to hide in, surface, middle and deep zones, and algae for the fish to graze.",
    settings: cubePreset((p) => {
      p.algae.enabled = true;
      p.fish.breedChance = 0.6;
      p.terrain = { ...p.terrain, mountains: true, rocks: true, reefs: true };
      p.zones.enabled = true;
    }),
  },
};

export class CubeSimulation extends EnhancedSimulation {
  // The base constructor already calls zoneOf, setUpTerrain and neighbours, before
  // this class's own fields would be set, so these are worked out from the settings.
  get depth(): number {
    return Math.max(3, Math.floor((this.settings as CubeSettings).depth));
  }

  private get offsets3d(): number[][] {
    return this.settings.neighbourhood === "moore" ? MOORE_3D : VON_NEUMANN_3D;
  }

  protected override cellCount(): number {
    return this.width * this.height * this.depth;
  }

  private coords(cell: number): [number, number, number] {
    const layer = this.width * this.height;
    const z = Math.floor(cell / layer);
    const rest = cell - z * layer;
    return [z, Math.floor(rest / this.width), rest % this.width];
  }

  private index(z: number, y: number, x: number): number {
    return x + this.width * (y + this.height * z);
  }

  /** A position across the sides: wrapped round, or null past a wall. */
  private side(v: number, n: number): number | null {
    if (v >= 0 && v < n) return v;
    return this.settings.wrap ? ((v % n) + n) % n : null;
  }

  /** A level, or null above the surface or below the seabed. */
  private level(z: number): number | null {
    return z >= 0 && z < this.depth ? z : null;
  }

  /** Depth zones are equal bands of levels, surface first. */
  protected override zoneOf(cell: number): number {
    const bands = this.settings.zones.bands.length;
    return Math.min(bands - 1, Math.floor((this.coords(cell)[0] * bands) / this.depth));
  }

  /**
   * A seabed heightmap: a few peaks spread over the floor, each a smooth hill, with
   * a little roughness. Rock fills each column from the seabed up to its height.
   */
  protected override raiseMountains(rng: Rng): void {
    const { width: w, height: h, depth: d } = this;
    const maxHeight = this.settings.terrain.mountainHeight * d;
    const peaks = Array.from({ length: 2 + rng.int(4) }, () => ({
      x: rng.next() * w,
      y: rng.next() * h,
      height: (0.4 + 0.6 * rng.next()) * maxHeight,
      spread: (0.1 + 0.15 * rng.next()) * Math.max(w, h),
    }));
    const across = (a: number, b: number, n: number) => {
      const v = Math.abs(a - b);
      return this.settings.wrap ? Math.min(v, n - v) : v;
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let top = 0;
        for (const p of peaks) {
          const r2 = (across(x, p.x, w) ** 2 + across(y, p.y, h) ** 2) / p.spread ** 2;
          top = Math.max(top, p.height * Math.exp(-r2));
        }
        top += rng.next() * 1.5 - 0.5;
        for (let z = d - 1; z >= 0 && d - z <= top; z--) this.terrain[this.index(z, y, x)] = ROCK;
      }
    }
  }

  protected override neighbours(cell: number): number[] {
    const [z, y, x] = this.coords(cell);
    const out: number[] = [];
    for (const [dz, dy, dx] of this.offsets3d) {
      const nz = this.level(z + dz);
      const ny = this.side(y + dy, this.height);
      const nx = this.side(x + dx, this.width);
      if (nz !== null && ny !== null && nx !== null) out.push(this.index(nz, ny, nx));
    }
    return out;
  }

  /** Chebyshev distance, wrap-aware: the number of 26-direction moves between two cells. */
  protected override distance(a: number, b: number): number {
    const pa = this.coords(a);
    const pb = this.coords(b);
    const sizes = [this.depth, this.height, this.width];
    let d = 0;
    for (let i = 0; i < 3; i++) {
      let v = Math.abs(pa[i] - pb[i]);
      if (this.settings.wrap && i > 0) v = Math.min(v, sizes[i] - v);
      d = Math.max(d, v);
    }
    return d;
  }

  /** Nearest creature of `family` within a cube of `range` cells around `cell`, or null. */
  protected override nearest(cell: number, family: Family, range: number): number | null {
    if (range <= 0) return null;
    const [z, y, x] = this.coords(cell);
    let best: number | null = null;
    let bestD = Infinity;
    for (let dz = -range; dz <= range; dz++) {
      const nz = this.level(z + dz);
      if (nz === null) continue;
      for (let dy = -range; dy <= range; dy++) {
        const ny = this.side(y + dy, this.height);
        if (ny === null) continue;
        for (let dx = -range; dx <= range; dx++) {
          if (dz === 0 && dy === 0 && dx === 0) continue;
          const nx = this.side(x + dx, this.width);
          if (nx === null) continue;
          const other = this.grid[this.index(nz, ny, nx)];
          if (other && other.family === family && !this.hiddenFrom(other.cell, family)) {
            const d = Math.max(Math.abs(dz), Math.abs(dy), Math.abs(dx));
            if (d < bestD || (d === bestD && this.rng.chance(0.5))) {
              bestD = d;
              best = other.cell;
            }
          }
        }
      }
    }
    return best;
  }
}
