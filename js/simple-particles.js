// ============= 简化版 Regl 粒子系统 =============

class SimpleReglParticles {
    constructor(reglInstance, options = {}) {
        this.regl = reglInstance;
        this.maxParticles = options.particleCount || 300000;
        this.canvas = options.canvas;
        
        this.config = {
            lifeSpan: options.lifeSpan || 2.0,
            sizeRange: options.sizeRange || [2.0, 4.0],
            speedRange: options.speedRange || [20.0, 60.0],
            colorStart: options.colorStart || [1.0, 1.0, 1.0, 1.0],
            colorEnd: options.colorEnd || [1.0, 1.0, 1.0, 0.0]
        };
        
        this.particles = [];
        this.spawnRate = options.spawnRate || 2000;
        this.spawnAccumulator = 0;
        this.time = 0;
        
        console.log('SimpleReglParticles 初始化，最大粒子数:', this.maxParticles);
        
        this._initShader();
    }
    
    _initShader() {
        // 创建渲染命令
        this.renderCommand = this.regl({
            vert: `
                precision highp float;
                attribute vec2 a_position;
                attribute float a_size;
                attribute float a_alpha;
                attribute vec3 a_color;
                
                uniform mat4 u_projection;
                varying float v_alpha;
                varying vec3 v_color;
                
                void main() {
                    v_alpha = a_alpha;
                    v_color = a_color;
                    gl_Position = u_projection * vec4(a_position, 0.0, 1.0);
                    gl_PointSize = a_size;
                }
            `,
            frag: `
                precision highp float;
                varying float v_alpha;
                varying vec3 v_color;
                
                void main() {
                    // 圆形粒子
                    vec2 coord = gl_PointCoord - vec2(0.5);
                    float dist = length(coord);
                    if (dist > 0.5) {
                        discard;
                    }
                    
                    // 柔和边缘与发光效果
                    float edge = 1.0 - smoothstep(0.25, 0.5, dist);
                    float glow = 1.0 - smoothstep(0.0, 0.5, dist);
                    
                    vec3 color = v_color;
                    float alpha = v_alpha * edge * 0.95 + glow * v_alpha * 0.3;
                    
                    gl_FragColor = vec4(color, alpha);
                }
            `,
            attributes: {
                a_position: this.regl.prop('positions'),
                a_size: this.regl.prop('sizes'),
                a_alpha: this.regl.prop('alphas'),
                a_color: this.regl.prop('colors')
            },
            uniforms: {
                u_projection: this.regl.prop('projection')
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
            count: this.regl.prop('count'),
            primitive: 'points'
        });
        
        console.log('渲染命令创建完成');
    }
    
    spawnParticle(x, y, color = null, isTail = false, tailProgress = 0, isDead = false, modeAlpha = 1) {
        if (this.particles.length >= this.maxParticles) {
            this.particles.shift(); // 移除最老的粒子
        }
        
        // 根据是否是尾巴调整参数
        let speed, lifeMultiplier, sizeMultiplier;
        
        if (isDead) {
            // 鲸落/散开粒子：爆发速度，持续更久
            speed = 12.0 + Math.random() * 14.0; 
            lifeMultiplier = 20.0; // 大幅拉长寿命
            sizeMultiplier = 1.1;
        } else if (isTail) {
            // 尾巴粒子：更大速度，更长生命，更大尺寸
            speed = (1.0 + tailProgress * 3.0) + Math.random() * 2.0; // 尾尖速度更大
            lifeMultiplier = 1.5 + tailProgress * 1.5; // 尾巴生命更长
            sizeMultiplier = 1.2 + tailProgress * 0.5; // 尾巴粒子更大
        } else {
            // 身体粒子：极小速度
            speed = 0.3 + Math.random() * 1.0;
            lifeMultiplier = 1.0;
            sizeMultiplier = 1.0;
        }
        
        const angle = Math.random() * Math.PI * 2;
        const baseSize = this.config.sizeRange[0] + 
                        Math.random() * (this.config.sizeRange[1] - this.config.sizeRange[0]);
        
        const particle = {
            x: x,
            y: y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life: this.config.lifeSpan * lifeMultiplier,
            initialLife: this.config.lifeSpan * lifeMultiplier,
            size: baseSize * sizeMultiplier,
            color: color || this.config.colorStart,
            isTail: isTail,
            isDead: isDead,
            modeAlpha: modeAlpha
        };
        
        // 散开粒子不需要额外的重力下沉，让它们自然散开
        
        this.particles.push(particle);
    }
    
    // 新增：粒子爆发（用于鲸落散开）
    explode(points, modeAlpha = 1) {
        if (!points || points.length === 0) return;
        
        // 对每个采样点生成 1-2 个粒子
        for (const point of points) {
            // 随机生成 1 或 2 个粒子
            const count = Math.random() < 0.5 ? 1 : 2;
            for (let i = 0; i < count; i++) {
                // 添加一点位置抖动
                const jitterX = (Math.random() - 0.5) * 4;
                const jitterY = (Math.random() - 0.5) * 4;
                
                this.spawnParticle(
                    point.x + jitterX, 
                    point.y + jitterY, 
                    point.color, 
                    false, 
                    0, 
                    true, // isDead = true，触发散开物理参数
                    modeAlpha
                );
            }
        }
    }
    
    update(deltaTime, skeletonPoints, modeAlpha = 1) {
        this.time += deltaTime;
        
        // 更新现有粒子
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.life -= deltaTime;
            
            if (p.life <= 0) {
                this.particles.splice(i, 1);
                continue;
            }
            
            // 更新位置
            p.x += p.vx * deltaTime;
            p.y += p.vy * deltaTime;
            
            // 根据是否是尾巴粒子调整阻尼
            if (p.isDead) {
                // 散开粒子：中等阻尼，让其滑行一段距离
                p.vx *= 0.92;
                p.vy *= 0.92;
            } else if (p.isTail) {
                // 尾巴粒子：更小阻尼，保持飘逸感
                p.vx *= 0.96;
                p.vy *= 0.96;
            } else {
                // 身体粒子：强阻尼
                p.vx *= 0.90;
                p.vy *= 0.90;
            }
        }
        
        // 生成新粒子 - 在鱼体的每个采样点都生成粒子
        if (skeletonPoints && skeletonPoints.length > 0) {
            // 高频率生成，让粒子覆盖整个鱼体
            this.spawnAccumulator += deltaTime * this.spawnRate;
            const spawnCount = Math.floor(this.spawnAccumulator);
            
            if (spawnCount > 0) {
                this.spawnAccumulator -= spawnCount;
                
                // 在所有骨骼点上生成粒子（带颜色和尾巴信息）
                for (let i = 0; i < spawnCount; i++) {
                    const point = skeletonPoints[Math.floor(Math.random() * skeletonPoints.length)];
                    
                    // 如果是尸体粒子，保留更多粒子(30%)，但单个粒子更透明，形成厚重感
                    if (point.isDead && Math.random() > 0.3) {
                        continue;
                    }
                    
                    this.spawnParticle(
                        point.x, 
                        point.y, 
                        point.color, 
                        point.isTail || false, 
                        point.tailProgress || 0,
                        point.isDead || false,
                        modeAlpha
                    );
                }
            }
        }
    }
    
    render(projectionMatrix, camera = null) {
        if (this.particles.length === 0) return;
        
        const positions = [];
        const sizes = [];
        const alphas = [];
        const colors = [];
        
        for (const p of this.particles) {
            // 将世界坐标转换到屏幕坐标（随摄像机移动）
            const screenX = camera ? (p.x - camera.x) * camera.zoom : p.x;
            const screenY = camera ? (p.y - camera.y) * camera.zoom : p.y;
            positions.push(screenX, screenY);

            // 粒子尺寸随缩放变化，保持在世界中的相对尺寸
            const sizeScale = camera ? camera.zoom : 1;
            sizes.push(p.size * (p.life / p.initialLife) * sizeScale);

            const alpha = (p.life / p.initialLife) * (p.modeAlpha !== undefined ? p.modeAlpha : 1);
            alphas.push(alpha);
            
            // 使用粒子自身的颜色，尾巴粒子增强亮度
            if (p.color && p.color.length >= 3) {
                if (p.isTail) {
                    // 尾巴粒子增加亮度，更醒目
                    const brightnessFactor = 1.3;
                    colors.push(
                        Math.min(1.0, p.color[0] * brightnessFactor),
                        Math.min(1.0, p.color[1] * brightnessFactor),
                        Math.min(1.0, p.color[2] * brightnessFactor)
                    );
                } else {
                    colors.push(p.color[0], p.color[1], p.color[2]);
                }
            } else {
                colors.push(1.0, 0.4, 0.2);  // default orange-red
            }
        }
        
        this.renderCommand({
            projection: projectionMatrix,
            positions: positions,
            sizes: sizes,
            alphas: alphas,
            colors: colors,
            count: this.particles.length
        });
    }
    
    destroy() {
        this.particles = [];
    }
}

window.SimpleReglParticles = SimpleReglParticles;
