// ============= Regl GPGPU 粒子系统 =============

/**
 * 基于 regl + GPGPU 的高性能粒子系统
 * 支持数万粒子实时渲染，所有计算在 GPU 上完成
 */
class ReglGPGPUParticles {
    constructor(reglInstance, options = {}) {
        this.regl = reglInstance;
        this.particleCount = options.particleCount || 10000;
        this.canvas = options.canvas;
        
        // 粒子配置
        this.config = {
            lifeSpan: options.lifeSpan || 2.0,
            sizeRange: options.sizeRange || [1.0, 4.0],
            speedRange: options.speedRange || [20.0, 60.0],
            damping: options.damping || 0.96,
            gravity: options.gravity || [0, 0],
            colorStart: options.colorStart || [0.94, 0.94, 0.96, 1.0],
            colorEnd: options.colorEnd || [0.94, 0.94, 0.96, 0.0]
        };
        
        // 发射器状态
        this.emitterPoints = [];
        this.spawnRate = options.spawnRate || 100; // 粒子/秒
        this.spawnAccumulator = 0;
        this.nextParticleIndex = 0;
        
        this.time = 0;
        
        // 初始化
        this._initTextures();
        this._initBuffers();
        this._initShaders();
    }
    
    /**
     * 初始化 FBO 纹理用于存储粒子状态
     * 使用 ping-pong 技术在两个 FBO 之间交替更新
     */
    _initTextures() {
        const size = Math.ceil(Math.sqrt(this.particleCount));
        this.textureSize = size;
        
        // 创建初始粒子数据（位置 + 速度）
        const positionData = new Float32Array(size * size * 4);
        const velocityData = new Float32Array(size * size * 4);
        const birthData = new Float32Array(size * size * 4);
        const attributeData = new Float32Array(size * size * 4);
        
        // 初始化所有粒子为"死亡"状态
        for (let i = 0; i < size * size; i++) {
            const idx = i * 4;
            // 位置 (x, y, z, w) - w 用作 life
            positionData[idx + 0] = 0;
            positionData[idx + 1] = 0;
            positionData[idx + 2] = 0;
            positionData[idx + 3] = -1; // life < 0 表示粒子未激活
            
            // 速度 (vx, vy, vz, unused)
            velocityData[idx + 0] = 0;
            velocityData[idx + 1] = 0;
            velocityData[idx + 2] = 0;
            velocityData[idx + 3] = 0;
            
            // 出生时间和初始生命值
            birthData[idx + 0] = 0; // birthTime
            birthData[idx + 1] = 0; // initialLife
            birthData[idx + 2] = 0;
            birthData[idx + 3] = 0;
            
            // 属性 (size, ...)
            attributeData[idx + 0] = 2.0; // size
            attributeData[idx + 1] = 0;
            attributeData[idx + 2] = 0;
            attributeData[idx + 3] = 0;
        }
        
        // 创建 FBO 纹理（ping-pong）
        this.positionFBO = [
            this.regl.framebuffer({
                color: this.regl.texture({
                    width: size,
                    height: size,
                    data: positionData,
                    type: 'float',
                    format: 'rgba'
                }),
                depthStencil: false
            }),
            this.regl.framebuffer({
                color: this.regl.texture({
                    width: size,
                    height: size,
                    data: positionData,
                    type: 'float',
                    format: 'rgba'
                }),
                depthStencil: false
            })
        ];
        
        this.velocityFBO = [
            this.regl.framebuffer({
                color: this.regl.texture({
                    width: size,
                    height: size,
                    data: velocityData,
                    type: 'float',
                    format: 'rgba'
                }),
                depthStencil: false
            }),
            this.regl.framebuffer({
                color: this.regl.texture({
                    width: size,
                    height: size,
                    data: velocityData,
                    type: 'float',
                    format: 'rgba'
                }),
                depthStencil: false
            })
        ];
        
        // 静态纹理（不需要 ping-pong）
        this.birthTexture = this.regl.texture({
            width: size,
            height: size,
            data: birthData,
            type: 'float',
            format: 'rgba'
        });
        
        this.attributeTexture = this.regl.texture({
            width: size,
            height: size,
            data: attributeData,
            type: 'float',
            format: 'rgba'
        });
        
        this.currentBuffer = 0; // 当前读取的 buffer 索引
    }
    
    /**
     * 初始化几何缓冲区
     */
    _initBuffers() {
        const size = this.textureSize;
        const particleIndices = [];
        const particleUVs = [];
        
        // 为每个粒子创建一个 UV 坐标，用于索引纹理
        for (let i = 0; i < this.particleCount; i++) {
            const x = i % size;
            const y = Math.floor(i / size);
            const u = (x + 0.5) / size;
            const v = (y + 0.5) / size;
            
            particleIndices.push(i);
            particleUVs.push(u, v);
        }
        
        this.particleBuffer = this.regl.buffer(particleIndices);
        this.particleUVBuffer = this.regl.buffer(particleUVs);
        
        // 全屏四边形用于 GPGPU 计算
        this.quadBuffer = this.regl.buffer([
            [-1, -1], [1, -1], [-1, 1],
            [-1, 1], [1, -1], [1, 1]
        ]);
    }
    
    /**
     * 初始化着色器程序
     */
    _initShaders() {
        // ========== GPGPU 更新着色器 ==========
        
        // 更新位置
        this.updatePositionCommand = this.regl({
            frag: `
                precision highp float;
                uniform sampler2D u_positionTexture;
                uniform sampler2D u_velocityTexture;
                uniform sampler2D u_birthTexture;
                uniform float u_time;
                uniform float u_deltaTime;
                varying vec2 v_uv;
                
                void main() {
                    vec4 position = texture2D(u_positionTexture, v_uv);
                    vec4 velocity = texture2D(u_velocityTexture, v_uv);
                    vec4 birth = texture2D(u_birthTexture, v_uv);
                    
                    float life = position.w;
                    float birthTime = birth.x;
                    float initialLife = birth.y;
                    
                    // 计算新的 life
                    if (life >= 0.0) {
                        life -= u_deltaTime;
                    }
                    
                    // 更新位置
                    if (life >= 0.0) {
                        position.xy += velocity.xy * u_deltaTime;
                    }
                    
                    gl_FragColor = vec4(position.xyz, life);
                }
            `,
            vert: `
                precision highp float;
                attribute vec2 a_position;
                varying vec2 v_uv;
                void main() {
                    v_uv = a_position * 0.5 + 0.5;
                    gl_Position = vec4(a_position, 0, 1);
                }
            `,
            attributes: {
                a_position: this.quadBuffer
            },
            uniforms: {
                u_positionTexture: () => this.positionFBO[this.currentBuffer],
                u_velocityTexture: () => this.velocityFBO[this.currentBuffer],
                u_birthTexture: this.birthTexture,
                u_time: () => this.time,
                u_deltaTime: this.regl.prop('deltaTime')
            },
            framebuffer: () => this.positionFBO[1 - this.currentBuffer],
            count: 6
        });
        
        // 更新速度
        this.updateVelocityCommand = this.regl({
            frag: `
                precision highp float;
                uniform sampler2D u_positionTexture;
                uniform sampler2D u_velocityTexture;
                uniform float u_deltaTime;
                uniform vec2 u_gravity;
                uniform float u_damping;
                varying vec2 v_uv;
                
                void main() {
                    vec4 position = texture2D(u_positionTexture, v_uv);
                    vec4 velocity = texture2D(u_velocityTexture, v_uv);
                    
                    float life = position.w;
                    
                    if (life >= 0.0) {
                        // 应用阻尼
                        velocity.xy *= u_damping;
                        
                        // 应用重力
                        velocity.xy += u_gravity * u_deltaTime;
                    }
                    
                    gl_FragColor = velocity;
                }
            `,
            vert: `
                precision highp float;
                attribute vec2 a_position;
                varying vec2 v_uv;
                void main() {
                    v_uv = a_position * 0.5 + 0.5;
                    gl_Position = vec4(a_position, 0, 1);
                }
            `,
            attributes: {
                a_position: this.quadBuffer
            },
            uniforms: {
                u_positionTexture: () => this.positionFBO[1 - this.currentBuffer],
                u_velocityTexture: () => this.velocityFBO[this.currentBuffer],
                u_deltaTime: this.regl.prop('deltaTime'),
                u_gravity: () => this.config.gravity,
                u_damping: () => this.config.damping
            },
            framebuffer: () => this.velocityFBO[1 - this.currentBuffer],
            count: 6
        });
        
        // ========== 粒子渲染着色器 ==========
        this.renderParticlesCommand = this.regl({
            vert: `
                precision highp float;
                attribute float a_index;
                attribute vec2 a_uv;
                
                uniform sampler2D u_positionTexture;
                uniform sampler2D u_attributeTexture;
                uniform sampler2D u_birthTexture;
                uniform mat4 u_projection;
                uniform vec2 u_resolution;
                uniform float u_time;
                
                varying float v_alpha;
                varying vec2 v_uv;
                
                void main() {
                    vec4 position = texture2D(u_positionTexture, a_uv);
                    vec4 attributes = texture2D(u_attributeTexture, a_uv);
                    vec4 birth = texture2D(u_birthTexture, a_uv);
                    
                    float life = position.w;
                    float initialLife = birth.y;
                    float size = attributes.x;
                    
                    // 计算 alpha：随生命值衰减
                    v_alpha = max(0.0, life / initialLife);
                    
                    // 如果粒子已死亡，移到屏幕外
                    if (life < 0.0) {
                        gl_Position = vec4(-10.0, -10.0, 0.0, 1.0);
                        gl_PointSize = 0.0;
                    } else {
                        vec2 screenPos = position.xy;
                        vec4 clipPos = u_projection * vec4(screenPos, 0.0, 1.0);
                        gl_Position = clipPos;
                        
                        // 点大小随 alpha 变化
                        gl_PointSize = max(0.5, size * v_alpha);
                    }
                    
                    v_uv = a_uv;
                }
            `,
            frag: `
                precision highp float;
                uniform vec4 u_colorStart;
                uniform vec4 u_colorEnd;
                varying float v_alpha;
                
                void main() {
                    // 圆形粒子
                    vec2 coord = gl_PointCoord - vec2(0.5);
                    float dist = length(coord);
                    if (dist > 0.5) {
                        discard;
                    }
                    
                    // 柔和边缘
                    float edge = 1.0 - smoothstep(0.3, 0.5, dist);
                    
                    // 颜色插值
                    vec4 color = mix(u_colorEnd, u_colorStart, v_alpha);
                    color.a *= v_alpha * edge * 0.8;
                    
                    gl_FragColor = color;
                }
            `,
            attributes: {
                a_index: this.particleBuffer,
                a_uv: this.particleUVBuffer
            },
            uniforms: {
                u_positionTexture: () => this.positionFBO[1 - this.currentBuffer],
                u_attributeTexture: this.attributeTexture,
                u_birthTexture: this.birthTexture,
                u_projection: this.regl.prop('projection'),
                u_resolution: () => [this.canvas.width, this.canvas.height],
                u_time: () => this.time,
                u_colorStart: () => this.config.colorStart,
                u_colorEnd: () => this.config.colorEnd
            },
            blend: {
                enable: true,
                func: {
                    srcRGB: 'src alpha',
                    srcAlpha: 'one',
                    dstRGB: 'one minus src alpha',
                    dstAlpha: 'one'
                }
            },
            depth: { enable: false },
            count: this.particleCount,
            primitive: 'points'
        });
    }
    
    /**
     * 生成新粒子
     */
    spawnParticles(points, count) {
        if (!points || points.length === 0 || count <= 0) return;
        
        const size = this.textureSize;
        
        // 读取当前的纹理数据
        const currentPos = this.positionFBO[1 - this.currentBuffer].color[0];
        const currentVel = this.velocityFBO[1 - this.currentBuffer].color[0];
        
        // 创建新的数据数组
        const posData = new Float32Array(size * size * 4);
        const velData = new Float32Array(size * size * 4);
        const birthData = new Float32Array(size * size * 4);
        const attrData = new Float32Array(size * size * 4);
        
        // 读取当前数据
        this.regl({
            framebuffer: this.positionFBO[1 - this.currentBuffer]
        })(() => {
            this.regl.read({ data: posData });
        });
        
        this.regl({
            framebuffer: this.velocityFBO[1 - this.currentBuffer]
        })(() => {
            this.regl.read({ data: velData });
        });
        
        // 读取静态纹理
        const gl = this.regl._gl;
        const fb = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.birthTexture._texture.texture, 0);
        gl.readPixels(0, 0, size, size, gl.RGBA, gl.FLOAT, birthData);
        
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.attributeTexture._texture.texture, 0);
        gl.readPixels(0, 0, size, size, gl.RGBA, gl.FLOAT, attrData);
        
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.deleteFramebuffer(fb);
        
        // 生成新粒子
        for (let i = 0; i < count && i < this.particleCount; i++) {
            const particleIdx = this.nextParticleIndex;
            this.nextParticleIndex = (this.nextParticleIndex + 1) % this.particleCount;
            
            const texIdx = particleIdx * 4;
            
            // 随机选择一个发射点
            const point = points[Math.floor(Math.random() * points.length)];
            
            // 随机速度
            const angle = Math.random() * Math.PI * 2;
            const speed = this.config.speedRange[0] + 
                         Math.random() * (this.config.speedRange[1] - this.config.speedRange[0]);
            
            // 位置（带少量抖动）
            const jitter = 2;
            posData[texIdx + 0] = point.x + (Math.random() - 0.5) * jitter;
            posData[texIdx + 1] = point.y + (Math.random() - 0.5) * jitter;
            posData[texIdx + 2] = 0;
            posData[texIdx + 3] = this.config.lifeSpan * (0.8 + Math.random() * 0.4); // 生命值
            
            // 速度
            velData[texIdx + 0] = Math.cos(angle) * speed;
            velData[texIdx + 1] = Math.sin(angle) * speed;
            velData[texIdx + 2] = 0;
            velData[texIdx + 3] = 0;
            
            // 出生信息
            birthData[texIdx + 0] = this.time;
            birthData[texIdx + 1] = posData[texIdx + 3]; // initialLife
            birthData[texIdx + 2] = 0;
            birthData[texIdx + 3] = 0;
            
            // 属性
            const particleSize = this.config.sizeRange[0] + 
                               Math.random() * (this.config.sizeRange[1] - this.config.sizeRange[0]);
            attrData[texIdx + 0] = particleSize;
            attrData[texIdx + 1] = 0;
            attrData[texIdx + 2] = 0;
            attrData[texIdx + 3] = 0;
        }
        
        // 更新纹理
        this.positionFBO[1 - this.currentBuffer].color[0].subimage(posData);
        this.velocityFBO[1 - this.currentBuffer].color[0].subimage(velData);
        this.birthTexture.subimage(birthData);
        this.attributeTexture.subimage(attrData);
    }
    
    /**
     * 更新粒子系统
     */
    update(deltaTime, skeletonPoints) {
        this.time += deltaTime;
        
        // 生成新粒子
        if (skeletonPoints && skeletonPoints.length > 0) {
            const densityFactor = Math.min(6, skeletonPoints.length / 35);
            this.spawnAccumulator += deltaTime * this.spawnRate * densityFactor;
            const spawnCount = Math.floor(this.spawnAccumulator);
            
            if (spawnCount > 0) {
                this.spawnAccumulator -= spawnCount;
                this.spawnParticles(skeletonPoints, spawnCount);
            }
        }
        
        // GPGPU 更新：先更新速度，再更新位置
        this.updateVelocityCommand({ deltaTime });
        this.updatePositionCommand({ deltaTime });
        
        // 切换缓冲区
        this.currentBuffer = 1 - this.currentBuffer;
    }
    
    /**
     * 渲染粒子
     */
    render(projectionMatrix) {
        this.renderParticlesCommand({
            projection: projectionMatrix
        });
    }
    
    /**
     * 清理资源
     */
    destroy() {
        this.positionFBO.forEach(fbo => fbo.destroy());
        this.velocityFBO.forEach(fbo => fbo.destroy());
        this.birthTexture.destroy();
        this.attributeTexture.destroy();
        this.particleBuffer.destroy();
        this.particleUVBuffer.destroy();
        this.quadBuffer.destroy();
    }
}

// 导出
window.ReglGPGPUParticles = ReglGPGPUParticles;

