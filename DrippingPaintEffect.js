import * as THREE from 'three';

const vertexShader = `
  attribute float size;
  attribute vec3 customColor;
  varying vec3 vColor;
  void main() {
    vColor = customColor;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * (200.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const fragmentShader = `
  varying vec3 vColor;
  void main() {
    if (length(gl_PointCoord - vec2(0.5, 0.5)) > 0.475) discard;
    gl_FragColor = vec4(vColor, 1.0);
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
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        this.ctx = canvas.getContext('2d', { willReadFrequently: true });
        this.ctx.drawImage(image, 0, 0);
    }

    start() {
        if (this.isActive) return;
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
        const velocities = [];

        for (let i = 0; i < this.particleCount; i++) {
            // Random point on a circle (for the rotunda ceiling base)
            const angle = Math.random() * Math.PI * 2;
            const radius = Math.random() * 29.5;
            const x = Math.cos(angle) * radius;
            const z = Math.sin(angle) * radius;

            // Project onto the sphere (ceiling)
            const y = 25 + Math.sqrt(Math.max(0, 30*30 - x*x - z*z));

            positions.push(x, y, z);

            const u = 0.5 + x / 60;
            const v = 0.5 + z / 60;
            const color = this._getColorFromUV(u, v);
            colors.push(color.r, color.g, color.b);

            sizes.push(Math.random() * 1.5 + 0.5);
            
            velocities.push({
                x: (Math.random() - 0.5) * 0.1,
                y: -Math.random() * 2 - 2, // Start with downward velocity
                z: (Math.random() - 0.5) * 0.1
            });
        }

        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('customColor', new THREE.Float32BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.Float32BufferAttribute(sizes, 1));
        
        this.velocities = velocities;

        const material = new THREE.ShaderMaterial({
            uniforms: {
                color: { value: new THREE.Color(0xffffff) },
            },
            vertexShader,
            fragmentShader,
            blending: THREE.AdditiveBlending,
            depthTest: false,
            transparent: true,
        });

        this.particles = new THREE.Points(geometry, material);
        this.scene.add(this.particles);
    }

    update(delta) {
        if (!this.isActive || !this.particles) return;

        const positions = this.particles.geometry.attributes.position.array;
        const gravity = 9.8;

        for (let i = 0; i < this.particleCount; i++) {
            const i3 = i * 3;
            
            // Apply gravity
            this.velocities[i].y -= gravity * delta * 0.5;

            positions[i3] += this.velocities[i].x * delta;
            positions[i3 + 1] += this.velocities[i].y * delta;
            positions[i3 + 2] += this.velocities[i].z * delta;

            // Reset particle if it hits the floor
            if (positions[i3 + 1] < 0.1) {
                const angle = Math.random() * Math.PI * 2;
                const radius = Math.random() * 29.5;
                const x = Math.cos(angle) * radius;
                const z = Math.sin(angle) * radius;
                const y = 25 + Math.sqrt(Math.max(0, 30*30 - x*x - z*z));
                
                positions[i3] = x;
                positions[i3 + 1] = y;
                positions[i3 + 2] = z;
                
                this.velocities[i] = {
                    x: (Math.random() - 0.5) * 0.1,
                    y: -Math.random() * 2 - 2,
                    z: (Math.random() - 0.5) * 0.1
                };
            }
        }
        this.particles.geometry.attributes.position.needsUpdate = true;
    }
}