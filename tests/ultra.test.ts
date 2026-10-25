import { describe, expect, it } from "vitest";
import { PAINT_SICK, PAINT_SPECIES, SPECIES, ULTRA_DEFAULTS, UltraSimulation, type UltraSettings } from "../src/engine/ultra";
import { ULTRA_PRESETS } from "../src/ultra/fields";

function make(change: (s: UltraSettings) => void = () => {}, seed = 1): UltraSimulation {
  const s: UltraSettings = { ...structuredClone(ULTRA_DEFAULTS), seed };
  change(s);
  return new UltraSimulation(s);
}

function deaths(sim: UltraSimulation, k: (typeof SPECIES)[number]): number {
  const e = sim.lastEvents()[k];
  return e.eaten + e.oldAge + e.starved + e.disease + e.caught;
}

describe("ultra", () => {
  for (const [key, p] of Object.entries(ULTRA_PRESETS)) {
    it(`${key}: births and deaths add up, one creature per cell`, () => {
      const sim = new UltraSimulation({ ...structuredClone(p.settings), seed: 3 });
      const cells = new Uint8Array(sim.width * sim.height);
      let prev = sim.counts();
      for (let i = 0; i < 150 && !sim.finished(); i++) {
        if (i === 20) sim.trigger("disease", "fish");
        if (i === 30) sim.trigger("boat");
        if (i === 40) sim.trigger("heatwave");
        sim.step();
        const now = sim.counts();
        sim.paint(cells);
        SPECIES.forEach((k, idx) => {
          expect(now[k] - prev[k]).toBe(sim.lastEvents()[k].born - deaths(sim, k));
          expect(cells.filter((v) => (v & ~PAINT_SICK) === PAINT_SPECIES + idx).length).toBe(now[k]);
        });
        prev = now;
      }
    });
  }

  it("is repeatable from a seed, events included", () => {
    const run = () => {
      const sim = make(() => {}, 9);
      for (let i = 0; i < 120; i++) {
        if (i === 50) sim.trigger("boat");
        sim.step();
      }
      return [sim.counts(), sim.traitStats()];
    };
    expect(run()).toEqual(run());
  });

  it("keeps traits fixed with evolution off", () => {
    const sim = make((s) => (s.evolution.enabled = false));
    for (let i = 0; i < 100; i++) sim.step();
    const t = sim.traitStats();
    expect(t.fish.speed).toBe(1);
    expect(t.fish.sight).toBe(2);
    expect(t.sharks.lifespan).toBe(120);
  });

  it("babies inherit mutated traits with evolution on", () => {
    const sim = make();
    for (let i = 0; i < 100; i++) sim.step();
    const speeds = sim.traitValues("fish", "speed");
    expect(new Set(speeds).size).toBeGreaterThan(10);
    expect(sim.traitStats().fish.generation).toBeGreaterThan(3);
  });

  it("selection favours speed when traits are free", () => {
    // With no cost, faster sharks catch more and fish that outrun them survive.
    const sim = make((s) => {
      s.evolution.tradeOff = 0;
      s.evolution.mutation = 0.15;
      s.algae.enabled = false;
    }, 5);
    for (let i = 0; i < 600 && !sim.finished(); i++) sim.step();
    expect(sim.traitStats().sharks.speed).toBeGreaterThan(1.1);
  });

  it("algae grows fastest in summer and slowest in winter", () => {
    const sim = make((s) => {
      s.seasons.yearLength = 100;
      s.seasons.strength = 1;
    });
    sim.tick = 37;
    expect(sim.season()).toBe("summer");
    expect(sim.growthFactor()).toBeCloseTo(2, 1);
    sim.tick = 87;
    expect(sim.season()).toBe("winter");
    expect(sim.growthFactor()).toBeCloseTo(0, 1);
    sim.tick = 100;
    expect(sim.season()).toBe("spring");
  });

  it("disease spreads and kills", () => {
    const sim = make((s) => {
      s.events.disease.spread = 0.6;
      s.events.disease.lethality = 0.2;
    });
    sim.trigger("disease", "fish");
    let killed = 0;
    for (let i = 0; i < 30; i++) {
      sim.step();
      killed += sim.lastEvents().fish.disease;
    }
    expect(killed).toBeGreaterThan(20);
    expect(sim.lastEvents().sharks.disease).toBe(0);
  });

  it("a fishing boat sweeps the whole ocean once", () => {
    const sim = make((s) => (s.species.sharks.start = 5));
    sim.trigger("boat");
    let caught = 0;
    let ticks = 0;
    while (sim.boats().length) {
      sim.step();
      caught += sim.lastEvents().fish.caught;
      ticks++;
    }
    expect(ticks).toBeLessThanOrEqual(sim.width + 3);
    expect(caught).toBeGreaterThan(100);
  });

  it("a heatwave kills off algae", () => {
    // One long-lived fish and shark each, so grazing doesn't muddy the comparison.
    const quiet = (s: UltraSettings) => {
      s.seasons.enabled = false;
      for (const k of SPECIES) Object.assign(s.species[k], { start: 1, maxAge: 5000, startEnergy: 1000, maxEnergy: 1000, breedChance: 0 });
    };
    const a = make(quiet, 2);
    const b = make(quiet, 2);
    b.trigger("heatwave");
    for (let i = 0; i < 20; i++) {
      a.step();
      b.step();
    }
    expect(b.algaeCells()!).toBeLessThan(a.algaeCells()! * 0.7);
    expect(b.heatwaveLeft()).toBe(10);
  });
});
