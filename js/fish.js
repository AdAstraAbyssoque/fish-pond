// ============= Fish类 - 锦鲤（基础回退版） =============
const BASE_SPINE_LINK_SIZE = 40;
const BASE_BODY_WIDTH = [40, 48, 50, 50, 46, 38, 30, 23, 19, 11];
const BASE_SELECTION_RADIUS = 60;
const MIN_SELECTION_RADIUS = 18;
const MIN_PULSE_SIZE = 30;

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

        this.velocity = Vec2.fromAngle(Math.random() * Math.PI * 2).setMag(0.5);
        this.maxSpeed = 1.2;
        this.maxForce = 0.04;

        this.noiseOffsetX = Math.random() * 1000;
        this.noiseOffsetY = Math.random() * 1000;
        this.noiseScale = 0.003;
        this.noiseTime = 0;

        this.circlingCenter = null;
        this.circlingTime = 0;
        this.maxCirclingTime = 3 + Math.random() * 4;
        this.circlingCooldown = 0;
        this.circlingDirection = Math.random() < 0.5 ? 1 : -1;
    }

    resolve(otherFish, deltaTime, canvasWidth, canvasHeight) {
        const headPos = this.spine.joints[0];
        this.noiseTime += deltaTime;

        const neighbors = [];
        const sameGroupNeighbors = [];
        for (let other of otherFish) {
            if (other === this) continue;
            const dist = headPos.sub(other.spine.joints[0]).mag();
            if (dist < this.cohesionRadius) {
                neighbors.push({ fish: other, distance: dist });
                if (other.groupId === this.groupId) {
                    sameGroupNeighbors.push({ fish: other, distance: dist });
                }
            }
        }

        if (this.circlingCooldown > 0) {
            this.circlingCooldown -= deltaTime;
        }

        if (this.circlingTime > 0) {
            this.circlingTime -= deltaTime;
            if (this.circlingTime <= 0) {
                this.circlingCenter = null;
                this.circlingWeight = 0;
                this.circlingCooldown = 5 + Math.random() * 5;
            }
        } else if (sameGroupNeighbors.length >= 3 && this.circlingCooldown <= 0) {
            this.circlingTime = this.maxCirclingTime;
            this.circlingWeight = 1.2;
            let center = new Vec2(0, 0);
            for (let n of sameGroupNeighbors) {
                center = center.add(n.fish.spine.joints[0]);
            }
            center = center.add(headPos);
            this.circlingCenter = center.mult(1 / (sameGroupNeighbors.length + 1));
        }

        const separationForce = this.calculateSeparation(neighbors);
        const alignmentForce = this.calculateAlignment(sameGroupNeighbors);
        const cohesionForce = this.calculateCohesion(sameGroupNeighbors);
        const noiseForce = this.calculateNoiseForce();
        const circlingForce = this.calculateCircling();
        const boundaryForce = this.calculateBoundaryAvoidance(headPos, canvasWidth, canvasHeight);

        let acceleration = new Vec2(0, 0);
        acceleration = acceleration.add(separationForce.mult(this.separationWeight));
        acceleration = acceleration.add(alignmentForce.mult(this.alignmentWeight));
        acceleration = acceleration.add(cohesionForce.mult(this.cohesionWeight));
        acceleration = acceleration.add(noiseForce.mult(this.noiseWeight));
        acceleration = acceleration.add(circlingForce.mult(this.circlingWeight));
        acceleration = acceleration.add(boundaryForce.mult(this.boundaryWeight));

        this.velocity = this.velocity.mult(0.99).add(acceleration);

        const currentMaxSpeed = this.circlingTime > 0 ? this.maxSpeed * 0.8 : this.maxSpeed;
        if (this.velocity.mag() > currentMaxSpeed) {
            this.velocity = this.velocity.setMag(currentMaxSpeed);
        }

        if (this.velocity.mag() < 0.3) {
            this.velocity = this.velocity.setMag(0.3);
        }

        const newPos = headPos.add(this.velocity.mult(12));
        const hardMargin = 30;
        newPos.x = Math.max(hardMargin, Math.min(canvasWidth - hardMargin, newPos.x));
        newPos.y = Math.max(hardMargin, Math.min(canvasHeight - hardMargin, newPos.y));

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
        if (pos.x < margin) {
            const strength = 1 - pos.x / margin;
            force = force.add(new Vec2(strength * this.maxForce * 3, 0));
        }
        if (pos.x > canvasWidth - margin) {
            const strength = 1 - (canvasWidth - pos.x) / margin;
            force = force.add(new Vec2(-strength * this.maxForce * 3, 0));
        }
        if (pos.y < margin) {
            const strength = 1 - pos.y / margin;
            force = force.add(new Vec2(0, strength * this.maxForce * 3));
        }
        if (pos.y > canvasHeight - margin) {
            const strength = 1 - (canvasHeight - pos.y) / margin;
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

    sampleBodyPoints(step = 10) {
        const points = [];
        const joints = this.spine.joints;
        const angles = this.spine.angles;
        const offsets = [-1, -0.5, 0, 0.5, 1];

        for (let i = 0; i < joints.length - 1; i += 12 / step) {
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

        // 眼睛
        ctx.fillStyle = 'rgba(40, 40, 50, 0.9)';
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.lineWidth = Math.max(0.5, 1 * s);
        const eyeRadius = Math.max(2, 5 * s);
        ctx.beginPath();
        ctx.arc(this.getPosX(0, Math.PI / 2, -11 * s), this.getPosY(0, Math.PI / 2, -11 * s), eyeRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(this.getPosX(0, -Math.PI / 2, -11 * s), this.getPosY(0, -Math.PI / 2, -11 * s), eyeRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    }

    containsPoint(x, y) {
        const head = this.spine.joints[0];
        const dist = Math.sqrt((x - head.x) ** 2 + (y - head.y) ** 2);
        return dist < this.hitRadius;
    }
}
