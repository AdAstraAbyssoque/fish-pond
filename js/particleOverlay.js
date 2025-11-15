class ParticleOverlay {
    constructor(width, height) {
        const root = document.getElementById('overlay-root');
        this.app = new PIXI.Application({
            width,
            height,
            backgroundAlpha: 0,
            antialias: true,
            autoStart: false,
            resolution: window.devicePixelRatio || 1
        });
        root.appendChild(this.app.view);

        this.graphics = new PIXI.Graphics();
        this.app.stage.addChild(this.graphics);

        this.fishes = [];
        this.elapsed = 0;
    }

    syncCanvasSize(width, height) {
        if (!this.app) return;
        this.app.renderer.resize(width, height);
    }

    syncFishes(fishes) {
        this.fishes = fishes || [];
    }

    renderFrame(deltaTime = 0) {
        if (!this.app) return;
        this.elapsed += deltaTime;
        this.graphics.clear();

        const flicker = 0.15 + 0.05 * Math.sin(this.elapsed * 3);

        for (const fish of this.fishes) {
            if (!fish || typeof fish.sampleBodyPoints !== 'function') continue;
            const color = fish.type === 'orange' ? 0xffb088 : 0xe8edf5;
            const points = fish.sampleBodyPoints(10);
            const alphaBase = fish.type === 'orange' ? 0.25 : 0.18;

            for (const point of points) {
                const radius = (1.2 + Math.random() * 2.2) * fish.scale;
                const alpha = Math.min(0.85, alphaBase + Math.random() * 0.25 + flicker * 0.2);
                this.graphics.beginFill(color, alpha);
                this.graphics.drawCircle(point.x, point.y, radius);
                this.graphics.endFill();
            }
        }

        this.app.renderer.render(this.app.stage);
    }
}

window.ParticleOverlay = ParticleOverlay;

