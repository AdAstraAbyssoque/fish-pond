// ============= Fish类 - 锦鲤（基础回退版） =============
const BASE_SPINE_LINK_SIZE = 40;
const BASE_BODY_WIDTH = [40, 48, 50, 50, 46, 38, 30, 23, 19, 11];
const BASE_SELECTION_RADIUS = 60;
const MIN_SELECTION_RADIUS = 18;
const MIN_PULSE_SIZE = 30;
const SPEED_SCALE = 0.5; // 全局速度缩放，0.5 表示降到原来的二分之一

class Fish {
    constructor(origin, type = 'white', scale = 1) {
        this.scale = Math.max(0.05, scale || 1);
        this.spine = new Chain(origin, 12, BASE_SPINE_LINK_SIZE * this.scale, Math.PI / 8);
        this.type = type;
        this.selected = false;

        this.bodyWidth = BASE_BODY_WIDTH.map(width => width * this.scale);
        this.hitRadius = Math.max(MIN_SELECTION_RADIUS, BASE_SELECTION_RADIUS * this.scale);

        if (type === 'orange') {
            this.bodyColor = 'rgba(255, 99, 71, 0.95)';
            this.finColor = 'rgba(255, 140, 105, 0.9)';
            this.highlightColor = 'rgba(255, 160, 122, 0.6)';
        } else {
            this.bodyColor = 'rgba(240, 240, 245, 0.85)';
            this.finColor = 'rgba(255, 255, 255, 0.7)';
            this.highlightColor = 'rgba(255, 255, 255, 0.4)';
        }

        this.groupId = 0;

        this.separationRadius = 140;
        this.alignmentRadius = 180;
        this.cohesionRadius = 220;

        this.separationWeight = 2.5;
        this.alignmentWeight = 0.8;
        this.cohesionWeight = 0.6;
        this.noiseWeight = 0.7;
        this.circlingWeight = 0;

        this.boundaryMargin = 150;
        this.boundaryWeight = 3.5;

        this.velocity = Vec2.fromAngle(Math.random() * Math.PI * 2).setMag(0.5 * SPEED_SCALE);  // 初始速度
        this.maxSpeed = 1.2 * SPEED_SCALE;  // 最大速度
        this.maxForce = 0.04 * SPEED_SCALE;

        this.noiseOffsetX = Math.random() * 1000;
        this.noiseOffsetY = Math.random() * 1000;
        this.noiseScale = 0.003;
        this.noiseTime = 0;

        this.circlingCenter = null;
        this.circlingTime = 0;
        this.maxCirclingTime = 3 + Math.random() * 4;
        this.circlingCooldown = 0;
        this.circlingDirection = Math.random() < 0.5 ? 1 : -1;

        this.baseMaxSpeed = this.maxSpeed;
        this.baseNoiseWeight = this.noiseWeight;
        
        // 个性化偏差：每条鱼对传感器角度有一个固定的随机偏差（+/- 25度）
        // 这样即使传感器给所有鱼同一个指令，它们也不会完全平行游动
        this.sensorAngleOffset = (Math.random() - 0.5) * (Math.PI / 3.6); 

        // 记录上一帧的完整度，用于检测消失事件
        this.lastIntegrity = 1.0;
        this.whaleFallCenter = null;  // 供鲸落效果使用
        this.respawnDelay = 0;        // 鲸落后延迟复活

        // 临时结群机制
        this.schoolingTimer = 0;       // 剩余结群时间
        this.schoolingCooldown = 0;    // 结群冷却时间
        this.isSchooling = false;
        
        // 是否已经永久死亡（用于控制玩家鱼消失动画）
        this.isPermanentlyDead = false;
    }

    resolve(otherFish, deltaTime, canvasWidth, canvasHeight, playerControl = null, playerFish = null, ecoModifiers = null) {
        const headPos = this.spine.joints[0];
        this.noiseTime += deltaTime;
        const eco = ecoModifiers || { speedMultiplier: 1, noiseMultiplier: 1, boundarySlowdown: 1 };

        // 更新结群状态
        if (this.schoolingCooldown > 0) {
            this.schoolingCooldown -= deltaTime;
        }

        if (this.isSchooling) {
            this.schoolingTimer -= deltaTime;
            if (this.schoolingTimer <= 0) {
                this.isSchooling = false;
                this.schoolingCooldown = 15 + Math.random() * 25; // 15-40秒冷却
                // console.log('🐟 结束结群，进入冷却');
            }
        } else {
            // 如果不在冷却且不在结群，有机会开始结群
            if (this.schoolingCooldown <= 0 && Math.random() < 0.002) { // 约每8秒检查一次 (60fps)
                this.isSchooling = true;
                this.schoolingTimer = 5 + Math.random() * 10; // 5-15秒结群
                // console.log('🐟 开始临时结群！时长:', this.schoolingTimer.toFixed(1));
            }
        }

        let acceleration = new Vec2(0, 0);
        
        // 1. 始终添加一点自然游动的噪音力，让它们看起来更自由
        const noiseForce = this.calculateNoiseForce();
        acceleration = acceleration.add(noiseForce.mult(this.noiseWeight * (eco.noiseMultiplier || 1)));
        
        // 2. 邻居查找（用于分离和结群）
        // 优化：只在需要时计算邻居
        const neighbors = [];
        const checkRadius = Math.max(this.separationRadius, this.cohesionRadius);
        for (let other of otherFish) {
            if (other !== this) {
                // Vec2 没有 dist 方法，使用 sub().mag() 代替
                const d = headPos.sub(other.spine.joints[0]).mag();
                if (d < checkRadius) {
                    neighbors.push({ fish: other, distance: d });
                }
            }
        }

        // 3. 分离力 (Separation) - 始终保持，避免重叠
        // 稍微降低权重，允许偶尔靠近
        const separation = this.calculateSeparation(neighbors).mult(this.separationWeight * 0.8);
        acceleration = acceleration.add(separation);

        // 4. 结群力 (Cohesion & Alignment) - 仅在结群状态下生效
        if (this.isSchooling) {
            const alignment = this.calculateAlignment(neighbors).mult(this.alignmentWeight);
            const cohesion = this.calculateCohesion(neighbors).mult(this.cohesionWeight);
            acceleration = acceleration.add(alignment).add(cohesion);
        }

        // 5. 传感器角度控制（主要驱动力）
        if (ecoModifiers && ecoModifiers.sensorAngle !== null && ecoModifiers.sensorAngle !== undefined) {
            // 传感器角度：AngX
            // AngX 0-180度 → 鱼左转0-180度（映射到0-π弧度）
            // AngX 0到-180度 → 鱼右转0-180度（映射到π-2π弧度，即-π到0弧度）
            let sensorAngleDeg = ecoModifiers.sensorAngle;
            
            // 映射规则：
            // 0-180度 → 0-π 弧度（直接映射）
            // -180到0度 → 转换为180-360度，然后映射到π-2π弧度（即-π到0弧度）
            let targetAngle;
            if (sensorAngleDeg >= 0 && sensorAngleDeg <= 180) {
                // 左转：0-180度 → 0-π 弧度
                targetAngle = (sensorAngleDeg / 180) * Math.PI;
            } else if (sensorAngleDeg < 0 && sensorAngleDeg >= -180) {
                // 右转：-180到0度 → 转换为180-360度 → π-2π弧度
                // 例如：-180° → 180° → π, -90° → 270° → 3π/2, 0° → 360° → 2π
                const normalizedDeg = 360 + sensorAngleDeg; // -180 → 180, -90 → 270, 0 → 360
                targetAngle = (normalizedDeg / 180) * Math.PI; // 180 → π, 270 → 3π/2, 360 → 2π
            } else {
                // 超出范围，归一化到-180到180
                sensorAngleDeg = ((sensorAngleDeg % 360) + 360) % 360;
                if (sensorAngleDeg > 180) sensorAngleDeg -= 360;
                if (sensorAngleDeg >= 0) {
                    targetAngle = (sensorAngleDeg / 180) * Math.PI;
                } else {
                    const normalizedDeg = 360 + sensorAngleDeg;
                    targetAngle = (normalizedDeg / 180) * Math.PI;
                }
            }
            
            // 计算目标方向向量（加入个性化偏差）
            const finalTargetAngle = targetAngle + this.sensorAngleOffset;
            const targetDirection = Vec2.fromAngle(finalTargetAngle);
            
            // 计算当前速度方向
            let currentAngle;
            if (this.velocity.mag() > 0.01) {
                currentAngle = this.velocity.heading();
            } else {
                // 如果速度很小，使用头部朝向
                if (this.spine.joints.length >= 2) {
                    const headDir = this.spine.joints[0].sub(this.spine.joints[1]);
                    currentAngle = headDir.heading();
                } else {
                    currentAngle = 0;
                }
            }
            
            // 计算角度差
            let angleDiff = finalTargetAngle - currentAngle;
            // 归一化到 [-π, π]
            while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
            while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
            
            // 调试信息：每0.5秒输出一次（避免刷屏）
            if (!this._lastDebugTime || Date.now() - this._lastDebugTime > 500) {
                const currentAngleDeg = (currentAngle * 180 / Math.PI);
                let targetAngleDeg = (finalTargetAngle * 180 / Math.PI);
                // 将弧度转换为-180到180度的范围显示
                if (targetAngleDeg > 180) targetAngleDeg -= 360;
                const angleDiffDeg = (angleDiff * 180 / Math.PI);
                const direction = sensorAngleDeg >= 0 ? '左转' : '右转';
                /*
                console.log(`🎯 传感器角度控制调试 (AngX):`);
                console.log(`   传感器角度: ${sensorAngleDeg.toFixed(1)}° (${direction})`);
                console.log(`   目标方向: ${targetAngleDeg.toFixed(1)}° (${finalTargetAngle.toFixed(3)} 弧度)`);
                console.log(`   当前方向: ${currentAngleDeg.toFixed(1)}° (${currentAngle.toFixed(3)} 弧度)`);
                console.log(`   角度差: ${angleDiffDeg.toFixed(1)}°`);
                */
                this._lastDebugTime = Date.now();
            }
            
            // 保存调试信息到全局（供 UI 显示）
            if (!window.sensorAngleDebug) {
                window.sensorAngleDebug = {};
            }
            let targetAngleDeg = (finalTargetAngle * 180 / Math.PI);
            if (targetAngleDeg > 180) targetAngleDeg -= 360;
            window.sensorAngleDebug = {
                sensorAngleDeg: sensorAngleDeg,
                targetAngleDeg: targetAngleDeg,
                currentAngleDeg: (currentAngle * 180 / Math.PI),
                angleDiffDeg: (angleDiff * 180 / Math.PI),
                targetAngleRad: finalTargetAngle,
                currentAngleRad: currentAngle,
                direction: sensorAngleDeg >= 0 ? '左转' : '右转'
            };
            
            // 直接朝向目标方向（更强的控制力）
            const angleDiffAbs = Math.abs(angleDiff);
            const turnStrength = Math.min(1, angleDiffAbs / (Math.PI / 3)); // 60度内线性响应
            
            // 转向力：垂直于当前速度方向
            const turnDirection = angleDiff > 0 ? 1 : -1;
            const perpendicularAngle = currentAngle + (Math.PI / 2) * turnDirection;
            const turnForce = Vec2.fromAngle(perpendicularAngle).mult(this.maxForce * turnStrength * 3);
            
            // 朝向目标方向的吸引力（主要力）
            // 降低一点吸引力，让 NoiseForce 更明显
            const attractionForce = targetDirection.mult(this.maxForce * 1.5);
            
            acceleration = acceleration.add(turnForce).add(attractionForce);
        } else {
            // 如果没有传感器角度，保持当前方向（最小速度）
            // 此时 NoiseForce 已经是主要动力
            if (this.velocity.mag() < 0.1) {
                // 如果速度很小，给一个很小的随机方向
                const randomAngle = Math.random() * Math.PI * 2;
                const smallForce = Vec2.fromAngle(randomAngle).mult(this.maxForce * 0.1);
                acceleration = acceleration.add(smallForce);
            }
        }
        
        // 边界躲避（保留，避免鱼游出屏幕）
        const boundaryForce = this.calculateBoundaryAvoidance(headPos, canvasWidth, canvasHeight);
        acceleration = acceleration.add(boundaryForce.mult(this.boundaryWeight));

        // 应用阻尼和加速度
        this.velocity = this.velocity.mult(0.98).add(acceleration);

        // 速度限制
        const dynamicMaxSpeed = this.baseMaxSpeed * (eco.speedMultiplier || 1);
        const currentMaxSpeed = this.circlingTime > 0 ? dynamicMaxSpeed * 0.8 : dynamicMaxSpeed;
        if (this.velocity.mag() > currentMaxSpeed) {
            this.velocity = this.velocity.setMag(currentMaxSpeed);
        }

        // 最小速度
        // 让最小速度也受生态倍率影响，这样濒死时可以停下来
        // eco.speedMultiplier 在惊扰时可能>1，取 min(1, val) 确保最小速度只会降低不会升高
        const baseMinSpeed = 0.2 * SPEED_SCALE;
        let effectiveMinSpeed = baseMinSpeed;
        if (eco.speedMultiplier !== undefined && eco.speedMultiplier < 1) {
            effectiveMinSpeed = baseMinSpeed * eco.speedMultiplier;
        }

        if (this.velocity.mag() < effectiveMinSpeed) {
            this.velocity = this.velocity.setMag(effectiveMinSpeed);
        }

        // 使用合理的速度倍数（而不是固定的12）
        const moveSpeed = 8.0 * SPEED_SCALE;  // 移动速度
        let newPos = headPos.add(this.velocity.mult(moveSpeed));
        
        // 碰撞检测：检查新位置是否可行走
        if (window.isPositionWalkable && !window.isPositionWalkable(newPos.x, newPos.y)) {
            // 如果新位置不可通过，尝试沿着边界滑动
            // 1. 尝试只在 X 方向移动
            const newPosX = new Vec2(newPos.x, headPos.y);
            if (window.isPositionWalkable(newPosX.x, newPosX.y)) {
                newPos = newPosX;
            } else {
                // 2. 尝试只在 Y 方向移动
                const newPosY = new Vec2(headPos.x, newPos.y);
                if (window.isPositionWalkable(newPosY.x, newPosY.y)) {
                    newPos = newPosY;
                } else {
                    // 3. 两个方向都不行，则反弹
                    newPos = headPos;
                    // 反转速度方向（弹开效果）
                    this.velocity = this.velocity.mult(-0.5);
                }
            }
        }
        
        // 边界硬限制（作为额外保险）- 只在没有碰撞遮罩时使用
        if (!window.isPositionWalkable) {
            const hardMargin = 30;
            newPos.x = Math.max(hardMargin, Math.min(canvasWidth - hardMargin, newPos.x));
            newPos.y = Math.max(hardMargin, Math.min(canvasHeight - hardMargin, newPos.y));
        }

        // 接近不可通行区时施加减速（配合生态动荡时的“撞墙减速”）
        if (window.isPositionWalkable && eco.boundarySlowdown < 1) {
            const probeDistance = 40;
            const probeX = newPos.x + Math.sign(this.velocity.x) * probeDistance;
            const probeY = newPos.y + Math.sign(this.velocity.y) * probeDistance;
            if (!window.isPositionWalkable(probeX, probeY)) {
                this.velocity = this.velocity.mult(eco.boundarySlowdown);
            }
        }

        this.spine.resolve(newPos);
    }

    calculateSeparation(neighbors) {
        let steer = new Vec2(0, 0);
        let count = 0;
        for (let neighbor of neighbors) {
            if (neighbor.distance < this.separationRadius && neighbor.distance > 0) {
                const headPos = this.spine.joints[0];
                const otherPos = neighbor.fish.spine.joints[0];
                let diff = headPos.sub(otherPos);
                diff = diff.mult(1 / neighbor.distance);
                steer = steer.add(diff);
                count++;
            }
        }
        if (count > 0) {
            steer = steer.mult(1 / count);
            if (steer.mag() > 0) {
                steer = steer.setMag(this.maxSpeed);
                steer = steer.sub(this.velocity);
                if (steer.mag() > this.maxForce) {
                    steer = steer.setMag(this.maxForce);
                }
            }
        }
        return steer;
    }

    calculateAlignment(neighbors) {
        let avgVelocity = new Vec2(0, 0);
        let count = 0;
        for (let neighbor of neighbors) {
            if (neighbor.distance < this.alignmentRadius) {
                avgVelocity = avgVelocity.add(neighbor.fish.velocity);
                count++;
            }
        }
        if (count > 0) {
            avgVelocity = avgVelocity.mult(1 / count).setMag(this.maxSpeed);
            let steer = avgVelocity.sub(this.velocity);
            if (steer.mag() > this.maxForce) {
                steer = steer.setMag(this.maxForce);
            }
            return steer;
        }
        return new Vec2(0, 0);
    }

    calculateCohesion(neighbors) {
        let centerOfMass = new Vec2(0, 0);
        let count = 0;
        for (let neighbor of neighbors) {
            if (neighbor.distance < this.cohesionRadius) {
                centerOfMass = centerOfMass.add(neighbor.fish.spine.joints[0]);
                count++;
            }
        }
        if (count > 0) {
            centerOfMass = centerOfMass.mult(1 / count);
            const headPos = this.spine.joints[0];
            let desired = centerOfMass.sub(headPos);
            if (desired.mag() > 0) {
                desired = desired.setMag(this.maxSpeed);
                let steer = desired.sub(this.velocity);
                if (steer.mag() > this.maxForce) {
                    steer = steer.setMag(this.maxForce);
                }
                return steer;
            }
        }
        return new Vec2(0, 0);
    }

    calculateNoiseForce() {
        const noiseX = globalNoise.noise(this.noiseOffsetX + this.noiseTime * this.noiseScale, 0);
        const noiseY = globalNoise.noise(this.noiseOffsetY + this.noiseTime * this.noiseScale, 100);
        const angle = Math.atan2(noiseY, noiseX);
        let desired = Vec2.fromAngle(angle).setMag(this.maxSpeed * 0.5);
        let steer = desired.sub(this.velocity);
        if (steer.mag() > this.maxForce * 0.3) {
            steer = steer.setMag(this.maxForce * 0.3);
        }
        return steer;
    }

    calculateCircling() {
        if (!this.circlingCenter || this.circlingTime <= 0) {
            return new Vec2(0, 0);
        }
        const headPos = this.spine.joints[0];
        const toCenter = this.circlingCenter.sub(headPos);
        const distToCenter = toCenter.mag();
        if (distToCenter < 10) {
            return new Vec2(0, 0);
        }
        const tangent = new Vec2(-toCenter.y * this.circlingDirection, toCenter.x * this.circlingDirection);
        const desiredRadius = 80;
        const radiusError = distToCenter - desiredRadius;
        const centerPull = toCenter.setMag(radiusError * 0.02);
        const tangentForce = tangent.setMag(this.maxForce * 0.6);
        let force = tangentForce.add(centerPull);
        if (force.mag() > this.maxForce) {
            force = force.setMag(this.maxForce);
        }
        return force;
    }

    calculateBoundaryAvoidance(pos, canvasWidth, canvasHeight) {
        let force = new Vec2(0, 0);
        const margin = this.boundaryMargin;
        const softMargin = margin * 1.5; // 更大的缓冲区域
        
        // 左边界
        if (pos.x < softMargin) {
            const dist = pos.x;
            const strength = Math.pow(1 - dist / softMargin, 2); // 平方衰减，更柔和
            // 不直接推开，而是向右偏转
            const pushForce = new Vec2(strength * this.maxForce * 1.5, 0);
            // 添加切向力，让鱼沿边游
            const tangentForce = new Vec2(0, (Math.random() - 0.5) * this.maxForce * 0.5);
            force = force.add(pushForce).add(tangentForce);
        }
        
        // 右边界
        if (pos.x > canvasWidth - softMargin) {
            const dist = canvasWidth - pos.x;
            const strength = Math.pow(1 - dist / softMargin, 2);
            const pushForce = new Vec2(-strength * this.maxForce * 1.5, 0);
            const tangentForce = new Vec2(0, (Math.random() - 0.5) * this.maxForce * 0.5);
            force = force.add(pushForce).add(tangentForce);
        }
        
        // 上边界
        if (pos.y < softMargin) {
            const dist = pos.y;
            const strength = Math.pow(1 - dist / softMargin, 2);
            const pushForce = new Vec2(0, strength * this.maxForce * 1.5);
            const tangentForce = new Vec2((Math.random() - 0.5) * this.maxForce * 0.5, 0);
            force = force.add(pushForce).add(tangentForce);
        }
        
        // 下边界
        if (pos.y > canvasHeight - softMargin) {
            const dist = canvasHeight - pos.y;
            const strength = Math.pow(1 - dist / softMargin, 2);
            const pushForce = new Vec2(0, -strength * this.maxForce * 1.5);
            const tangentForce = new Vec2((Math.random() - 0.5) * this.maxForce * 0.5, 0);
            force = force.add(pushForce).add(tangentForce);
        }
        
        return force;
    }

    getPosX(i, angleOffset, lengthOffset) {
        return this.spine.joints[i].x + Math.cos(this.spine.angles[i] + angleOffset) * (this.bodyWidth[i] + lengthOffset);
    }

    getPosY(i, angleOffset, lengthOffset) {
        return this.spine.joints[i].y + Math.sin(this.spine.angles[i] + angleOffset) * (this.bodyWidth[i] + lengthOffset);
    }

    // 基于骨骼的采样（旧方法）
    sampleBodyPoints(step = 10) {
        const points = [];
        const joints = this.spine.joints;
        const angles = this.spine.angles;
        const offsets = [-1, -0.8, -0.6, -0.4, -0.2, 0, 0.2, 0.4, 0.6, 0.8, 1];

        for (let i = 0; i < joints.length - 1; i += 12 / (step * 2)) {
            const idx = Math.min(Math.floor(i), joints.length - 1);
            const joint = joints[idx];
            const normalAngle = (angles[idx] || 0) + Math.PI / 2;
            const normalVec = Vec2.fromAngle(normalAngle);
            const width = this.bodyWidth[Math.min(idx, this.bodyWidth.length - 1)] || this.bodyWidth[this.bodyWidth.length - 1];

            for (let offset of offsets) {
                const sample = joint.add(normalVec.mult(width * 0.5 * offset));
                points.push({ x: sample.x, y: sample.y });
            }
        }

        return points;
    }
    
    // 基于图像采样的方法（新方法）- 带颜色信息
    sampleBodyPointsFromImage(offscreenCtx, sampleDensity = 2) {
        const points = [];
        
        // 计算鱼的实际边界框 - 遍历所有关节点找出最大最小值
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;
        
        for (let i = 0; i < this.spine.joints.length; i++) {
            const joint = this.spine.joints[i];
            const width = this.bodyWidth[Math.min(i, this.bodyWidth.length - 1)] || this.bodyWidth[this.bodyWidth.length - 1];
            
            // 考虑鱼体宽度
            minX = Math.min(minX, joint.x - width);
            minY = Math.min(minY, joint.y - width);
            maxX = Math.max(maxX, joint.x + width);
            maxY = Math.max(maxY, joint.y + width);
        }
        
        // 添加额外的 padding 确保鳍和尾巴不被裁切
        const padding = Math.max(...this.bodyWidth) * 3;
        minX -= padding;
        minY -= padding;
        maxX += padding;
        maxY += padding;
        
        const width = maxX - minX;
        const height = maxY - minY;
        
        // 确保边界框不超出离屏 canvas
        const safeWidth = Math.min(Math.ceil(width), offscreenCtx.canvas.width);
        const safeHeight = Math.min(Math.ceil(height), offscreenCtx.canvas.height);
        
        // 清空离屏画布
        offscreenCtx.clearRect(0, 0, offscreenCtx.canvas.width, offscreenCtx.canvas.height);
        
        // 临时保存 selected 状态并关闭（避免渲染选中圆圈）
        const wasSelected = this.selected;
        this.selected = false;
        
        // 在离屏画布上渲染鱼（使用相对坐标）
        offscreenCtx.save();
        offscreenCtx.translate(-minX, -minY);
        this.display(offscreenCtx);
        offscreenCtx.restore();
        
        // 恢复 selected 状态
        this.selected = wasSelected;
        
        // 读取像素数据
        const imageData = offscreenCtx.getImageData(0, 0, safeWidth, safeHeight);
        const data = imageData.data;
        
        // 计算尾巴区域（后1/3是尾巴）
        const tailStartX = width * 0.67;
        
        // 采样像素：每隔 sampleDensity 像素采样一次，带颜色信息
        for (let y = 0; y < imageData.height; y += sampleDensity) {
            for (let x = 0; x < imageData.width; x += sampleDensity) {
                const idx = (y * imageData.width + x) * 4;
                const r = data[idx + 0];
                const g = data[idx + 1];
                const b = data[idx + 2];
                const alpha = data[idx + 3];
                
                // 如果像素不透明（alpha > 阈值），则作为采样点
                if (alpha > 20) {
                    // 判断是否是尾巴区域
                    const isTail = x > tailStartX;
                    // 计算在尾巴中的位置比例（0=尾根，1=尾尖）
                    const tailProgress = isTail ? (x - tailStartX) / (width - tailStartX) : 0;
                    
                    // 打散网格采样：给像素位置加一点随机抖动，避免粒子呈现规则网格
                    const jitter = Math.max(0.5, sampleDensity * 0.7);
                    const jx = (Math.random() - 0.5) * jitter;
                    const jy = (Math.random() - 0.5) * jitter;
                    
                    points.push({
                        x: minX + x + jx,
                        y: minY + y + jy,
                        color: [r / 255, g / 255, b / 255, alpha / 255],
                        isTail: isTail,
                        tailProgress: tailProgress  // 0-1，越靠近尾尖越大
                    });
                }
            }
        }
        
        return points;
    }

    display(ctx) {
        const j = this.spine.joints;
        const a = this.spine.angles;
        const s = this.scale;

        const headToMid1 = relativeAngleDiff(a[0], a[6]);
        const headToMid2 = relativeAngleDiff(a[0], a[7]);
        const headToTail = headToMid1 + relativeAngleDiff(a[6], a[11]);

        if (this.selected) {
            const head = j[0];
            ctx.save();
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
            ctx.lineWidth = Math.max(0.6, 2 * s);
            ctx.beginPath();
            const rawPulse = (70 + Math.sin(Date.now() * 0.003) * 8) * s;
            const pulseSize = Math.max(MIN_PULSE_SIZE, rawPulse);
            ctx.arc(head.x, head.y, pulseSize, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.lineWidth = Math.max(0.8, 3 * s);
        ctx.fillStyle = this.finColor;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        // 胸鳍
        ctx.save();
        ctx.globalAlpha = 0.7;
        ctx.translate(this.getPosX(3, Math.PI / 3, 0), this.getPosY(3, Math.PI / 3, 0));
        ctx.rotate(a[2] - Math.PI / 4);
        ctx.beginPath();
        ctx.ellipse(0, 0, 48 * s, 20 * s, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();

        ctx.save();
        ctx.globalAlpha = 0.7;
        ctx.translate(this.getPosX(3, -Math.PI / 3, 0), this.getPosY(3, -Math.PI / 3, 0));
        ctx.rotate(a[2] + Math.PI / 4);
        ctx.beginPath();
        ctx.ellipse(0, 0, 48 * s, 20 * s, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();

        // 腹鳍
        ctx.save();
        ctx.globalAlpha = 0.7;
        ctx.translate(this.getPosX(7, Math.PI / 2, 0), this.getPosY(7, Math.PI / 2, 0));
        ctx.rotate(a[6] - Math.PI / 4);
        ctx.beginPath();
        ctx.ellipse(0, 0, 30 * s, 10 * s, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();

        ctx.save();
        ctx.globalAlpha = 0.7;
        ctx.translate(this.getPosX(7, -Math.PI / 2, 0), this.getPosY(7, -Math.PI / 2, 0));
        ctx.rotate(a[6] + Math.PI / 4);
        ctx.beginPath();
        ctx.ellipse(0, 0, 30 * s, 10 * s, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();

        ctx.globalAlpha = 1.0;

        // 尾鳍
        ctx.beginPath();
        const tailPoints = [];
        for (let i = 8; i < 12; i++) {
            const tailWidth = 1.5 * headToTail * (i - 8) * (i - 8) * s;
            tailPoints.push({
                x: j[i].x + Math.cos(a[i] - Math.PI / 2) * tailWidth,
                y: j[i].y + Math.sin(a[i] - Math.PI / 2) * tailWidth
            });
        }
        for (let i = 11; i >= 8; i--) {
            const tailWidth = Math.max(-13 * s, Math.min(13 * s, headToTail * 6 * s));
            tailPoints.push({
                x: j[i].x + Math.cos(a[i] + Math.PI / 2) * tailWidth,
                y: j[i].y + Math.sin(a[i] + Math.PI / 2) * tailWidth
            });
        }
        if (tailPoints.length > 0) {
            ctx.moveTo(tailPoints[0].x, tailPoints[0].y);
            for (let i = 0; i < tailPoints.length; i++) {
                const p0 = tailPoints[i];
                const p1 = tailPoints[(i + 1) % tailPoints.length];
                const cp1x = p0.x + (p1.x - p0.x) * 0.5;
                const cp1y = p0.y + (p1.y - p0.y) * 0.5;
                ctx.quadraticCurveTo(p1.x, p1.y, cp1x, cp1y);
            }
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // 身体
        ctx.fillStyle = this.bodyColor;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = Math.max(0.6, 2 * s);
        ctx.beginPath();
        const rightPoints = [];
        for (let i = 0; i < 10; i++) {
            rightPoints.push({
                x: this.getPosX(i, Math.PI / 2, 0),
                y: this.getPosY(i, Math.PI / 2, 0)
            });
        }
        rightPoints.push({
            x: this.getPosX(9, Math.PI, 0),
            y: this.getPosY(9, Math.PI, 0)
        });
        const leftPoints = [];
        for (let i = 9; i >= 0; i--) {
            leftPoints.push({
                x: this.getPosX(i, -Math.PI / 2, 0),
                y: this.getPosY(i, -Math.PI / 2, 0)
            });
        }
        const headPoints = [
            { x: this.getPosX(0, -Math.PI / 6, 0), y: this.getPosY(0, -Math.PI / 6, 0) },
            { x: this.getPosX(0, 0, 4 * s), y: this.getPosY(0, 0, 4 * s) },
            { x: this.getPosX(0, Math.PI / 6, 0), y: this.getPosY(0, Math.PI / 6, 0) }
        ];
        const allPoints = [...rightPoints, ...leftPoints, ...headPoints];
        if (allPoints.length > 2) {
            ctx.moveTo(allPoints[0].x, allPoints[0].y);
            for (let i = 1; i < allPoints.length - 2; i++) {
                const xc = (allPoints[i].x + allPoints[i + 1].x) / 2;
                const yc = (allPoints[i].y + allPoints[i + 1].y) / 2;
                ctx.quadraticCurveTo(allPoints[i].x, allPoints[i].y, xc, yc);
            }
            ctx.quadraticCurveTo(
                allPoints[allPoints.length - 2].x,
                allPoints[allPoints.length - 2].y,
                allPoints[allPoints.length - 1].x,
                allPoints[allPoints.length - 1].y
            );
            ctx.quadraticCurveTo(
                allPoints[allPoints.length - 1].x,
                allPoints[allPoints.length - 1].y,
                allPoints[0].x,
                allPoints[0].y
            );
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        if (this.highlightColor) {
            ctx.fillStyle = this.highlightColor;
            ctx.beginPath();
            ctx.ellipse(j[2].x, j[2].y, 24 * s, 15 * s, a[2], 0, Math.PI * 2);
            ctx.fill();
        }

        // 背鳍
        ctx.fillStyle = this.finColor;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.lineWidth = Math.max(0.6, 2 * s);
        ctx.beginPath();
        ctx.moveTo(j[4].x, j[4].y);
        ctx.bezierCurveTo(
            j[5].x, j[5].y,
            j[6].x, j[6].y,
            j[7].x, j[7].y
        );
        ctx.bezierCurveTo(
            j[6].x + Math.cos(a[6] + Math.PI / 2) * headToMid2 * 16,
            j[6].y + Math.sin(a[6] + Math.PI / 2) * headToMid2 * 16,
            j[5].x + Math.cos(a[5] + Math.PI / 2) * headToMid1 * 16,
            j[5].y + Math.sin(a[5] + Math.PI / 2) * headToMid1 * 16,
            j[4].x, j[4].y
        );
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // 眼睛 - 已移除
    }

    containsPoint(x, y) {
        const head = this.spine.joints[0];
        const dist = Math.sqrt((x - head.x) ** 2 + (y - head.y) ** 2);
        return dist < this.hitRadius;
    }
}
