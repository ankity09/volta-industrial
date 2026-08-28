/**
 * Procedural Three.js machine builders for the Volta Plant Floor 3D.
 * 6 machine types, each with recognizable silhouette and one animated part.
 * Particles (emphasized machines only, !reducedMotion).
 * Pure Three.js, no React, no data binding — just geometry + animation.
 */

import * as THREE from 'three';
import type { MachineType } from './scene.types';

export interface BuiltMachine {
  group: THREE.Group;
  body: THREE.Mesh;
  animate(t: number, phase: number): void;
  dispose(): void;
}

export interface BuildMachineOpts {
  colorHex: number;
  emphasized: boolean;
  reducedMotion: boolean;
}

// ─────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────

function steelMat(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0x8a94a6,
    roughness: 0.5,
    metalness: 0.6,
  });
}

function accentMat(hex: number, emphasized: boolean): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: hex,
    emissive: hex,
    emissiveIntensity: emphasized ? 0.6 : 0.15,
    roughness: 0.4,
    metalness: 0.3,
  });
}

function track(
  disposables: (THREE.BufferGeometry | THREE.Material)[],
  geo: THREE.BufferGeometry | null,
  mat: THREE.Material | null
): void {
  if (geo) disposables.push(geo);
  if (mat) disposables.push(mat);
}

// ─────────────────────────────────────────────────────────────────────────
// Hydraulic Press
// ─────────────────────────────────────────────────────────────────────────

function buildPress(opts: BuildMachineOpts): BuiltMachine {
  const group = new THREE.Group();
  const disposables: (THREE.BufferGeometry | THREE.Material)[] = [];

  // Materials
  const steelM = steelMat();
  const accentM = accentMat(opts.colorHex, opts.emphasized);
  track(disposables, null, steelM);
  track(disposables, null, accentM);

  // H-frame: 2 vertical columns + top crown + bottom bolster
  const colGeo = new THREE.BoxGeometry(0.15, 2.2, 0.15);
  track(disposables, colGeo, null);

  const leftCol = new THREE.Mesh(colGeo, steelM);
  leftCol.position.set(-0.55, 1.1, 0);
  group.add(leftCol);

  const rightCol = new THREE.Mesh(colGeo, steelM);
  rightCol.position.set(0.55, 1.1, 0);
  group.add(rightCol);

  // Top crown (accent)
  const crownGeo = new THREE.BoxGeometry(1.3, 0.25, 0.25);
  track(disposables, crownGeo, null);
  const crown = new THREE.Mesh(crownGeo, accentM);
  crown.position.set(0, 2.3, 0);
  group.add(crown);

  // Bottom bolster
  const bolsterGeo = new THREE.BoxGeometry(1.4, 0.2, 0.3);
  track(disposables, bolsterGeo, null);
  const bolster = new THREE.Mesh(bolsterGeo, steelM);
  bolster.position.set(0, 0.1, 0);
  group.add(bolster);

  // Animated ram (between columns)
  const ramGeo = new THREE.BoxGeometry(0.8, 0.4, 0.3);
  track(disposables, ramGeo, null);
  const ram = new THREE.Mesh(ramGeo, accentM);
  ram.position.set(0, 1.2, 0);
  group.add(ram);

  const baseRamY = ram.position.y;
  const animate = (t: number, phase: number) => {
    if (opts.reducedMotion) return;
    const stroke = (opts.emphasized ? 0.5 : 0.18) * (0.5 - 0.5 * Math.cos(t * (opts.emphasized ? 6 : 2) + phase));
    ram.position.y = baseRamY - stroke;
  };

  return {
    group,
    body: crown,
    animate,
    dispose: () => {
      disposables.forEach((d) => d.dispose());
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Assembly Robot
// ─────────────────────────────────────────────────────────────────────────

function buildRobot(opts: BuildMachineOpts): BuiltMachine {
  const group = new THREE.Group();
  const disposables: (THREE.BufferGeometry | THREE.Material)[] = [];

  const steelM = steelMat();
  const accentM = accentMat(opts.colorHex, opts.emphasized);
  track(disposables, null, steelM);
  track(disposables, null, accentM);

  // Base cylinder
  const baseGeo = new THREE.CylinderGeometry(0.35, 0.4, 0.25, 16);
  track(disposables, baseGeo, null);
  const base = new THREE.Mesh(baseGeo, steelM);
  base.position.set(0, 0.125, 0);
  group.add(base);

  // Shoulder box
  const shoulderGeo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
  track(disposables, shoulderGeo, null);
  const shoulder = new THREE.Mesh(shoulderGeo, steelM);
  shoulder.position.set(0, 0.5, 0);
  group.add(shoulder);

  // Arm group (upper arm + forearm)
  const armGroup = new THREE.Group();
  armGroup.position.set(0, 0.5, 0);
  group.add(armGroup);

  // Upper arm
  const upperArmGeo = new THREE.BoxGeometry(0.15, 0.5, 0.15);
  track(disposables, upperArmGeo, null);
  const upperArm = new THREE.Mesh(upperArmGeo, accentM);
  upperArm.position.set(0.25, 0, 0);
  armGroup.add(upperArm);

  // Forearm
  const forearmGeo = new THREE.BoxGeometry(0.12, 0.4, 0.12);
  track(disposables, forearmGeo, null);
  const forearm = new THREE.Mesh(forearmGeo, accentM);
  forearm.position.set(0.35, -0.3, 0);
  armGroup.add(forearm);

  const animate = (t: number, phase: number) => {
    if (opts.reducedMotion) return;
    armGroup.rotation.y = Math.sin(t * (opts.emphasized ? 2.5 : 0.9) + phase) * 0.8;
    forearm.rotation.z = Math.sin(t * (opts.emphasized ? 1.5 : 0.5) + phase) * 0.3;
  };

  return {
    group,
    body: base,
    animate,
    dispose: () => {
      disposables.forEach((d) => d.dispose());
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Welding Cell
// ─────────────────────────────────────────────────────────────────────────

function buildWeldCell(opts: BuildMachineOpts): BuiltMachine {
  const group = new THREE.Group();
  const disposables: (THREE.BufferGeometry | THREE.Material)[] = [];

  const steelM = steelMat();
  const accentM = accentMat(opts.colorHex, opts.emphasized);
  track(disposables, null, steelM);
  track(disposables, null, accentM);

  // Frame: 4 corner struts
  const strutGeo = new THREE.BoxGeometry(0.08, 1.8, 0.08);
  track(disposables, strutGeo, null);

  const corners = [
    { x: -0.5, z: -0.5 },
    { x: 0.5, z: -0.5 },
    { x: -0.5, z: 0.5 },
    { x: 0.5, z: 0.5 },
  ];

  corners.forEach(({ x, z }) => {
    const strut = new THREE.Mesh(strutGeo, steelM);
    strut.position.set(x, 0.9, z);
    group.add(strut);
  });

  // Top rails (accent)
  const railGeo = new THREE.BoxGeometry(1.2, 0.1, 1.2);
  track(disposables, railGeo, null);
  const topRail = new THREE.Mesh(railGeo, accentM);
  topRail.position.set(0, 1.8, 0);
  group.add(topRail);

  // Torch tip (small cone) on an arm
  const torchArmGeo = new THREE.BoxGeometry(0.08, 0.08, 0.4);
  track(disposables, torchArmGeo, null);
  const torchArm = new THREE.Mesh(torchArmGeo, steelM);
  torchArm.position.set(0, 1.5, 0.5);
  group.add(torchArm);

  const torchTipGeo = new THREE.ConeGeometry(0.06, 0.2, 8);
  track(disposables, torchTipGeo, null);
  const torchTip = new THREE.Mesh(torchTipGeo, accentM);
  torchTip.position.set(0, 1.35, 0.75);
  torchTip.rotation.z = Math.PI / 2;
  group.add(torchTip);

  // Particle system: spark points (only if emphasized && !reducedMotion)
  let sparkPoints: THREE.Points | null = null;
  let sparkPositions: Float32Array | null = null;
  let sparkVelocities: THREE.Vector3[] | null = null;

  if (opts.emphasized && !opts.reducedMotion) {
    const sparkCount = 30;
    sparkPositions = new Float32Array(sparkCount * 3);
    sparkVelocities = Array.from({ length: sparkCount }, () => new THREE.Vector3());

    // Initialize spark positions around torch tip
    for (let i = 0; i < sparkCount; i++) {
      sparkPositions[i * 3] = 0;
      sparkPositions[i * 3 + 1] = 1.35;
      sparkPositions[i * 3 + 2] = 0.75;
    }

    const sparkGeo = new THREE.BufferGeometry();
    sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPositions, 3));
    track(disposables, sparkGeo, null);

    const sparkMat = new THREE.PointsMaterial({
      color: 0xffd27f,
      size: 0.04,
      sizeAttenuation: true,
      toneMapped: false,
    });
    track(disposables, null, sparkMat);

    sparkPoints = new THREE.Points(sparkGeo, sparkMat);
    group.add(sparkPoints);
  }

  // Light for accent (only if emphasized && !reducedMotion)
  let torchLight: THREE.PointLight | null = null;
  if (opts.emphasized && !opts.reducedMotion) {
    torchLight = new THREE.PointLight(0x66ccff, 0.5, 4);
    torchLight.position.set(0, 1.35, 0.75);
    group.add(torchLight);
  }

  let lightIntensity = 0.5;
  const animate = (_t: number, _phase: number) => {
    if (opts.reducedMotion) return;

    // Flicker light
    if (torchLight) {
      lightIntensity = 0.3 + Math.random() * 0.4;
      torchLight.intensity = lightIntensity;
    }

    // Jitter spark points
    if (sparkPoints && sparkPositions && sparkVelocities) {
      const posAttr = sparkPoints.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < sparkVelocities.length; i++) {
        const idx = i * 3;
        // Random walk outward from torch
        sparkVelocities[i].randomDirection().multiplyScalar(0.1);
        sparkPositions[idx] += sparkVelocities[i].x;
        sparkPositions[idx + 1] += sparkVelocities[i].y;
        sparkPositions[idx + 2] += sparkVelocities[i].z;

        // Reset if too far
        const dx = sparkPositions[idx];
        const dy = sparkPositions[idx + 1] - 1.35;
        const dz = sparkPositions[idx + 2] - 0.75;
        if (dx * dx + dy * dy + dz * dz > 0.25) {
          sparkPositions[idx] = 0;
          sparkPositions[idx + 1] = 1.35;
          sparkPositions[idx + 2] = 0.75;
        }
      }
      posAttr.needsUpdate = true;
    }
  };

  return {
    group,
    body: topRail,
    animate,
    dispose: () => {
      disposables.forEach((d) => d.dispose());
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// CNC Mill
// ─────────────────────────────────────────────────────────────────────────

function buildCnc(opts: BuildMachineOpts): BuiltMachine {
  const group = new THREE.Group();
  const disposables: (THREE.BufferGeometry | THREE.Material)[] = [];

  const steelM = steelMat();
  const accentM = accentMat(opts.colorHex, opts.emphasized);
  track(disposables, null, steelM);
  track(disposables, null, accentM);

  // Enclosure box
  const enclosureGeo = new THREE.BoxGeometry(0.9, 1.4, 0.7);
  track(disposables, enclosureGeo, null);
  const enclosure = new THREE.Mesh(enclosureGeo, steelM);
  enclosure.position.set(0, 0.7, 0);
  group.add(enclosure);

  // Front window panel (emissive accent)
  const windowGeo = new THREE.BoxGeometry(0.7, 0.8, 0.05);
  track(disposables, windowGeo, null);
  const window = new THREE.Mesh(windowGeo, accentM);
  window.position.set(0, 0.8, 0.35);
  group.add(window);

  // Spindle (cylinder inside, rotates)
  const spindleGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.6, 16);
  track(disposables, spindleGeo, null);
  const spindle = new THREE.Mesh(spindleGeo, accentM);
  spindle.position.set(0, 0.5, 0);
  spindle.rotation.z = Math.PI / 2; // horizontal
  group.add(spindle);

  // Particle system: coolant mist (only if emphasized && !reducedMotion)
  let mistPoints: THREE.Points | null = null;
  let mistPositions: Float32Array | null = null;

  if (opts.emphasized && !opts.reducedMotion) {
    const mistCount = 25;
    mistPositions = new Float32Array(mistCount * 3);

    for (let i = 0; i < mistCount; i++) {
      mistPositions[i * 3] = (Math.random() - 0.5) * 0.3;
      mistPositions[i * 3 + 1] = 0.5 + (Math.random() - 0.5) * 0.2;
      mistPositions[i * 3 + 2] = (Math.random() - 0.5) * 0.2;
    }

    const mistGeo = new THREE.BufferGeometry();
    mistGeo.setAttribute('position', new THREE.BufferAttribute(mistPositions, 3));
    track(disposables, mistGeo, null);

    const mistMat = new THREE.PointsMaterial({
      color: 0xc0d9ff,
      size: 0.03,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.4,
      toneMapped: false,
    });
    track(disposables, null, mistMat);

    mistPoints = new THREE.Points(mistGeo, mistMat);
    group.add(mistPoints);
  }

  const animate = (t: number, _phase: number) => {
    if (opts.reducedMotion) return;
    spindle.rotation.y = t * (opts.emphasized ? 12 : 5);

    // Subtle mist drift
    if (mistPoints && mistPositions) {
      const posAttr = mistPoints.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < mistPositions.length / 3; i++) {
        mistPositions[i * 3] += Math.sin(t * 0.5 + i) * 0.001;
        mistPositions[i * 3 + 1] += Math.cos(t * 0.3 + i) * 0.001;
      }
      posAttr.needsUpdate = true;
    }
  };

  return {
    group,
    body: enclosure,
    animate,
    dispose: () => {
      disposables.forEach((d) => d.dispose());
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Grinder
// ─────────────────────────────────────────────────────────────────────────

function buildGrinder(opts: BuildMachineOpts): BuiltMachine {
  const group = new THREE.Group();
  const disposables: (THREE.BufferGeometry | THREE.Material)[] = [];

  const steelM = steelMat();
  const accentM = accentMat(opts.colorHex, opts.emphasized);
  track(disposables, null, steelM);
  track(disposables, null, accentM);

  // Housing (squat, wide)
  const housingGeo = new THREE.BoxGeometry(1.2, 0.9, 0.7);
  track(disposables, housingGeo, null);
  const housing = new THREE.Mesh(housingGeo, steelM);
  housing.position.set(0, 0.45, 0);
  group.add(housing);

  // Grinding wheel (thin cylinder, spins on horizontal axis)
  const wheelGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.08, 32);
  track(disposables, wheelGeo, null);
  const wheel = new THREE.Mesh(wheelGeo, accentM);
  wheel.position.set(0.3, 0.5, 0);
  wheel.rotation.z = Math.PI / 2; // horizontal spin
  group.add(wheel);

  // Particle system: spark stream (only if emphasized && !reducedMotion)
  let sparkStream: THREE.Points | null = null;
  let sparkStreamPos: Float32Array | null = null;
  let sparkStreamVel: THREE.Vector3[] | null = null;

  if (opts.emphasized && !opts.reducedMotion) {
    const sparkCount = 40;
    sparkStreamPos = new Float32Array(sparkCount * 3);
    sparkStreamVel = Array.from({ length: sparkCount }, () => new THREE.Vector3());

    for (let i = 0; i < sparkCount; i++) {
      sparkStreamPos[i * 3] = 0.3;
      sparkStreamPos[i * 3 + 1] = 0.5;
      sparkStreamPos[i * 3 + 2] = 0;
    }

    const sparkStreamGeo = new THREE.BufferGeometry();
    sparkStreamGeo.setAttribute('position', new THREE.BufferAttribute(sparkStreamPos, 3));
    track(disposables, sparkStreamGeo, null);

    const sparkStreamMat = new THREE.PointsMaterial({
      color: 0xff9944,
      size: 0.035,
      sizeAttenuation: true,
      toneMapped: false,
    });
    track(disposables, null, sparkStreamMat);

    sparkStream = new THREE.Points(sparkStreamGeo, sparkStreamMat);
    group.add(sparkStream);
  }

  const animate = (t: number, _phase: number) => {
    if (opts.reducedMotion) return;
    wheel.rotation.x = t * (opts.emphasized ? 18 : 8);

    // Spark stream ejection
    if (sparkStream && sparkStreamPos && sparkStreamVel) {
      const posAttr = sparkStream.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < sparkStreamVel.length; i++) {
        const idx = i * 3;
        // Radial ejection
        const angle = (i / sparkStreamVel.length) * Math.PI * 2 + t;
        sparkStreamVel[i].set(Math.cos(angle) * 0.08, Math.sin(angle) * 0.08, (Math.random() - 0.5) * 0.03);
        sparkStreamPos[idx] += sparkStreamVel[i].x;
        sparkStreamPos[idx + 1] += sparkStreamVel[i].y;
        sparkStreamPos[idx + 2] += sparkStreamVel[i].z;

        // Gravity + reset
        sparkStreamPos[idx + 1] -= 0.01;
        const dist = Math.sqrt(
          Math.pow(sparkStreamPos[idx] - 0.3, 2) + Math.pow(sparkStreamPos[idx + 1] - 0.5, 2) + Math.pow(sparkStreamPos[idx + 2], 2)
        );
        if (dist > 0.3) {
          sparkStreamPos[idx] = 0.3;
          sparkStreamPos[idx + 1] = 0.9;
          sparkStreamPos[idx + 2] = 0;
        }
      }
      posAttr.needsUpdate = true;
    }
  };

  return {
    group,
    body: housing,
    animate,
    dispose: () => {
      disposables.forEach((d) => d.dispose());
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Injection Molder
// ─────────────────────────────────────────────────────────────────────────

function buildMolder(opts: BuildMachineOpts): BuiltMachine {
  const group = new THREE.Group();
  const disposables: (THREE.BufferGeometry | THREE.Material)[] = [];

  const steelM = steelMat();
  const accentM = accentMat(opts.colorHex, opts.emphasized);
  track(disposables, null, steelM);
  track(disposables, null, accentM);

  // Base clamp frame
  const baseGeo = new THREE.BoxGeometry(1.0, 0.2, 0.5);
  track(disposables, baseGeo, null);
  const base = new THREE.Mesh(baseGeo, steelM);
  base.position.set(0, 0.1, 0);
  group.add(base);

  // Moving platen A (left)
  const platenGeo = new THREE.BoxGeometry(0.4, 0.6, 0.5);
  track(disposables, platenGeo, null);
  const platenA = new THREE.Mesh(platenGeo, accentM);
  platenA.position.set(-0.3, 0.5, 0);
  group.add(platenA);

  // Moving platen B (right)
  const platenB = new THREE.Mesh(platenGeo, accentM);
  platenB.position.set(0.3, 0.5, 0);
  group.add(platenB);

  // Barrel cylinder (feed inlet)
  const barrelGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.8, 16);
  track(disposables, barrelGeo, null);
  const barrel = new THREE.Mesh(barrelGeo, steelM);
  barrel.position.set(0, 0.6, -0.3);
  barrel.rotation.z = Math.PI / 2;
  group.add(barrel);

  const basePlatenAX = platenA.position.x;
  const basePlatenBX = platenB.position.x;

  const animate = (t: number, phase: number) => {
    if (opts.reducedMotion) return;
    const clampCycle = Math.cos(t * (opts.emphasized ? 3 : 1) + phase);
    const opening = 0.15 * (0.5 - 0.5 * clampCycle); // clamp opens/closes
    platenA.position.x = basePlatenAX - opening;
    platenB.position.x = basePlatenBX + opening;
  };

  return {
    group,
    body: base,
    animate,
    dispose: () => {
      disposables.forEach((d) => d.dispose());
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────

export function buildMachine(type: MachineType, opts: BuildMachineOpts): BuiltMachine {
  switch (type) {
    case 'Hydraulic_Press':
      return buildPress(opts);
    case 'Assembly_Robot':
      return buildRobot(opts);
    case 'Welding_Cell':
      return buildWeldCell(opts);
    case 'CNC_Mill':
      return buildCnc(opts);
    case 'Grinder':
      return buildGrinder(opts);
    case 'Injection_Molder':
      return buildMolder(opts);
  }
}
