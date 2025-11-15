// ============= 粒子系统 =============

class Particle {
    constructor(position, velocity, life, size, color) {
        this.position = position.copy();
        this.velocity = velocity.copy();
        this.life = life;
        this.initialLife = life;
        this.size = size;
        this.color = color;
    }

    get alpha() {
        return Math.max(0, this.life / this.initialLife);
    }

    update(deltaTime) {
        this.life -= deltaTime;
        if (this.life <= 0) return;
        this.position = this.position.add(this.velocity.mult(deltaTime));
        // 轻微扩散
        this.velocity = this.velocity.mult(0.96);
    }

    draw(ctx) {
        if (this.life <= 0) return;
        ctx.beginPath();
        ctx.fillStyle = `rgba(${this.color}, ${0.6 * this.alpha})`;
        const radius = Math.max(0.5, this.size * this.alpha);
        ctx.arc(this.position.x, this.position.y, radius, 0, Math.PI * 2);
        ctx.fill();
    }
}

class ParticleEmitter {
    constructor(options = {}) {
        this.particles = [];
        this.maxParticles = options.maxParticles || 200;
        this.spawnRate = options.spawnRate || 60; // 粒子/秒
        this.sizeRange = options.sizeRange || [1, 4];
        this.lifeRange = options.lifeRange || [0.6, 1.4];
        this.speedRange = options.speedRange || [15, 40];
        this.color = options.color || '240,240,245';
        this.accumulator = 0;
    }

    randomBetween(min, max) {
        return min + Math.random() * (max - min);
    }

    spawnParticle(point) {
        const angle = Math.random() * Math.PI * 2;
        const speed = this.randomBetween(this.speedRange[0], this.speedRange[1]);
        const velocity = Vec2.fromAngle(angle).setMag(speed);
        const size = this.randomBetween(this.sizeRange[0], this.sizeRange[1]);
        const life = this.randomBetween(this.lifeRange[0], this.lifeRange[1]);
        const jitter = Vec2.fromAngle(Math.random() * Math.PI * 2).setMag(size * 0.5);
        const particle = new Particle(point.add(jitter), velocity, life, size, this.color);
        if (this.particles.length >= this.maxParticles) {
            this.particles.shift();
        }
        this.particles.push(particle);
    }

    spawnAlongSkeleton(points, count) {
        if (!points || points.length === 0) return;
        for (let i = 0; i < count; i++) {
            const index = Math.floor(Math.random() * points.length);
            const point = points[index];
            this.spawnParticle(new Vec2(point.x, point.y));
        }
    }

    update(deltaTime, skeletonPoints) {
        this.particles = this.particles.filter(p => p.life > 0);
        this.particles.forEach(p => p.update(deltaTime));

        if (!skeletonPoints || skeletonPoints.length === 0) return;

        const densityFactor = Math.min(6, skeletonPoints.length / 35);
        this.accumulator += deltaTime * this.spawnRate * densityFactor;
        const spawnCount = Math.floor(this.accumulator);
        if (spawnCount > 0) {
            this.accumulator -= spawnCount;
            this.spawnAlongSkeleton(skeletonPoints, spawnCount);
        }
    }

    render(ctx) {
        this.particles.forEach(p => p.draw(ctx));
    }
}


