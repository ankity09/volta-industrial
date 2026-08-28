/**
 * Vanilla Three.js engine for the Volta Plant Floor 3D scene.
 * Renders a SceneModel with instanced cabinets, bay floors, and critical beams.
 * Imperative API: createScene() → SceneHandle { setLines, focusLine, onSelect, resize, dispose }
 *
 * Toolchain constraints (three@0.169, ESM via three/addons/*, r169 API):
 * - import * as THREE from 'three'
 * - import addons from 'three/addons/...' (NOT three/examples/jsm/)
 * - outputColorSpace = THREE.SRGBColorSpace, shadowMap.type = THREE.PCFSoftShadowMap
 * - use OutputPass for final bloom compose pass
 * - allocation-free loops: reuse one dummy Object3D and one Color per loop
 * - performance target: 1200 cabinet instances at 60fps
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import type {
  SceneModel,
  InstanceModel,
  SelectPayload,
  SceneHandle,
  SceneOptions,
} from './scene.types';

/**
 * Internal state for a single running scene instance.
 */
interface SceneState {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  labelRenderer: CSS2DRenderer;
  controls: OrbitControls;
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  clock: THREE.Clock;
  rafId: number | null;

  // Content management
  model: SceneModel | null;
  contentGroup: THREE.Group;
  cabinetMesh: THREE.InstancedMesh | null;
  beamsMesh: THREE.InstancedMesh | null;
  instanceLineIds: string[]; // index → lineId
  lineIdToIndex: Map<string, number>; // lineId → index
  instances: InstanceModel[]; // cached from model

  // Camera tween for focusLine fly-to
  camTween: {
    active: boolean;
    t0: number;
    dur: number;
    fromP: [number, number, number];
    toP: [number, number, number];
    fromT: [number, number, number];
    toT: [number, number, number];
  };

  // Hover + selection
  selectCb: ((p: SelectPayload) => void) | null;
  hoveredInstanceId: number | null;
  pointerDownPos: { x: number; y: number } | null;

  // Hero line tracking for ambient pulse
  heroLineId: string | null;

  // Reduced motion preference
  reducedMotion: boolean;

  // Container reference for cleanup
  container: HTMLElement;

  // Disposal guard
  disposed: boolean;
}

/**
 * Create a new Three.js scene engine, mounted into the given container.
 * Returns an imperative handle for lifecycle + interaction control.
 */
export function createScene(
  container: HTMLElement,
  opts: SceneOptions = {}
): SceneHandle {
  const reducedMotion = opts.reducedMotion ?? false;

  // --- Step 1: Setup ---

  const sizeOf = () => ({
    w: container.clientWidth || 1200,
    h: container.clientHeight || 800,
  });

  const { w, h } = sizeOf();

  // Scene
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0f1c); // deep navy
  scene.fog = new THREE.FogExp2(0x0a0f1c, 0.012);

  // Camera
  const camera = new THREE.PerspectiveCamera(46, w / h, 0.1, 500);
  camera.position.set(0, 60, 90);
  camera.lookAt(0, 0, 0);

  // Renderer
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setSize(w, h);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);

  // CSS2D overlay for labels
  const labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(w, h);
  labelRenderer.domElement.style.position = 'absolute';
  labelRenderer.domElement.style.top = '0';
  labelRenderer.domElement.style.left = '0';
  labelRenderer.domElement.style.pointerEvents = 'none';
  container.appendChild(labelRenderer.domElement);

  // OrbitControls
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.maxPolarAngle = Math.PI / 2.05; // don't go under floor
  controls.minDistance = 12;
  controls.maxDistance = 220;
  controls.target.set(0, 0, 0);
  controls.update();

  // Lighting
  const hemLight = new THREE.HemisphereLight(0xbfd2e6, 0x0c1420, 0.55);
  scene.add(hemLight);

  const ambLight = new THREE.AmbientLight(0xffffff, 0.22);
  scene.add(ambLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
  dirLight.position.set(40, 80, 40);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.set(2048, 2048);
  scene.add(dirLight);

  // Bloom post-processing
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  composer.setSize(w, h);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.7, 0.5, 0.6);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const clock = new THREE.Clock();

  // --- Internal state ---

  const state: SceneState = {
    scene,
    camera,
    renderer,
    labelRenderer,
    controls,
    composer,
    bloom,
    clock,
    rafId: null,
    model: null,
    contentGroup: new THREE.Group(),
    cabinetMesh: null,
    beamsMesh: null,
    instanceLineIds: [],
    lineIdToIndex: new Map(),
    instances: [],
    camTween: {
      active: false,
      t0: 0,
      dur: 1.2,
      fromP: [0, 0, 0],
      toP: [0, 0, 0],
      fromT: [0, 0, 0],
      toT: [0, 0, 0],
    },
    selectCb: null,
    hoveredInstanceId: null,
    pointerDownPos: null,
    heroLineId: null,
    reducedMotion,
    container,
    disposed: false,
  };

  scene.add(state.contentGroup);

  // --- Step 3: Raycast + pointer interaction ---

  const raycaster = new THREE.Raycaster();
  const raycasterNdc = new THREE.Vector2();

  const onPointerDown = (ev: PointerEvent) => {
    if (state.disposed) return;
    state.pointerDownPos = { x: ev.clientX, y: ev.clientY };
  };

  const onPointerUp = (ev: PointerEvent) => {
    if (state.disposed || !state.pointerDownPos || !state.cabinetMesh) return;

    const dx = ev.clientX - state.pointerDownPos.x;
    const dy = ev.clientY - state.pointerDownPos.y;
    const dragDist = Math.sqrt(dx * dx + dy * dy);

    if (dragDist > 6) {
      // treated as drag, ignore
      state.pointerDownPos = null;
      return;
    }

    // Raycast for selection
    const rect = renderer.domElement.getBoundingClientRect();
    raycasterNdc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    raycasterNdc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(raycasterNdc, camera);
    const hits = raycaster.intersectObject(state.cabinetMesh);

    if (hits.length > 0 && hits[0].instanceId != null) {
      const idx = hits[0].instanceId;
      const lineId = state.instanceLineIds[idx];
      if (lineId && state.instances[idx]) {
        const inst = state.instances[idx];
        if (state.selectCb) {
          state.selectCb({
            lineId: inst.lineId,
            plantId: inst.plantId,
            lineName: inst.lineName,
            machineType: inst.machineType,
            riskBand: inst.riskBand,
          });
        }
      }
    }

    state.pointerDownPos = null;
  };

  const onPointerMove = (ev: PointerEvent) => {
    if (state.disposed || !state.cabinetMesh) return;

    const rect = renderer.domElement.getBoundingClientRect();
    raycasterNdc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    raycasterNdc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(raycasterNdc, camera);
    const hits = raycaster.intersectObject(state.cabinetMesh);

    const newHoveredId = hits.length > 0 && hits[0].instanceId != null ? hits[0].instanceId : null;

    if (newHoveredId !== state.hoveredInstanceId) {
      if (state.hoveredInstanceId != null && state.cabinetMesh) {
        // reset old hover
        const dummy = new THREE.Object3D();
        const inst = state.instances[state.hoveredInstanceId];
        if (inst) {
          dummy.position.set(inst.x, inst.emphasized ? 1.0 : 0.8, inst.z);
          dummy.scale.set(1, inst.emphasized ? 1.35 : 1, 1);
          dummy.updateMatrix();
          state.cabinetMesh.setMatrixAt(state.hoveredInstanceId, dummy.matrix);
        }
      }

      if (newHoveredId != null && state.cabinetMesh) {
        // set new hover (scale up slightly)
        const dummy = new THREE.Object3D();
        const inst = state.instances[newHoveredId];
        if (inst) {
          dummy.position.set(inst.x, inst.emphasized ? 1.0 : 0.8, inst.z);
          dummy.scale.set(1.1, inst.emphasized ? 1.35 * 1.05 : 1.05, 1.1);
          dummy.updateMatrix();
          state.cabinetMesh.setMatrixAt(newHoveredId, dummy.matrix);
        }
      }

      if (state.cabinetMesh.instanceMatrix) {
        state.cabinetMesh.instanceMatrix.needsUpdate = true;
      }

      state.hoveredInstanceId = newHoveredId;
      renderer.domElement.style.cursor = newHoveredId != null ? 'pointer' : 'default';
    }
  };

  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointerup', onPointerUp);
  renderer.domElement.addEventListener('pointermove', onPointerMove);

  // --- Step 4: Camera tween helpers ---

  function easeInOutCubic(k: number): number {
    return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
  }

  function clamp(v: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, v));
  }

  function stepCamTween(t: number): void {
    if (!state.camTween.active) return;

    const k = clamp((t - state.camTween.t0) / state.camTween.dur, 0, 1);
    const ease = easeInOutCubic(k);

    // Lerp position
    camera.position.x =
      state.camTween.fromP[0] + (state.camTween.toP[0] - state.camTween.fromP[0]) * ease;
    camera.position.y =
      state.camTween.fromP[1] + (state.camTween.toP[1] - state.camTween.fromP[1]) * ease;
    camera.position.z =
      state.camTween.fromP[2] + (state.camTween.toP[2] - state.camTween.fromP[2]) * ease;

    // Lerp target
    controls.target.x =
      state.camTween.fromT[0] + (state.camTween.toT[0] - state.camTween.fromT[0]) * ease;
    controls.target.y =
      state.camTween.fromT[1] + (state.camTween.toT[1] - state.camTween.fromT[1]) * ease;
    controls.target.z =
      state.camTween.fromT[2] + (state.camTween.toT[2] - state.camTween.fromT[2]) * ease;

    controls.update();

    if (k >= 1) {
      state.camTween.active = false;
    }
  }

  // --- Animation loop ---

  function stepPulse(t: number): void {
    if (!state.beamsMesh || !state.beamsMesh.material) return;

    // Subtle pulse on beams opacity
    const pulseFactor = 0.4 + 0.25 * Math.sin(t * 3);
    (state.beamsMesh.material as THREE.MeshBasicMaterial).opacity = pulseFactor;
  }

  function animate(): void {
    state.rafId = requestAnimationFrame(animate);

    const t = clock.getElapsedTime();

    controls.update();

    // Camera tween always runs (discrete transition)
    if (state.camTween.active) {
      stepCamTween(t);
    }

    // Ambient pulse only when NOT reduced-motion
    if (!state.reducedMotion) {
      stepPulse(t);
    }

    // Render
    if (state.reducedMotion) {
      renderer.render(scene, camera);
    } else {
      composer.render();
    }

    labelRenderer.render(scene, camera);
  }

  // --- Public API ---

  const handle: SceneHandle = {
    setLines(model: SceneModel): void {
      if (state.disposed) return;

      state.model = model;
      state.heroLineId = model.heroLineId;
      state.instances = model.instances;

      // Dispose old content
      state.contentGroup.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry?.dispose();
          if (Array.isArray(obj.material)) {
            obj.material.forEach((m) => m.dispose());
          } else if (obj.material) {
            obj.material.dispose();
          }
        }
      });

      // Remove CSS2D labels
      state.contentGroup.children.forEach((child) => {
        if (child instanceof CSS2DObject) {
          child.element?.remove?.();
        }
      });

      while (state.contentGroup.children.length > 0) {
        state.contentGroup.remove(state.contentGroup.children[0]);
      }

      state.cabinetMesh = null;
      state.beamsMesh = null;
      state.instanceLineIds = [];
      state.lineIdToIndex.clear();
      state.hoveredInstanceId = null;

      // --- Step 2: Build bays + cabinets ---

      // Bay floors + labels
      model.bays.forEach((bay) => {
        // Floor tile
        const floorGeo = new THREE.BoxGeometry(bay.halfW * 2, 0.1, bay.halfD * 2);
        const floorMat = new THREE.MeshStandardMaterial({
          color: 0x141b2b,
          roughness: 0.8,
          metalness: 0,
        });
        const floor = new THREE.Mesh(floorGeo, floorMat);
        floor.position.set(bay.centerX, -0.05, bay.centerZ);
        floor.receiveShadow = true;
        state.contentGroup.add(floor);

        // Bay label
        const labelDiv = document.createElement('div');
        labelDiv.textContent = bay.label.toUpperCase();
        labelDiv.style.fontFamily = 'monospace';
        labelDiv.style.fontWeight = '700';
        labelDiv.style.letterSpacing = '0.15em';
        labelDiv.style.fontSize = '11px';
        labelDiv.style.color = '#d0d5dd';
        labelDiv.style.backgroundColor = 'rgba(11, 14, 19, 0.82)';
        labelDiv.style.padding = '4px 8px';
        labelDiv.style.borderRadius = '4px';
        labelDiv.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.6)';
        labelDiv.style.whiteSpace = 'nowrap';

        const labelObj = new CSS2DObject(labelDiv);
        labelObj.position.set(bay.centerX, 2.2, bay.centerZ - bay.halfD);
        state.contentGroup.add(labelObj);
      });

      // Cabinet InstancedMesh
      const cabinetCount = model.instances.length;
      const cabinetGeo = new THREE.BoxGeometry(1.2, 1.6, 1.2);
      const cabinetMat = new THREE.MeshStandardMaterial({
        roughness: 0.6,
        metalness: 0.2,
      });

      const cabinetMesh = new THREE.InstancedMesh(cabinetGeo, cabinetMat, cabinetCount);
      cabinetMesh.castShadow = true;
      cabinetMesh.receiveShadow = true;

      const dummy = new THREE.Object3D();
      const tmpColor = new THREE.Color();

      model.instances.forEach((inst, i) => {
        dummy.position.set(inst.x, inst.emphasized ? 1.0 : 0.8, inst.z);
        dummy.scale.set(1, inst.emphasized ? 1.35 : 1, 1);
        dummy.updateMatrix();
        cabinetMesh.setMatrixAt(i, dummy.matrix);

        tmpColor.setHex(inst.colorHex);
        cabinetMesh.setColorAt(i, tmpColor);

        state.instanceLineIds[i] = inst.lineId;
        state.lineIdToIndex.set(inst.lineId, i);
      });

      cabinetMesh.instanceMatrix.needsUpdate = true;
      if (cabinetMesh.instanceColor) {
        cabinetMesh.instanceColor.needsUpdate = true;
      }

      state.contentGroup.add(cabinetMesh);
      state.cabinetMesh = cabinetMesh;

      // Vertical beams for critical instances
      const criticalCount = model.instances.filter((i) => i.riskBand === 'critical').length;

      if (criticalCount > 0) {
        const beamGeo = new THREE.CylinderGeometry(0.12, 0.12, 8, 6);
        const beamMat = new THREE.MeshBasicMaterial({
          color: 0xe5484d,
          transparent: true,
          opacity: 0.5,
          toneMapped: false,
        });

        const beamsMesh = new THREE.InstancedMesh(beamGeo, beamMat, criticalCount);

        let beamIdx = 0;
        model.instances.forEach((inst) => {
          if (inst.riskBand === 'critical') {
            dummy.position.set(inst.x, 4, inst.z);
            dummy.scale.set(1, 1, 1);
            dummy.updateMatrix();
            beamsMesh.setMatrixAt(beamIdx, dummy.matrix);
            beamIdx++;
          }
        });

        beamsMesh.instanceMatrix.needsUpdate = true;
        state.contentGroup.add(beamsMesh);
        state.beamsMesh = beamsMesh;
      }
    },

    focusLine(lineId: string): void {
      if (state.disposed) return;

      const idx = state.lineIdToIndex.get(lineId);
      if (idx == null) return;

      const inst = state.instances[idx];
      if (!inst) return;

      const toP: [number, number, number] = [inst.x + 6, 6, inst.z + 10];
      const toT: [number, number, number] = [inst.x, 1, inst.z];

      if (state.reducedMotion) {
        camera.position.set(...toP);
        controls.target.set(...toT);
        controls.update();
      } else {
        state.camTween.active = true;
        state.camTween.t0 = clock.getElapsedTime();
        state.camTween.fromP = [camera.position.x, camera.position.y, camera.position.z];
        state.camTween.fromT = [controls.target.x, controls.target.y, controls.target.z];
        state.camTween.toP = toP;
        state.camTween.toT = toT;
      }
    },

    onSelect(cb: (payload: SelectPayload) => void): void {
      if (state.disposed) return;
      state.selectCb = cb;
    },

    resize(): void {
      if (state.disposed) return;

      const { w: newW, h: newH } = sizeOf();

      camera.aspect = newW / newH;
      camera.updateProjectionMatrix();

      renderer.setSize(newW, newH);
      labelRenderer.setSize(newW, newH);
      composer.setSize(newW, newH);
      state.bloom.resolution.set(newW, newH);
    },

    dispose(): void {
      if (state.disposed) return;
      state.disposed = true;

      if (state.rafId != null) {
        cancelAnimationFrame(state.rafId);
        state.rafId = null;
      }

      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);

      controls.dispose();

      // Dispose all geometries + materials in contentGroup
      state.contentGroup.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry?.dispose();
          if (Array.isArray(obj.material)) {
            obj.material.forEach((m) => m.dispose());
          } else if (obj.material) {
            obj.material.dispose();
          }
        }
      });

      // Remove CSS2D labels + clean up DOM
      state.contentGroup.children.forEach((child) => {
        if (child instanceof CSS2DObject) {
          child.element?.remove?.();
        }
      });

      // Clear scene
      while (state.scene.children.length > 0) {
        state.scene.remove(state.scene.children[0]);
      }

      // Dispose WebGL resources
      renderer.dispose();
      composer.dispose();

      // Remove canvases from DOM
      if (state.container.contains(renderer.domElement)) {
        state.container.removeChild(renderer.domElement);
      }
      if (state.container.contains(labelRenderer.domElement)) {
        state.container.removeChild(labelRenderer.domElement);
      }
    },
  };

  // Start animation loop
  animate();

  return handle;
}
