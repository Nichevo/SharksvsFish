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
import { ALGAE, FISH, SHARK } from "../engine/types";

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
  private frame: THREE.LineSegments;
  private size = { w: 0, h: 0, d: 0 };
  private cells = new Uint8Array(0);
  private needsRender = true;
  private matrix = new THREE.Matrix4();
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
    for (const name of ["fish", "sharks", "algae"] as const) {
      const old = this[name];
      if (old.instanceMatrix.count < cells) {
        this.scene.remove(old);
        old.dispose();
        this[name] = this.makeMesh(old.geometry, old.material as THREE.Material, cells);
      }
    }
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
    (this.fish.material as THREE.MeshLambertMaterial).color = colour("--fish");
    (this.sharks.material as THREE.MeshLambertMaterial).color = colour("--shark");
    (this.algae.material as THREE.MeshLambertMaterial).color = colour("--algae");
    (this.frame.material as THREE.LineBasicMaterial).color = colour("--text-muted");
    this.needsRender = true;
  }

  /** Colours changed (light or dark theme). */
  refreshColours(): void {
    this.applyColours();
  }

  draw(sim: CubeSimulation): void {
    sim.paint(this.cells);
    const { w, h, d } = this.size;
    const o = this.options;
    const counts = { fish: 0, sharks: 0, algae: 0 };
    const m = this.matrix;
    for (let i = 0; i < this.cells.length; i++) {
      const v = this.cells[i];
      if (!v) continue;
      const x = i % w;
      const rest = Math.floor(i / w);
      const y = rest % h;
      const z = Math.floor(rest / h);
      if (z < o.cutaway) continue;
      m.makeTranslation(x - (w - 1) / 2, (d - 1) / 2 - z, y - (h - 1) / 2);
      if (v === FISH && o.showFish) this.fish.setMatrixAt(counts.fish++, m);
      else if (v === SHARK && o.showSharks) this.sharks.setMatrixAt(counts.sharks++, m);
      else if (v === ALGAE) this.algae.setMatrixAt(counts.algae++, m);
    }
    for (const name of ["fish", "sharks", "algae"] as const) {
      this[name].count = counts[name];
      this[name].instanceMatrix.needsUpdate = true;
    }
    this.needsRender = true;
  }
}
