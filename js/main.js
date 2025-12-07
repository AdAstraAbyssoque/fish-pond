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
    
    // 视野改变后，重新限制摄像机位置
    camera.clampPosition();
    
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
    
    // 设置摄像机边界（池塘图片边缘）
    camera.setWorldBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    console.log('摄像机边界已设置:', 0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    
    const zoomX = canvas.width / WORLD_WIDTH;
    const zoomY = canvas.height / WORLD_HEIGHT;
        const fitZoom = Math.min(zoomX, zoomY);
        // 稍微放大，避免背景看起来过小；同时遵守摄像机上下限
        // 放大1.5倍
        normalZoom = Math.max(camera.minZoom, Math.min(camera.maxZoom, fitZoom * 1.4 * 1.5));
        camera.zoom = normalZoom;
        camera.targetZoom = normalZoom;
    console.log('正常缩放 (放大2倍):', normalZoom.toFixed(3));
        console.log('整个池塘缩放:', (fitZoom * 0.95).toFixed(3));
    
    // 初始化时限制摄像机位置
    camera.clampPosition();
    
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
const WHALE_LINGER_TIME = 4.0;   // 鲸落亮度保持时间
const WHALE_FADE_TIME = 10.0;    // 鲸落淡出时间
const WHALE_RESPAWN_DELAY = 4.5; // 鲸落后重新出现的等待时间
const PANIC_COOLDOWN_BASE = 0.55; // 惊扰计时回落的基础速度
const COLLAPSE_RECOVERY_RATE = 0.08; // 崩塌后缓慢回升承载力
const COLLAPSE_DAMAGE_REDUCTION = 0.6; // 崩塌状态下减少伤害系数

// 生态稳态/传感器状态
let homeostasis = null;
let sensorStream = null;
let lastEcosystemSnapshot = null;

// 视觉模式缓冲：实体鱼与粒子鱼的平滑切换
let calmBlend = 1;   // 1=完全实体渲染，0=完全粒子
let calmState = true;
const CALM_ENTER_PANIC = 0.08; // 低于该值逐步进入静水渲染
const CALM_EXIT_PANIC = 0.14;  // 高于该值逐步退出静水渲染

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
            boundarySlowdown: 1,
            sensorAngle: null
        };
    }
    const panic = clamp01(snapshot.panic);
    const speedMultiplier = 1 + panic * 0.8;       // 越惊慌越快
    const noiseMultiplier = 1 + panic * 0.9;       // 方向不确定性提升
    const vividBoost = 1 + panic * 0.6;            // 颜色更鲜艳
    const boundarySlowdown = 1 - Math.min(0.7, panic * 0.85); // 贴边时减速
    
    // 传递传感器角度数据（使用 angle 字段，即 AngX）
    // AngX 0-180度 → 鱼左转0-180度
    // AngX -180到0度 → 鱼右转0-180度
    const sensorAngle = snapshot.sensor 
        ? (snapshot.sensor.angle !== undefined ? snapshot.sensor.angle : snapshot.sensor.AngX)
        : null;
    
    return { speedMultiplier, noiseMultiplier, vividBoost, boundarySlowdown, sensorAngle };
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

// 生态稳态模型：把传感器的加速度映射为池塘"压力"和"健康度"
class PondHomeostasis {
    constructor() {
        this.sensor = { x: 0, y: 0, z: 0, a: 0, magnitude: 0, phase: '静水' };
        this.panic = 0;       // 瞬时动荡度
        this.stability = 1;   // 系统稳态（目标靠近1）
        this.health = 1;      // 鱼群健康/活力
        this.capacity = 1;    // 池塘承载力（掉下去后不完全恢复）
        this.collapseDebt = 0;
        
        // 惊扰计时器
        this.panicTime = 0;           // 累计惊扰时间
        this.isPermanentlyDead = false; // 是否永久死亡
        
        // 启动保护：前3秒内强制忽略所有动荡
        this.bootProtectionTime = 3.0;
    }

    receiveSensor(vector) {
        this.sensor = { ...vector };
    }

    step(deltaTime) {
        // 启动保护倒计时
        if (this.bootProtectionTime > 0) {
            this.bootProtectionTime -= deltaTime;
            // 保护期间如果传感器数据正常，可以提前结束保护
            // 如果数据异常（magnitude很大），则强制压制
        }

        // 如果已经永久死亡，直接返回死亡状态
        if (this.isPermanentlyDead) {
            return {
                sensor: this.sensor,
                panic: 1.0,
                instability: 1.0,
                stability: 0,
                health: 0,
                capacity: 0,
                irreversible: true,
                fishIntegrity: 0,
                particleMultiplier: 0,
                panicTime: this.panicTime,
                isPermanentlyDead: true
            };
        }
        
        const magnitude = Math.sqrt(
            this.sensor.x * this.sensor.x +
            this.sensor.y * this.sensor.y +
            this.sensor.z * this.sensor.z
        );
        const jerk = Math.abs(this.sensor.a);

        // 优化动荡度计算：
        // 1. 使用净加速度 (magnitude - 1)，去除重力常数影响
        // 2. 这样静止时 netMagnitude ≈ 0，动荡度 ≈ 0
        const netMagnitude = Math.abs(magnitude - 1.0);

        // 将加速度映射为动荡度
        // jerk 已经是后端处理过的动态加速度 (dynamic_acc * 50)
        // magnitude 权重进一步降低，主要靠 netMagnitude 判断
        let agitation = clamp01(netMagnitude * 0.1 + jerk * 0.05);  
        
        if (this.bootProtectionTime > 0) {
            // 保护期间，忽略所有突增的动荡，强制平稳过渡
            agitation = 0;
            // 同时重置传感器状态，防止phase卡在'惊扰'
            if (this.sensor.phase === '惊扰') {
                this.sensor.phase = '静水';
            }
        }

        // 增加阻尼，让数值上升更慢
        // 3.8 -> 2.0 (更慢的上升速度)
        this.panic = damp(this.panic, agitation, 2.0, deltaTime);
        
        // 判断是否处于惊扰状态（phase 为 "惊扰"）
        // 同样受启动保护影响
        const isInPanic = this.sensor.phase === '惊扰' && this.bootProtectionTime <= 0;
        
        if (isInPanic) {
            this.panicTime += deltaTime;
            
            // 惊扰超过15秒 → 永久死亡
            if (this.panicTime >= 5) {
                this.isPermanentlyDead = true;
                this.health = 0;
                this.capacity = 0;
                console.log('💀 池塘生态系统永久崩溃！惊扰持续时间:', this.panicTime.toFixed(1), '秒');
            }
            // 注意：这里不再粗暴地直接降低全局 health，改为在 getFishIntegrity 中计算个体可见度
            // 只有当动荡极度持久时，才缓慢通过 collapseDebt 影响全局 capacity
        } else {
            // 不在惊扰状态时，加速 panicTime 回落，避免长时间残影
            // 平静、健康越高，回落越快
            const stabilityBoost = this.stability * 0.6 + this.health * 0.3;
            const recoverySpeed = (PANIC_COOLDOWN_BASE + stabilityBoost) * (1 - this.panic * 0.6);
            this.panicTime = Math.max(0, this.panicTime - deltaTime * recoverySpeed);
        }

        // 稳态越高，恢复力越强；动荡越高，稳态越低
        const stabilityTarget = clamp01(1 - this.panic * 0.75 + this.capacity * 0.15);  // 增加 panic 的影响
        this.stability = damp(this.stability, stabilityTarget, 2.5, deltaTime);  // 中等恢复速度

        // 恢复与伤害，结合稳态与动荡
        const collapsePenalty = this.capacity < 0.99 ? COLLAPSE_DAMAGE_REDUCTION : 1;
        const damage = (0.1 + this.collapseDebt * 0.4) * Math.pow(this.panic, 1.5) * collapsePenalty;
        const recoveryBoost = (this.capacity < 0.99 && this.panic < 0.25) ? 1.35 : 1;
        const recovery = Math.max(0, this.stability - this.health) *
            (0.5 * this.capacity) * 
            (1 - this.panic * 0.8) *
            recoveryBoost;
        this.health = clamp01(this.health + (recovery - damage) * deltaTime);

        // 低于阈值后触发承载力衰减（降低阈值，减缓衰减速度）
        if (this.health < 0.1) {
            this.collapseDebt = clamp01(this.collapseDebt + (0.05 + this.panic * 0.2) * deltaTime);  // 减缓衰减
            this.capacity = Math.max(0.5, 1 - this.collapseDebt);  // 提高最低承载力
        }

        // 崩塌后，如果环境恢复平稳，允许缓慢回升承载力，避免“锁死”后持续衰减
        if (this.capacity < 0.99 && this.panic < 0.2 && this.stability > 0.6) {
            this.collapseDebt = Math.max(0, this.collapseDebt - COLLAPSE_RECOVERY_RATE * deltaTime * (this.stability + 0.5));
            this.capacity = Math.max(0.5, 1 - this.collapseDebt);
        }

        const fishIntegrity = clamp01(this.health * this.capacity); // 这里只计算基础值，具体每条鱼在 getFishIntegrity 中算
        const particleMultiplier = clamp01(0.5 + fishIntegrity * 0.5);

        return {
            sensor: this.sensor,
            panic: this.panic,
            instability: agitation,
            stability: this.stability,
            health: this.health,
            capacity: this.capacity,
            irreversible: this.capacity < 0.99,
            fishIntegrity,
            particleMultiplier,
            panicTime: this.panicTime,
            isPermanentlyDead: this.isPermanentlyDead
        };
    }

    // 计算单条鱼的完整度（可见度）
    // sensitivity: -0.5 (胆小) 到 0.5 (胆大)
    getFishIntegrity(sensitivity = 0) {
        // 如果永久死亡，返回0
        if (this.isPermanentlyDead) {
            return 0;
        }
        
        // 基础健康度（受系统健康和承载力影响）
        const baseHealth = clamp01(this.health * this.capacity);
        
        // 个体差异化消失逻辑：
        // 1. 惊扰阈值：胆小的鱼(sensitivity < 0)阈值低，更早开始消失
        //    基础阈值 1.5s，差异 +/- 1.0s => 范围 0.5s ~ 2.5s
        const vanishThreshold = 1.5 + sensitivity * 2.0;
        
        // 2. 消失过程持续时间：胆大的鱼消失得慢一点
        //    基础 3.0s，差异 +/- 1.0s => 范围 2.0s ~ 4.0s
        const vanishDuration = 3.0 + sensitivity * 1.0;
        
        // 如果还没有达到该鱼的惊扰阈值，它就是完全可见的
        if (this.panicTime < vanishThreshold) {
            return Math.max(0.2, baseHealth);
        }
        
        // 计算消失进度 (0.0 -> 1.0)
        const progress = clamp01((this.panicTime - vanishThreshold) / vanishDuration);
        
        // 随着进度增加，可见度降低
        // 即使完全消失，也保留极少量的影子(0.05)，除非 panicTime 极大
        let visibility = 1.0 - progress;
        
        // 如果 panicTime 极大（超过17秒），彻底消失
        if (this.panicTime > 17) visibility = 0;
        
        return Math.max(0, visibility * baseHealth);
    }

    getParticleMultiplier() {
        // 粒子生成倍率：
        // 只要没有永久死亡，且不在消失过程中（panicTime < 2），就始终保持满倍率生成
        // 确保视觉上鱼始终是实心的，不会因为微小的健康度波动而闪烁
        if (this.isPermanentlyDead) return 0;
        if (this.panicTime >= 2) {
             // 消失过程中，生成率随健康度下降
             return clamp01(this.health * this.capacity);
        }
        // 正常状态满倍率
        return 1.0; 
    }
}

// ============= 加速度数据流 =============

// 配置：连接到真实传感器后端（WT901BLE67 双设备）
const USE_REAL_SENSOR = true;  // true=真实传感器后端, false=模拟数据
const WEBSOCKET_URL_DIRECTION = 'ws://localhost:8765';  // 设备1：方向控制（角度数据）
const WEBSOCKET_URL_ACCELERATION = 'ws://localhost:8766';  // 设备2：加速度检测（运动状态）

// 模拟一个"Python 后端"源源推送四维加速度（x, y, z, a）
let mockPhaseIndex = 0; // 当前mock状态索引
const mockPhases = [
    { name: '静水', base: 0.6, spread: 0.8, jerk: [0.03, 0.18], duration: [5, 9] },
    { name: '微扰', base: 2.4, spread: 1.6, jerk: [0.25, 0.8], duration: [6, 10] },
    { name: '惊扰', base: 6.5, spread: 3.2, jerk: [0.7, 2.1], duration: [3, 5.5] }
];

function createMockAccelerometerStream() {
    const listeners = [];
    let currentPhase = { ...mockPhases[mockPhaseIndex], remaining: Infinity }; // 手动控制时不自动切换
    let lastVector = { x: 0, y: 0, z: 0, a: 0, magnitude: 0, phase: currentPhase.name };
    const intervalMs = 320;

    const tick = () => {
        // 手动控制模式下不自动切换phase
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
        setPhase(index) {
            if (index >= 0 && index < mockPhases.length) {
                mockPhaseIndex = index;
                currentPhase = { ...mockPhases[mockPhaseIndex], remaining: Infinity };
                lastVector.phase = currentPhase.name;
                // 立即通知一次
                listeners.forEach(cb => cb(lastVector));
            }
        },
        getCurrentPhase() {
            return mockPhaseIndex;
        },
        stop() {
            clearInterval(timer);
        }
    };
}

// 真实传感器数据流（通过双 WebSocket 连接 Python 后端）
function createRealAccelerometerStream() {
    const listeners = [];
    let lastVector = { x: 0, y: 0, z: 0, a: 0, magnitude: 0, phase: '静水', AngX: 0, AngY: 0, AngZ: 0 };
    let wsDirection = null;  // 设备1：方向控制
    let wsAcceleration = null;  // 设备2：加速度检测
    let reconnectTimer1 = null;
    let reconnectTimer2 = null;
    let isConnected1 = false;  // 方向设备连接状态
    let isConnected2 = false;  // 加速度设备连接状态

    // 连接方向控制设备（设备1）
    const connectDirection = () => {
        console.log(`正在连接方向控制设备: ${WEBSOCKET_URL_DIRECTION}`);
        
        try {
            wsDirection = new WebSocket(WEBSOCKET_URL_DIRECTION);
            
            wsDirection.onopen = () => {
                console.log('✅ 方向控制设备已连接 (设备1)');
                isConnected1 = true;
                updateConnectionStatus();
            };
            
            wsDirection.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    
                    // 更新角度数据（保留加速度数据）
                    lastVector.AngX = data.AngX || data.angle || 0;
                    lastVector.AngY = data.AngY || 0;
                    lastVector.AngZ = data.AngZ || 0;
                    
                    // 通知所有监听器
                    listeners.forEach(cb => cb(lastVector));
                    
                } catch (error) {
                    console.error('解析方向数据失败:', error);
                }
            };
            
            wsDirection.onerror = (error) => {
                console.error('❌ 方向设备 WebSocket 错误:', error);
                isConnected1 = false;
            };
            
            wsDirection.onclose = () => {
                console.log('🔴 方向设备连接已断开');
                isConnected1 = false;
                updateConnectionStatus();
                
                // 5秒后尝试重连
                reconnectTimer1 = setTimeout(() => {
                    console.log('尝试重新连接方向设备...');
                    connectDirection();
                }, 5000);
            };
            
        } catch (error) {
            console.error('创建方向设备 WebSocket 连接失败:', error);
            reconnectTimer1 = setTimeout(connectDirection, 5000);
        }
    };

    // 连接加速度检测设备（设备2）
    const connectAcceleration = () => {
        console.log(`正在连接加速度检测设备: ${WEBSOCKET_URL_ACCELERATION}`);
        
        try {
            wsAcceleration = new WebSocket(WEBSOCKET_URL_ACCELERATION);
            
            wsAcceleration.onopen = () => {
                console.log('✅ 加速度检测设备已连接 (设备2)');
                isConnected2 = true;
                updateConnectionStatus();
                
                // 重置稳态模型的启动保护
                if (homeostasis) {
                    homeostasis.bootProtectionTime = 3.0;
                    homeostasis.panic = 0;
                    homeostasis.sensor.phase = '静水';
                    console.log('🛡️ 传感器连接，启动动荡保护 (3s)');
                }
            };
            
            wsAcceleration.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    
                    // 更新加速度数据（保留角度数据）
                    lastVector.x = data.x || 0;
                    lastVector.y = data.y || 0;
                    lastVector.z = data.z || 0;
                    lastVector.a = data.a || 0;
                    lastVector.magnitude = data.magnitude || 0;
                    lastVector.phase = data.phase || '静水';
                    
                    // 通知所有监听器
                    listeners.forEach(cb => cb(lastVector));
                    
                } catch (error) {
                    console.error('解析加速度数据失败:', error);
                }
            };
            
            wsAcceleration.onerror = (error) => {
                console.error('❌ 加速度设备 WebSocket 错误:', error);
                isConnected2 = false;
            };
            
            wsAcceleration.onclose = () => {
                console.log('🔴 加速度设备连接已断开');
                isConnected2 = false;
                updateConnectionStatus();
                
                // 5秒后尝试重连
                reconnectTimer2 = setTimeout(() => {
                    console.log('尝试重新连接加速度设备...');
                    connectAcceleration();
                }, 5000);
            };
            
        } catch (error) {
            console.error('创建加速度设备 WebSocket 连接失败:', error);
            reconnectTimer2 = setTimeout(connectAcceleration, 5000);
        }
    };

    // 更新连接状态显示
    const updateConnectionStatus = () => {
        const statusDiv = document.getElementById('sensor-status');
        if (statusDiv && USE_REAL_SENSOR) {
            if (isConnected1 && isConnected2) {
                statusDiv.textContent = '🟢 双设备已连接';
                statusDiv.style.color = '#00ff00';
            } else if (isConnected1 || isConnected2) {
                const connected = isConnected1 ? '方向' : '加速度';
                const disconnected = !isConnected1 ? '方向' : '加速度';
                statusDiv.textContent = `🟡 ${connected}设备已连接，${disconnected}设备重连中...`;
                statusDiv.style.color = '#ffaa00';
            } else {
                statusDiv.textContent = '🔴 设备断开，尝试重连...';
                statusDiv.style.color = '#ff9900';
            }
        }
    };
    
    // 立即连接两个设备
    connectDirection();
    connectAcceleration();
    
    return {
        onData(callback) {
            listeners.push(callback);
        },
        getLatest() {
            return lastVector;
        },
        isConnected() {
            return isConnected1 && isConnected2;  // 两个设备都连接才算完全连接
        },
        stop() {
            if (reconnectTimer1) clearTimeout(reconnectTimer1);
            if (reconnectTimer2) clearTimeout(reconnectTimer2);
            if (wsDirection) wsDirection.close();
            if (wsAcceleration) wsAcceleration.close();
        }
    };
}

// 工厂函数：根据配置创建数据流
function createAccelerometerStream() {
    if (USE_REAL_SENSOR) {
        console.log('🎯 使用真实传感器数据 (WT901BLE67 双设备)');
        console.log('📡 方向控制设备:', WEBSOCKET_URL_DIRECTION);
        console.log('📡 加速度检测设备:', WEBSOCKET_URL_ACCELERATION);
        console.log('💡 提示：确保 Python WebSocket 服务器正在运行');
        return createRealAccelerometerStream();
    } else {
        console.log('🎲 使用模拟传感器数据 (Mock)');
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
    
    const { sensor, panic, stability, health, capacity, irreversible, panicTime, isPermanentlyDead } = snapshot;
    const formatPercent = (value) => `${Math.round(clamp01(value) * 100)}%`;

    if (ecosystemUI.vector) {
        const angleInfo = sensor.AngX !== undefined 
            ? ` | AngX: ${sensor.AngX.toFixed(1)}°` 
            : '';
        ecosystemUI.vector.textContent = `${sensor.x.toFixed(2)}, ${sensor.y.toFixed(2)}, ${sensor.z.toFixed(2)}, ${sensor.a.toFixed(2)}${angleInfo}`;
    }
    
    // 更新角度调试信息
    if (window.sensorAngleDebug) {
        const debug = window.sensorAngleDebug;
        const sensorAngleEl = document.getElementById('sensorAngleDeg');
        const targetAngleEl = document.getElementById('targetAngleDeg');
        const currentAngleEl = document.getElementById('currentAngleDeg');
        const angleDiffEl = document.getElementById('angleDiffDeg');
        const angleDirectionEl = document.getElementById('angleDirection');
        
        if (sensorAngleEl) sensorAngleEl.textContent = debug.sensorAngleDeg.toFixed(1);
        if (targetAngleEl) targetAngleEl.textContent = debug.targetAngleDeg.toFixed(1);
        if (currentAngleEl) currentAngleEl.textContent = debug.currentAngleDeg.toFixed(1);
        if (angleDirectionEl) {
            angleDirectionEl.textContent = debug.direction || '';
            angleDirectionEl.style.color = debug.sensorAngleDeg >= 0 ? '#00ff00' : '#ffaa00'; // 左转绿色，右转橙色
        }
        if (angleDiffEl) {
            angleDiffEl.textContent = debug.angleDiffDeg.toFixed(1);
            // 根据角度差显示颜色
            const absDiff = Math.abs(debug.angleDiffDeg);
            if (absDiff < 10) {
                angleDiffEl.style.color = '#00ff00'; // 绿色：接近目标
            } else if (absDiff < 45) {
                angleDiffEl.style.color = '#ffaa00'; // 橙色：中等偏差
            } else {
                angleDiffEl.style.color = '#ff0000'; // 红色：大偏差
            }
        }
    } else {
        // 没有调试信息时显示占位符
        const sensorAngleEl = document.getElementById('sensorAngleDeg');
        const targetAngleEl = document.getElementById('targetAngleDeg');
        const currentAngleEl = document.getElementById('currentAngleDeg');
        const angleDiffEl = document.getElementById('angleDiffDeg');
        const angleDirectionEl = document.getElementById('angleDirection');
        if (sensorAngleEl) sensorAngleEl.textContent = '-';
        if (targetAngleEl) targetAngleEl.textContent = '-';
        if (currentAngleEl) currentAngleEl.textContent = '-';
        if (angleDiffEl) {
            angleDiffEl.textContent = '-';
            angleDiffEl.style.color = '';
        }
        if (angleDirectionEl) angleDirectionEl.textContent = '';
    }
    if (ecosystemUI.phase) {
        // 显示状态和惊扰计时
        let phaseText = sensor.phase || '静水';
        if (sensor.phase === '惊扰' && panicTime > 0) {
            phaseText += ` (${panicTime.toFixed(1)}s)`;
            if (panicTime >= 2) {
                phaseText += ' ⚠️';
            }
        }
        if (isPermanentlyDead) {
            phaseText = '💀 永久死亡';
        }
        ecosystemUI.phase.textContent = phaseText;
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
        if (isPermanentlyDead) {
            ecosystemUI.note.textContent = '💀 池塘生态系统已永久崩溃，所有鱼类死亡。刷新页面重新开始。';
            ecosystemUI.note.style.color = '#ff0000';
            ecosystemUI.note.style.fontWeight = 'bold';
        } else if (sensor.phase === '惊扰' && panicTime >= 2) {
            const remaining = (17 - panicTime).toFixed(0);
            ecosystemUI.note.textContent = `⚠️ 鱼群正在消失！再持续 ${remaining} 秒将永久死亡！停止摇晃！`;
            ecosystemUI.note.style.color = '#ff3300';
            ecosystemUI.note.style.fontWeight = 'bold';
        } else if (sensor.phase === '惊扰') {
            const remaining = (2 - panicTime).toFixed(1);
            ecosystemUI.note.textContent = `⚡ 惊扰状态！${remaining} 秒后鱼开始消失，停止摇晃恢复平静。`;
            ecosystemUI.note.style.color = '#ffaa00';
            ecosystemUI.note.style.fontWeight = 'normal';
        } else if (irreversible) {
            ecosystemUI.note.textContent = '超过崩塌阈值：鱼群粒子上限被压低，需要长时间稳定才能缓慢恢复。';
            ecosystemUI.note.style.color = '';
            ecosystemUI.note.style.fontWeight = 'normal';
        } else {
            ecosystemUI.note.textContent = '💡 摇晃传感器改变水体状态，静置后自动恢复平衡。';
            ecosystemUI.note.style.color = '';
            ecosystemUI.note.style.fontWeight = 'normal';
        }
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

    // 在地图中创建 7 条鱼 (5 + 2)
    const fishCount = 7;
    const positions = [];
    
    // 全地图随机分布生成
    for (let i = 0; i < fishCount; i++) {
        let attempts = 0;
        let positionFound = false;
        
        while (!positionFound && attempts < 200) {
            attempts++;
            
            // 随机位置（保留边距）
            const margin = 300;
            const pos = {
                x: margin + Math.random() * (WORLD_WIDTH - 2 * margin),
                y: margin + Math.random() * (WORLD_HEIGHT - 2 * margin)
            };
            
            // 检查是否在可通行区域（碰撞检测）
            if (window.isPositionWalkable && !window.isPositionWalkable(pos.x, pos.y)) {
                continue; // 不在可通行区域，跳过
            }
            
            // 检查与其他鱼的距离（稍微放宽限制以允许更多鱼）
            let valid = true;
            for (let existing of positions) {
                const dx = pos.x - existing.x;
                const dy = pos.y - existing.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < 100) {  // 减小最小距离（原150）
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
        fish.groupId = 0; // 不再使用群组
        fish.selected = idx === 0;
        fish.isPlayer = idx === 0;  // 标记玩家鱼
        
        fish.separationRadius = 110; // 稍微减小分离半径，允许更紧密
        fish.alignmentRadius = 180;
        fish.cohesionRadius = 220;
        fish.maxSpeed = (0.6 + Math.random() * 0.3) * 0.67 * 0.5 * 1.2; // 速度增加 1.2 倍
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
        
        if (fish.isPlayer) {
            // 橙色鱼（玩家鱼）是“鱼王”，胆子最大，最后消失
            // sensitivity = 2.0，意味着它的惊扰阈值会比普通鱼高很多（1.5 + 4.0 = 5.5秒）
            fish.ecoSensitivity = 2.0;
        } else {
            // 普通鱼：增大个体差异范围 (-0.5 到 0.5)，使鱼群消失时间明显错开
            fish.ecoSensitivity = (Math.random() - 0.5) * 1.0; 
        }
        
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
            particleCount: 300000,     // 提高上限，避免低点数显格子
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
        
        // Mock模式下，数字键切换状态：1=静水, 2=微扰, 3=惊扰
        if (!USE_REAL_SENSOR && sensorStream && sensorStream.setPhase) {
            if (e.key === '1') {
                sensorStream.setPhase(0);
                console.log('🌊 切换到：静水');
            } else if (e.key === '2') {
                sensorStream.setPhase(1);
                console.log('🌊 切换到：微扰');
            } else if (e.key === '3') {
                sensorStream.setPhase(2);
                console.log('🌊 切换到：惊扰');
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
    const panicLevel = lastEcosystemSnapshot?.panic ?? 0;
    const isPhaseCalm = lastEcosystemSnapshot?.sensor?.phase === '静水';
    if (calmState) {
        if (!isPhaseCalm || panicLevel > CALM_EXIT_PANIC) {
            calmState = false;
        }
    } else {
        if (isPhaseCalm && panicLevel < CALM_ENTER_PANIC) {
            calmState = true;
        }
    }
    const targetCalmBlend = calmState ? 1 : 0;
    calmBlend = damp(calmBlend, targetCalmBlend, 3.2, deltaTime || 0.016);
    const particleBlend = 1 - calmBlend;
    const ecoModifiers = getEcoModifiers(lastEcosystemSnapshot);
    
    // ===== 2. 更新所有鱼 =====
    for (let fish of fishes) {
        // 计算个体的完整度来影响速度（濒死乏力）
        const integrity = homeostasis ? homeostasis.getFishIntegrity(fish.ecoSensitivity) : 1;
        if (fish.respawnDelay > 0) {
            fish.respawnDelay = Math.max(0, fish.respawnDelay - (deltaTime || 0));
        }
        
        // Mock模式下，玩家鱼由键盘控制
        let modifiersForThisFish;
        if (fish.isPlayer && !USE_REAL_SENSOR) {
            // 键盘控制：WASD控制方向
            const moveVec = keyboard.getMovementVector();
            if (moveVec.x !== 0 || moveVec.y !== 0) {
                // 计算目标角度
                const targetAngle = Math.atan2(moveVec.y, moveVec.x);
                // 转换为角度（度）
                let angleDeg = (targetAngle * 180 / Math.PI);
                // 归一化到-180到180
                if (angleDeg > 180) angleDeg -= 360;
                if (angleDeg < -180) angleDeg += 360;
                
                modifiersForThisFish = {
                    ...ecoModifiers,
                    sensorAngle: angleDeg // 使用键盘方向作为传感器角度
                };
            } else {
                // 没有键盘输入时，保持当前方向
                modifiersForThisFish = {
                    ...ecoModifiers,
                    sensorAngle: null // 不改变方向
                };
            }
        } else if (fish.isPlayer) {
            // 真实传感器模式：正常使用传感器角度
            modifiersForThisFish = ecoModifiers;
        } else {
            // 白色鱼：不受传感器角度控制
            modifiersForThisFish = { ...ecoModifiers, sensorAngle: null };
        }
            
        // 如果完整度低，强制减速（模拟濒死游不动）
        if (integrity < 0.6) {
            // 线性衰减：0.6 -> 1.0x, 0.0 -> 0.0x
            // 对于橙色鱼，当它快消失时，也应该动不了了
            const fatigue = Math.max(0, integrity / 0.6);
            modifiersForThisFish = {
                ...modifiersForThisFish,
                speedMultiplier: (modifiersForThisFish.speedMultiplier || 1) * fatigue
            };
        }
            
        fish.resolve(fishes, deltaTime, WORLD_WIDTH, WORLD_HEIGHT, null, null, modifiersForThisFish);
    }
    
    // ===== 3. 摄像机跟随玩家鱼 =====
    if (playerFish) {
        if (lastEcosystemSnapshot && lastEcosystemSnapshot.isPermanentlyDead) {
            // 永久死亡：拉大视野到全景（类似 V 键 Debug 模式）
            // 计算能看到整个池塘的缩放
            const fitZoom = Math.min(canvas.width / WORLD_WIDTH, canvas.height / WORLD_HEIGHT) * 0.95;
            
            // 平滑过渡到全景缩放
            camera.targetZoom = fitZoom;
            
            // 摄像机移动到池塘中心
            camera.targetX = WORLD_WIDTH / 2;
            camera.targetY = WORLD_HEIGHT / 2;
        } else {
            // 正常状态：跟随玩家鱼
        // 使用更高的平滑度，让摄像机更快地跟随到中心
        camera.follow(playerFish.spine.joints[0], 0.15);
        }
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
        
        // 应用惊扰滤镜：背景变暗淡、灰度
        if (homeostasis) {
            const panic = homeostasis.panic; // 0-1
            // 只有当惊扰程度明显时才应用，节省性能
            if (panic > 0.05) {
                // 灰度增加 (0 -> 100%)
                const grayscale = Math.min(100, panic * 120); 
                // 亮度降低 (100% -> 60%)
                const brightness = Math.max(60, 100 - panic * 40);
                // 对比度略微降低 (100% -> 90%)
                const contrast = Math.max(90, 100 - panic * 10);
                
                ctx.filter = `grayscale(${grayscale}%) brightness(${brightness}%) contrast(${contrast}%)`;
            }
        }
        
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
    
    // 静水状态下渲染鱼的实体（不使用粒子）
    const shouldRenderEntities = calmBlend > 0.02;
    if (shouldRenderEntities) {
        ctx.save();
        ctx.globalAlpha *= Math.min(1, calmBlend + 0.05); // 轻微补偿，避免刚切换时过暗
        for (let fish of visibleFishes) {
            const integrity = homeostasis ? homeostasis.getFishIntegrity(fish.ecoSensitivity) : 1;
            // 只有完整度足够高时才显示实体
            if (integrity > 0.1) {
                fish.display(ctx);
            }
        }
        ctx.restore();
    }
    
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
    
    // ===== 7. 粒子系统（只处理可见的鱼，静水状态下不显示粒子） =====
    if (particleSystem && visibleFishes.length > 0 && particleBlend > 0.02) {
        const ecoSpawnMultiplier = homeostasis ? homeostasis.getParticleMultiplier() : 1;
        const debugSpawnScale = debugMode ? debugParticleReduction : 1;
        
        const allSkeletonPoints = [];
        let hasWhaleFall = false;
        for (let fish of visibleFishes) {
            const integrity = homeostasis ? homeostasis.getFishIntegrity(fish.ecoSensitivity) : 1;
            
            // 检测消失事件：如果之前可见，现在几乎不可见，触发大涟漪
            if (fish.lastIntegrity > 0.1 && integrity <= 0.1) {
                const head = fish.spine.joints[0];
                const ripple = new Ripple(head.x, head.y);
                ripple.maxRadius = 300; // 更大的涟漪
                ripple.speed = 250;     // 更快的扩散
                ripple.lifespan = 3.0;  // 持续更久
                activeRipples.push(ripple);
            }
            
            let currentPoints = [];
            let isWhaleFall = false;
            
            // 惊扰状态下鱼会根据时间逐渐消失
            const ecoModifiers = getEcoModifiers(lastEcosystemSnapshot);
            const vividBoost = ecoModifiers.vividBoost || 1;
            
            // 处理鲸落逻辑
            if (integrity <= 0) {
                // 如果是刚死（上一帧还活着），生成死亡快照用于持续渲染残留
                if (fish.lastIntegrity > 0 && !fish.deadSnapshot) {
                    // 玩家鱼（橙色鱼）不生成鲸落散开，直接消失
                    // 普通鱼触发散开并保留快照
                    if (!fish.isPlayer) {
                        // 强制采样一次作为散开源和残留快照
                        // 使用较高的密度(2)
                        const points = fish.sampleBodyPointsFromImage(offscreenCtx, 2);
                        
                        // 触发一次性粒子爆发
                        fish.whaleFallCenter = fish.spine.joints[0].copy();
                        const whaleAlpha = Math.max(0.8, particleBlend); // 鲸落保持较高亮度
                        particleSystem.explode(points, whaleAlpha);
                        fish.respawnDelay = WHALE_RESPAWN_DELAY;
                        
                        // 保存快照用于持续渲染残留（逐渐淡出）
                        fish.deadSnapshot = points.map(p => ({
                            ...p,
                            isDead: true,
                            fadeTime: 0, // 淡出计时器
                            driftAngle: Math.random() * Math.PI * 2,
                            baseRadius: 40 + Math.random() * 50
                        }));
                        
                        // 触发涟漪
                        const head = fish.spine.joints[0];
                        createRipple(head.x, head.y);
                    }
                }
                
                // 如果有死亡快照，持续渲染残留（逐渐淡出）
                if (fish.deadSnapshot) {
                    // 更新淡出计时器
                    fish.deadSnapshot.forEach(p => {
                        p.fadeTime = (p.fadeTime || 0) + deltaTime;
                    });
                    
                    // 过滤掉完全淡出的点（超过 linger+fade 时间）
                    fish.deadSnapshot = fish.deadSnapshot.filter(p => p.fadeTime < (WHALE_LINGER_TIME + WHALE_FADE_TIME));
                    
                    if (fish.deadSnapshot.length > 0) {
                        currentPoints = fish.deadSnapshot;
                        isWhaleFall = true;
                        hasWhaleFall = true;
                    } else {
                        // 完全淡出后清除快照
                        fish.deadSnapshot = null;
                        fish.whaleFallCenter = null;
                    }
                }
                
                // 玩家鱼特殊处理：如果是最后永久死亡（系统崩溃），则标记为死亡并允许消失
                if (fish.isPlayer && homeostasis.isPermanentlyDead) {
                    fish.isPermanentlyDead = true;
                }
                
                // 如果没有残留快照，跳过渲染
                if (!fish.deadSnapshot || fish.deadSnapshot.length === 0) {
                    fish.lastIntegrity = integrity;
                    continue;
                }
            } else {
                // 复活/正常状态
                if (fish.deadSnapshot) {
                    if (fish.respawnDelay > 0) {
                        // 仍处于鲸落冷却期，继续显示残留，不渲染实体
                        fish.deadSnapshot.forEach(p => {
                            p.fadeTime = (p.fadeTime || 0) + deltaTime;
                        });
                        fish.deadSnapshot = fish.deadSnapshot.filter(p => p.fadeTime < (WHALE_LINGER_TIME + WHALE_FADE_TIME));
                        if (fish.deadSnapshot.length > 0) {
                            currentPoints = fish.deadSnapshot;
                            isWhaleFall = true;
                            hasWhaleFall = true;
                            fish.lastIntegrity = integrity;
                            // 在冷却期内跳过正常渲染逻辑
                            continue;
                        } else {
                            fish.whaleFallCenter = null;
                        }
                    } else {
                        fish.deadSnapshot = null;
                        fish.whaleFallCenter = null;
                    }
                }

                const effectiveIntegrity = fish.isPlayer ? Math.max(integrity, 0.3) : integrity;

            // 优化采样密度逻辑：
            const baseDensity = debugMode ? 3 : 1;
            let variableDensity = baseDensity;
            
            if (effectiveIntegrity < 0.5) {
                variableDensity = Math.max(baseDensity, Math.round(baseDensity + (0.5 - effectiveIntegrity) * 10));
            }
            
                currentPoints = fish.sampleBodyPointsFromImage(offscreenCtx, variableDensity);

                // 完整度低时随机丢弃点
            if (effectiveIntegrity < 0.9) {
                const keepChance = effectiveIntegrity;
                    currentPoints = currentPoints.filter(() => Math.random() < keepChance);
            }

                // 贴边时在高动荡下加速消散
            if (window.isPositionWalkable && ecoModifiers.boundarySlowdown < 1) {
                const head = fish.spine.joints[0];
                const probe = window.isPositionWalkable(head.x, head.y) && !window.isPositionWalkable(head.x + 20, head.y + 20);
                if (probe) {
                        currentPoints = currentPoints.filter(() => Math.random() < ecoModifiers.boundarySlowdown);
                    }
                }
            }

            // 更新上一帧完整度
            fish.lastIntegrity = integrity;

            if (currentPoints.length === 0) {
                continue;
            }
            
            // 应用视觉效果（保持世界坐标，渲染时再换算为屏幕）
            const worldPoints = currentPoints.map(p => {
                let boostedColor = p.color;
                let px = p.x;
                let py = p.y;
                
                if (isWhaleFall) {
                    // 鲸落效果：围绕死亡中心扩散成雾，弱化鱼的形状
                    const center = fish.whaleFallCenter || fish.spine.joints[0];
                    const t = p.fadeTime || 0;
                    const baseAngle = p.driftAngle !== undefined ? p.driftAngle : Math.random() * Math.PI * 2;
                    const spread = (p.baseRadius || 60) + t * 45;
                    const swirl = (Math.random() - 0.5) * 0.2; // 轻微旋涡感
                    const sink = t * 12; // 缓慢下沉
                    px = center.x + Math.cos(baseAngle + swirl) * spread + (Math.random() - 0.5) * 9;
                    py = center.y + Math.sin(baseAngle + swirl) * spread + sink + (Math.random() - 0.5) * 9;
                    
                    let alpha;
                    if (t < WHALE_LINGER_TIME) {
                        alpha = 0.45;
                    } else {
                        const fadeProgress = Math.min(1, (t - WHALE_LINGER_TIME) / WHALE_FADE_TIME);
                        alpha = 0.45 * (1 - fadeProgress);
                    }
                    boostedColor = [
                        0.50 + Math.random() * 0.18,
                        0.64 + Math.random() * 0.16,
                        0.80 + Math.random() * 0.12,
                        alpha
                    ];
                } else if (vividBoost !== 1 && p.color) {
                    boostedColor = [
                        Math.min(1, p.color[0] * vividBoost),
                        Math.min(1, p.color[1] * vividBoost * 0.95),
                        Math.min(1, p.color[2] * vividBoost * 0.9),
                        p.color[3]
                    ];
                }
                return { 
                    ...p, 
                    x: px, 
                    y: py, 
                    color: boostedColor,
                    isDead: isWhaleFall
                };
            });
            
            // Debug 模式时进一步降低粒子生成率
            if (debugMode) {
                const reduction = Math.max(1, Math.floor(1 / debugParticleReduction));
                for (let i = 0; i < worldPoints.length; i += reduction) {
                    allSkeletonPoints.push(worldPoints[i]);
                }
            } else {
                allSkeletonPoints.push(...worldPoints);
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
        
        const spawnBlend = hasWhaleFall ? Math.max(particleBlend, 0.7) : particleBlend;
        particleSystem.spawnRate = BASE_PARTICLE_SPAWN_RATE * ecoSpawnMultiplier * debugSpawnScale * spawnBlend;

        const frameBlend = hasWhaleFall ? Math.max(particleBlend, 0.85) : particleBlend;
        particleSystem.update(deltaTime, allSkeletonPoints, frameBlend);
        
        // 创建正交投影矩阵
        const projection = [
            2 / canvas.width, 0, 0, 0,
            0, -2 / canvas.height, 0, 0,
            0, 0, 1, 0,
            -1, 1, 0, 1
        ];
        
        regl.clear({ color: [0, 0, 0, 0], depth: 1 });
        particleSystem.render(projection, camera);
    }
    
    // ===== 7.5. 渲染荷叶遮罩（顶层 overlay canvas，固定在世界坐标，遮挡鱼） =====
    // 先清除 overlay canvas
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    
    if (lotusImage && lotusImage.complete) {
        overlayCtx.save();
        
        // 应用惊扰滤镜：荷叶也变黑白
        if (homeostasis) {
            const panic = homeostasis.panic; // 0-1
            // 只有当惊扰程度明显时才应用，节省性能
            if (panic > 0.05) {
                // 灰度增加 (0 -> 100%)
                const grayscale = Math.min(100, panic * 120); 
                // 亮度降低 (100% -> 60%)
                const brightness = Math.max(60, 100 - panic * 40);
                // 对比度略微降低 (100% -> 90%)
                const contrast = Math.max(90, 100 - panic * 10);
                
                overlayCtx.filter = `grayscale(${grayscale}%) brightness(${brightness}%) contrast(${contrast}%)`;
            }
        }
        
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
    if (USE_REAL_SENSOR) {
    ctx.save();
    ctx.fillStyle = 'rgba(100, 200, 255, 0.6)';
    ctx.font = '14px monospace';
    const infoText = `玩家: (${Math.floor(playerFish?.spine.joints[0].x || 0)}, ${Math.floor(playerFish?.spine.joints[0].y || 0)}) | 视野: ${visibleFishes.length}/${fishes.length} 鱼 | Zoom: ${camera.zoom.toFixed(2)}x`;
    ctx.fillText(infoText, 10, canvas.height - 20);
    ctx.restore();
    }

    requestAnimationFrame(animate);
}

requestAnimationFrame(animate);
