// ============= 固定背景粒子系统 =============
// 用于渲染水和荷叶的固定粒子

class BackgroundParticles {
    constructor(reglInstance, options = {}) {
        this.regl = reglInstance;
        this.canvas = options.canvas;
        this.particles = [];
        
        // 粒子大小范围（更大更明显）
        this.sizeRange = options.sizeRange || [4.5, 7.0];
        
        console.log('BackgroundParticles 初始化');
        this._initShader();
    }
    
    _initShader() {
        // 创建渲染命令（与SimpleReglParticles相同的shader）
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
                    
                    // 更清晰的圆形边缘（减少柔化）
                    float edge = 1.0 - smoothstep(0.35, 0.5, dist);
                    
                    vec3 color = v_color;
                    float alpha = v_alpha * edge;
                    
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
        
        console.log('背景粒子渲染命令创建完成');
    }
    
    // 添加固定粒子
    addParticle(x, y, color, size = null) {
        const particleSize = size || (this.sizeRange[0] + Math.random() * (this.sizeRange[1] - this.sizeRange[0]));
        this.particles.push({
            x: x,
            y: y,
            size: particleSize,
            color: color, // [r, g, b] 0-1范围
            alpha: 0.95 + Math.random() * 0.05 // 0.95-1.0 更不透明
        });
    }
    
    // 生成水的粒子（深蓝色系，更丰富的颜色变化）
    generateWaterParticles(worldWidth, worldHeight, density = 0.85) {
        const spacing = 7; // 粒子间距（更密集）
        const cols = Math.floor(worldWidth / spacing);
        const rows = Math.floor(worldHeight / spacing);
        
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                if (Math.random() > density) continue; // 密度控制
                
                const x = col * spacing + (Math.random() - 0.5) * spacing * 0.4;
                const y = row * spacing + (Math.random() - 0.5) * spacing * 0.4;
                
                // 深蓝色系变化（从深海军蓝到浅天蓝）
                const rand = Math.random();
                let color;
                if (rand < 0.2) {
                    // 深海军蓝
                    color = [
                        (10 + Math.random() * 20) / 255,
                        (20 + Math.random() * 30) / 255,
                        (50 + Math.random() * 40) / 255
                    ];
                } else if (rand < 0.4) {
                    // 深靛蓝
                    color = [
                        (20 + Math.random() * 25) / 255,
                        (30 + Math.random() * 35) / 255,
                        (70 + Math.random() * 50) / 255
                    ];
                } else if (rand < 0.6) {
                    // 中蓝色
                    color = [
                        (30 + Math.random() * 40) / 255,
                        (60 + Math.random() * 50) / 255,
                        (120 + Math.random() * 60) / 255
                    ];
                } else if (rand < 0.8) {
                    // 浅蓝色
                    color = [
                        (70 + Math.random() * 50) / 255,
                        (130 + Math.random() * 60) / 255,
                        (200 + Math.random() * 55) / 255
                    ];
                } else {
                    // 天蓝/青色
                    color = [
                        (100 + Math.random() * 50) / 255,
                        (180 + Math.random() * 50) / 255,
                        (220 + Math.random() * 35) / 255
                    ];
                }
                
                this.addParticle(x, y, color);
            }
        }
        
        console.log(`生成了 ${this.particles.length} 个水的粒子`);
    }
    
    // 生成荷叶的粒子（主要是亮黄色，混合黄绿色和深黄色/橙色）
    generateLilyPadParticles(lilyPads) {
        let lilyPadCount = 0;
        
        for (let pad of lilyPads) {
            lilyPadCount++;
            
            // 在荷叶范围内生成粒子（更密集）
            const padRadius = pad.size;
            const particleCount = Math.floor(padRadius * padRadius * 0.25); // 增加密度
            
            for (let i = 0; i < particleCount; i++) {
                // 在椭圆范围内随机生成位置
                const angle = Math.random() * Math.PI * 2;
                const radius = Math.sqrt(Math.random()) * padRadius; // 均匀分布
                
                let x = pad.x + Math.cos(angle) * radius;
                let y = pad.y + Math.sin(angle) * radius * 0.85; // 椭圆
                
                // 检查是否在荷叶范围内
                const dx = (x - pad.x) / pad.size;
                const dy = (y - pad.y) / (pad.size * 0.85);
                if (dx * dx + dy * dy > 1) continue;
                
                // 主要是亮黄色，混合黄绿色和深黄色/橙色
                const rand = Math.random();
                let color;
                if (rand < 0.5) {
                    // 亮黄色（主要颜色）
                    color = [
                        (240 + Math.random() * 15) / 255,
                        (220 + Math.random() * 35) / 255,
                        (100 + Math.random() * 50) / 255
                    ];
                } else if (rand < 0.75) {
                    // 黄绿色
                    color = [
                        (200 + Math.random() * 40) / 255,
                        (240 + Math.random() * 15) / 255,
                        (120 + Math.random() * 50) / 255
                    ];
                } else if (rand < 0.9) {
                    // 深黄色/橙色
                    color = [
                        (220 + Math.random() * 35) / 255,
                        (180 + Math.random() * 40) / 255,
                        (80 + Math.random() * 40) / 255
                    ];
                } else {
                    // 橄榄绿（边缘）
                    color = [
                        (150 + Math.random() * 50) / 255,
                        (180 + Math.random() * 40) / 255,
                        (100 + Math.random() * 40) / 255
                    ];
                }
                
                // 中心更亮，边缘稍暗
                const distFromCenter = Math.sqrt(dx * dx + dy * dy);
                const brightness = 1.0 - distFromCenter * 0.2;
                color = color.map(c => Math.min(1.0, c * brightness));
                
                this.addParticle(x, y, color);
            }
        }
        
        console.log(`在 ${lilyPadCount} 个荷叶上生成了粒子`);
    }
    
    // 清空所有粒子
    clear() {
        this.particles = [];
    }
    
    // 渲染（固定位置，不更新）
    render(projectionMatrix, camera) {
        if (this.particles.length === 0) return;
        
        // 视野剔除
        const visibleParticles = this.particles.filter(p => {
            return camera.isInView(p.x, p.y, p.size * 2);
        });
        
        if (visibleParticles.length === 0) return;
        
        const positions = [];
        const sizes = [];
        const alphas = [];
        const colors = [];
        
        for (const p of visibleParticles) {
            // 转换到屏幕坐标
            const screenPos = camera.worldToScreen(p.x, p.y);
            positions.push(screenPos.x, screenPos.y);
            sizes.push(p.size);
            alphas.push(p.alpha);
            colors.push(p.color[0], p.color[1], p.color[2]);
        }
        
        this.renderCommand({
            projection: projectionMatrix,
            positions: positions,
            sizes: sizes,
            alphas: alphas,
            colors: colors,
            count: visibleParticles.length
        });
    }
}

window.BackgroundParticles = BackgroundParticles;

