// ============= Fish类 - 锦鲤 =============

class Fish {
    constructor(origin, type = 'white') {
        this.spine = new Chain(origin, 12, 40, Math.PI / 8); // 减小linkSize从64到40
        this.type = type;
        this.selected = false;
        
        // 身体宽度 - 缩小到原来的60%
        this.bodyWidth = [40, 48, 50, 50, 46, 38, 30, 23, 19, 11];
        
        // 根据类型设置颜色
        if (type === 'orange') {
            this.bodyColor = 'rgba(255, 99, 71, 0.95)'; // 橙红色
            this.finColor = 'rgba(255, 140, 105, 0.9)';
            this.highlightColor = 'rgba(255, 160, 122, 0.6)';
        } else {
            this.bodyColor = 'rgba(240, 240, 245, 0.85)'; // 白色
            this.finColor = 'rgba(255, 255, 255, 0.7)';
            this.highlightColor = 'rgba(255, 255, 255, 0.4)';
        }
        
        // 群组ID
        this.groupId = 0;
        
        // Boids算法参数
        this.separationRadius = 140; // 分离距离（避免拥挤）
        this.alignmentRadius = 180;  // 对齐距离（匹配方向）
        this.cohesionRadius = 220;   // 聚合距离（向群体靠拢）
        
        // 行为权重
        this.separationWeight = 2.5;  // 分离权重最高，避免碰撞
        this.alignmentWeight = 0.8;   // 对齐权重（降低）
        this.cohesionWeight = 0.6;    // 聚合权重（降低）
        this.noiseWeight = 0.7;       // 噪声权重（新增）
        this.circlingWeight = 0;      // 环绕权重（动态变化）
        
        // 边界回避参数
        this.boundaryMargin = 150;    // 距离边界多远开始回避
        this.boundaryWeight = 3.5;    // 边界回避权重（提高）
        
        // 速度和方向
        this.velocity = Vec2.fromAngle(Math.random() * Math.PI * 2).setMag(0.5);
        this.maxSpeed = 1.2;          // 最大速度
        this.maxForce = 0.04;         // 最大转向力（大幅降低，让转向非常缓慢）
        
        // Perlin噪声参数
        this.noiseOffsetX = Math.random() * 1000;
        this.noiseOffsetY = Math.random() * 1000;
        this.noiseScale = 0.003;      // 噪声缩放，越小越平滑
        this.noiseTime = 0;
        
        // 环绕行为参数
        this.circlingCenter = null;
        this.circlingTime = 0;
        this.maxCirclingTime = 3 + Math.random() * 4; // 绕圈3-7秒
        this.circlingCooldown = 0;
        this.circlingDirection = Math.random() < 0.5 ? 1 : -1;
    }

    resolve(otherFish, deltaTime, canvasWidth, canvasHeight) {
        const headPos = this.spine.joints[0];
        this.noiseTime += deltaTime;
        
        // 收集附近的同组邻居
        const neighbors = [];
        const sameGroupNeighbors = [];
        for (let other of otherFish) {
            if (other === this) continue;
            const dist = headPos.sub(other.spine.joints[0]).mag();
            if (dist < this.cohesionRadius) {
                neighbors.push({fish: other, distance: dist});
                if (other.groupId === this.groupId) {
                    sameGroupNeighbors.push({fish: other, distance: dist});
                }
            }
        }
        
        // 检查是否应该进入环绕模式
        if (this.circlingCooldown > 0) {
            this.circlingCooldown -= deltaTime;
        }
        
        if (this.circlingTime > 0) {
            // 正在环绕
            this.circlingTime -= deltaTime;
            if (this.circlingTime <= 0) {
                this.circlingCenter = null;
                this.circlingWeight = 0;
                this.circlingCooldown = 5 + Math.random() * 5; // 冷却5-10秒
            }
        } else if (sameGroupNeighbors.length >= 3 && this.circlingCooldown <= 0) {
            // 有足够的同组邻居且不在冷却期，开始环绕
            this.circlingTime = this.maxCirclingTime;
            this.circlingWeight = 1.2;
            // 计算群体中心
            let center = new Vec2(0, 0);
            for (let n of sameGroupNeighbors) {
                center = center.add(n.fish.spine.joints[0]);
            }
            center = center.add(headPos);
            this.circlingCenter = center.mult(1 / (sameGroupNeighbors.length + 1));
        }
        
        // 计算各种力（主要针对同组成员）
        const separationForce = this.calculateSeparation(neighbors); // 所有鱼都要分离
        const alignmentForce = this.calculateAlignment(sameGroupNeighbors);
        const cohesionForce = this.calculateCohesion(sameGroupNeighbors);
        const noiseForce = this.calculateNoiseForce();
        const circlingForce = this.calculateCircling();
        const boundaryForce = this.calculateBoundaryAvoidance(headPos, canvasWidth, canvasHeight);
        
        // 组合所有力
        let acceleration = new Vec2(0, 0);
        acceleration = acceleration.add(separationForce.mult(this.separationWeight));
        acceleration = acceleration.add(alignmentForce.mult(this.alignmentWeight));
        acceleration = acceleration.add(cohesionForce.mult(this.cohesionWeight));
        acceleration = acceleration.add(noiseForce.mult(this.noiseWeight));
        acceleration = acceleration.add(circlingForce.mult(this.circlingWeight));
        acceleration = acceleration.add(boundaryForce.mult(this.boundaryWeight));
        
        // 更新速度（添加更强的阻尼）
        this.velocity = this.velocity.mult(0.99).add(acceleration);
        
        // 限制速度
        const currentMaxSpeed = this.circlingTime > 0 ? this.maxSpeed * 0.8 : this.maxSpeed;
        if (this.velocity.mag() > currentMaxSpeed) {
            this.velocity = this.velocity.setMag(currentMaxSpeed);
        }
        
        // 保持最小速度
        if (this.velocity.mag() < 0.3) {
            this.velocity = this.velocity.setMag(0.3);
        }
        
        // 计算新位置（更细腻的移动）
        const newPos = headPos.add(this.velocity.mult(12));
        
        // 硬边界限制
        const hardMargin = 30;
        newPos.x = Math.max(hardMargin, Math.min(canvasWidth - hardMargin, newPos.x));
        newPos.y = Math.max(hardMargin, Math.min(canvasHeight - hardMargin, newPos.y));
        
        this.spine.resolve(newPos);
    }
    
    // 分离：避免拥挤
    calculateSeparation(neighbors) {
        let steer = new Vec2(0, 0);
        let count = 0;
        
        for (let neighbor of neighbors) {
            if (neighbor.distance < this.separationRadius && neighbor.distance > 0) {
                const headPos = this.spine.joints[0];
                const otherPos = neighbor.fish.spine.joints[0];
                let diff = headPos.sub(otherPos);
                diff = diff.mult(1 / neighbor.distance); // 距离越近权重越大
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
    
    // 对齐：与邻居保持相同方向
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
            avgVelocity = avgVelocity.mult(1 / count);
            avgVelocity = avgVelocity.setMag(this.maxSpeed);
            let steer = avgVelocity.sub(this.velocity);
            if (steer.mag() > this.maxForce) {
                steer = steer.setMag(this.maxForce);
            }
            return steer;
        }
        
        return new Vec2(0, 0);
    }
    
    // 聚合：向群体中心移动
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
    
    // 噪声驱动的运动（替代随机漫游）
    calculateNoiseForce() {
        // 使用Perlin噪声获取平滑的方向变化
        const noiseX = globalNoise.noise(this.noiseOffsetX + this.noiseTime * this.noiseScale, 0);
        const noiseY = globalNoise.noise(this.noiseOffsetY + this.noiseTime * this.noiseScale, 100);
        
        // 将噪声值转换为角度
        const angle = Math.atan2(noiseY, noiseX);
        
        // 创建目标方向
        let desired = Vec2.fromAngle(angle).setMag(this.maxSpeed * 0.5);
        
        // 转向力（进一步限制噪声的转向力）
        let steer = desired.sub(this.velocity);
        if (steer.mag() > this.maxForce * 0.3) {
            steer = steer.setMag(this.maxForce * 0.3);
        }
        
        return steer;
    }
    
    // 环绕行为
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
        
        // 计算切线方向（垂直于指向中心的方向）
        const tangent = new Vec2(-toCenter.y * this.circlingDirection, toCenter.x * this.circlingDirection);
        
        // 期望的环绕半径
        const desiredRadius = 80;
        const radiusError = distToCenter - desiredRadius;
        
        // 向心力：保持在期望半径上
        const centerPull = toCenter.setMag(radiusError * 0.02);
        
        // 切向力：沿圆周运动（降低强度）
        const tangentForce = tangent.setMag(this.maxForce * 0.6);
        
        let force = tangentForce.add(centerPull);
        
        if (force.mag() > this.maxForce) {
            force = force.setMag(this.maxForce);
        }
        
        return force;
    }
    
    // 边界回避：远离边界
    calculateBoundaryAvoidance(pos, canvasWidth, canvasHeight) {
        let force = new Vec2(0, 0);
        const margin = this.boundaryMargin;
        
        // 左边界
        if (pos.x < margin) {
            const strength = 1 - (pos.x / margin);
            force = force.add(new Vec2(strength * this.maxForce * 3, 0));
        }
        // 右边界
        if (pos.x > canvasWidth - margin) {
            const strength = 1 - ((canvasWidth - pos.x) / margin);
            force = force.add(new Vec2(-strength * this.maxForce * 3, 0));
        }
        // 上边界
        if (pos.y < margin) {
            const strength = 1 - (pos.y / margin);
            force = force.add(new Vec2(0, strength * this.maxForce * 3));
        }
        // 下边界
        if (pos.y > canvasHeight - margin) {
            const strength = 1 - ((canvasHeight - pos.y) / margin);
            force = force.add(new Vec2(0, -strength * this.maxForce * 3));
        }
        
        return force;
    }

    getPosX(i, angleOffset, lengthOffset) {
        return this.spine.joints[i].x + Math.cos(this.spine.angles[i] + angleOffset) * (this.bodyWidth[i] + lengthOffset);
    }

    getPosY(i, angleOffset, lengthOffset) {
        return this.spine.joints[i].y + Math.sin(this.spine.angles[i] + angleOffset) * (this.bodyWidth[i] + lengthOffset);
    }

    display(ctx) {
        const j = this.spine.joints;
        const a = this.spine.angles;

        // 计算角度差异用于鳍的动态效果
        const headToMid1 = relativeAngleDiff(a[0], a[6]);
        const headToMid2 = relativeAngleDiff(a[0], a[7]);
        const headToTail = headToMid1 + relativeAngleDiff(a[6], a[11]);

        // 绘制选中效果
        if (this.selected) {
            const head = j[0];
            ctx.save();
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            const pulseSize = 70 + Math.sin(Date.now() * 0.003) * 8;
            ctx.arc(head.x, head.y, pulseSize, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }
        

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.lineWidth = 3;
        ctx.fillStyle = this.finColor;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        // === 胸鳍 === (缩小到60%)
        ctx.save();
        ctx.globalAlpha = 0.7;
        ctx.translate(this.getPosX(3, Math.PI / 3, 0), this.getPosY(3, Math.PI / 3, 0));
        ctx.rotate(a[2] - Math.PI / 4);
        ctx.beginPath();
        ctx.ellipse(0, 0, 48, 20, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();

        ctx.save();
        ctx.globalAlpha = 0.7;
        ctx.translate(this.getPosX(3, -Math.PI / 3, 0), this.getPosY(3, -Math.PI / 3, 0));
        ctx.rotate(a[2] + Math.PI / 4);
        ctx.beginPath();
        ctx.ellipse(0, 0, 48, 20, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();

        // === 腹鳍 === (缩小到60%)
        ctx.save();
        ctx.globalAlpha = 0.7;
        ctx.translate(this.getPosX(7, Math.PI / 2, 0), this.getPosY(7, Math.PI / 2, 0));
        ctx.rotate(a[6] - Math.PI / 4);
        ctx.beginPath();
        ctx.ellipse(0, 0, 30, 10, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();

        ctx.save();
        ctx.globalAlpha = 0.7;
        ctx.translate(this.getPosX(7, -Math.PI / 2, 0), this.getPosY(7, -Math.PI / 2, 0));
        ctx.rotate(a[6] + Math.PI / 4);
        ctx.beginPath();
        ctx.ellipse(0, 0, 30, 10, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();

        ctx.globalAlpha = 1.0;

        // === 尾鳍 ===
        ctx.beginPath();
        
        const tailPoints = [];
        for (let i = 8; i < 12; i++) {
            const tailWidth = 1.5 * headToTail * (i - 8) * (i - 8);
            tailPoints.push({
                x: j[i].x + Math.cos(a[i] - Math.PI / 2) * tailWidth,
                y: j[i].y + Math.sin(a[i] - Math.PI / 2) * tailWidth
            });
        }
        
        for (let i = 11; i >= 8; i--) {
            const tailWidth = Math.max(-13, Math.min(13, headToTail * 6));
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

        // === 身体 ===
        ctx.fillStyle = this.bodyColor;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 2;
        
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
            {x: this.getPosX(0, -Math.PI / 6, 0), y: this.getPosY(0, -Math.PI / 6, 0)},
            {x: this.getPosX(0, 0, 4), y: this.getPosY(0, 0, 4)},
            {x: this.getPosX(0, Math.PI / 6, 0), y: this.getPosY(0, Math.PI / 6, 0)}
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

        // === 身体高光 === (缩小到60%)
        if (this.highlightColor) {
            ctx.fillStyle = this.highlightColor;
            ctx.beginPath();
            ctx.ellipse(j[2].x, j[2].y, 24, 15, a[2], 0, Math.PI * 2);
            ctx.fill();
        }

        // === 背鳍 ===
        ctx.fillStyle = this.finColor;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.lineWidth = 2;
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

        // === 眼睛 === (缩小到60%)
        ctx.fillStyle = 'rgba(40, 40, 50, 0.9)';
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.lineWidth = 1;
        
        ctx.beginPath();
        ctx.arc(this.getPosX(0, Math.PI / 2, -11), this.getPosY(0, Math.PI / 2, -11), 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        
        ctx.beginPath();
        ctx.arc(this.getPosX(0, -Math.PI / 2, -11), this.getPosY(0, -Math.PI / 2, -11), 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    }

    containsPoint(x, y) {
        const head = this.spine.joints[0];
        const dist = Math.sqrt((x - head.x) ** 2 + (y - head.y) ** 2);
        return dist < 60; // 适配缩小后的鱼
    }
}

