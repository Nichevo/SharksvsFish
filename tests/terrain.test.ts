import { describe, expect, it } from "vitest";
import { EnhancedSimulation, ENHANCED_DEFAULTS, OPEN, REEF, ROCK, type EnhancedSettings } from "../src/engine/enhanced";
import { ALGAE, EMPTY, FISH, FISH_FEMALE, SHARK, SHARK_FEMALE } from "../src/engine/types";

function settings(change: (s: EnhancedSettings) => void = () => {}): EnhancedSettings {
  const s = { ...structuredClone(ENHANCED_DEFAULTS), seed: 7 };
  change(s);
  return s;
}

function run(sim: EnhancedSimulation, ticks: number, each?: () => void): void {
  for (let i = 0; i < ticks && !sim.finished(); i++) {
    sim.step();
    each?.();
  }
}

describe("terrain and depth zones", () => {
  it("are off by default and leave runs unchanged", () => {
    const plain = new EnhancedSimulation(settings());
    expect(plain.terrainMap()).toBeNull();
    expect(plain.zoneMap()).toBeNull();
    expect(plain.zoneCounts()).toBeNull();
    // Changing the (switched off) values must not change anything.
    const tweaked = new EnhancedSimulation(
      settings((s) => {
        s.terrain.rockCover = 0.5;
        s.zones.bands[0].fishBreed = 5;
      }),
    );
    run(plain, 200);
    run(tweaked, 200);
    expect(tweaked.counts()).toEqual(plain.counts());
  });

  it("keeps every creature off rock, and sharks out of reefs", () => {
    const sim = new EnhancedSimulation(
      settings((s) => {
        s.terrain = { ...s.terrain, mountains: true, rocks: true, reefs: true, reefCover: 0.2 };
      }),
    );
    const t = sim.terrainMap()!;
    expect(t.includes(ROCK)).toBe(true);
    expect(t.includes(REEF)).toBe(true);
    const out = new Uint8Array(t.length);
    let fishOnReef = 0;
    const check = () => {
      sim.paint(out);
      for (let i = 0; i < out.length; i++) {
        if (t[i] === ROCK) expect(out[i]).toBe(EMPTY);
        if (t[i] === REEF) {
          expect(out[i] === SHARK || out[i] === SHARK_FEMALE).toBe(false);
          expect(out[i]).not.toBe(ALGAE);
          if (out[i] === FISH || out[i] === FISH_FEMALE) fishOnReef++;
        }
      }
    };
    check();
    run(sim, 150, check);
    expect(fishOnReef).toBeGreaterThan(0);
  });

  it("raises mountains from the bottom of the ocean", () => {
    const sim = new EnhancedSimulation(settings((s) => (s.terrain.mountains = true)));
    const t = sim.terrainMap()!;
    const row = (y: number) => [...t.slice(y * sim.width, (y + 1) * sim.width)];
    expect(row(sim.height - 1).filter((v) => v === ROCK).length).toBeGreaterThan(sim.width / 4);
    expect(row(0).every((v) => v === OPEN)).toBe(true);
  });

  it("lets fish hide from sharks in reefs", () => {
    const eaten = (hideChance: number) => {
      const sim = new EnhancedSimulation(
        settings((s) => (s.terrain = { ...s.terrain, reefs: true, reefCover: 0.4, hideChance })),
      );
      let n = 0;
      run(sim, 150, () => (n += sim.lastEvents().fishEaten));
      return n;
    };
    expect(eaten(1)).toBeLessThan(eaten(0));
  });

  it("counts creatures by depth zone", () => {
    const sim = new EnhancedSimulation(settings((s) => (s.zones.enabled = true)));
    run(sim, 50);
    const zones = sim.zoneCounts()!;
    expect(zones.map((z) => z.name)).toEqual(["Surface", "Middle", "Deep"]);
    const { fish, sharks } = sim.counts();
    expect(zones.reduce((a, z) => a + z.fish, 0)).toBe(fish);
    expect(zones.reduce((a, z) => a + z.sharks, 0)).toBe(sharks);
    const map = sim.zoneMap()!;
    expect(map[0]).toBe(0);
    expect(map[map.length - 1]).toBe(2);
  });

  it("uses each zone's values", () => {
    // Algae doesn't grow back in the deep, and fish can't breed there.
    const sim = new EnhancedSimulation(
      settings((s) => {
        s.zones.enabled = true;
        s.zones.bands[2] = { ...s.zones.bands[2], algaeGrowth: 0, fishBreed: 0 };
        s.algae = { ...s.algae, enabled: true, startCover: 0 };
      }),
    );
    const map = sim.zoneMap()!;
    const out = new Uint8Array(map.length);
    run(sim, 60, () => {
      sim.paint(out);
      for (let i = 0; i < out.length; i++) if (map[i] === 2) expect(out[i]).not.toBe(ALGAE);
    });
    sim.paint(out);
    let shallowAlgae = 0;
    for (let i = 0; i < out.length; i++) if (map[i] === 0 && out[i] === ALGAE) shallowAlgae++;
    expect(shallowAlgae).toBeGreaterThan(0);
  });
});
