/**
 * The 3D view for cube mode, drawn with Three.js. Loaded only when cube mode is
 * opened, so Classic and Enhanced don't pay for it.
 *
 * The ocean's x and y run across the scene's x and z; its levels run down the
 * scene's y, with the surface at the top.
 */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { CubeSimulation } from "../engine/cube";
import { REEF, ROCK } from "../engine/enhanced";
import { ALGAE, FISH, FISH_FEMALE, SHARK, SHARK_FEMALE } from "../engine/types";

export interface CubeViewOptions {
  showFish: boolean;
  showSharks: boolean;
  /** Hide this many levels from the surface down, to see inside. */
  cutaway: number;
  autoRotate: boolean;
}

export class CubeView {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(40, 1, 0.1, 2000);
  private controls: OrbitControls;
  private fish: THREE.InstancedMesh;
  private sharks: THREE.InstancedMesh;
  private algae: THREE.InstancedMesh;
  private rock: THREE.InstancedMesh;
  private reef: THREE.InstancedMesh;
  /** Faint tinted slabs of water, one per depth zone. */
  private zoneSlabs = new THREE.Group();
  private frame: THREE.LineSegments;
  private size = { w: 0, h: 0, d: 0 };
  private cells = new Uint8Array(0);
  private needsRender = true;
  private matrix = new THREE.Matrix4();
  /** Colour per painted cell value, read from the page's CSS. */
  private palette: Record<string, THREE.Color> = {};
  options: CubeViewOptions = { showFish: true, showSharks: true, cutaway: 0, autoRotate: true };

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    container.append(this.renderer.domElement);
    this.renderer.domElement.setAttribute("aria-label", "The ocean as a cube: fish are blue balls, sharks are red diamonds. Drag to turn it, scroll to zoom.");

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(1, 2, 1.5);
    this.scene.add(sun);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.autoRotateSpeed = 0.8;
    this.controls.addEventListener("change", () => (this.needsRender = true));

    // Sharks are bigger and a different shape, so they stand out among the fish and
    // don't rely on colour alone.
    this.fish = this.makeMesh(new THREE.SphereGeometry(0.28, 10, 8));
    this.sharks = this.makeMesh(new THREE.OctahedronGeometry(0.55));
    this.algae = this.makeMesh(new THREE.BoxGeometry(0.9, 0.12, 0.9));
    this.rock = this.makeMesh(new THREE.BoxGeometry(1, 1, 1));
    // Reefs are see-through so the fish hiding in them still show.
    this.reef = this.makeMesh(new THREE.BoxGeometry(0.96, 0.96, 0.96), new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.4, depthWrite: false }));
    this.scene.add(this.zoneSlabs);
    this.frame = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ transparent: true, opacity: 0.6 }));
    this.scene.add(this.frame);

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    const tick = () => {
      this.controls.autoRotate = this.options.autoRotate;
      // update() returns true while damping or auto-rotate is moving the camera.
      if (this.controls.update() || this.needsRender) {
        this.renderer.render(this.scene, this.camera);
        this.needsRender = false;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  private makeMesh(geometry: THREE.BufferGeometry, material: THREE.Material = new THREE.MeshLambertMaterial(), capacity = 1): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    this.scene.add(mesh);
    return mesh;
  }

  private resize(): void {
    const w = this.container.clientWidth;
    const h = Math.min(560, Math.max(280, Math.round(w * 0.75)));
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.needsRender = true;
  }

  /** Set up for a new ocean: frame, camera and enough instances for every cell. */
  reset(sim: CubeSimulation): void {
    const { width: w, height: h, depth: d } = sim;
    this.size = { w, h, d };
    const cells = w * h * d;
    this.cells = new Uint8Array(cells);
    for (const name of ["fish", "sharks", "algae", "rock", "reef"] as const) {
      const old = this[name];
      if (old.instanceMatrix.count < cells) {
        this.scene.remove(old);
        old.dispose();
        this[name] = this.makeMesh(old.geometry, old.material as THREE.Material, cells);
      }
    }
    this.buildZoneSlabs(sim);
    this.frame.geometry.dispose();
    this.frame.geometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(w, d, h));
    const r = Math.max(w, h, d);
    this.camera.position.set(r * 1.3, r * 0.9, r * 1.6);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
    this.applyColours();
  }

  private applyColours(): void {
    const css = getComputedStyle(this.container);
    const colour = (name: string) => new THREE.Color(css.getPropertyValue(name).trim() || "#888");
    for (const name of ["--fish", "--fish-male", "--fish-female", "--shark", "--shark-male", "--shark-female"]) {
      this.palette[name] = colour(name);
    }
    (this.algae.material as THREE.MeshLambertMaterial).color = colour("--algae");
    (this.rock.material as THREE.MeshLambertMaterial).color = colour("--rock");
    (this.reef.material as THREE.MeshLambertMaterial).color = colour("--reef");
    const water = [colour("--water"), colour("--water-middle"), colour("--water-deep")];
    this.zoneSlabs.children.forEach((slab, i) => {
      ((slab as THREE.Mesh).material as THREE.MeshBasicMaterial).color = water[Math.min(i, water.length - 1)];
    });
    (this.frame.material as THREE.LineBasicMaterial).color = colour("--text-muted");
    this.needsRender = true;
  }

  /** One faint box per depth zone, so the bands show without hiding anything. */
  private buildZoneSlabs(sim: CubeSimulation): void {
    for (const slab of [...this.zoneSlabs.children] as THREE.Mesh[]) {
      slab.geometry.dispose();
      (slab.material as THREE.Material).dispose();
      this.zoneSlabs.remove(slab);
    }
    const zones = sim.zoneMap?.();
    if (!zones) return;
    const { w, h, d } = this.size;
    const layer = w * h;
    let start = 0;
    for (let z = 1; z <= d; z++) {
      if (z < d && zones[z * layer] === zones[start * layer]) continue;
      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(w, z - start, h),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.25, depthWrite: false, side: THREE.BackSide }),
      );
      slab.position.y = d / 2 - (start + z) / 2;
      slab.userData.top = start;
      this.zoneSlabs.add(slab);
      start = z;
    }
  }

  /** Colours changed (light or dark theme). */
  refreshColours(): void {
    this.applyColours();
  }

  draw(sim: CubeSimulation): void {
    sim.paint(this.cells);
    const { w, h, d } = this.size;
    const o = this.options;
    const counts = { fish: 0, sharks: 0, algae: 0, rock: 0, reef: 0 };
    const terrain = sim.terrainMap?.() ?? null;
    // The cut-away hides whole zone slabs above the cut.
    for (const slab of this.zoneSlabs.children) slab.visible = slab.userData.top >= o.cutaway;
    const m = this.matrix;
    // Each creature is coloured on its own: with sexes on, males are the darker shade
    // and females the lighter one, as in the flat pond.
    const p = this.palette;
    const sexes = sim.hasSexes();
    const fishMale = sexes ? p["--fish-male"] : p["--fish"];
    const sharkMale = sexes ? p["--shark-male"] : p["--shark"];
    for (let i = 0; i < this.cells.length; i++) {
      const v = this.cells[i];
      const t = terrain ? terrain[i] : 0;
      if (!v && !t) continue;
      const x = i % w;
      const rest = Math.floor(i / w);
      const y = rest % h;
      const z = Math.floor(rest / h);
      if (z < o.cutaway) continue;
      m.makeTranslation(x - (w - 1) / 2, (d - 1) / 2 - z, y - (h - 1) / 2);
      if (t === ROCK) this.rock.setMatrixAt(counts.rock++, m);
      else if (t === REEF) this.reef.setMatrixAt(counts.reef++, m);
      if (v === FISH || v === FISH_FEMALE) {
        if (!o.showFish) continue;
        this.fish.setMatrixAt(counts.fish, m);
        this.fish.setColorAt(counts.fish++, v === FISH ? fishMale : p["--fish-female"]);
      } else if (v === SHARK || v === SHARK_FEMALE) {
        if (!o.showSharks) continue;
        this.sharks.setMatrixAt(counts.sharks, m);
        this.sharks.setColorAt(counts.sharks++, v === SHARK ? sharkMale : p["--shark-female"]);
      } else if (v === ALGAE) this.algae.setMatrixAt(counts.algae++, m);
    }
    for (const name of ["fish", "sharks", "algae", "rock", "reef"] as const) {
      const mesh = this[name];
      mesh.count = counts[name];
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.needsRender = true;
  }
}
