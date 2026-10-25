/**
 * 3D cube mode: the Enhanced rules, but the ocean is a cube of cells instead of a
 * flat grid. Only the geometry changes: who counts as a neighbour, how far apart
 * two cells are, and how far a creature can see.
 *
 * Cells are numbered x + width * (y + height * z). z is the level: 0 is the surface and
 * depth - 1 the seabed. The sides can wrap round, but the surface and seabed never do.
 */
import { ENHANCED_DEFAULTS, EnhancedSimulation, type EnhancedSettings } from "./enhanced";
import type { Family } from "./types";

export interface CubeSettings extends EnhancedSettings {
  /** Cells front to back. */
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

export class CubeSimulation extends EnhancedSimulation {
  readonly depth: number;
  private offsets3d: number[][];

  constructor(settings: CubeSettings) {
    super(settings);
    this.depth = Math.max(3, Math.floor(settings.depth));
    this.offsets3d = settings.neighbourhood === "moore" ? MOORE_3D : VON_NEUMANN_3D;
  }

  // Called from the base constructor, before this class's own fields are set.
  protected override cellCount(): number {
    const s = this.settings as CubeSettings;
    return this.width * this.height * Math.max(3, Math.floor(s.depth));
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

  /** A level, or null above the surface or below the seabed. */
  private level(z: number): number | null {
    return z >= 0 && z < this.depth ? z : null;
  }

  protected override neighbours(cell: number): number[] {
    const [z, y, x] = this.coords(cell);
    const out: number[] = [];
    for (const [dz, dy, dx] of this.offsets3d) {
      const nz = this.level(z + dz);
      const ny = this.wrapCoord(y + dy, this.height);
      const nx = this.wrapCoord(x + dx, this.width);
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
        const ny = this.wrapCoord(y + dy, this.height);
        if (ny === null) continue;
        for (let dx = -range; dx <= range; dx++) {
          if (dz === 0 && dy === 0 && dx === 0) continue;
          const nx = this.wrapCoord(x + dx, this.width);
          if (nx === null) continue;
          const other = this.grid[this.index(nz, ny, nx)];
          if (other && other.family === family) {
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
