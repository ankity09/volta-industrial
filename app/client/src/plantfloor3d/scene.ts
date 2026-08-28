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
  PlantSceneModel,
  MachineModel,
  SelectPayload,
  SceneHandle,
  SceneOptions,
} from './scene.types';
import type { RiskBand } from '@/shared/types';
import { buildMachine, type BuiltMachine } from './machines';

interface MachineInstance {
  lineId: string;
  phase: number;
  built: BuiltMachine;
  model: MachineModel;
}

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

  // Persistent factory envelope (built once, never rebuilt)
  envelopeGroup: THREE.Group;

  // Current plant (swapped on setPlant)
  plantGroup: THREE.Group | null;
  machines: MachineInstance[];
  lineIdToMachine: Map<string, MachineInstance>;
  pickTargets: THREE.Mesh[];

  // District labels (CSS2D, per-plant)
  districtLabels: CSS2DObject[];

  // Floating callout (single instance)
  callout: CSS2DObject | null;

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
  hoveredMachineId: string | null;
  pointerDownPos: { x: number; y: number } | null;

  // Hero line tracking for pulse
  heroLineId: string | null;

  // Risk highlight
  activeRisk: RiskBand | 'all';

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

  // --- Internal state (declare early so helpers can use it) ---

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
    envelopeGroup: new THREE.Group(),
    plantGroup: null,
    machines: [],
    lineIdToMachine: new Map(),
    pickTargets: [],
    districtLabels: [],
    callout: null,
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
    hoveredMachineId: null,
    pointerDownPos: null,
    heroLineId: null,
    activeRisk: 'all',
    reducedMotion,
    container,
    disposed: false,
  };

  scene.add(state.envelopeGroup);

  // Reused for hero pulse breathing
  const pulseDummy = new THREE.Object3D();

  // Helper: hash a lineId to a stable phase [0, 2π)
  function hashToPhase(lineId: string): number {
    let hash = 0;
    for (let i = 0; i < lineId.length; i++) {
      hash += lineId.charCodeAt(i);
    }
    return ((hash % 628) / 100) * Math.PI; // [0, 2π)
  }

  // Helper: set a machine's dimming (opacity/emissive)
  function setMachineDim(built: BuiltMachine, dim: boolean): void {
    built.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj.material) {
        const mat = obj.material as THREE.MeshStandardMaterial;
        if (dim) {
          mat.transparent = true;
          mat.opacity = 0.25;
          mat.emissiveIntensity = 0;
        } else {
          mat.transparent = false;
          mat.opacity = 1;
          // Restore original emissiveIntensity if it was set (this is approximate)
          if (mat.emissive && mat.emissive.getHex() !== 0) {
            mat.emissiveIntensity = built.group.userData.originalEmissiveIntensity ?? 0.15;
          }
        }
      }
    });
  }

  // Helper: create or update the callout CSS2D label
  function showCalloutFor(lineId: string): void {
    if (state.disposed) return;

    // Remove existing callout
    if (state.callout) {
      state.callout.element?.remove?.();
      scene.remove(state.callout);
      state.callout = null;
    }

    const machine = state.lineIdToMachine.get(lineId);
    if (!machine) return;

    // Create telemetry card
    const calloutDiv = document.createElement('div');
    calloutDiv.style.backgroundColor = 'rgba(11, 14, 19, 0.95)';
    calloutDiv.style.border = `2px solid ${machine.model.colorHex ? '#' + machine.model.colorHex.toString(16).padStart(6, '0') : '#8b5cf6'}`;
    calloutDiv.style.borderRadius = '6px';
    calloutDiv.style.padding = '12px 16px';
    calloutDiv.style.color = '#d0d5dd';
    calloutDiv.style.fontFamily = 'monospace';
    calloutDiv.style.fontSize = '12px';
    calloutDiv.style.whiteSpace = 'nowrap';
    calloutDiv.style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.8)';
    calloutDiv.style.pointerEvents = 'none';

    const failurePct = ((machine.model.failureRiskScore ?? 0) * 100).toFixed(1);
    const exposureK = ((machine.model.downtimeExposureUsd ?? 0) / 1000).toFixed(0);

    calloutDiv.innerHTML = `
<div style="font-weight: bold; margin-bottom: 4px;">${machine.model.lineName || machine.lineId}</div>
<div>Risk: ${failurePct}%</div>
<div>Exposure: $${exposureK}K</div>
<div style="color: #a1a5b0; font-size: 11px; margin-top: 4px;">${machine.model.machineType.replace(/_/g, ' ')}</div>
    `.trim();

    const callout = new CSS2DObject(calloutDiv);
    callout.position.copy(machine.built.group.position);
    callout.position.y += 2.5; // Hover above the machine
    machine.built.group.add(callout);
    state.callout = callout;
  }

  // Helper: dispose current plant (machines, labels, callout, plantGroup)
  function disposePlant(): void {
    // Dispose each machine's built resources
    state.machines.forEach(({ built }) => {
      built.dispose();
    });
    state.machines = [];
    state.lineIdToMachine.clear();
    state.pickTargets = [];

    // Remove district labels
    state.districtLabels.forEach((label) => {
      label.element?.remove?.();
      scene.remove(label);
    });
    state.districtLabels = [];

    // Remove callout
    if (state.callout) {
      state.callout.element?.remove?.();
      scene.remove(state.callout);
      state.callout = null;
    }

    // Remove plantGroup from scene
    if (state.plantGroup) {
      scene.remove(state.plantGroup);
      state.plantGroup = null;
    }
  }

  // --- Step 2: Build persistent factory envelope (built ONCE, never rebuilt on plant switch) ---

  // Floor plate
  const floorGeo = new THREE.BoxGeometry(90, 0.1, 50);
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x0d1526,
    roughness: 0.9,
    metalness: 0,
  });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.position.set(0, -0.05, 0);
  floor.receiveShadow = true;
  state.envelopeGroup.add(floor);

  // Aisle stripes (thin bright planes)
  const stripeGeo = new THREE.BoxGeometry(90, 0.01, 1.5);
  const stripeMat = new THREE.MeshStandardMaterial({
    color: 0x2d3748,
    emissive: 0x4a5568,
    roughness: 0.4,
  });
  [-12, 0, 12].forEach((z) => {
    const stripe = new THREE.Mesh(stripeGeo, stripeMat);
    stripe.position.set(0, 0.02, z);
    state.envelopeGroup.add(stripe);
  });

  // Perimeter walls (4 tall boxes)
  const wallGeo = new THREE.BoxGeometry(1, 8, 50);
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0x1a2332,
    roughness: 0.8,
    metalness: 0.1,
  });
  [-45, 45].forEach((x) => {
    const wall = new THREE.Mesh(wallGeo, wallMat);
    wall.position.set(x, 4, 0);
    wall.castShadow = true;
    wall.receiveShadow = true;
    state.envelopeGroup.add(wall);
  });

  const wallGeo2 = new THREE.BoxGeometry(90, 8, 1);
  [25, -25].forEach((z) => {
    const wall = new THREE.Mesh(wallGeo2, wallMat);
    wall.position.set(0, 4, z);
    wall.castShadow = true;
    wall.receiveShadow = true;
    state.envelopeGroup.add(wall);
  });

  // Roof trusses (thin boxes spanning overhead)
  const trussGeo = new THREE.BoxGeometry(95, 0.3, 0.3);
  const trussMat = new THREE.MeshStandardMaterial({
    color: 0x2a3f5f,
    roughness: 0.5,
    metalness: 0.3,
  });
  [6, 0, -6].forEach((z) => {
    const truss = new THREE.Mesh(trussGeo, trussMat);
    truss.position.set(0, 7.8, z);
    truss.castShadow = true;
    state.envelopeGroup.add(truss);
  });

  // Back wall window band (emissive)
  const windowBandGeo = new THREE.BoxGeometry(88, 2, 0.2);
  const windowBandMat = new THREE.MeshStandardMaterial({
    color: 0x1e3a5f,
    emissive: 0x2a5f8f,
    emissiveIntensity: 0.15,
    roughness: 0.3,
    metalness: 0.1,
  });
  const windowBand = new THREE.Mesh(windowBandGeo, windowBandMat);
  windowBand.position.set(0, 5, 24.9);
  state.envelopeGroup.add(windowBand);

  // Overhead crane (bridge beam + trolley box, slow traverse)
  const bridgeGeo = new THREE.BoxGeometry(90, 0.4, 0.4);
  const bridgeMat = new THREE.MeshStandardMaterial({
    color: 0xf59e0b,
    roughness: 0.4,
    metalness: 0.4,
  });
  const bridge = new THREE.Mesh(bridgeGeo, bridgeMat);
  bridge.position.set(0, 7.5, 0);
  bridge.castShadow = true;
  state.envelopeGroup.add(bridge);

  const trolleyGeo = new THREE.BoxGeometry(2, 0.5, 1.5);
  const trolleyMat = new THREE.MeshStandardMaterial({
    color: 0xf59e0b,
    roughness: 0.5,
    metalness: 0.3,
  });
  const trolley = new THREE.Mesh(trolleyGeo, trolleyMat);
  trolley.position.set(0, 7.25, 0);
  trolley.castShadow = true;
  state.envelopeGroup.add(trolley);

  // Track crane motion in animate loop via this ref
  const trolleyRef = trolley;

  // Dispose a mesh's GPU resources. InstancedMesh keeps its instanceMatrix /
  // instanceColor buffers on the MESH (not the geometry), so geometry disposal
  // alone leaks them — InstancedMesh.dispose() releases those. setLines rebuilds
  // a fresh 1,200-instance mesh on every filter change + every dataMutated
  // recolor, so this runs often; leaking here is a real GPU-memory drain.
  const disposeMeshResources = (obj: THREE.Object3D): void => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry?.dispose();
      const mat = obj.material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
      if (obj instanceof THREE.InstancedMesh) obj.dispose();
    }
  };

  // --- Step 3: Raycast + pointer interaction ---

  const raycaster = new THREE.Raycaster();
  const raycasterNdc = new THREE.Vector2();

  const onPointerDown = (ev: PointerEvent) => {
    if (state.disposed) return;
    state.pointerDownPos = { x: ev.clientX, y: ev.clientY };
  };

  const onPointerUp = (ev: PointerEvent) => {
    if (state.disposed || !state.pointerDownPos) return;

    const dx = ev.clientX - state.pointerDownPos.x;
    const dy = ev.clientY - state.pointerDownPos.y;
    const dragDist = Math.sqrt(dx * dx + dy * dy);

    if (dragDist > 6) {
      // treated as drag, ignore
      state.pointerDownPos = null;
      return;
    }

    // Raycast for selection against per-machine bodies
    const rect = renderer.domElement.getBoundingClientRect();
    raycasterNdc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    raycasterNdc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(raycasterNdc, camera);
    const hits = raycaster.intersectObjects(state.pickTargets, false);

    if (hits.length > 0) {
      const hitMesh = hits[0].object as THREE.Mesh;
      const userData = hitMesh.userData as any;
      if (userData && userData.lineId && state.selectCb) {
        state.selectCb({
          lineId: userData.lineId,
          plantId: userData.plantId,
          lineName: userData.lineName,
          machineType: userData.machineType,
          riskBand: userData.riskBand,
        });
      }
    }

    state.pointerDownPos = null;
  };

  const setHover = (newHoveredId: string | null): void => {
    if (newHoveredId === state.hoveredMachineId) return;

    // Restore previous hover
    if (state.hoveredMachineId != null) {
      const prevMachine = state.lineIdToMachine.get(state.hoveredMachineId);
      if (prevMachine) {
        prevMachine.built.group.scale.set(1, 1, 1);
      }
    }

    // Apply new hover
    if (newHoveredId != null) {
      const newMachine = state.lineIdToMachine.get(newHoveredId);
      if (newMachine) {
        newMachine.built.group.scale.set(1.08, 1.08, 1.08);
      }
    }

    state.hoveredMachineId = newHoveredId;
    renderer.domElement.style.cursor = newHoveredId != null ? 'pointer' : 'default';
  };

  const onPointerMove = (ev: PointerEvent) => {
    if (state.disposed) return;

    const rect = renderer.domElement.getBoundingClientRect();
    raycasterNdc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    raycasterNdc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(raycasterNdc, camera);
    const hits = raycaster.intersectObjects(state.pickTargets, false);

    const newHoveredId = hits.length > 0 ? (hits[0].object.userData.lineId ?? null) : null;
    setHover(newHoveredId);
  };

  // Cursor leaving the canvas must clear the last hover.
  const onPointerLeave = () => {
    if (state.disposed) return;
    setHover(null);
  };

  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointerup', onPointerUp);
  renderer.domElement.addEventListener('pointermove', onPointerMove);
  renderer.domElement.addEventListener('pointerleave', onPointerLeave);

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

  // --- Animation loop helpers ---

  function stepPulse(t: number): void {
    // Crane slow ambient traverse
    trolleyRef.position.x = Math.sin(t * 0.3) * 30;

    // Animate each machine
    state.machines.forEach(({ built, phase }) => {
      built.animate(t, phase);
    });

    // Hero machine breathing pulse (skip if hovered)
    if (state.heroLineId && state.heroLineId !== state.hoveredMachineId) {
      const hero = state.lineIdToMachine.get(state.heroLineId);
      if (hero) {
        const pop = 1 + 0.06 * Math.sin(t * 4.5);
        pulseDummy.position.copy(hero.built.group.position);
        pulseDummy.scale.set(pop, pop, pop);
        pulseDummy.updateMatrix();
        // We don't use instanceMatrix anymore, so just skip this.
        // The hero breathing is handled via the group scale during render.
        hero.built.group.scale.set(pop, pop, pop);
      }
    }
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
    setPlant(model: PlantSceneModel): void {
      if (state.disposed) return;

      // Dispose previous plant (NOT the envelope)
      disposePlant();

      state.heroLineId = model.heroLineId;

      // Create new plant group
      state.plantGroup = new THREE.Group();
      scene.add(state.plantGroup);

      // Build neighborhood district floors + labels
      model.neighborhoods.forEach((nb) => {
        // District floor tint
        const districtFloorGeo = new THREE.BoxGeometry(nb.halfW * 2, 0.02, nb.halfD * 2);
        const districtFloorMat = new THREE.MeshStandardMaterial({
          color: 0x1a2b3b,
          roughness: 0.8,
          metalness: 0,
          transparent: true,
          opacity: 0.4,
        });
        const districtFloor = new THREE.Mesh(districtFloorGeo, districtFloorMat);
        districtFloor.position.set(nb.centerX, 0.02, nb.centerZ);
        districtFloor.receiveShadow = true;
        state.plantGroup!.add(districtFloor);

        // District label
        const labelDiv = document.createElement('div');
        labelDiv.textContent = nb.label.toUpperCase();
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
        labelObj.position.set(nb.centerX, 2.5, nb.centerZ - nb.halfD - 1);
        state.plantGroup!.add(labelObj);
        state.districtLabels.push(labelObj);
      });

      // Build machines
      model.machines.forEach((machineModel) => {
        const built = buildMachine(machineModel.machineType, {
          colorHex: machineModel.colorHex,
          emphasized: machineModel.emphasized,
          reducedMotion: state.reducedMotion,
        });

        built.group.position.set(machineModel.x, 0, machineModel.z);

        // Set body userData for raycast
        built.body.userData = {
          lineId: machineModel.lineId,
          plantId: model.plantId,
          lineName: machineModel.lineName,
          machineType: machineModel.machineType,
          riskBand: machineModel.riskBand,
        };

        state.plantGroup!.add(built.group);
        state.pickTargets.push(built.body);

        const phase = hashToPhase(machineModel.lineId);
        const instance = { lineId: machineModel.lineId, phase, built, model: machineModel };
        state.machines.push(instance);
        state.lineIdToMachine.set(machineModel.lineId, instance);
      });

      // Apply current risk filter
      if (state.activeRisk !== 'all') {
        state.machines.forEach(({ built, model: m }) => {
          setMachineDim(built, m.riskBand !== state.activeRisk);
        });
      }
    },

    focusLine(lineId: string): void {
      if (state.disposed) return;

      const machine = state.lineIdToMachine.get(lineId);
      if (!machine) return;

      state.heroLineId = lineId;

      const toP: [number, number, number] = [machine.model.x + 8, 8, machine.model.z + 12];
      const toT: [number, number, number] = [machine.model.x, 1, machine.model.z];

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

      // Show callout
      showCalloutFor(lineId);
    },

    onSelect(cb: (payload: SelectPayload) => void): void {
      if (state.disposed) return;
      state.selectCb = cb;
    },

    highlightRisk(band: RiskBand | 'all'): void {
      if (state.disposed) return;
      state.activeRisk = band;

      state.machines.forEach(({ built, model: m }) => {
        if (band === 'all') {
          setMachineDim(built, false);
        } else {
          setMachineDim(built, m.riskBand !== band);
        }
      });
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
      renderer.domElement.removeEventListener('pointerleave', onPointerLeave);

      controls.dispose();

      // Dispose current plant
      disposePlant();

      // Dispose envelope
      state.envelopeGroup.traverse(disposeMeshResources);

      // Clear scene
      while (state.scene.children.length > 0) {
        state.scene.remove(state.scene.children[0]);
      }

      // Dispose WebGL resources
      renderer.dispose();
      renderer.forceContextLoss();
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
