// ============= Three.js 3D 场景系统 =============

class ThreeScene {
    constructor(canvasElement) {
        this.canvas = canvasElement;
        
        // 创建场景
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x000000); // 黑色背景
        
        // 创建正交相机（模拟 2D 效果，避免透视失真）
        const aspect = canvasElement.width / canvasElement.height;
        const viewSize = canvasElement.height;
        this.camera = new THREE.OrthographicCamera(
            -viewSize * aspect / 2,  // left
            viewSize * aspect / 2,   // right
            viewSize / 2,             // top
            -viewSize / 2,            // bottom
            0.1,                      // near
            1000                      // far
        );
        this.camera.position.z = 500; // 相机在 Z 轴上方，俯视场景
        
        // 创建渲染器
        this.renderer = new THREE.WebGLRenderer({
            canvas: canvasElement,
            alpha: true,
            antialias: true
        });
        this.renderer.setSize(canvasElement.width, canvasElement.height);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        
        // 环境光（整体照明）
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);
        
        // 方向光（模拟太阳光）
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(0, 0, 1);
        this.scene.add(directionalLight);
        
        // 存储对象
        this.waterParticles = null;
        this.lilyPadParticles = null;
        this.fishParticles = null;
        this.waterPlane = null;
        
        console.log('Three.js 场景初始化完成');
    }
    
    // 更新相机位置（跟随玩家）
    updateCamera(x, y, zoom = 1.0) {
        // 将世界坐标转换为相机坐标
        this.camera.position.x = x;
        this.camera.position.y = -y; // Y 轴翻转
        
        // 更新缩放
        const aspect = this.canvas.width / this.canvas.height;
        const viewSize = (this.canvas.height / zoom) / 2;
        this.camera.left = -viewSize * aspect;
        this.camera.right = viewSize * aspect;
        this.camera.top = viewSize;
        this.camera.bottom = -viewSize;
        this.camera.updateProjectionMatrix();
    }
    
    // 创建水的粒子系统
    createWaterParticles(particles, worldWidth, worldHeight) {
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particles.length * 3);
        const colors = new Float32Array(particles.length * 3);
        const sizes = new Float32Array(particles.length);
        
        particles.forEach((p, i) => {
            const i3 = i * 3;
            positions[i3] = p.x - worldWidth / 2;
            positions[i3 + 1] = -(p.y - worldHeight / 2); // Y 轴翻转
            positions[i3 + 2] = 0;
            
            colors[i3] = p.color[0];
            colors[i3 + 1] = p.color[1];
            colors[i3 + 2] = p.color[2];
            
            sizes[i] = p.size;
        });
        
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        
        // 创建材质
        const material = new THREE.ShaderMaterial({
            uniforms: {
                pointTexture: {
                    value: this.createPointTexture()
                }
            },
            vertexShader: `
                attribute float size;
                attribute vec3 color;
                varying vec3 vColor;
                
                void main() {
                    vColor = color;
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    gl_PointSize = size * (300.0 / -mvPosition.z);
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                uniform sampler2D pointTexture;
                varying vec3 vColor;
                
                void main() {
                    vec4 textureColor = texture2D(pointTexture, gl_PointCoord);
                    gl_FragColor = vec4(vColor, textureColor.a);
                }
            `,
            transparent: true,
            vertexColors: true,
            depthTest: false,
            blending: THREE.AdditiveBlending
        });
        
        this.waterParticles = new THREE.Points(geometry, material);
        this.scene.add(this.waterParticles);
        
        console.log('水的粒子系统创建完成，粒子数:', particles.length);
    }
    
    // 创建荷叶的粒子系统
    createLilyPadParticles(particles) {
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particles.length * 3);
        const colors = new Float32Array(particles.length * 3);
        const sizes = new Float32Array(particles.length);
        
        particles.forEach((p, i) => {
            const i3 = i * 3;
            positions[i3] = p.x;
            positions[i3 + 1] = -p.y; // Y 轴翻转
            positions[i3 + 2] = 1; // 稍微在水的粒子上方
            
            colors[i3] = p.color[0];
            colors[i3 + 1] = p.color[1];
            colors[i3 + 2] = p.color[2];
            
            sizes[i] = p.size;
        });
        
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        
        const material = new THREE.ShaderMaterial({
            uniforms: {
                pointTexture: {
                    value: this.createPointTexture()
                }
            },
            vertexShader: `
                attribute float size;
                attribute vec3 color;
                varying vec3 vColor;
                
                void main() {
                    vColor = color;
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    gl_PointSize = size * (300.0 / -mvPosition.z);
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                uniform sampler2D pointTexture;
                varying vec3 vColor;
                
                void main() {
                    vec4 textureColor = texture2D(pointTexture, gl_PointCoord);
                    gl_FragColor = vec4(vColor, textureColor.a);
                }
            `,
            transparent: true,
            vertexColors: true,
            depthTest: false,
            blending: THREE.AdditiveBlending
        });
        
        this.lilyPadParticles = new THREE.Points(geometry, material);
        this.scene.add(this.lilyPadParticles);
        
        console.log('荷叶的粒子系统创建完成，粒子数:', particles.length);
    }
    
    // 创建鱼的粒子系统（动态更新）
    createFishParticles() {
        const geometry = new THREE.BufferGeometry();
        const material = new THREE.ShaderMaterial({
            uniforms: {
                pointTexture: {
                    value: this.createPointTexture()
                }
            },
            vertexShader: `
                attribute float size;
                attribute vec3 color;
                attribute float alpha;
                varying vec3 vColor;
                varying float vAlpha;
                
                void main() {
                    vColor = color;
                    vAlpha = alpha;
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    gl_PointSize = size * (300.0 / -mvPosition.z);
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                uniform sampler2D pointTexture;
                varying vec3 vColor;
                varying float vAlpha;
                
                void main() {
                    vec4 textureColor = texture2D(pointTexture, gl_PointCoord);
                    gl_FragColor = vec4(vColor, textureColor.a * vAlpha);
                }
            `,
            transparent: true,
            vertexColors: true,
            depthTest: false,
            blending: THREE.AdditiveBlending
        });
        
        this.fishParticles = new THREE.Points(geometry, material);
        this.scene.add(this.fishParticles);
    }
    
    // 更新鱼的粒子
    updateFishParticles(particles, worldWidth, worldHeight) {
        if (!this.fishParticles) {
            this.createFishParticles();
        }
        
        const geometry = this.fishParticles.geometry;
        const positions = new Float32Array(particles.length * 3);
        const colors = new Float32Array(particles.length * 3);
        const sizes = new Float32Array(particles.length);
        const alphas = new Float32Array(particles.length);
        
        particles.forEach((p, i) => {
            const i3 = i * 3;
            positions[i3] = p.x - worldWidth / 2;
            positions[i3 + 1] = -(p.y - worldHeight / 2); // Y 轴翻转
            positions[i3 + 2] = 2; // 在荷叶上方
            
            if (p.color && p.color.length >= 3) {
                colors[i3] = p.color[0];
                colors[i3 + 1] = p.color[1];
                colors[i3 + 2] = p.color[2];
            } else {
                colors[i3] = 1.0;
                colors[i3 + 1] = 0.4;
                colors[i3 + 2] = 0.2;
            }
            
            sizes[i] = p.size || 2.0;
            alphas[i] = p.alpha || 1.0;
        });
        
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1));
        geometry.setDrawRange(0, particles.length);
    }
    
    // 创建水面平面（可选，用于反射效果）
    createWaterPlane(worldWidth, worldHeight) {
        const geometry = new THREE.PlaneGeometry(worldWidth, worldHeight);
        
        // PBR 材质，模拟水面
        const material = new THREE.MeshStandardMaterial({
            color: 0x0a1a2e,
            metalness: 0.1,
            roughness: 0.3,
            transparent: true,
            opacity: 0.3
        });
        
        this.waterPlane = new THREE.Mesh(geometry, material);
        this.waterPlane.rotation.x = -Math.PI / 2;
        this.waterPlane.position.z = 0;
        // this.scene.add(this.waterPlane); // 可选：取消注释以显示水面平面
        
        return this.waterPlane;
    }
    
    // 创建圆形粒子纹理
    createPointTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        
        const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
        gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.8)');
        gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
        
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 64, 64);
        
        const texture = new THREE.CanvasTexture(canvas);
        return texture;
    }
    
    // 渲染场景
    render() {
        this.renderer.render(this.scene, this.camera);
    }
    
    // 窗口大小改变时更新
    onWindowResize(width, height) {
        this.canvas.width = width;
        this.canvas.height = height;
        
        const aspect = width / height;
        const viewSize = height / 2;
        this.camera.left = -viewSize * aspect;
        this.camera.right = viewSize * aspect;
        this.camera.top = viewSize;
        this.camera.bottom = -viewSize;
        this.camera.updateProjectionMatrix();
        
        this.renderer.setSize(width, height);
    }
    
    // 清理资源
    dispose() {
        if (this.waterParticles) {
            this.waterParticles.geometry.dispose();
            this.waterParticles.material.dispose();
        }
        if (this.lilyPadParticles) {
            this.lilyPadParticles.geometry.dispose();
            this.lilyPadParticles.material.dispose();
        }
        if (this.fishParticles) {
            this.fishParticles.geometry.dispose();
            this.fishParticles.material.dispose();
        }
    }
}

window.ThreeScene = ThreeScene;

