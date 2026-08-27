import React, { useEffect, useRef, useMemo, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { LineStatus, RISK_BAND_HEX } from './types';
import { usePlantFloorScene } from './usePlantFloorScene';

interface PlantFloor3DProps {
  lines: LineStatus[];
  onSelectLine?: (lineId: string) => void;
  heroLineId?: string;
}

export const PlantFloor3D: React.FC<PlantFloor3DProps> = ({
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
    lineMeshes: Map<string, THREE.Mesh>;
    dispose: () => void;
  } | null>(null);

  const lineColorMap = useMemo(() => {
    const map = new Map<string, number>();
    lines.forEach((line) => {
      map.set(line.lineId, RISK_BAND_HEX[line.riskBand]);
    });
    return map;
  }, [lines]);

  const initScene = useCallback(() => {
    if (!containerRef.current || sceneRef.current) return;

    const w = containerRef.current.clientWidth;
    const h = containerRef.current.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0f1c);
    scene.fog = new THREE.Fog(0x0a0f1c, 80, 300);

    const camera = new THREE.PerspectiveCamera(75, w / h, 0.1, 1000);
    camera.position.set(40, 50, 60);
    camera.lookAt(0, 0, -10);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(w, h);
    renderer.setPixelRatio(window.devicePixelRatio);
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
      1.2,
      0.4,
      0.85
    );
    composer.addPass(bloomPass);

    setupLighting(scene);
    setupEnvironment(scene);

    const lineMeshes = new Map<string, THREE.Mesh>();
    sceneRef.current = {
      scene,
      camera,
      renderer,
      controls,
      composer,
      lineMeshes,
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

    window.addEventListener('resize', handleResize);

    const animate = () => {
      requestAnimationFrame(animate);
      controls.update();
      composer.render();
    };

    animate();

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

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
    if (!sceneRef.current) return;

    const { scene, lineMeshes } = sceneRef.current;

    lineMeshes.forEach((mesh) => {
      scene.remove(mesh);
      mesh.geometry.dispose();
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((m) => m.dispose());
      } else {
        mesh.material.dispose();
      }
    });
    lineMeshes.clear();

    lines.forEach((line, idx) => {
      const x = idx * 7;
      const z = -10;
      const y = 0;

      const color = RISK_BAND_HEX[line.riskBand];
      const geometry = new THREE.BoxGeometry(5, 6, 4);
      const material = new THREE.MeshStandardMaterial({
        color,
        metalness: 0.75,
        roughness: 0.25,
        emissive: color,
        emissiveIntensity: line.riskBand === 'critical' ? 0.8 : line.riskBand === 'elevated' || line.riskBand === 'watch' ? 0.4 : 0.1,
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.lineId = line.lineId;
      mesh.userData.lineName = line.lineName;

      scene.add(mesh);
      lineMeshes.set(line.lineId, mesh);

      if (line.riskBand === 'critical' || line.riskBand === 'elevated' || line.riskBand === 'watch') {
        const glowGeometry = new THREE.BoxGeometry(5.2, 6.2, 4.2);
        const glowMaterial = new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.15,
        });
        const glowMesh = new THREE.Mesh(glowGeometry, glowMaterial);
        glowMesh.position.copy(mesh.position);
        glowMesh.position.z -= 0.1;
        scene.add(glowMesh);
      }
    });
  }, [lines]);

  return <div ref={containerRef} className="w-full h-full bg-gradient-to-br from-slate-900 to-slate-950 rounded-lg overflow-hidden" />;
};

function setupLighting(scene: THREE.Scene) {
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
  directionalLight.position.set(50, 60, 40);
  directionalLight.castShadow = true;
  directionalLight.shadow.mapSize.width = 2048;
  directionalLight.shadow.mapSize.height = 2048;
  directionalLight.shadow.camera.far = 500;
  directionalLight.shadow.camera.left = -100;
  directionalLight.shadow.camera.right = 100;
  directionalLight.shadow.camera.top = 100;
  directionalLight.shadow.camera.bottom = -100;
  scene.add(directionalLight);

  const accentLight = new THREE.PointLight(0xffb020, 0.6, 100);
  accentLight.position.set(30, 20, -30);
  scene.add(accentLight);
}

function setupEnvironment(scene: THREE.Scene) {
  const floorGeometry = new THREE.PlaneGeometry(200, 200);
  const floorMaterial = new THREE.MeshStandardMaterial({
    color: 0x1a1f2e,
    metalness: 0.3,
    roughness: 0.8,
  });
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -5;
  floor.receiveShadow = true;
  scene.add(floor);

  const gridHelper = new THREE.GridHelper(200, 40, 0x2a3a52, 0x1a2a3a);
  gridHelper.position.y = -4.9;
  scene.add(gridHelper);
}
