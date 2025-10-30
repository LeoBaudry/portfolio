<script>
  import { onMount } from 'svelte';
  import * as THREE from 'three';
  import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
  import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

  let canvas; 
  let container; 

  onMount(() => {
    if (!canvas || !container) return;

    // la scène
    const scene = new THREE.Scene();

    // tailles
    const size = {
      width: container.clientWidth,
      height: container.clientHeight
    };

    // caméra
    const camera = new THREE.PerspectiveCamera(75, size.width / size.height, 0.1, 100);

    camera.position.z = 1; 
    scene.add(camera);

    // lumières (3points)
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.2); 
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.5); 
    directionalLight.position.set(3, 3, 3);
    scene.add(directionalLight);

    const fillLight = new THREE.DirectionalLight(0xffffff, 0.8); 
    fillLight.position.set(-3, -2, 2);
    scene.add(fillLight);

    // modèle 3D
    const gltfLoader = new GLTFLoader();
    gltfLoader.load(
      '/models/logo3D.glb',
      (gltf) => {
        // centrer le modèle
        new THREE.Box3().setFromObject(gltf.scene).getCenter(gltf.scene.position).multiplyScalar(-1);
        scene.add(gltf.scene);
      },
      undefined,
      (error) => {
        console.error('Erreur lors du chargement du modèle 3D', error);
      }
    );

    // renderer
    const renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      antialias: true,
      alpha: true 
    });
    renderer.setSize(size.width, size.height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // contrôles (pour rotation)
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; // Effet de "lissage"
    controls.enableZoom = false; // Pas de zoom
    controls.enablePan = false; // Pas de déplacement
    controls.autoRotate = true; // Rotation auto
    controls.autoRotateSpeed = 1.0; // Vitesse de rotation

    // boucle d'animation
    const tick = () => {
      controls.update(); 
      renderer.render(scene, camera);
      window.requestAnimationFrame(tick);
    };
    tick();

    // redimensionnement
    const resizeObserver = new ResizeObserver(() => {
      size.width = container.clientWidth;
      size.height = container.clientHeight;

      camera.aspect = size.width / size.height;
      camera.updateProjectionMatrix();

      renderer.setSize(size.width, size.height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    });
    resizeObserver.observe(container);

    // nettoyage
    return () => {
      resizeObserver.disconnect();
      renderer.dispose();
    };
  });
</script>

<div bind:this={container} class="w-full h-full">
  <canvas bind:this={canvas}></canvas>
</div>