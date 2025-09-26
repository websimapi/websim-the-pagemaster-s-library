import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { DrippingPaintEffect } from './DrippingPaintEffect.js';

let scene, camera, renderer, controls;
let moveForward = false, moveBackward = false, moveLeft = false, moveRight = false;
const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();
const clock = new THREE.Clock();

let drippingEffect;
let effectTriggered = false;

async function init() {
    // Scene
    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x000000, 0, 100);

    // Camera
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 2, 18);

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    document.body.appendChild(renderer.domElement);

    // Controls
    controls = new PointerLockControls(camera, document.body);
    const instructions = document.getElementById('instructions');
    instructions.addEventListener('click', () => {
        controls.lock();
    });
    controls.addEventListener('lock', () => {
        instructions.style.display = 'none';
    });
    controls.addEventListener('unlock', () => {
        instructions.style.display = 'block';
    });
    scene.add(controls.getObject());

    // Lighting
    const ambientLight = new THREE.AmbientLight(0x404040, 2);
    scene.add(ambientLight);

    const centralLight = new THREE.PointLight(0xffffff, 1.5, 150);
    centralLight.position.set(0, 30, 0);
    scene.add(centralLight);
    
    // Textures
    const textureLoader = new THREE.TextureLoader();
    const loadingManager = new THREE.LoadingManager(() => {
        const loadingScreen = document.getElementById('loading');
        loadingScreen.style.display = 'none';
        instructions.style.display = 'block';
    });
    const loader = new THREE.TextureLoader(loadingManager);

    const bookshelfTexture = loader.load('bookshelf_texture.png');
    bookshelfTexture.wrapS = bookshelfTexture.wrapT = THREE.RepeatWrapping;
    bookshelfTexture.repeat.set(16, 2);

    const floorTexture = loader.load('marble_floor.png');
    floorTexture.wrapS = floorTexture.wrapT = THREE.RepeatWrapping;
    floorTexture.repeat.set(8, 8);

    const ceilingTexture = loader.load('ceiling_fresco.png', (texture) => {
        // Dripping Paint Effect is created here, after the texture has loaded.
        drippingEffect = new DrippingPaintEffect(scene, texture);
    });

    // Library Geometry
    // Floor
    const floorGeometry = new THREE.CircleGeometry(30, 64);
    const floorMaterial = new THREE.MeshStandardMaterial({ map: floorTexture });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    // Walls
    const wallGeometry = new THREE.CylinderGeometry(30, 30, 50, 64, 1, true);
    const wallMaterial = new THREE.MeshStandardMaterial({ map: bookshelfTexture, side: THREE.BackSide });
    const walls = new THREE.Mesh(wallGeometry, wallMaterial);
    walls.position.y = 25;
    scene.add(walls);

    // Ceiling
    const ceilingGeometry = new THREE.SphereGeometry(30, 64, 32, 0, Math.PI * 2, 0, Math.PI / 2);
    const ceilingMaterial = new THREE.MeshStandardMaterial({ 
        map: ceilingTexture, 
        side: THREE.BackSide,
        emissive: 0x111111,
        emissiveMap: ceilingTexture,
    });
    const ceiling = new THREE.Mesh(ceilingGeometry, ceilingMaterial);
    ceiling.position.y = 25;
    scene.add(ceiling);

    // Event Listeners
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    window.addEventListener('resize', onWindowResize);

    animate();
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function onKeyDown(event) {
    switch (event.code) {
        case 'ArrowUp':
        case 'KeyW':
            moveForward = true;
            break;
        case 'ArrowLeft':
        case 'KeyA':
            moveLeft = true;
            break;
        case 'ArrowDown':
        case 'KeyS':
            moveBackward = true;
            break;
        case 'ArrowRight':
        case 'KeyD':
            moveRight = true;
            break;
    }
}

function onKeyUp(event) {
    switch (event.code) {
        case 'ArrowUp':
        case 'KeyW':
            moveForward = false;
            break;
        case 'ArrowLeft':
        case 'KeyA':
            moveLeft = false;
            break;
        case 'ArrowDown':
        case 'KeyS':
            moveBackward = false;
            break;
        case 'ArrowRight':
        case 'KeyD':
            moveRight = false;
            break;
    }
}

function checkTrigger() {
    if (effectTriggered || !drippingEffect) return;

    const playerPosition = controls.getObject().position;
    const distanceToCenter = playerPosition.distanceTo(new THREE.Vector3(0, playerPosition.y, 0));

    // Get camera direction
    const cameraDirection = new THREE.Vector3(0, 0, -1);
    cameraDirection.applyQuaternion(camera.quaternion);

    const lookingUp = cameraDirection.y > 0.85; 

    if (distanceToCenter < 5 && lookingUp) {
        effectTriggered = true;
        drippingEffect.start();
    }
}

function animate() {
    requestAnimationFrame(animate);

    const delta = clock.getDelta();

    if (controls.isLocked) {
        velocity.x -= velocity.x * 10.0 * delta;
        velocity.z -= velocity.z * 10.0 * delta;

        direction.z = Number(moveForward) - Number(moveBackward);
        direction.x = Number(moveRight) - Number(moveLeft);
        direction.normalize(); // this ensures consistent movements in all directions

        if (moveForward || moveBackward) velocity.z -= direction.z * 40.0 * delta;
        if (moveLeft || moveRight) velocity.x -= direction.x * 40.0 * delta;

        controls.moveRight(-velocity.x * delta);
        controls.moveForward(-velocity.z * delta);

        // Keep player on the floor
        controls.getObject().position.y = 2;

        checkTrigger();
    }
    
    if (drippingEffect) {
        drippingEffect.update(delta);
    }

    renderer.render(scene, camera);
}

init();