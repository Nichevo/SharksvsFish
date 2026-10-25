import { describe, expect, it } from "vitest";
import { UltraSimulation, ULTRA_DEFAULTS } from "../src/engine/ultra";
import { equilibrium, fitLotkaVolterra, solveLotkaVolterra } from "../src/ultra/lv";

describe("Lotka-Volterra", () => {
  const truth = { alpha: 0.1, beta: 0.002, delta: 0.0005, gamma: 0.2 };

  it("recovers the parameters from its own curves", () => {
    const { prey, pred } = solveLotkaVolterra(truth, 500, 40, 800);
    const fit = fitLotkaVolterra(prey, pred, 0)!;
    expect(fit).not.toBeNull();
    for (const k of ["alpha", "beta", "delta", "gamma"] as const) expect(Math.abs(fit[k] / truth[k] - 1)).toBeLessThan(0.05);
    expect(fit.r2Prey).toBeGreaterThan(0.95);
  });

  it("cycles round the equilibrium", () => {
    const eq = equilibrium(truth);
    expect(eq.prey).toBeCloseTo(400);
    expect(eq.pred).toBeCloseTo(50);
    const { prey } = solveLotkaVolterra(truth, 500, 40, 400);
    expect(Math.max(...prey)).toBeGreaterThan(eq.prey);
    expect(Math.min(...prey)).toBeLessThan(eq.prey);
  });

  it("gives no fit when a species is gone", () => {
    expect(fitLotkaVolterra(new Array(300).fill(100), new Array(300).fill(0))).toBeNull();
  });

  it("fits a real run", () => {
    const sim = new UltraSimulation({ ...structuredClone(ULTRA_DEFAULTS), seed: 2, evolution: { ...ULTRA_DEFAULTS.evolution, enabled: false } });
    const fish: number[] = [];
    const sharks: number[] = [];
    for (let i = 0; i < 600 && !sim.finished(); i++) {
      sim.step();
      fish.push(sim.counts().fish);
      sharks.push(sim.counts().sharks);
    }
    const fit = fitLotkaVolterra(fish, sharks);
    expect(fit).not.toBeNull();
  });
});
