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
    constructor(scene, texture) {
        this.scene = scene;
        this.texture = texture;
        this.isActive = false;
        this.particleCount = 5000;
        this.particles = null;

        // Get image data from texture to sample colors
        const image = this.texture.image;
        if (!image) {
            console.error("DrippingPaintEffect: Texture image is not available.");
            return;
        }
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        this.ctx = canvas.getContext('2d', { willReadFrequently: true });
        this.ctx.drawImage(image, 0, 0);
    }

    start() {
        if (this.isActive || !this.ctx) return;
        this.isActive = true;
        this._createParticles();
    }
    
    _getColorFromUV(u, v) {
        const x = Math.floor(u * this.ctx.canvas.width);
        const y = Math.floor(v * this.ctx.canvas.height);
        const pixel = this.ctx.getImageData(x, y, 1, 1).data;
        const color = new THREE.Color(`rgb(${pixel[0]}, ${pixel[1]}, ${pixel[2]})`);
        
        // Desaturate and then hyper-saturate for the effect
        let hsl = {};
        color.getHSL(hsl);
        hsl.s = Math.min(1.0, hsl.s * 2.5); // Hyper-saturate
        hsl.l = Math.max(0.3, Math.min(0.7, hsl.l * 1.2)); // Brighten
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

        const numClusters = 7;
        const clusterCenters = [];
        for (let i = 0; i < numClusters; i++) {
            const angle = Math.random() * Math.PI * 2;
            const radius = Math.random() * 25.0; // Clusters not at the very edge
            clusterCenters.push({ x: Math.cos(angle) * radius, z: Math.sin(angle) * radius });
        }

        for (let i = 0; i < this.particleCount; i++) {
            // Pick a cluster and generate a point within it
            const cluster = clusterCenters[i % numClusters];
            const clusterRadius = 6.0;
            const angle = Math.random() * Math.PI * 2;
            const radius = Math.random() * clusterRadius;
            
            let x = cluster.x + Math.cos(angle) * radius;
            let z = cluster.z + Math.sin(angle) * radius;
            
            // Ensure particles are within the ceiling bounds
            if (Math.sqrt(x*x + z*z) > 29.5) {
                x *= 0.9;
                z *= 0.9;
            }

            // Project onto the sphere (ceiling)
            const y = 25 + Math.sqrt(Math.max(0, 30 * 30 - x * x - z * z));

            positions.push(x, y, z);

            const u = 0.5 + x / 60;
            const v = 0.5 + z / 60;
            const color = this._getColorFromUV(u, v);
            colors.push(color.r, color.g, color.b);

            const initialSize = Math.random() * 1.5 + 0.5;
            sizes.push(initialSize * 0.5); // Start smaller before swelling
            alphas.push(1.0);
            
            this.particleData.push({
                initialPos: new THREE.Vector3(x, y, z),
                velocity: new THREE.Vector3(0, 0, 0),
                delay: Math.random() * 15.0 + 5.0, // Increased delay for slower start
                life: 0,
                state: 'gathering', // gathering, falling, splatted
                initialSize: initialSize,
                wobbleFactor: Math.random() * Math.PI * 2, // For unique shimmer
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
        const gravity = 2.5; // Slightly increased gravity for a heavier feel

        for (let i = 0; i < this.particleCount; i++) {
            const p = this.particleData[i];
            p.life += delta;
            const i3 = i * 3;

            if (p.state === 'gathering') {
                if (p.life < p.delay) {
                    // Swell up before falling
                    sizes[i] = p.initialSize * 0.5 + (p.life / p.delay) * p.initialSize;
                    // Shimmer effect
                    const shimmer = Math.sin(p.life * 2 + p.wobbleFactor) * 0.05;
                    positions[i3] = p.initialPos.x + shimmer;
                    positions[i3 + 2] = p.initialPos.z - shimmer;
                } else {
                    p.state = 'falling';
                    p.life = 0;
                    // Start with a very small downward velocity
                    p.velocity.set((Math.random() - 0.5) * 0.1, -0.01, (Math.random() - 0.5) * 0.1);
                }
            } else if (p.state === 'falling') {
                // Apply accelerating gravity for a "heavy" tear-drop feel
                const fallAcceleration = gravity * Math.min(1.0, p.life * 1.2);
                p.velocity.y -= fallAcceleration * delta;

                positions[i3] += p.velocity.x * delta;
                positions[i3 + 1] += p.velocity.y * delta;
                positions[i3 + 2] += p.velocity.z * delta;

                // Hit the floor
                if (positions[i3 + 1] < 0.1) {
                    positions[i3 + 1] = 0.1;
                    p.state = 'splatted';
                    p.life = 0;
                    // Splash bigger based on final velocity
                    const speed = p.velocity.length();
                    sizes[i] *= 1.2 + Math.min(3, speed * 0.2); 
                }
            } else if (p.state === 'splatted') {
                 // Puddle spreads out then fades
                const spreadDuration = 0.7;
                const fadeDuration = 3.0;
                
                if (p.life < spreadDuration) {
                    // Spread out
                    sizes[i] += (2.0 - (p.life / spreadDuration)) * delta;
                } else {
                    // Fade out
                    alphas[i] = Math.max(0, 1.0 - (p.life - spreadDuration) / fadeDuration);
                }


                if (alphas[i] <= 0) {
                    // Reset particle to ceiling
                    positions[i3] = p.initialPos.x;
                    positions[i3 + 1] = p.initialPos.y;
                    positions[i3 + 2] = p.initialPos.z;
                    
                    p.velocity.set(0, 0, 0);
                    p.delay = Math.random() * 15.0 + 8.0; // Give it a long delay before respawning
                    p.life = 0;
                    p.state = 'gathering';
                    alphas[i] = 1.0;
                    sizes[i] = p.initialSize * 0.5; // Reset to small size
                }
            }
        }
        this.particles.geometry.attributes.position.needsUpdate = true;
        this.particles.geometry.attributes.alpha.needsUpdate = true;
        this.particles.geometry.attributes.size.needsUpdate = true;
    }
}