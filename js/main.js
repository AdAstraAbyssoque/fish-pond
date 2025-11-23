// ============= 主程序 =============

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const particleCanvas = document.getElementById('particle-canvas');
const overlayCanvas = document.getElementById('overlay-canvas');
const overlayCtx = overlayCanvas.getContext('2d');

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
particleCanvas.width = window.innerWidth;
particleCanvas.height = window.innerHeight;
overlayCanvas.width = window.innerWidth;
overlayCanvas.height = window.innerHeight;

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
    overlayCanvas.width = window.innerWidth;
    overlayCanvas.height = window.innerHeight;
    
    // 更新摄像机的视野尺寸
    camera.viewWidth = canvas.width;
    camera.viewHeight = canvas.height;
    
    if (particleSystem) {
        particleSystem.canvas = particleCanvas;
    }
});

// 创建鱼群
const fishes = [];
let particleSystem = null;
let backgroundImage = null; // 池塘背景图片
let lotusImage = null; // 荷叶遮罩图片
let collisionMaskImage = null; // 碰撞遮罩图片
let collisionMaskData = null; // 碰撞遮罩的像素数据
let playerFish = null;  // 玩家控制的鱼
let normalZoom = 1.0; // 正常模式下的缩放（会在图片加载后更新）
const ecosystemUI = {};
const assetReady = { background: false, collision: false };

// 创建离屏 canvas 用于图像采样（更大的尺寸）
const offscreenCanvas = document.createElement('canvas');
offscreenCanvas.width = 3000;
offscreenCanvas.height = 3000;
const offscreenCtx = offscreenCanvas.getContext('2d', { willReadFrequently: true });

// 创建离屏 canvas 用于碰撞检测遮罩
const collisionCanvas = document.createElement('canvas');
const collisionCtx = collisionCanvas.getContext('2d', { willReadFrequently: true });

// 创建摄像机和键盘控制
const camera = new Camera(canvas);
const keyboard = new KeyboardController();

// 地图配置（将在背景图片加载后更新）
let WORLD_WIDTH = canvas.width * 2;  // 默认值，将在图片加载后更新
let WORLD_HEIGHT = canvas.height * 2;  // 默认值，将在图片加载后更新

// 地图参照物
let landmarks = null;

function setWorldSize(width, height) {
    WORLD_WIDTH = width;
    WORLD_HEIGHT = height;
    console.log('地图尺寸更新为:', WORLD_WIDTH, 'x', WORLD_HEIGHT);
    
    const zoomX = canvas.width / WORLD_WIDTH;
    const zoomY = canvas.height / WORLD_HEIGHT;
        const fitZoom = Math.min(zoomX, zoomY);
        // 稍微放大，避免背景看起来过小；同时遵守摄像机上下限
        normalZoom = Math.max(camera.minZoom, Math.min(camera.maxZoom, fitZoom * 1.4));
        camera.zoom = normalZoom;
        camera.targetZoom = normalZoom;
    console.log('正常缩放 (~1/3池塘):', normalZoom.toFixed(3));
        console.log('整个池塘缩放:', (fitZoom * 0.95).toFixed(3));
    
    if (landmarks) {
        const mapSize = Math.ceil(Math.max(WORLD_WIDTH, WORLD_HEIGHT) / canvas.width);
        landmarks = new Landmarks(WORLD_WIDTH, WORLD_HEIGHT, mapSize);
    }
}

// Debug 模式
let debugMode = false;
let debugParticleReduction = 1.0;  // 粒子数量倍率

const SCALE_STORAGE_KEY = 'pondScaleRatio';
const SCALE_RANGE = { min: 0.05, max: 1.2, default: 0.6 };  // 更大的鱼（60%）

// 粒子与生态模型的基础参数
const BASE_PARTICLE_SPAWN_RATE = 28000;

// 生态稳态/传感器状态
let homeostasis = null;
let sensorStream = null;
let lastEcosystemSnapshot = null;

function clampScale(value) {
    return Math.min(SCALE_RANGE.max, Math.max(SCALE_RANGE.min, value));
}

function allAssetsReady() {
    return assetReady.background && assetReady.collision;
}

function getEcoModifiers(snapshot) {
    if (!snapshot) {
        return {
            speedMultiplier: 1,
            noiseMultiplier: 1,
            vividBoost: 1,
            boundarySlowdown: 1
        };
    }
    const panic = clamp01(snapshot.panic);
    const speedMultiplier = 1 + panic * 0.8;       // 越惊慌越快
    const noiseMultiplier = 1 + panic * 0.9;       // 方向不确定性提升
    const vividBoost = 1 + panic * 0.6;            // 颜色更鲜艳
    const boundarySlowdown = 1 - Math.min(0.7, panic * 0.85); // 贴边时减速
    return { speedMultiplier, noiseMultiplier, vividBoost, boundarySlowdown };
}

function clamp01(value) {
    return Math.max(0, Math.min(1, value));
}

function damp(current, target, speed, deltaTime) {
    const t = 1 - Math.exp(-speed * deltaTime);
    return current + (target - current) * t;
}

function randomRange(min, max) {
    return min + Math.random() * (max - min);
}

function randomUnitVector3() {
    const theta = Math.random() * Math.PI * 2;
    const z = Math.random() * 2 - 1;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    return {
        x: Math.cos(theta) * r,
        y: Math.sin(theta) * r,
        z
    };
}

// 生态稳态模型：把传感器的加速度映射为池塘“压力”和“健康度”
class PondHomeostasis {
    constructor() {
        this.sensor = { x: 0, y: 0, z: 0, a: 0, magnitude: 0, phase: '静水' };
        this.panic = 0;       // 瞬时动荡度
        this.stability = 1;   // 系统稳态（目标靠近1）
        this.health = 1;      // 鱼群健康/活力
        this.capacity = 1;    // 池塘承载力（掉下去后不完全恢复）
        this.collapseDebt = 0;
    }

    receiveSensor(vector) {
        this.sensor = { ...vector };
    }

    step(deltaTime) {
        const magnitude = Math.sqrt(
            this.sensor.x * this.sensor.x +
            this.sensor.y * this.sensor.y +
            this.sensor.z * this.sensor.z
        );
        const jerk = Math.abs(this.sensor.a);

        // 将加速度映射为动荡度，a 维度提供额外“突发”权重
        const agitation = clamp01(magnitude * 0.045 + jerk * 0.18);
        this.panic = damp(this.panic, agitation, 3.4, deltaTime);

        // 稳态越高，恢复力越强；动荡越高，稳态越低
        const stabilityTarget = clamp01(1 - this.panic * 0.9 + this.capacity * 0.12);
        this.stability = damp(this.stability, stabilityTarget, 2.2, deltaTime);

        // 恢复与伤害，结合稳态与动荡
        const damage = (0.36 + this.collapseDebt * 0.65) * Math.pow(this.panic, 1.25);
        const recovery = Math.max(0, this.stability - this.health) *
            (0.55 * this.capacity) *
            (1 - this.panic * 0.75);
        this.health = clamp01(this.health + (recovery - damage) * deltaTime);

        // 低于阈值后触发不可逆的承载力衰减
        if (this.health < 0.24) {
            this.collapseDebt = clamp01(this.collapseDebt + (0.11 + this.panic * 0.45) * deltaTime);
            this.capacity = Math.max(0.32, 1 - this.collapseDebt);
        }

        const fishIntegrity = clamp01(this.health * this.capacity * (1 - this.panic * 0.25));
        const particleMultiplier = clamp01(0.28 + fishIntegrity * 0.9);

        return {
            sensor: this.sensor,
            panic: this.panic,
            instability: agitation,
            stability: this.stability,
            health: this.health,
            capacity: this.capacity,
            irreversible: this.capacity < 0.99,
            fishIntegrity,
            particleMultiplier
        };
    }

    getFishIntegrity(offset = 0) {
        const base = clamp01(this.health * this.capacity * (1 - this.panic * 0.3));
        return clamp01(base * (1 + offset));
    }

    getParticleMultiplier() {
        const base = clamp01(this.health * this.capacity);
        const panicLoss = 0.25 + this.panic * 0.55;
        return clamp01(0.25 + base * (1 - panicLoss * 0.6));
    }
}

// ============= 加速度数据流 =============

// 配置：使用真实传感器还是模拟数据
const USE_REAL_SENSOR = true;  // 改为 false 使用模拟数据
const WEBSOCKET_URL = 'ws://localhost:8765';

// 模拟一个"Python 后端"源源推送四维加速度（x, y, z, a）
function createMockAccelerometerStream() {
    const listeners = [];
    const phases = [
        { name: '静水', base: 0.6, spread: 0.8, jerk: [0.03, 0.18], duration: [5, 9] },
        { name: '微扰', base: 2.4, spread: 1.6, jerk: [0.25, 0.8], duration: [6, 10] },
        { name: '惊扰', base: 6.5, spread: 3.2, jerk: [0.7, 2.1], duration: [3, 5.5] }
    ];
    let currentPhase = { ...phases[0], remaining: randomRange(phases[0].duration[0], phases[0].duration[1]) };
    let lastVector = { x: 0, y: 0, z: 0, a: 0, magnitude: 0, phase: currentPhase.name };
    const intervalMs = 320;

    const pickPhase = (lastName) => {
        const candidates = phases.filter(p => p.name !== lastName || Math.random() < 0.35);
        const next = candidates[Math.floor(Math.random() * candidates.length)];
        return { ...next, remaining: randomRange(next.duration[0], next.duration[1]) };
    };

    const tick = () => {
        currentPhase.remaining -= intervalMs / 1000;
        if (currentPhase.remaining <= 0) {
            currentPhase = pickPhase(currentPhase.name);
        }

        const dir = randomUnitVector3();
        const magnitude = Math.max(0, currentPhase.base + (Math.random() - 0.5) * currentPhase.spread * 2);
        const jerk = randomRange(currentPhase.jerk[0], currentPhase.jerk[1]) * (Math.random() < 0.18 ? 2.4 : 1);

        lastVector = {
            x: dir.x * magnitude + randomRange(-0.6, 0.6),
            y: dir.y * magnitude + randomRange(-0.6, 0.6),
            z: dir.z * magnitude + randomRange(-0.6, 0.6),
            a: jerk,
            magnitude,
            phase: currentPhase.name
        };

        listeners.forEach(cb => cb(lastVector));
    };

    const timer = setInterval(tick, intervalMs);

    return {
        onData(callback) {
            listeners.push(callback);
        },
        getLatest() {
            return lastVector;
        },
        stop() {
            clearInterval(timer);
        }
    };
}

// 真实传感器数据流（通过 WebSocket 连接 Python 后端）
function createRealAccelerometerStream() {
    const listeners = [];
    let lastVector = { x: 0, y: 0, z: 0, a: 0, magnitude: 0, phase: '静水' };
    let ws = null;
    let reconnectTimer = null;
    let isConnected = false;

    const connect = () => {
        console.log(`正在连接传感器服务器: ${WEBSOCKET_URL}`);
        
        try {
            ws = new WebSocket(WEBSOCKET_URL);
            
            ws.onopen = () => {
                console.log('✅ 传感器已连接');
                isConnected = true;
                
                // 显示连接状态
                const statusDiv = document.getElementById('sensor-status');
                if (statusDiv) {
                    statusDiv.textContent = '🟢 传感器已连接';
                    statusDiv.style.color = '#00ff00';
                }
            };
            
            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    
                    // 将传感器数据映射到我们的格式
                    lastVector = {
                        x: data.x || 0,
                        y: data.y || 0,
                        z: data.z || 0,
                        a: data.a || 0,
                        magnitude: data.magnitude || 0,
                        phase: data.phase || '静水',
                        // 保留额外的传感器数据
                        AngX: data.AngX,
                        AngY: data.AngY,
                        AngZ: data.AngZ
                    };
                    
                    // 通知所有监听器
                    listeners.forEach(cb => cb(lastVector));
                    
                } catch (error) {
                    console.error('解析传感器数据失败:', error);
                }
            };
            
            ws.onerror = (error) => {
                console.error('❌ WebSocket 错误:', error);
                isConnected = false;
            };
            
            ws.onclose = () => {
                console.log('🔴 传感器连接已断开');
                isConnected = false;
                
                const statusDiv = document.getElementById('sensor-status');
                if (statusDiv) {
                    statusDiv.textContent = '🔴 传感器已断开，尝试重连...';
                    statusDiv.style.color = '#ff9900';
                }
                
                // 5秒后尝试重连
                reconnectTimer = setTimeout(() => {
                    console.log('尝试重新连接传感器...');
                    connect();
                }, 5000);
            };
            
        } catch (error) {
            console.error('创建 WebSocket 连接失败:', error);
            
            // 5秒后尝试重连
            reconnectTimer = setTimeout(connect, 5000);
        }
    };
    
    // 立即连接
    connect();
    
    return {
        onData(callback) {
            listeners.push(callback);
        },
        getLatest() {
            return lastVector;
        },
        isConnected() {
            return isConnected;
        },
        stop() {
            if (reconnectTimer) {
                clearTimeout(reconnectTimer);
            }
            if (ws) {
                ws.close();
            }
        }
    };
}

// 工厂函数：根据配置创建数据流
function createAccelerometerStream() {
    if (USE_REAL_SENSOR) {
        console.log('🔧 使用真实传感器数据');
        return createRealAccelerometerStream();
    } else {
        console.log('🔧 使用模拟传感器数据');
        return createMockAccelerometerStream();
    }
}

// 立即创建一个稳态模型，等 bootstrap 后绑定模拟数据流
homeostasis = new PondHomeostasis();

// ============= 碰撞检测系统 =============

// 检查某个位置是否可以通过（亮色区域为可通过，深色为不可通过）
function isPositionWalkable(x, y) {
    if (!collisionMaskData || !collisionMaskImage) {
        return true; // 如果没有碰撞遮罩，默认可通过
    }
    
    // 边界检查
    if (x < 0 || y < 0 || x >= WORLD_WIDTH || y >= WORLD_HEIGHT) {
        return false;
    }
    
    // 转换到图片坐标
    const imgX = Math.floor(x);
    const imgY = Math.floor(y);
    
    // 边界检查（防止越界）
    if (imgX < 0 || imgY < 0 || imgX >= collisionMaskImage.width || imgY >= collisionMaskImage.height) {
        return false;
    }
    
    // 计算像素索引（RGBA格式）
    const index = (imgY * collisionMaskImage.width + imgX) * 4;
    
    // 获取 RGB 值
    const r = collisionMaskData.data[index];
    const g = collisionMaskData.data[index + 1];
    const b = collisionMaskData.data[index + 2];
    
    // 计算亮度（luminance）：亮色（白色/浅色）= 池塘可通过，深色 = 岸边不可通过
    const brightness = (r * 0.299 + g * 0.587 + b * 0.114);
    
    // 亮度 > 200 认为是可通过区域（池塘），否则是岸边
    return brightness > 200;
}

// 暴露到全局作用域，供 Fish 类使用
window.isPositionWalkable = isPositionWalkable;

// 加载碰撞遮罩并提取像素数据
function loadCollisionMask(imageSrc, callback) {
    collisionMaskImage = new Image();
    collisionMaskImage.src = imageSrc;
    
    collisionMaskImage.onload = () => {
        console.log('碰撞遮罩加载完成，尺寸:', collisionMaskImage.width, 'x', collisionMaskImage.height);
        
        // 设置碰撞 canvas 尺寸
        collisionCanvas.width = collisionMaskImage.width;
        collisionCanvas.height = collisionMaskImage.height;
        
        // 绘制图片到离屏 canvas
        collisionCtx.clearRect(0, 0, collisionCanvas.width, collisionCanvas.height);
        collisionCtx.drawImage(collisionMaskImage, 0, 0);
        
        // 提取像素数据
        collisionMaskData = collisionCtx.getImageData(0, 0, collisionCanvas.width, collisionCanvas.height);
        console.log('碰撞遮罩像素数据已提取');
        
        // 测试几个点的亮度值
        const testPoints = [
            { x: Math.floor(collisionCanvas.width / 2), y: Math.floor(collisionCanvas.height / 2), desc: '中心' },
            { x: 50, y: 50, desc: '左上角' },
            { x: collisionCanvas.width - 50, y: 50, desc: '右上角' },
            { x: 200, y: 200, desc: '测试点1' },
        ];
        console.log('碰撞遮罩采样测试:');
        for (let point of testPoints) {
            const idx = (point.y * collisionCanvas.width + point.x) * 4;
            const r = collisionMaskData.data[idx];
            const g = collisionMaskData.data[idx + 1];
            const b = collisionMaskData.data[idx + 2];
            const brightness = (r * 0.299 + g * 0.587 + b * 0.114);
            console.log(`  ${point.desc} (${point.x}, ${point.y}): RGB(${r},${g},${b}), 亮度=${brightness.toFixed(1)}, 可通过=${brightness > 200}`);
        }
        
        if (callback) callback();
        
        // 如果背景已加载且尺寸不一致，优先使用遮罩尺寸并提示
        if (backgroundImage) {
            if (backgroundImage.width !== collisionMaskImage.width || backgroundImage.height !== collisionMaskImage.height) {
                console.warn('背景与碰撞遮罩尺寸不一致，采用遮罩尺寸驱动世界坐标');
            }
            setWorldSize(collisionMaskImage.width, collisionMaskImage.height);
        } else {
            setWorldSize(collisionMaskImage.width, collisionMaskImage.height);
        }
    };
    
    collisionMaskImage.onerror = () => {
        console.error('碰撞遮罩加载失败');
        assetReady.collision = true;
        if (allAssetsReady()) {
            initPond();
        }
    };
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

function setupEcosystemPanel() {
    ecosystemUI.panel = document.getElementById('eco-panel');
    ecosystemUI.vector = document.getElementById('sensorVector');
    ecosystemUI.phase = document.getElementById('sensorPhase');
    ecosystemUI.panicBar = document.getElementById('panicBar');
    ecosystemUI.stabilityBar = document.getElementById('stabilityBar');
    ecosystemUI.healthBar = document.getElementById('healthBar');
    ecosystemUI.capacity = document.getElementById('ecoCapacity');
    ecosystemUI.note = document.getElementById('ecoNote');
    ecosystemUI.panicValue = document.getElementById('panicValue');
    ecosystemUI.stabilityValue = document.getElementById('stabilityValue');
    ecosystemUI.healthValue = document.getElementById('healthValue');
}

function updateEcosystemPanelUI(snapshot) {
    if (!snapshot || !ecosystemUI.panel) {
        return;
    }
    
    const { sensor, panic, stability, health, capacity, irreversible } = snapshot;
    const formatPercent = (value) => `${Math.round(clamp01(value) * 100)}%`;

    if (ecosystemUI.vector) {
        ecosystemUI.vector.textContent = `${sensor.x.toFixed(2)}, ${sensor.y.toFixed(2)}, ${sensor.z.toFixed(2)}, ${sensor.a.toFixed(2)}`;
    }
    if (ecosystemUI.phase) {
        ecosystemUI.phase.textContent = sensor.phase || '静水';
    }

    const applyBar = (el, value) => {
        if (el) {
            const percent = clamp01(value) * 100;
            el.style.width = `${percent}%`;
        }
    };

    applyBar(ecosystemUI.panicBar, panic);
    applyBar(ecosystemUI.stabilityBar, stability);
    applyBar(ecosystemUI.healthBar, health);

    if (ecosystemUI.panicValue) {
        ecosystemUI.panicValue.textContent = formatPercent(panic);
    }
    if (ecosystemUI.stabilityValue) {
        ecosystemUI.stabilityValue.textContent = formatPercent(stability);
    }
    if (ecosystemUI.healthValue) {
        ecosystemUI.healthValue.textContent = formatPercent(health);
    }

    if (ecosystemUI.capacity) {
        ecosystemUI.capacity.textContent = `承载力 ${formatPercent(capacity)}`;
        ecosystemUI.capacity.classList.toggle('warn', irreversible);
    }

    if (ecosystemUI.note) {
        ecosystemUI.note.textContent = irreversible
            ? '超过崩塌阈值：鱼群粒子上限被压低，需要长时间稳定才能缓慢恢复。'
            : '越温和越接近稳态，轻微动荡后会自动修复鱼群粒子。';
    }
}

// ===== 涟漪系统 =====
class Ripple {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.radius = 0;
        this.maxRadius = 150 + Math.random() * 100; // 150-250
        this.speed = 120 + Math.random() * 80; // 120-200 像素/秒
        this.alpha = 1.0;
        this.lifespan = 2.0; // 生命周期（秒）
        this.age = 0;
    }
    
    update(deltaTime) {
        this.age += deltaTime;
        this.radius += this.speed * deltaTime;
        // 淡出效果
        this.alpha = Math.max(0, 1.0 - (this.age / this.lifespan));
        return this.age < this.lifespan;
    }
    
    render(ctx) {
        if (this.alpha <= 0) return;
        
        ctx.save();
        ctx.strokeStyle = `rgba(255, 255, 255, ${this.alpha * 0.4})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }
}

let activeRipples = [];
const fishLastPositions = new Map();
const RIPPLE_TRIGGER_DISTANCE = 300; // 每移动 300 像素可能触发一次涟漪
const RIPPLE_TRIGGER_CHANCE = 0.08; // 8% 的概率触发

function createRipple(x, y) {
    activeRipples.push(new Ripple(x, y));
}

function updateRipples(deltaTime) {
    activeRipples = activeRipples.filter(ripple => ripple.update(deltaTime));
}

function renderRipples(ctx, camera) {
    for (const ripple of activeRipples) {
        ripple.render(ctx);
    }
}

function checkFishMovementForRipples(deltaTime) {
    for (const fish of fishes) {
        const head = fish.spine.joints[0];
        const fishId = fishes.indexOf(fish);
        
        if (!fishLastPositions.has(fishId)) {
            fishLastPositions.set(fishId, { x: head.x, y: head.y, distance: 0 });
            continue;
        }
        
        const lastData = fishLastPositions.get(fishId);
        const dx = head.x - lastData.x;
        const dy = head.y - lastData.y;
        const movedDistance = Math.sqrt(dx * dx + dy * dy);
        
        lastData.distance += movedDistance;
        
        if (lastData.distance >= RIPPLE_TRIGGER_DISTANCE) {
            if (Math.random() < RIPPLE_TRIGGER_CHANCE) {
                createRipple(head.x, head.y);
            }
            lastData.distance = 0;
        }
        
        lastData.x = head.x;
        lastData.y = head.y;
    }
}

function initPond() {
    if (!allAssetsReady()) {
        console.log('资源未就绪，延迟初始化池塘');
        return;
    }
    
    fishes.length = 0;
    playerFish = null;
    
    // 重置涟漪系统
    fishLastPositions.clear();
    activeRipples = [];

    // 在地图中创建约 20-24 条鱼
    const fishCount = 20 + Math.floor(Math.random() * 5); // 20-24条
    const positions = [];
    
    // 在地图中生成均匀分布的群组中心（使用 3x3 网格）
    const gridSize = 3;
    const tileWidth = WORLD_WIDTH / gridSize;
    const tileHeight = WORLD_HEIGHT / gridSize;
    const groupCenters = [];
    for (let gx = 0; gx < gridSize; gx++) {
        for (let gy = 0; gy < gridSize; gy++) {
            groupCenters.push({
                x: (gx + 0.5) * tileWidth,
                y: (gy + 0.5) * tileHeight
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
            const radius = Math.random() * (Math.min(tileWidth, tileHeight) * 0.35);
            
            const pos = {
                x: center.x + Math.cos(angle) * radius,
                y: center.y + Math.sin(angle) * radius
            };
            
            // 世界边界检查
            const margin = 300;
            pos.x = Math.max(margin, Math.min(WORLD_WIDTH - margin, pos.x));
            pos.y = Math.max(margin, Math.min(WORLD_HEIGHT - margin, pos.y));
            
            // 检查是否在可通行区域（碰撞检测）
            if (window.isPositionWalkable && !window.isPositionWalkable(pos.x, pos.y)) {
                continue; // 不在可通行区域，跳过
            }
            
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
        fish.maxSpeed = (0.6 + Math.random() * 0.3) * 0.67 * 0.5; // 速度减慢1/3后再减慢1/2
        fish.baseMaxSpeed = fish.maxSpeed; // 动态动荡放大/回落时以当前速度为基准
        fish.maxForce = 0.03;
        fish.separationWeight = 2.0;
        fish.alignmentWeight = 0.6;
        fish.cohesionWeight = 0.5;
        fish.noiseWeight = 0.5;
        fish.baseNoiseWeight = fish.noiseWeight;
        fish.boundaryMargin = 300;  // 更大的边界适应大地图
        fish.boundaryWeight = 2.0;
        fish.noiseScale = 0.003;
        fish.circlingDirection = Math.random() < 0.5 ? 1 : -1;
        fish.ecoSensitivity = (Math.random() - 0.5) * 0.3; // 个体对生态波动的敏感度差异
        
        fishes.push(fish);
        
        if (idx === 0) {
            playerFish = fish;
        }
    });
    
    console.log('创建了', fishes.length, '条鱼，地图尺寸:', WORLD_WIDTH, 'x', WORLD_HEIGHT);
    console.log('玩家鱼:', playerFish ? '已创建' : '未找到');
}

function bootstrap() {
    setupScaleControls();
    setupDebugControls();
    setupEcosystemPanel();
    
    if (!sensorStream) {
        sensorStream = createAccelerometerStream();  // 使用工厂函数，根据配置选择真实/模拟数据
        sensorStream.onData((vector) => {
            homeostasis.receiveSensor(vector);
        });
        homeostasis.receiveSensor(sensorStream.getLatest());
        console.log('✅ 加速度数据流已启动');
    }
    
    // 加载池塘背景图片（底层）
    if (!backgroundImage) {
        console.log('加载池塘背景图片...');
        backgroundImage = new Image();
        backgroundImage.src = 'assets/pond2.PNG';
        backgroundImage.onload = () => {
            console.log('池塘背景图片加载完成，尺寸:', backgroundImage.width, 'x', backgroundImage.height);
            setWorldSize(backgroundImage.width, backgroundImage.height);
            
            if (collisionMaskImage && (collisionMaskImage.width !== backgroundImage.width || collisionMaskImage.height !== backgroundImage.height)) {
                console.warn('背景与碰撞遮罩尺寸不一致，优先采用遮罩尺寸');
                setWorldSize(collisionMaskImage.width, collisionMaskImage.height);
            }

            assetReady.background = true;
            if (allAssetsReady()) {
                initPond();
            }
        };
        backgroundImage.onerror = () => {
            console.error('池塘背景图片加载失败');
            assetReady.background = true; // 尝试继续
        };
    }
    
    // 加载荷叶遮罩图片（顶层）
    if (!lotusImage) {
        console.log('加载荷叶遮罩图片...');
        lotusImage = new Image();
        lotusImage.src = 'assets/lotus.PNG';
        lotusImage.onload = () => {
            console.log('荷叶遮罩图片加载完成，尺寸:', lotusImage.width, 'x', lotusImage.height);
        };
        lotusImage.onerror = () => {
            console.error('荷叶遮罩图片加载失败');
        };
    }
    
    // 加载碰撞遮罩图片
    console.log('加载碰撞遮罩...');
    loadCollisionMask('assets/riverbank2.PNG', () => {
        console.log('碰撞检测系统已就绪');
        assetReady.collision = true;
        if (allAssetsReady()) {
            initPond();
        }
    });
    
    // 初始化地图参照物
    if (!landmarks) {
        console.log('生成地图参照物...');
        const mapSize = Math.ceil(Math.max(WORLD_WIDTH, WORLD_HEIGHT) / canvas.width);
        landmarks = new Landmarks(WORLD_WIDTH, WORLD_HEIGHT, mapSize);
    }
    
    if (!particleSystem) {
        console.log('初始化粒子系统（视野自适应）...');
        particleSystem = new SimpleReglParticles(regl, {
            canvas: particleCanvas,
            particleCount: 90000,     // 提高上限，避免低点数显格子
            lifeSpan: 0.12,
            sizeRange: [1.5, 2.5],
            speedRange: [0.15, 0.8],
            spawnRate: BASE_PARTICLE_SPAWN_RATE,         // 提高生成率
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
                // 计算能看到整个池塘的缩放
                const fitZoom = Math.min(canvas.width / WORLD_WIDTH, canvas.height / WORLD_HEIGHT) * 0.95;
                camera.setZoom(fitZoom);  // 显示整个池塘
                debugParticleReduction = 0.3;  // 减少到 30% 粒子
                console.log('Debug模式：显示整个池塘，zoom:', fitZoom.toFixed(3));
            } else {
                camera.setZoom(normalZoom);  // 恢复到正常缩放（显示约1/4池塘）
                debugParticleReduction = 1.0;
                console.log('正常模式：显示1/4池塘，zoom:', normalZoom.toFixed(3));
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

    if (homeostasis) {
        lastEcosystemSnapshot = homeostasis.step(deltaTime || 0.016);
        updateEcosystemPanelUI(lastEcosystemSnapshot);
    }
    const ecoModifiers = getEcoModifiers(lastEcosystemSnapshot);
    
    // ===== 1. 获取玩家输入 =====
    const playerInput = keyboard.getMovementVector();
    const hasPlayerInput = keyboard.hasInput();
    
    // ===== 2. 更新所有鱼（带玩家控制） =====
    for (let fish of fishes) {
        const control = fish.isPlayer ? playerInput : null;
        fish.resolve(fishes, deltaTime, WORLD_WIDTH, WORLD_HEIGHT, control, playerFish, ecoModifiers);
    }
    
    // ===== 3. 摄像机跟随玩家鱼 =====
    if (playerFish) {
        // 使用更高的平滑度，让摄像机更快地跟随到中心
        camera.follow(playerFish.spine.joints[0], 0.15);
    }
    camera.update();
    
    // ===== 4. 视野剔除 =====
    const visibleFishes = fishes.filter(fish => {
        const head = fish.spine.joints[0];
        return camera.isInView(head.x, head.y, 300);
    });
    
    // ===== 4.5. 检测鱼的位置变化并触发涟漪 =====
    checkFishMovementForRipples(deltaTime);
    
    // ===== 4.6. 更新涟漪系统 =====
    updateRipples(deltaTime);
    
    // ===== 5. 渲染背景（屏幕坐标） =====
    // 先清除 canvas
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // 渲染池塘背景图片（固定在世界坐标，跟随缩放但不跟随平移）
    if (backgroundImage && backgroundImage.complete) {
        ctx.save();
        
        // 背景固定在世界坐标 (0, 0) 到 (WORLD_WIDTH, WORLD_HEIGHT)
        // 使用 worldToScreen 转换，这样背景会固定在世界坐标中，跟随缩放
        const topLeftScreen = camera.worldToScreen(0, 0);
        const bottomRightScreen = camera.worldToScreen(WORLD_WIDTH, WORLD_HEIGHT);
        
        const screenX = topLeftScreen.x;
        const screenY = topLeftScreen.y;
        const screenWidth = bottomRightScreen.x - topLeftScreen.x;
        const screenHeight = bottomRightScreen.y - topLeftScreen.y;
        
        // 绘制背景图片
        ctx.drawImage(backgroundImage, screenX, screenY, screenWidth, screenHeight);
        
        ctx.restore();
    }
    
    // ===== 6. 应用摄像机变换并渲染世界 =====
    camera.applyTransform(ctx);
    
    // 渲染涟漪（在世界坐标中，只在池塘范围内）
    renderRipples(ctx, camera);
    
    // 不渲染地图参照物，保持池塘外纯黑
    // if (landmarks) {
    //     landmarks.render(ctx, camera, currentTime);
    // }
    
    // （可选）渲染鱼的实体
    // for (let fish of visibleFishes) {
    //     fish.display(ctx);
    // }
    
    // Debug: 绘制世界边界
    if (debugMode) {
        ctx.strokeStyle = 'rgba(255, 0, 0, 0.3)';
        ctx.lineWidth = 3;
        ctx.strokeRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
        
        // 绘制网格（每 1000 像素一条线）
        ctx.strokeStyle = 'rgba(100, 100, 255, 0.2)';
        ctx.lineWidth = 1;
        const gridSpacing = 1000;
        for (let i = gridSpacing; i < WORLD_WIDTH; i += gridSpacing) {
            ctx.beginPath();
            ctx.moveTo(i, 0);
            ctx.lineTo(i, WORLD_HEIGHT);
            ctx.stroke();
        }
        for (let i = gridSpacing; i < WORLD_HEIGHT; i += gridSpacing) {
            ctx.beginPath();
            ctx.moveTo(0, i);
            ctx.lineTo(WORLD_WIDTH, i);
            ctx.stroke();
        }
    }
    
    camera.restoreTransform(ctx);
    
    // ===== 7. 粒子系统（只处理可见的鱼） =====
    if (particleSystem && visibleFishes.length > 0) {
        const ecoSpawnMultiplier = homeostasis ? homeostasis.getParticleMultiplier() : 1;
        const debugSpawnScale = debugMode ? debugParticleReduction : 1;
        particleSystem.spawnRate = BASE_PARTICLE_SPAWN_RATE * ecoSpawnMultiplier * debugSpawnScale;
        
        const allSkeletonPoints = [];
        for (let fish of visibleFishes) {
            const integrity = homeostasis ? homeostasis.getFishIntegrity(fish.ecoSensitivity) : 1;
            const effectiveIntegrity = fish.isPlayer ? Math.max(integrity, 0.25) : integrity;
            if (effectiveIntegrity <= 0.02) {
                continue;
            }
            const vividBoost = ecoModifiers.vividBoost || 1;

            const baseDensity = debugMode ? 3 : 1;
            const variableDensity = Math.max(baseDensity, Math.round(baseDensity + (1 - effectiveIntegrity) * 5));
            const points = fish.sampleBodyPointsFromImage(offscreenCtx, variableDensity);
            let filteredPoints = points;

            if (effectiveIntegrity < 0.9) {
                const keepChance = effectiveIntegrity;
                filteredPoints = points.filter(() => Math.random() < keepChance);
            }

            // 贴边时在高动荡下加速消散：减少保留粒子
            if (window.isPositionWalkable && ecoModifiers.boundarySlowdown < 1) {
                const head = fish.spine.joints[0];
                const probe = window.isPositionWalkable(head.x, head.y) && !window.isPositionWalkable(head.x + 20, head.y + 20);
                if (probe) {
                    filteredPoints = filteredPoints.filter(() => Math.random() < ecoModifiers.boundarySlowdown);
                }
            }

            if (filteredPoints.length === 0) {
                continue;
            }
            
            // 转换到屏幕坐标
            const screenPoints = filteredPoints.map(p => {
                const screenPos = camera.worldToScreen(p.x, p.y);
                let boostedColor = p.color;
                if (vividBoost !== 1 && p.color) {
                    boostedColor = [
                        Math.min(1, p.color[0] * vividBoost),
                        Math.min(1, p.color[1] * vividBoost * 0.95),
                        Math.min(1, p.color[2] * vividBoost * 0.9),
                        p.color[3]
                    ];
                }
                return { ...p, x: screenPos.x, y: screenPos.y, color: boostedColor };
            });
            
            // Debug 模式时进一步降低粒子生成率
            if (debugMode) {
                const reduction = Math.max(1, Math.floor(1 / debugParticleReduction));
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
                'Debug:', debugMode ? `开(${(debugParticleReduction * 100).toFixed(0)}%)` : '关',
                '稳态:', (lastEcosystemSnapshot?.stability || 1).toFixed(2),
                'spawn倍率:', (ecoSpawnMultiplier * debugSpawnScale).toFixed(2)
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
    
    // ===== 7.5. 渲染荷叶遮罩（顶层 overlay canvas，固定在世界坐标，遮挡鱼） =====
    // 先清除 overlay canvas
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    
    if (lotusImage && lotusImage.complete) {
        overlayCtx.save();
        
        // 荷叶固定在世界坐标 (0, 0) 到 (WORLD_WIDTH, WORLD_HEIGHT)
        // 使用 worldToScreen 转换，和背景图片一样的行为
        const topLeftScreen = camera.worldToScreen(0, 0);
        const bottomRightScreen = camera.worldToScreen(WORLD_WIDTH, WORLD_HEIGHT);
        
        const screenX = topLeftScreen.x;
        const screenY = topLeftScreen.y;
        const screenWidth = bottomRightScreen.x - topLeftScreen.x;
        const screenHeight = bottomRightScreen.y - topLeftScreen.y;
        
        // 绘制荷叶遮罩图片（PNG 透明图片）
        overlayCtx.drawImage(lotusImage, screenX, screenY, screenWidth, screenHeight);
        
        overlayCtx.restore();
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
