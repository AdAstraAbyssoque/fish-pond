// ============= 主程序 =============

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

window.addEventListener('resize', () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    particleOverlay?.syncCanvasSize(canvas.width, canvas.height);
});

// 创建鱼群
const fishes = [];
let particleOverlay = null;

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

    const groupCount = 3; // 3个群组
    const fishPerGroup = 4 + Math.floor(Math.random() * 3); // 每组4-6条鱼
    const positions = [];
    const groupCenters = [];

    for (let g = 0; g < groupCount; g++) {
        const centerX = canvas.width * (0.25 + Math.random() * 0.5);
        const centerY = canvas.height * (0.25 + Math.random() * 0.5);
        groupCenters.push({x: centerX, y: centerY});
    }

    let orangeFishCreated = false;

    for (let g = 0; g < groupCount; g++) {
        const groupCenter = groupCenters[g];
        const groupRadius = 150 + Math.random() * 100;
        
        for (let i = 0; i < fishPerGroup; i++) {
            const angle = Math.random() * Math.PI * 2;
            const radius = Math.random() * groupRadius;
            const pos = {
                x: groupCenter.x + Math.cos(angle) * radius,
                y: groupCenter.y + Math.sin(angle) * radius
            };
            
            const margin = 150;
            pos.x = Math.max(margin, Math.min(canvas.width - margin, pos.x));
            pos.y = Math.max(margin, Math.min(canvas.height - margin, pos.y));
            
            let valid = true;
            for (let existing of positions) {
                const dx = pos.x - existing.x;
                const dy = pos.y - existing.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < 120) {
                    valid = false;
                    break;
                }
            }
            
            if (!valid) {
                i--;
                continue;
            }
            
            positions.push(pos);
            
            const fishType = (!orangeFishCreated) ? 'orange' : 'white';
            if (!orangeFishCreated) orangeFishCreated = true;
            
            const fish = new Fish(new Vec2(pos.x, pos.y), fishType, pondScale);
            fish.groupId = g;
            
            fish.separationRadius = 130 + Math.random() * 30;
            fish.alignmentRadius = 170 + Math.random() * 30;
            fish.cohesionRadius = 200 + Math.random() * 50;
            fish.maxSpeed = 1.0 + Math.random() * 0.4;
            fish.maxForce = 0.03 + Math.random() * 0.02;
            fish.separationWeight = 2.3 + Math.random() * 0.4;
            fish.boundaryMargin = 140 + Math.random() * 30;
            fish.noiseScale = 0.002 + Math.random() * 0.002;
            fish.circlingDirection = Math.random() < 0.5 ? 1 : -1;
            
            if (fishType === 'orange') {
                fish.selected = true;
            }
            
            fishes.push(fish);
        }
    }

    particleOverlay?.syncFishes(fishes);
}

function bootstrap() {
    setupScaleControls();
    initPond();
    if (!particleOverlay) {
        particleOverlay = new ParticleOverlay(canvas.width, canvas.height);
        particleOverlay.syncFishes(fishes);
    }
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

// 绘制池塘阴影效果
function drawPondShadows(ctx) {
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    
    // 绘制多个半透明圆形阴影
    const shadows = [
        {x: canvas.width * 0.25, y: canvas.height * 0.25, r: 200, opacity: 0.15},
        {x: canvas.width * 0.75, y: canvas.height * 0.3, r: 180, opacity: 0.12},
        {x: canvas.width * 0.5, y: canvas.height * 0.5, r: 250, opacity: 0.18},
        {x: canvas.width * 0.2, y: canvas.height * 0.7, r: 150, opacity: 0.1},
        {x: canvas.width * 0.8, y: canvas.height * 0.75, r: 170, opacity: 0.13},
    ];
    
    shadows.forEach(shadow => {
        const gradient = ctx.createRadialGradient(
            shadow.x, shadow.y, 0,
            shadow.x, shadow.y, shadow.r
        );
        gradient.addColorStop(0, `rgba(20, 25, 30, ${shadow.opacity})`);
        gradient.addColorStop(0.6, `rgba(20, 25, 30, ${shadow.opacity * 0.5})`);
        gradient.addColorStop(1, 'rgba(20, 25, 30, 0)');
        
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(shadow.x, shadow.y, shadow.r, 0, Math.PI * 2);
        ctx.fill();
    });
}

// 绘制圆形边界装饰
function drawPondBorders(ctx) {
    const borders = [
        {x: canvas.width * 0.15, y: canvas.height * 0.2, r: 60},
        {x: canvas.width * 0.85, y: canvas.height * 0.15, r: 45},
        {x: canvas.width * 0.1, y: canvas.height * 0.8, r: 50},
        {x: canvas.width * 0.9, y: canvas.height * 0.85, r: 55},
    ];
    
    borders.forEach(border => {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(border.x, border.y, border.r, 0, Math.PI * 2);
        ctx.stroke();
        
        // 内圈
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
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
    
    // 背景渐变
    const gradient = ctx.createRadialGradient(
        canvas.width / 2, canvas.height / 2, 0,
        canvas.width / 2, canvas.height / 2, Math.max(canvas.width, canvas.height)
    );
    gradient.addColorStop(0, '#3a3e45');
    gradient.addColorStop(1, '#2a2e35');
    
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // 绘制池塘效果
    drawPondShadows(ctx);
    drawPondBorders(ctx);
    
    // 更新和绘制所有鱼
    for (let fish of fishes) {
        fish.resolve(fishes, deltaTime, canvas.width, canvas.height);
        fish.display(ctx);
    }

    particleOverlay?.renderFrame(deltaTime);

    requestAnimationFrame(animate);
}

requestAnimationFrame(animate);

