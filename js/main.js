// ============= 主程序 =============

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

window.addEventListener('resize', () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
});

// 创建鱼群
const fishes = [];

// 随机生成离散的初始位置
function generateRandomPosition() {
    const margin = 150;
    return {
        x: margin + Math.random() * (canvas.width - margin * 2),
        y: margin + Math.random() * (canvas.height - margin * 2)
    };
}

// 确保鱼的初始位置不重叠（减小最小距离以适配更小的鱼）
function generateNonOverlappingPosition(existingPositions, minDistance = 180) {
    let attempts = 0;
    let pos;
    
    while (attempts < 100) {
        pos = generateRandomPosition();
        let valid = true;
        
        for (let existing of existingPositions) {
            const dx = pos.x - existing.x;
            const dy = pos.y - existing.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            
            if (dist < minDistance) {
                valid = false;
                break;
            }
        }
        
        if (valid) return pos;
        attempts++;
    }
    
    return pos; // 如果尝试太多次，返回最后一个位置
}

// 创建多个鱼群
const groupCount = 3; // 3个群组
const fishPerGroup = 4 + Math.floor(Math.random() * 3); // 每组4-6条鱼
const totalFish = groupCount * fishPerGroup;
const positions = [];

// 为每个群组生成一个初始中心位置
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
        // 在群组中心附近生成位置
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.random() * groupRadius;
        const pos = {
            x: groupCenter.x + Math.cos(angle) * radius,
            y: groupCenter.y + Math.sin(angle) * radius
        };
        
        // 确保在画布内
        const margin = 150;
        pos.x = Math.max(margin, Math.min(canvas.width - margin, pos.x));
        pos.y = Math.max(margin, Math.min(canvas.height - margin, pos.y));
        
        // 检查是否与已有位置重叠
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
            i--; // 重试
            continue;
        }
        
        positions.push(pos);
        
        // 第一条鱼是橙色，其余白色
        const fishType = (!orangeFishCreated) ? 'orange' : 'white';
        if (!orangeFishCreated) orangeFishCreated = true;
        
        const fish = new Fish(new Vec2(pos.x, pos.y), fishType);
        fish.groupId = g; // 设置群组ID
        
        // 为每条鱼设置略微不同的参数
        fish.separationRadius = 130 + Math.random() * 30;
        fish.alignmentRadius = 170 + Math.random() * 30;
        fish.cohesionRadius = 200 + Math.random() * 50;
        fish.maxSpeed = 1.0 + Math.random() * 0.4;
        fish.maxForce = 0.03 + Math.random() * 0.02;  // 降低到0.03-0.05范围
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

    requestAnimationFrame(animate);
}

requestAnimationFrame(animate);

