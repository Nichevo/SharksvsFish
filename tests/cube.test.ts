import { describe, expect, it } from "vitest";
import { CUBE_DEFAULTS, CUBE_PRESETS, CubeSimulation, type CubeSettings } from "../src/engine/cube";
import { OPEN, ROCK } from "../src/engine/enhanced";
import { FISH, SHARK } from "../src/engine/types";

function make(change: (s: CubeSettings) => void = () => {}, seed = 1): CubeSimulation {
  const s: CubeSettings = { ...structuredClone(CUBE_DEFAULTS), seed };
  change(s);
  return new CubeSimulation(s);
}

function cellsOf(sim: CubeSimulation): Uint8Array {
  const out = new Uint8Array(sim.width * sim.height * sim.depth);
  sim.paint(out);
  return out;
}

/** Test-only access to the protected geometry. */
const geometry = (sim: CubeSimulation) =>
  sim as unknown as { neighbours(cell: number): number[]; distance(a: number, b: number): number };

describe("cube", () => {
  it("has width x length x depth cells and never puts two creatures in one", () => {
    const sim = make((s) => {
      s.width = 8;
      s.height = 6;
      s.depth = 5;
      s.fish.start = 100;
      s.sharks.start = 10;
    });
    expect(cellsOf(sim).length).toBe(240);
    for (let i = 0; i < 60 && !sim.finished(); i++) {
      sim.step();
      const cells = cellsOf(sim);
      const { fish, sharks } = sim.counts();
      expect(cells.filter((v) => v === FISH).length).toBe(fish);
      expect(cells.filter((v) => v === SHARK).length).toBe(sharks);
    }
  });

  it("has 26 or 6 neighbours inside the water, and fewer at the surface", () => {
    const sim = make((s) => {
      s.width = s.height = s.depth = 5;
    });
    const g = geometry(sim);
    const middle = 2 + 5 * (2 + 5 * 2);
    expect(new Set(g.neighbours(middle)).size).toBe(26);
    // The sides wrap but the surface doesn't: a surface cell loses the 9 above it.
    expect(new Set(g.neighbours(2 + 5 * 2)).size).toBe(17);
    const faces = make((s) => {
      s.width = s.height = s.depth = 5;
      s.neighbourhood = "vonNeumann";
    });
    expect(new Set(geometry(faces).neighbours(middle)).size).toBe(6);
  });

  it("measures distance across the wrapped sides but not through the seabed", () => {
    const sim = make((s) => {
      s.width = s.height = s.depth = 10;
    });
    const at = (x: number, y: number, z: number) => x + 10 * (y + 10 * z);
    const g = geometry(sim);
    expect(g.distance(at(0, 0, 0), at(9, 0, 0))).toBe(1);
    expect(g.distance(at(0, 0, 0), at(0, 0, 9))).toBe(9);
    expect(g.distance(at(1, 2, 3), at(4, 2, 5))).toBe(3);
  });

  it("is repeatable from a seed", () => {
    const a = make(() => {}, 4);
    const b = make(() => {}, 4);
    for (let i = 0; i < 40; i++) {
      a.step();
      b.step();
    }
    expect(a.counts()).toEqual(b.counts());
  });

  it("keeps both species going for a long run with the default settings", () => {
    for (const seed of [1, 2]) {
      const sim = make(() => {}, seed);
      for (let i = 0; i < 400 && !sim.finished(); i++) sim.step();
      expect(sim.finished()).toBe(false);
    }
  }, 60_000);

  it("splits levels into depth zones, surface first", () => {
    const sim = make((s) => {
      s.width = s.height = 4;
      s.depth = 9;
      s.zones.enabled = true;
    });
    const zones = sim.zoneMap()!;
    const layer = 16;
    expect([0, 3, 6, 8].map((z) => zones[z * layer])).toEqual([0, 1, 2, 2]);
    // Every cell on a level is in the same zone.
    expect(new Set(zones.slice(3 * layer, 4 * layer))).toEqual(new Set([1]));
  });

  it("builds seabed mountains up from the bottom level, with no creatures in rock", () => {
    const sim = make((s) => {
      s.terrain.mountains = true;
      s.terrain.mountainHeight = 0.5;
    });
    const t = sim.terrainMap()!;
    const { width: w, height: h, depth: d } = sim;
    expect(t.includes(ROCK)).toBe(true);
    for (let i = 0; i < w * h; i++) {
      // Each column is rock from the seabed up, then open water above.
      let z = d - 1;
      while (z >= 0 && t[i + z * w * h] === ROCK) z--;
      for (; z >= 0; z--) expect(t[i + z * w * h]).toBe(OPEN);
      // Nothing reaches the surface level.
      expect(t[i]).toBe(OPEN);
    }
    const cells = cellsOf(sim);
    for (let i = 0; i < t.length; i++) if (t[i] === ROCK) expect(cells[i]).toBe(0);
  });

  it("keeps both species going in the reefs and depths starting point", () => {
    const sim = new CubeSimulation({ ...structuredClone(CUBE_PRESETS.reef.settings), seed: 1 });
    for (let i = 0; i < 400 && !sim.finished(); i++) sim.step();
    expect(sim.finished()).toBe(false);
  }, 60_000);
});
