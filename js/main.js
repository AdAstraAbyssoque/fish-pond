// ============= 主程序 =============

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const particleCanvas = document.getElementById('particle-canvas');

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
particleCanvas.width = window.innerWidth;
particleCanvas.height = window.innerHeight;

// 创建 regl 实例
const regl = createREGL({
    canvas: particleCanvas,
    extensions: ['OES_texture_float', 'OES_texture_float_linear'],
    attributes: {
        alpha: true,
        antialias: false,
        preserveDrawingBuffer: false
    }
});

window.addEventListener('resize', () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    particleCanvas.width = window.innerWidth;
    particleCanvas.height = window.innerHeight;
    
    if (particleSystem) {
        particleSystem.canvas = particleCanvas;
    }
});

// 创建鱼群
const fishes = [];
let particleSystem = null;
let playerFish = null;  // 玩家控制的鱼

// 创建离屏 canvas 用于图像采样（更大的尺寸）
const offscreenCanvas = document.createElement('canvas');
offscreenCanvas.width = 3000;
offscreenCanvas.height = 3000;
const offscreenCtx = offscreenCanvas.getContext('2d', { willReadFrequently: true });

// 创建摄像机和键盘控制
const camera = new Camera(canvas);
const keyboard = new KeyboardController();

// 地图配置
const MAP_SIZE = 2;  // 2x2 地图
const TILE_SIZE = canvas.width;  // 每个格子等于一个屏幕大小
const WORLD_WIDTH = MAP_SIZE * TILE_SIZE;
const WORLD_HEIGHT = MAP_SIZE * TILE_SIZE;

// 地图参照物
let landmarks = null;

// Debug 模式
let debugMode = false;
let debugParticleReduction = 1.0;  // 粒子数量倍率

const SCALE_STORAGE_KEY = 'pondScaleRatio';
const SCALE_RANGE = { min: 0.05, max: 1.2, default: 0.05 };

function clampScale(value) {
    return Math.min(SCALE_RANGE.max, Math.max(SCALE_RANGE.min, value));
}

function readStoredScale() {
    try {
        const stored = parseFloat(localStorage.getItem(SCALE_STORAGE_KEY));
        if (!Number.isFinite(stored)) {
            return SCALE_RANGE.default;
        }
        return clampScale(stored);
    } catch (error) {
        return SCALE_RANGE.default;
    }
}

function persistScale(value) {
    try {
        localStorage.setItem(SCALE_STORAGE_KEY, value.toString());
    } catch (error) {
        // 忽略无痕模式等导致的写入失败
    }
}

let pondScale = readStoredScale();

let scaleSlider;
let scaleValueLabel;
let resetScaleBtn;
let scaleDownBtn;
let scaleUpBtn;

function updateScaleLabel(value) {
    if (scaleValueLabel) {
        scaleValueLabel.textContent = `${Math.round(value * 100)}%`;
    }
}

function syncScaleControls() {
    if (scaleSlider) {
        scaleSlider.value = pondScale.toFixed(2);
    }
    updateScaleLabel(pondScale);
}

function cacheControlElements() {
    scaleSlider = document.getElementById('pondScaleControl');
    scaleValueLabel = document.getElementById('scaleValue');
    resetScaleBtn = document.getElementById('resetScale');
    scaleDownBtn = document.getElementById('scaleDown25');
    scaleUpBtn = document.getElementById('scaleUp20');
}

function setupScaleControls() {
    cacheControlElements();

    if (!scaleSlider) {
        return;
    }

    syncScaleControls();

    let reinitTimer = null;

    const scheduleReinit = () => {
        if (reinitTimer) {
            clearTimeout(reinitTimer);
        }
        reinitTimer = setTimeout(() => {
            persistScale(pondScale);
            initPond();
        }, 140);
    };

    scaleSlider.addEventListener('input', (event) => {
        const nextValue = parseFloat(event.target.value);
        if (Number.isFinite(nextValue)) {
            pondScale = clampScale(nextValue);
            updateScaleLabel(pondScale);
            scheduleReinit();
        }
    });

    scaleSlider.addEventListener('change', () => {
        if (reinitTimer) {
            clearTimeout(reinitTimer);
            reinitTimer = null;
        }
        persistScale(pondScale);
        initPond();
    });

    if (resetScaleBtn) {
        resetScaleBtn.addEventListener('click', () => {
            pondScale = SCALE_RANGE.default;
            syncScaleControls();
            persistScale(pondScale);
            initPond();
        });
    }

    const applyFactor = (factor) => {
        pondScale = clampScale(pondScale * factor);
        syncScaleControls();
        persistScale(pondScale);
        initPond();
    };

    if (scaleDownBtn) {
        scaleDownBtn.addEventListener('click', () => applyFactor(0.75));
    }

    if (scaleUpBtn) {
        scaleUpBtn.addEventListener('click', () => applyFactor(1.2));
    }
}

function initPond() {
    fishes.length = 0;
    playerFish = null;

    // 在 2x2 大地图中创建约 20-24 条鱼
    const fishCount = 20 + Math.floor(Math.random() * 5); // 20-24条
    const positions = [];
    
    // 在 3x3 地图中生成均匀分布的群组中心
    const groupCenters = [];
    for (let gx = 0; gx < MAP_SIZE; gx++) {
        for (let gy = 0; gy < MAP_SIZE; gy++) {
            groupCenters.push({
                x: (gx + 0.5) * TILE_SIZE,
                y: (gy + 0.5) * TILE_SIZE
            });
        }
    }
    
    // 为每条鱼找位置
    for (let i = 0; i < fishCount; i++) {
        let attempts = 0;
        let positionFound = false;
        
        while (!positionFound && attempts < 100) {
            attempts++;
            
            // 围绕群组中心生成位置
            const groupIndex = i % groupCenters.length;
            const center = groupCenters[groupIndex];
            const angle = Math.random() * Math.PI * 2;
            const radius = Math.random() * (TILE_SIZE * 0.35);
            
            const pos = {
                x: center.x + Math.cos(angle) * radius,
                y: center.y + Math.sin(angle) * radius
            };
            
            // 世界边界检查
            const margin = 300;
            pos.x = Math.max(margin, Math.min(WORLD_WIDTH - margin, pos.x));
            pos.y = Math.max(margin, Math.min(WORLD_HEIGHT - margin, pos.y));
            
            // 检查与其他鱼的距离
            let valid = true;
            for (let existing of positions) {
                const dx = pos.x - existing.x;
                const dy = pos.y - existing.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < 150) {  // 减小最小距离以容纳更多鱼
                    valid = false;
                    break;
                }
            }
            
            if (valid) {
                positions.push(pos);
                positionFound = true;
            }
        }
    }
    
    // 创建鱼
    positions.forEach((pos, idx) => {
        const fishType = idx === 0 ? 'orange' : 'white';
        const fish = new Fish(new Vec2(pos.x, pos.y), fishType, pondScale);
        fish.groupId = idx % groupCenters.length;
        fish.selected = idx === 0;
        fish.isPlayer = idx === 0;  // 标记玩家鱼
        
        fish.separationRadius = 130;
        fish.alignmentRadius = 180;
        fish.cohesionRadius = 220;
        fish.maxSpeed = 0.6 + Math.random() * 0.3;
        fish.maxForce = 0.03;
        fish.separationWeight = 2.0;
        fish.alignmentWeight = 0.6;
        fish.cohesionWeight = 0.5;
        fish.noiseWeight = 0.5;
        fish.boundaryMargin = 300;  // 更大的边界适应大地图
        fish.boundaryWeight = 2.0;
        fish.noiseScale = 0.003;
        fish.circlingDirection = Math.random() < 0.5 ? 1 : -1;
        
        fishes.push(fish);
        
        if (idx === 0) {
            playerFish = fish;
        }
    });
    
    console.log('创建了', fishes.length, '条鱼，分布在', MAP_SIZE, 'x', MAP_SIZE, '大地图');
    console.log('玩家鱼:', playerFish ? '已创建' : '未找到');
}

function bootstrap() {
    setupScaleControls();
    setupDebugControls();
    initPond();
    
    // 初始化地图参照物
    if (!landmarks) {
        console.log('生成地图参照物...');
        landmarks = new Landmarks(WORLD_WIDTH, WORLD_HEIGHT, MAP_SIZE);
    }
    
    if (!particleSystem) {
        console.log('初始化粒子系统（视野自适应）...');
        particleSystem = new SimpleReglParticles(regl, {
            canvas: particleCanvas,
            particleCount: 60000,     // 增加到 60000 以支持更多鱼
            lifeSpan: 0.12,
            sizeRange: [1.5, 2.5],
            speedRange: [0.15, 0.8],
            spawnRate: 20000,         // 提高生成率
            colorStart: [1.0, 0.4, 0.2, 0.98],
            colorEnd: [1.0, 0.6, 0.3, 0.0]
        });
        console.log('粒子系统初始化完成');
    }
}

// Debug 控制
function setupDebugControls() {
    // V 键切换 debug 模式
    window.addEventListener('keydown', (e) => {
        if (e.key.toLowerCase() === 'v') {
            debugMode = !debugMode;
            camera.debugMode = debugMode;
            console.log('Debug 模式:', debugMode ? '开启' : '关闭');
            
            // 切换时调整粒子数
            if (debugMode) {
                camera.setZoom(0.35);  // 缩小看到更大范围
                debugParticleReduction = 0.3;  // 减少到 30% 粒子
            } else {
                camera.setZoom(1.0);
                debugParticleReduction = 1.0;
            }
        }
    });
    
    // 鼠标滚轮缩放（仅 debug 模式）
    canvas.addEventListener('wheel', (e) => {
        if (debugMode) {
            e.preventDefault();
            const zoomDelta = -e.deltaY * 0.001;
            camera.setZoom(camera.targetZoom + zoomDelta);
            
            // 根据缩放调整粒子
            const zoomRatio = camera.targetZoom / camera.maxZoom;
            debugParticleReduction = Math.max(0.2, zoomRatio * 0.5);
        }
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
    bootstrap();
}

// 点击事件 - 选择鱼
canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    for (let fish of fishes) {
        if (fish.containsPoint(x, y)) {
            fishes.forEach(f => f.selected = false);
            fish.selected = true;
            break;
        }
    }
});

// 水波纹理效果
function drawWaterRipples(ctx, time) {
    const timeInSeconds = time / 1000;
    
    // 绘制缓慢移动的水波纹
    for (let i = 0; i < 8; i++) {
        const angle = (timeInSeconds * 0.1 + i * Math.PI / 4) % (Math.PI * 2);
        const x = canvas.width * 0.5 + Math.cos(angle) * 200;
        const y = canvas.height * 0.5 + Math.sin(angle) * 150;
        
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, 80);
        gradient.addColorStop(0, 'rgba(100, 130, 180, 0.02)');
        gradient.addColorStop(1, 'rgba(100, 130, 180, 0)');
        
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, 80, 0, Math.PI * 2);
        ctx.fill();
    }
}

// 绘制池塘阴影效果（深夜版）
function drawPondShadows(ctx) {
    const shadows = [
        {x: canvas.width * 0.25, y: canvas.height * 0.25, r: 200, opacity: 0.08},
        {x: canvas.width * 0.75, y: canvas.height * 0.3, r: 180, opacity: 0.06},
        {x: canvas.width * 0.5, y: canvas.height * 0.5, r: 250, opacity: 0.1},
        {x: canvas.width * 0.2, y: canvas.height * 0.7, r: 150, opacity: 0.05},
        {x: canvas.width * 0.8, y: canvas.height * 0.75, r: 170, opacity: 0.07},
    ];
    
    shadows.forEach(shadow => {
        const gradient = ctx.createRadialGradient(
            shadow.x, shadow.y, 0,
            shadow.x, shadow.y, shadow.r
        );
        gradient.addColorStop(0, `rgba(5, 10, 20, ${shadow.opacity})`);
        gradient.addColorStop(0.6, `rgba(5, 10, 20, ${shadow.opacity * 0.5})`);
        gradient.addColorStop(1, 'rgba(5, 10, 20, 0)');
        
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(shadow.x, shadow.y, shadow.r, 0, Math.PI * 2);
        ctx.fill();
    });
}

// 绘制圆形边界装饰（深夜版）
function drawPondBorders(ctx) {
    const borders = [
        {x: canvas.width * 0.15, y: canvas.height * 0.2, r: 60},
        {x: canvas.width * 0.85, y: canvas.height * 0.15, r: 45},
        {x: canvas.width * 0.1, y: canvas.height * 0.8, r: 50},
        {x: canvas.width * 0.9, y: canvas.height * 0.85, r: 55},
    ];
    
    borders.forEach(border => {
        ctx.strokeStyle = 'rgba(100, 130, 180, 0.06)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(border.x, border.y, border.r, 0, Math.PI * 2);
        ctx.stroke();
        
        // 内圈光晕
        ctx.strokeStyle = 'rgba(120, 150, 200, 0.03)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(border.x, border.y, border.r - 10, 0, Math.PI * 2);
        ctx.stroke();
    });
}

// 动画循环
let lastTime = 0;

function animate(currentTime) {
    // 计算deltaTime（秒）
    const deltaTime = lastTime === 0 ? 0 : (currentTime - lastTime) / 1000;
    lastTime = currentTime;
    
    // ===== 1. 获取玩家输入 =====
    const playerInput = keyboard.getMovementVector();
    const hasPlayerInput = keyboard.hasInput();
    
    // ===== 2. 更新所有鱼（带玩家控制） =====
    for (let fish of fishes) {
        const control = fish.isPlayer ? playerInput : null;
        fish.resolve(fishes, deltaTime, WORLD_WIDTH, WORLD_HEIGHT, control, playerFish);
    }
    
    // ===== 3. 摄像机跟随玩家鱼 =====
    if (playerFish) {
        camera.follow(playerFish.spine.joints[0], 0.08);
    }
    camera.update();
    
    // ===== 4. 视野剔除 =====
    const visibleFishes = fishes.filter(fish => {
        const head = fish.spine.joints[0];
        return camera.isInView(head.x, head.y, 300);
    });
    
    // ===== 5. 渲染背景（屏幕坐标） =====
    ctx.fillStyle = '#0a0f17';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    const gradient = ctx.createRadialGradient(
        canvas.width / 2, canvas.height * 0.4, 0,
        canvas.width / 2, canvas.height * 0.4, Math.max(canvas.width, canvas.height) * 0.9
    );
    gradient.addColorStop(0, '#1a2332');
    gradient.addColorStop(0.5, '#0f1821');
    gradient.addColorStop(1, '#0a0f17');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // 月光倒影
    const moonGlow = ctx.createRadialGradient(
        canvas.width * 0.5, canvas.height * 0.3, 0,
        canvas.width * 0.5, canvas.height * 0.3, 400
    );
    moonGlow.addColorStop(0, 'rgba(180, 200, 230, 0.08)');
    moonGlow.addColorStop(0.5, 'rgba(120, 150, 200, 0.04)');
    moonGlow.addColorStop(1, 'rgba(80, 120, 180, 0)');
    ctx.fillStyle = moonGlow;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // 水波纹理
    drawWaterRipples(ctx, currentTime);
    drawPondShadows(ctx);
    drawPondBorders(ctx);
    
    // ===== 6. 应用摄像机变换并渲染世界 =====
    camera.applyTransform(ctx);
    
    // 渲染地图参照物
    if (landmarks) {
        landmarks.render(ctx, camera, currentTime);
    }
    
    // （可选）渲染鱼的实体
    // for (let fish of visibleFishes) {
    //     fish.display(ctx);
    // }
    
    // Debug: 绘制世界边界
    if (debugMode) {
        ctx.strokeStyle = 'rgba(255, 0, 0, 0.3)';
        ctx.lineWidth = 3;
        ctx.strokeRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
        
        // 绘制网格
        ctx.strokeStyle = 'rgba(100, 100, 255, 0.2)';
        ctx.lineWidth = 1;
        for (let i = 1; i < MAP_SIZE; i++) {
            ctx.beginPath();
            ctx.moveTo(i * TILE_SIZE, 0);
            ctx.lineTo(i * TILE_SIZE, WORLD_HEIGHT);
            ctx.stroke();
            
            ctx.beginPath();
            ctx.moveTo(0, i * TILE_SIZE);
            ctx.lineTo(WORLD_WIDTH, i * TILE_SIZE);
            ctx.stroke();
        }
    }
    
    camera.restoreTransform(ctx);
    
    // ===== 7. 粒子系统（只处理可见的鱼） =====
    if (particleSystem && visibleFishes.length > 0) {
        // 根据 debug 模式调整采样密度
        const sampleDensity = debugMode ? 3 : 1;  // debug 模式粗采样
        
        const allSkeletonPoints = [];
        for (let fish of visibleFishes) {
            const points = fish.sampleBodyPointsFromImage(offscreenCtx, sampleDensity);
            
            // 转换到屏幕坐标
            const screenPoints = points.map(p => {
                const screenPos = camera.worldToScreen(p.x, p.y);
                return { ...p, x: screenPos.x, y: screenPos.y };
            });
            
            // Debug 模式时进一步降低粒子生成率
            if (debugMode) {
                const reduction = Math.floor(1 / debugParticleReduction);
                for (let i = 0; i < screenPoints.length; i += reduction) {
                    allSkeletonPoints.push(screenPoints[i]);
                }
            } else {
                allSkeletonPoints.push(...screenPoints);
            }
        }
        
        // 调试信息
        if (Math.random() < 0.016) {
            console.log(
                '视野内鱼:', visibleFishes.length, '/', fishes.length,
                '采样点:', allSkeletonPoints.length,
                '活跃粒子:', particleSystem.particles.length,
                'Debug:', debugMode ? `开(${(debugParticleReduction * 100).toFixed(0)}%)` : '关'
            );
        }
        
        particleSystem.update(deltaTime, allSkeletonPoints);
        
        // 创建正交投影矩阵
        const projection = [
            2 / canvas.width, 0, 0, 0,
            0, -2 / canvas.height, 0, 0,
            0, 0, 1, 0,
            -1, 1, 0, 1
        ];
        
        regl.clear({ color: [0, 0, 0, 0], depth: 1 });
        particleSystem.render(projection);
    }
    
    // ===== 8. 屏幕空间 UI =====
    ctx.save();
    ctx.fillStyle = 'rgba(100, 200, 255, 0.6)';
    ctx.font = '14px monospace';
    const infoText = `玩家: (${Math.floor(playerFish?.spine.joints[0].x || 0)}, ${Math.floor(playerFish?.spine.joints[0].y || 0)}) | 视野: ${visibleFishes.length}/${fishes.length} 鱼 | Zoom: ${camera.zoom.toFixed(2)}x`;
    ctx.fillText(infoText, 10, canvas.height - 20);
    ctx.restore();

    requestAnimationFrame(animate);
}

requestAnimationFrame(animate);

