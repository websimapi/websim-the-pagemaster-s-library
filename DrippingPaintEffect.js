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
        
        // Reduced particle count for more isolated drips
        // Each "drip" is now composed of a head and a tail, so total particles = particleCount * 2
        this.dripCount = 350; 
        this.particleCount = this.dripCount * 2;
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
    
    _getColorFromUV(u, v) {
        const x = Math.floor(u * this.textureCanvas.width);
        const y = Math.floor(v * this.textureCanvas.height);
        const pixel = this.textureCtx.getImageData(x, y, 1, 1).data;
        const color = new THREE.Color(`rgb(${pixel[0]}, ${pixel[1]}, ${pixel[2]})`);
        
        // Desaturate and then hyper-saturate for the effect
        let hsl = {};
        color.getHSL(hsl);
        hsl.s = Math.min(1.0, hsl.s * 2.5); // Hyper-saturate
        hsl.l = Math.max(0.3, Math.min(0.7, hsl.l * 1.2)); // Brighten
        color.setHSL(hsl.h, hsl.s, hsl.l);

        return color;
    }

    _smearTexture(u, v, color) {
        const x = u * this.textureCanvas.width;
        const y = v * this.textureCanvas.height;
        const radius = 8; // Smear radius

        let hsl = {};
        color.getHSL(hsl);
        const smearColor = new THREE.Color().setHSL(hsl.h, hsl.s * 0.5, hsl.l * 0.6);

        this.textureCtx.fillStyle = `rgba(${smearColor.r * 255}, ${smearColor.g * 255}, ${smearColor.b * 255}, 0.1)`;
        for(let i=0; i < 10; i++){
            this.textureCtx.beginPath();
            this.textureCtx.arc(x, y + i * 2, radius * (1 - i/15), 0, Math.PI * 2);
            this.textureCtx.fill();
        }

        this.dynamicTexture.needsUpdate = true;
        this.ceilingMaterial.needsUpdate = true;
    }

    _createParticles() {
        const geometry = new THREE.BufferGeometry();
        const positions = [];
        const colors = [];
        const sizes = [];
        const alphas = [];
        this.particleData = [];

        const numClusters = 5;
        const clusterCenters = [];
        for (let i = 0; i < numClusters; i++) {
            const angle = Math.random() * Math.PI * 2;
            const radius = Math.random() * 20.0; 
            clusterCenters.push({ x: Math.cos(angle) * radius, z: Math.sin(angle) * radius });
        }

        for (let i = 0; i < this.dripCount; i++) {
            // Pick a cluster and generate a point within it
            const cluster = clusterCenters[i % numClusters];
            const clusterRadius = 8.0;
            const angle = Math.random() * Math.PI * 2;
            const radius = Math.random() * clusterRadius;
            
            let x = cluster.x + Math.cos(angle) * radius;
            let z = cluster.z + Math.sin(angle) * radius;
            
            if (Math.sqrt(x*x + z*z) > 29.5) {
                x *= 0.9;
                z *= 0.9;
            }

            const y = 25 + Math.sqrt(Math.max(0, 30 * 30 - x * x - z * z));
            const u = 0.5 + x / 60;
            const v = 0.5 + z / 60;
            const color = this._getColorFromUV(u, v);
            const initialSize = Math.random() * 2.0 + 1.0;

            // Drip Head
            positions.push(x, y, z);
            colors.push(color.r, color.g, color.b);
            sizes.push(initialSize * 0.5);
            alphas.push(1.0);
            this.particleData.push({
                isHead: true,
                initialPos: new THREE.Vector3(x, y, z),
                uv: new THREE.Vector2(u,v),
                color: color,
                velocity: new THREE.Vector3(0, 0, 0),
                delay: Math.random() * 20.0 + 8.0, 
                life: 0,
                state: 'gathering', // gathering, falling, splatted
                initialSize: initialSize,
                wobbleFactor: Math.random() * Math.PI * 2,
            });

            // Drip Tail
            positions.push(x, y, z);
            colors.push(color.r, color.g, color.b);
            sizes.push(initialSize * 0.25);
            alphas.push(0.6);
            this.particleData.push({
                isHead: false,
                initialPos: new THREE.Vector3(x, y, z),
                velocity: new THREE.Vector3(0, 0, 0),
                delay: Math.random() * 20.0 + 8.0,
                life: 0,
                state: 'gathering',
                initialSize: initialSize * 0.7,
            });
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
        const gravity = 2.8;

        for (let i = 0; i < this.particleCount; i++) {
            const p = this.particleData[i];
            p.life += delta;
            const i3 = i * 3;

            if (p.state === 'gathering') {
                if (p.isHead) { // Only heads shimmer and trigger fall
                    if (p.life < p.delay) {
                        sizes[i] = p.initialSize * 0.5 + (p.life / p.delay) * p.initialSize;
                        const shimmer = Math.sin(p.life * 2 + p.wobbleFactor) * 0.05;
                        positions[i3] = p.initialPos.x + shimmer;
                        positions[i3 + 2] = p.initialPos.z - shimmer;
                    } else {
                        // Head starts falling
                        p.state = 'falling';
                        p.life = 0;
                        p.velocity.set((Math.random() - 0.5) * 0.1, -0.01, (Math.random() - 0.5) * 0.1);
                        this._smearTexture(p.uv.x, p.uv.y, p.color);

                        // Find its tail and make it fall too
                        const tail = this.particleData[i+1];
                        if(tail && !tail.isHead) {
                            tail.state = 'falling';
                            tail.life = 0;
                            tail.velocity.copy(p.velocity);
                        }
                    }
                }
            } else if (p.state === 'falling') {
                const fallAcceleration = gravity * Math.min(1.0, p.life * 1.2);
                p.velocity.y -= fallAcceleration * delta;

                if (!p.isHead) { // Tail follows head
                    const headIndex = i - 1;
                    const headPos = new THREE.Vector3(positions[headIndex*3], positions[headIndex*3+1], positions[headIndex*3+2]);
                    const currentPos = new THREE.Vector3(positions[i3], positions[i3+1], positions[i3+2]);
                    // Simple lerp to follow, creates a stretchy tail effect
                    currentPos.lerp(headPos, 0.3);
                    positions[i3] = currentPos.x;
                    positions[i3+1] = currentPos.y;
                    positions[i3+2] = currentPos.z;

                    // Fade tail over time
                    alphas[i] = Math.max(0, 0.6 - p.life * 0.2);
                } else { // Head leads the fall
                    positions[i3] += p.velocity.x * delta;
                    positions[i3 + 1] += p.velocity.y * delta;
                    positions[i3 + 2] += p.velocity.z * delta;
                }

                if (p.isHead && positions[i3 + 1] < 0.1) {
                    positions[i3 + 1] = 0.1;
                    p.state = 'splatted';
                    p.life = 0;
                    const speed = p.velocity.length();
                    sizes[i] *= 1.2 + Math.min(3, speed * 0.2); 
                    
                    const tail = this.particleData[i+1];
                    if(tail && !tail.isHead) {
                        tail.state = 'splatted'; // Make tail disappear
                        alphas[i+1] = 0;
                    }
                }
            } else if (p.state === 'splatted') {
                 if (!p.isHead) continue; // Only heads splat

                const spreadDuration = 0.7;
                const fadeDuration = 3.0;
                
                if (p.life < spreadDuration) {
                    sizes[i] += (2.0 - (p.life / spreadDuration)) * delta;
                } else {
                    alphas[i] = Math.max(0, 1.0 - (p.life - spreadDuration) / fadeDuration);
                }

                if (alphas[i] <= 0) {
                    // --- Reset Head ---
                    positions[i3] = p.initialPos.x;
                    positions[i3 + 1] = p.initialPos.y;
                    positions[i3 + 2] = p.initialPos.z;
                    p.velocity.set(0, 0, 0);
                    p.delay = Math.random() * 20.0 + 15.0; // Longer respawn
                    p.life = 0;
                    p.state = 'gathering';
                    alphas[i] = 1.0;
                    sizes[i] = p.initialSize * 0.5;

                    // --- Reset Tail ---
                    const tailIndex = i + 1;
                    if (this.particleData[tailIndex] && !this.particleData[tailIndex].isHead) {
                        const tail = this.particleData[tailIndex];
                        const tail_i3 = tailIndex * 3;
                        positions[tail_i3] = tail.initialPos.x;
                        positions[tail_i3 + 1] = tail.initialPos.y;
                        positions[tail_i3 + 2] = tail.initialPos.z;
                        tail.state = 'gathering';
                        tail.life = 0;
                        alphas[tailIndex] = 0.6;
                    }
                }
            }
        }
        this.particles.geometry.attributes.position.needsUpdate = true;
        this.particles.geometry.attributes.alpha.needsUpdate = true;
        this.particles.geometry.attributes.size.needsUpdate = true;
    }
}