import React, { useEffect, useRef, useMemo, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { LineStatus, RISK_BAND_HEX } from './types';

interface PlantFloor3DPerformantProps {
  lines: LineStatus[];
  onSelectLine?: (lineId: string) => void;
  heroLineId?: string;
}

export const PlantFloor3DPerformant: React.FC<PlantFloor3DPerformantProps> = ({
  lines,
  onSelectLine,
  heroLineId = 'LINE-04',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    controls: OrbitControls;
    composer: EffectComposer;
    instancedMesh: THREE.InstancedMesh | null;
    raycaster: THREE.Raycaster;
    mouse: THREE.Vector2;
    dispose: () => void;
  } | null>(null);

  const healthyCount = useMemo(() => {
    return lines.filter((l) => l.riskBand === 'healthy').length;
  }, [lines]);

  const atRiskLines = useMemo(() => {
    return lines.filter((l) => l.riskBand !== 'healthy');
  }, [lines]);

  const initScene = useCallback(() => {
    if (!containerRef.current || sceneRef.current) return;

    const w = containerRef.current.clientWidth;
    const h = containerRef.current.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0f1c);
    scene.fog = new THREE.Fog(0x0a0f1c, 150, 400);

    const camera = new THREE.PerspectiveCamera(75, w / h, 0.1, 1000);
    camera.position.set(50, 70, 80);
    camera.lookAt(0, 10, -50);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowShadowMap;
    containerRef.current.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.autoRotate = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.enablePan = true;
    controls.enableZoom = true;

    const composer = new EffectComposer(renderer);
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);

    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(w, h),
      1.0,
      0.4,
      0.85
    );
    composer.addPass(bloomPass);

    setupLighting(scene);
    setupEnvironment(scene);

    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    sceneRef.current = {
      scene,
      camera,
      renderer,
      controls,
      composer,
      instancedMesh: null,
      raycaster,
      mouse,
      dispose: () => {
        renderer.dispose();
        composer.dispose();
        controls.dispose();
      },
    };

    const handleResize = () => {
      const newW = containerRef.current?.clientWidth || w;
      const newH = containerRef.current?.clientHeight || h;
      camera.aspect = newW / newH;
      camera.updateProjectionMatrix();
      renderer.setSize(newW, newH);
      composer.setSize(newW, newH);
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    };

    const handleClick = (e: MouseEvent) => {
      if (!sceneRef.current) return;
      raycaster.setFromCamera(mouse, camera);

      const instancedMesh = sceneRef.current.instancedMesh;
      if (instancedMesh) {
        const intersects = raycaster.intersectObject(instancedMesh);
        if (intersects.length > 0) {
          const index = intersects[0].instanceId;
          if (index !== undefined && index < lines.length) {
            onSelectLine?.(lines[index].lineId);
          }
        }
      }
    };

    window.addEventListener('resize', handleResize);
    renderer.domElement.addEventListener('mousemove', handleMouseMove);
    renderer.domElement.addEventListener('click', handleClick);

    const animate = () => {
      requestAnimationFrame(animate);
      controls.update();
      composer.render();
    };

    animate();

    return () => {
      window.removeEventListener('resize', handleResize);
      renderer.domElement.removeEventListener('mousemove', handleMouseMove);
      renderer.domElement.removeEventListener('click', handleClick);
    };
  }, [lines, onSelectLine]);

  useEffect(() => {
    const cleanup = initScene();
    return () => {
      cleanup?.();
      if (sceneRef.current) {
        sceneRef.current.dispose();
        if (sceneRef.current.renderer.domElement.parentNode === containerRef.current) {
          containerRef.current?.removeChild(sceneRef.current.renderer.domElement);
        }
        sceneRef.current = null;
      }
    };
  }, [initScene]);

  useEffect(() => {
    if (!sceneRef.current || lines.length === 0) return;

    const { scene, instancedMesh: oldInstancedMesh } = sceneRef.current;

    if (oldInstancedMesh) {
      scene.remove(oldInstancedMesh);
      oldInstancedMesh.geometry.dispose();
      oldInstancedMesh.material.dispose();
    }

    const box = new THREE.BoxGeometry(4.5, 5.5, 3.5);
    const material = new THREE.MeshStandardMaterial({
      metalness: 0.75,
      roughness: 0.25,
    });

    const instancedMesh = new THREE.InstancedMesh(box, material, lines.length);
    instancedMesh.castShadow = true;
    instancedMesh.receiveShadow = true;

    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();

    lines.forEach((line, idx) => {
      const gridWidth = Math.ceil(Math.sqrt(lines.length / 10));
      const col = idx % gridWidth;
      const row = Math.floor(idx / gridWidth);
      const depth = Math.floor(idx / (gridWidth * 10));

      const x = col * 6.5 - (gridWidth * 6.5) / 2;
      const y = 0;
      const z = -depth * 8;

      matrix.setPosition(x, y, z);
      instancedMesh.setMatrixAt(idx, matrix);

      const hexColor = RISK_BAND_HEX[line.riskBand];
      color.setHex(hexColor);
      instancedMesh.setColorAt(idx, color);
    });

    instancedMesh.instanceColor!.needsUpdate = true;
    scene.add(instancedMesh);

    if (sceneRef.current) {
      sceneRef.current.instancedMesh = instancedMesh;
    }
  }, [lines]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 rounded-lg overflow-hidden cursor-pointer"
      style={{
        background: 'radial-gradient(circle at 50% 20%, #12171f, #090b10 75%)',
      }}
    />
  );
};

function setupLighting(scene: THREE.Scene) {
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
  directionalLight.position.set(80, 100, 60);
  directionalLight.castShadow = true;
  directionalLight.shadow.mapSize.width = 2048;
  directionalLight.shadow.mapSize.height = 2048;
  directionalLight.shadow.camera.far = 500;
  directionalLight.shadow.camera.left = -200;
  directionalLight.shadow.camera.right = 200;
  directionalLight.shadow.camera.top = 200;
  directionalLight.shadow.camera.bottom = -200;
  scene.add(directionalLight);

  const accentLight1 = new THREE.PointLight(0xffb020, 0.5, 150);
  accentLight1.position.set(60, 40, -60);
  scene.add(accentLight1);

  const accentLight2 = new THREE.PointLight(0x4aa8ff, 0.3, 100);
  accentLight2.position.set(-60, 30, 0);
  scene.add(accentLight2);
}

function setupEnvironment(scene: THREE.Scene) {
  const floorGeometry = new THREE.PlaneGeometry(400, 400);
  const floorMaterial = new THREE.MeshStandardMaterial({
    color: 0x1a1f2e,
    metalness: 0.2,
    roughness: 0.9,
  });
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -3;
  floor.receiveShadow = true;
  scene.add(floor);

  const gridHelper = new THREE.GridHelper(400, 60, 0x2a3a52, 0x1a2a3a);
  gridHelper.position.y = -2.9;
  scene.add(gridHelper);

  const wallGeometry = new THREE.PlaneGeometry(400, 200);
  const wallMaterial = new THREE.MeshStandardMaterial({
    color: 0x0f1419,
    metalness: 0.1,
    roughness: 0.95,
    side: THREE.BackSide,
  });

  const backWall = new THREE.Mesh(wallGeometry, wallMaterial);
  backWall.position.set(0, 95, -200);
  scene.add(backWall);
}
