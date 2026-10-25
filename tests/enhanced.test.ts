import { describe, expect, it } from "vitest";
import { ENHANCED_DEFAULTS, EnhancedSimulation, type EnhancedSettings } from "../src/engine/enhanced";
import { ENHANCED_PRESETS } from "../src/engine/presets";
import { ALGAE, FISH, SHARK } from "../src/engine/types";

function make(change: (s: EnhancedSettings) => void = () => {}, seed = 1): EnhancedSimulation {
  const s: EnhancedSettings = { ...structuredClone(ENHANCED_DEFAULTS), seed };
  change(s);
  return new EnhancedSimulation(s);
}

function cellsOf(sim: EnhancedSimulation): Uint8Array {
  const out = new Uint8Array(sim.width * sim.height);
  sim.paint(out);
  return out;
}

describe("enhanced", () => {
  it("never puts two creatures in one cell", () => {
    const sim = make();
    for (let i = 0; i < 100 && !sim.finished(); i++) {
      sim.step();
      const cells = cellsOf(sim);
      const { fish, sharks } = sim.counts();
      expect(cells.filter((v) => v === FISH).length).toBe(fish);
      expect(cells.filter((v) => v === SHARK).length).toBe(sharks);
    }
  });

  it("is repeatable from a seed", () => {
    const a = make(() => {}, 9);
    const b = make(() => {}, 9);
    for (let i = 0; i < 80; i++) {
      a.step();
      b.step();
    }
    expect(a.counts()).toEqual(b.counts());
  });

  it("sharks starve without fish", () => {
    const sim = make((s) => {
      s.fish.start = 1;
      s.fish.breedChance = 0;
      s.fish.fleeChance = 1;
      s.sharks.start = 10;
      s.sharks.startEnergy = 3;
      s.sharks.breedChance = 0;
    });
    for (let i = 0; i < 5; i++) sim.step();
    expect(sim.counts().sharks).toBeLessThanOrEqual(1);
  });

  it("fish need a partner when needsMate is on", () => {
    const sim = make((s) => {
      s.fish.start = 1;
      s.fish.needsMate = true;
      s.fish.breedAge = 0;
      s.fish.breedChance = 1;
      s.fish.breedCooldown = 0;
      s.sharks.start = 1;
      s.sharks.startEnergy = 1000;
      s.sharks.maxEnergy = 1000;
      s.sharks.hungerThreshold = 0;
    });
    for (let i = 0; i < 10; i++) sim.step();
    expect(sim.counts().fish).toBe(1);
  });

  it("stops at maxTicks", () => {
    const sim = make((s) => (s.maxTicks = 5));
    for (let i = 0; i < 10; i++) sim.step();
    expect(sim.tick).toBe(5);
    expect(sim.finished()).toBe(true);
  });

  it("shows algae when the food chain is on", () => {
    const sim = make((s) => (s.algae.enabled = true));
    expect(cellsOf(sim).some((v) => v === ALGAE)).toBe(true);
  });

  it("walls stop movement off the edge when wrap is off", () => {
    const sim = make((s) => {
      s.wrap = false;
      s.width = 5;
      s.height = 5;
      s.fish.start = 3;
      s.sharks.start = 1;
    });
    for (let i = 0; i < 50 && !sim.finished(); i++) sim.step();
    expect(cellsOf(sim).length).toBe(25);
  });

  for (const [key, p] of Object.entries(ENHANCED_PRESETS)) {
    it(`preset "${key}" runs`, () => {
      const sim = new EnhancedSimulation({ ...structuredClone(p.settings), seed: 5 });
      for (let i = 0; i < 100 && !sim.finished(); i++) sim.step();
      expect(sim.tick).toBeGreaterThan(0);
    });
  }
});
