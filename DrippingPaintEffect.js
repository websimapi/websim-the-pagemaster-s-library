import * as THREE from 'three';

const vertexShader = `
  attribute float size;
  attribute vec3 customColor;
  attribute float alpha;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vColor = customColor;
    vAlpha = alpha;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * (200.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const fragmentShader = `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    if (length(gl_PointCoord - vec2(0.5, 0.5)) > 0.475) discard;
    gl_FragColor = vec4(vColor, vAlpha);
  }
`;

export class DrippingPaintEffect {
    constructor(scene, texture, ceilingMaterial) {
        this.scene = scene;
        this.originalTexture = texture;
        this.ceilingMaterial = ceilingMaterial;
        this.isActive = false;

        this.dripCount = 100; // Reduced count for better performance with more particles
        this.particlesPerDrip = 15; // Increased for a smoother, stringier look
        this.particleCount = this.dripCount * this.particlesPerDrip;
        this.particles = null;

        // Get image data from texture to sample colors
        const image = this.originalTexture.image;
        if (!image) {
            console.error("DrippingPaintEffect: Texture image is not available.");
            return;
        }

        // Create a new canvas for modifying the texture
        this.textureCanvas = document.createElement('canvas');
        this.textureCanvas.width = image.width;
        this.textureCanvas.height = image.height;
        this.textureCtx = this.textureCanvas.getContext('2d', { willReadFrequently: true });
        this.textureCtx.drawImage(image, 0, 0);

        // Create a new texture from this canvas that we can update
        this.dynamicTexture = new THREE.CanvasTexture(this.textureCanvas);
        this.ceilingMaterial.map = this.dynamicTexture;
        this.ceilingMaterial.emissiveMap = this.dynamicTexture;
    }

    start() {
        if (this.isActive || !this.textureCtx) return;
        this.isActive = true;
        this._createParticles();
    }
    
    _getColorAndEraseFromUV(u, v) {
        const x = Math.floor(u * this.textureCanvas.width);
        const y = Math.floor((1 - v) * this.textureCanvas.height); // V is often inverted
        
        if (x < 0 || x >= this.textureCanvas.width || y < 0 || y >= this.textureCanvas.height) {
            return new THREE.Color(0xffffff); // Default color if out of bounds
        }

        const pixel = this.textureCtx.getImageData(x, y, 1, 1).data;
        const color = new THREE.Color(`rgb(${pixel[0]}, ${pixel[1]}, ${pixel[2]})`);
        
        // "Erase" the pixel from the source texture
        this.textureCtx.clearRect(x - 1, y - 1, 3, 3);
        this.dynamicTexture.needsUpdate = true;
        this.ceilingMaterial.needsUpdate = true;

        // Hyper-saturate for the effect
        let hsl = {};
        color.getHSL(hsl);
        hsl.s = Math.min(1.0, hsl.s * 2.5);
        hsl.l = Math.max(0.3, Math.min(0.7, hsl.l * 1.2));
        color.setHSL(hsl.h, hsl.s, hsl.l);

        return color;
    }

    _createParticles() {
        const geometry = new THREE.BufferGeometry();
        const positions = [];
        const colors = [];
        const sizes = [];
        const alphas = [];
        this.particleData = [];

        const numClusters = 8; // Fewer, more defined drip areas
        const clusterCenters = [];
        for (let i = 0; i < numClusters; i++) {
            const angle = Math.random() * Math.PI * 2;
            const radius = Math.random() * 20.0; 
            clusterCenters.push({ x: Math.cos(angle) * radius, z: Math.sin(angle) * radius });
        }

        for (let i = 0; i < this.dripCount; i++) {
            // Pick a cluster and generate a point within it
            const cluster = clusterCenters[i % numClusters];
            const clusterRadius = 4.0; // Tighter clusters
            const angle = Math.random() * Math.PI * 2;
            const radius = Math.random() * clusterRadius;
            
            let x = cluster.x + Math.cos(angle) * radius;
            let z = cluster.z + Math.sin(angle) * radius;
            
            if (Math.sqrt(x*x + z*z) > 29.5) {
                x *= 0.9;
                z *= 0.9;
            }
            const ceilingYOffset = 25;
            const ceilingRadius = 30;

            const y = ceilingYOffset + Math.sqrt(Math.max(0, ceilingRadius * ceilingRadius - x * x - z * z));
            
            // Spherical UV mapping
            const spherePoint = new THREE.Vector3(x, y - ceilingYOffset, z).normalize();
            const u = 0.5 - Math.atan2(spherePoint.z, spherePoint.x) / (2 * Math.PI);
            const v = 0.5 + Math.asin(spherePoint.y) / Math.PI;

            const color = new THREE.Color(0xffffff); // Placeholder, will get color later
            const initialSize = Math.random() * 2.5 + 2.0; // Slightly larger drips

            for (let j = 0; j < this.particlesPerDrip; j++) {
                const isHead = j === 0;
                positions.push(x, y, z);
                colors.push(color.r, color.g, color.b);
                sizes.push(isHead ? initialSize : initialSize * Math.pow(1 - j / this.particlesPerDrip, 2) * 0.5); // Thinner tail
                alphas.push(isHead ? 1.0 : 0.9 * (1 - j / this.particlesPerDrip));

                this.particleData.push({
                    isHead: isHead,
                    dripIndex: i,
                    segmentIndex: j,
                    initialPos: new THREE.Vector3(x, y, z),
                    uv: new THREE.Vector2(u,v),
                    color: color, // Will be replaced
                    velocity: new THREE.Vector3(0, 0, 0),
                    delay: Math.random() * 25.0 + 10.0, // Longer, more varied delay
                    life: 0,
                    state: 'gathering', // gathering, stretching, falling, splatted
                    initialSize: initialSize,
                    wobbleFactor: Math.random() * Math.PI * 2,
                });
            }
        }

        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('customColor', new THREE.Float32BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.Float32BufferAttribute(sizes, 1));
        geometry.setAttribute('alpha', new THREE.Float32BufferAttribute(alphas, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                color: { value: new THREE.Color(0xffffff) },
            },
            vertexShader,
            fragmentShader,
            blending: THREE.NormalBlending, // Changed from AdditiveBlending for better color
            depthTest: false,
            transparent: true,
        });

        this.particles = new THREE.Points(geometry, material);
        this.scene.add(this.particles);
    }

    update(delta) {
        if (!this.isActive || !this.particles) return;

        const positions = this.particles.geometry.attributes.position.array;
        const alphas = this.particles.geometry.attributes.alpha.array;
        const sizes = this.particles.geometry.attributes.size.array;
        const customColors = this.particles.geometry.attributes.customColor.array;
        const gravity = 2.8; // Reduced gravity for a slower, heavier feel
        const drag = 0.97; // Increased drag for more viscosity
        const baseIndex = i => i * this.particlesPerDrip;

        for (let i = 0; i < this.dripCount; i++) {
            const headIndex = baseIndex(i);
            const pHead = this.particleData[headIndex];
            pHead.life += delta;
            const head_i3 = headIndex * 3;

            if (pHead.state === 'gathering') {
                if (pHead.life < pHead.delay) {
                    // Shimmer effect while gathering
                    const gatherProgress = pHead.life / pHead.delay;
                    sizes[headIndex] = pHead.initialSize * 0.5 + gatherProgress * pHead.initialSize * 1.2;
                    const shimmer = Math.sin(pHead.life * 2 + pHead.wobbleFactor) * 0.05;
                    positions[head_i3] = pHead.initialPos.x + shimmer;
                    positions[head_i3 + 2] = pHead.initialPos.z - shimmer;
                } else {
                    pHead.state = 'stretching';
                    pHead.life = 0;
                }
            } else if (pHead.state === 'stretching') {
                const stretchDuration = 3.0; // Longer stretch phase
                if (pHead.life < stretchDuration) {
                    const stretchProgress = pHead.life / stretchDuration;
                    const easeOutQuad = t => t * (2 - t);
                    const easedProgress = easeOutQuad(stretchProgress);

                    // Head swells and slowly moves down
                    sizes[headIndex] = pHead.initialSize * (1 + easedProgress * 0.3);
                    positions[head_i3 + 1] = pHead.initialPos.y - easedProgress * 1.5; // Stretch further
                    
                    // Tail stretches out like sticky cheese
                     for (let j = 1; j < this.particlesPerDrip; j++) {
                        const particleIndex = headIndex + j;
                        const leaderPos = new THREE.Vector3(positions[(particleIndex-1)*3], positions[(particleIndex-1)*3+1], positions[(particleIndex-1)*3+2]);
                        const currentPos = new THREE.Vector3(positions[particleIndex*3], positions[particleIndex*3+1], positions[particleIndex*3+2]);
                        currentPos.lerp(leaderPos, 0.15); // Slower follow for more stretch
                        positions[particleIndex*3] = currentPos.x;
                        positions[particleIndex*3+1] = currentPos.y;
                        positions[particleIndex*3+2] = currentPos.z;
                    }
                } else {
                    // Start falling
                    pHead.state = 'falling';
                    pHead.life = 0;
                    pHead.velocity.set((Math.random() - 0.5) * 0.1, -0.01, (Math.random() - 0.5) * 0.1);
                    
                    // Get color and remove from texture
                    const dripColor = this._getColorAndEraseFromUV(pHead.uv.x, pHead.uv.y);

                    // Update all particles in this drip with the new color
                    for (let j = 0; j < this.particlesPerDrip; j++) {
                        const particleIndex = headIndex + j;
                        this.particleData[particleIndex].color.copy(dripColor);
                        customColors[particleIndex * 3] = dripColor.r;
                        customColors[particleIndex * 3 + 1] = dripColor.g;
                        customColors[particleIndex * 3 + 2] = dripColor.b;
                        
                        if (j > 0) { // Update tail segments state
                            this.particleData[particleIndex].state = 'falling';
                            this.particleData[particleIndex].life = 0;
                        }
                    }
                }
            } else if (pHead.state === 'falling') {
                // Head particle physics
                pHead.velocity.y -= gravity * delta;
                pHead.velocity.multiplyScalar(drag); // Apply drag for viscosity

                positions[head_i3] += pHead.velocity.x * delta;
                positions[head_i3 + 1] += pHead.velocity.y * delta;
                positions[head_i3 + 2] += pHead.velocity.z * delta;

                // Tail segments follow previous segment
                for (let j = 1; j < this.particlesPerDrip; j++) {
                    const particleIndex = headIndex + j;
                    const prevParticleIndex = particleIndex - 1;
                    
                    const leaderPos = new THREE.Vector3(positions[prevParticleIndex*3], positions[prevParticleIndex*3+1], positions[prevParticleIndex*3+2]);
                    const currentPos = new THREE.Vector3(positions[particleIndex*3], positions[particleIndex*3+1], positions[particleIndex*3+2]);
                    
                    // Lerp to follow, creates a stretchy tail effect
                    currentPos.lerp(leaderPos, 0.45); // Tighter follow to look like a connected string
                    positions[particleIndex*3] = currentPos.x;
                    positions[particleIndex*3+1] = currentPos.y;
                    positions[particleIndex*3+2] = currentPos.z;

                    // Fade and thin tail over time/stretch
                    const stretchFactor = pHead.initialPos.distanceTo(currentPos) / 10;
                    alphas[particleIndex] = Math.max(0, 0.9 * (1 - j / this.particlesPerDrip) - stretchFactor);
                    sizes[particleIndex] = pHead.initialSize * Math.pow(1 - j / this.particlesPerDrip, 2) * Math.max(0.1, 0.5 - stretchFactor * 0.5);
                }

                // Check for splat
                if (positions[head_i3 + 1] < 0.1) {
                    positions[head_i3 + 1] = 0.1;
                    const speed = pHead.velocity.length();
                    sizes[headIndex] *= 1.5 + Math.min(3, speed * 0.15); 

                    for (let j = 0; j < this.particlesPerDrip; j++) {
                        const p = this.particleData[headIndex + j];
                        p.state = 'splatted';
                        p.life = 0;
                        if (j > 0) {
                            alphas[headIndex + j] = 0; // Make tail disappear on impact
                            sizes[headIndex + j] = 0;
                        }
                    }
                }
            } else if (pHead.state === 'splatted') {
                const spreadDuration = 1.2;
                const fadeDuration = 3.5;
                
                if (pHead.life < spreadDuration) {
                    const spreadProgress = pHead.life / spreadDuration;
                    sizes[headIndex] += Math.sin(spreadProgress * Math.PI) * 1.8 * delta; // Increased spread
                    alphas[headIndex] = 1.0 - Math.pow(spreadProgress, 3);
                } else {
                     alphas[headIndex] = Math.max(0, alphas[headIndex] - (delta / fadeDuration));
                }

                if (alphas[headIndex] <= 0) {
                    // --- Reset Drip ---
                    for (let j = 0; j < this.particlesPerDrip; j++) {
                        const particleIndex = headIndex + j;
                        const p = this.particleData[particleIndex];
                        const i3 = particleIndex * 3;

                        positions[i3] = p.initialPos.x;
                        positions[i3 + 1] = p.initialPos.y;
                        positions[i3 + 2] = p.initialPos.z;

                        p.velocity.set(0, 0, 0);
                        p.delay = Math.random() * 25.0 + 20.0; // Longer respawn
                        p.life = 0;
                        p.state = 'gathering';

                        if (p.isHead) {
                            alphas[particleIndex] = 1.0;
                            sizes[particleIndex] = p.initialSize * 0.5;
                        } else {
                            sizes[particleIndex] = p.initialSize * Math.pow(1 - j / this.particlesPerDrip, 2) * 0.5;
                            alphas[particleIndex] = 0.9 * (1 - j / this.particlesPerDrip);
                        }
                    }
                }
            }
        }
        this.particles.geometry.attributes.position.needsUpdate = true;
        this.particles.geometry.attributes.alpha.needsUpdate = true;
        this.particles.geometry.attributes.size.needsUpdate = true;
        this.particles.geometry.attributes.customColor.needsUpdate = true;
    }
}