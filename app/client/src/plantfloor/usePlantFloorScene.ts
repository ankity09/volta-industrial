import { useCallback } from 'react';
import * as THREE from 'three';
import { LineStatus } from './types';

interface SceneContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  lineMeshes: Map<string, THREE.Mesh>;
}

export function usePlantFloorScene() {
  const updateLineColor = useCallback((context: SceneContext, lineId: string, color: number) => {
    const mesh = context.lineMeshes.get(lineId);
    if (mesh && mesh.material instanceof THREE.MeshStandardMaterial) {
      mesh.material.color.setHex(color);
      mesh.material.emissive.setHex(color);
    }
  }, []);

  const focusLine = useCallback((context: SceneContext, lineId: string) => {
    const mesh = context.lineMeshes.get(lineId);
    if (mesh) {
      const camera = context.camera;
      const targetPos = mesh.position.clone();
      targetPos.x += 15;
      targetPos.y += 20;
      targetPos.z += 25;

      camera.position.lerp(targetPos, 0.1);
      camera.lookAt(mesh.position);
    }
  }, []);

  const resetCamera = useCallback((context: SceneContext) => {
    const camera = context.camera;
    camera.position.lerp(new THREE.Vector3(40, 50, 60), 0.1);
    camera.lookAt(0, 0, -10);
  }, []);

  return {
    updateLineColor,
    focusLine,
    resetCamera,
  };
}
