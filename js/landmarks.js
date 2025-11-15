// ============= 地图参照物系统 =============

class Landmarks {
    constructor(worldWidth, worldHeight, mapSize) {
        this.worldWidth = worldWidth;
        this.worldHeight = worldHeight;
        this.mapSize = mapSize;
        this.tileSize = worldWidth / mapSize;
        
        this.stones = [];
        this.waterPlants = [];
        this.ripples = [];
        
        this.generateLandmarks();
    }
    
    generateLandmarks() {
        // 生成石头（每个 tile 2-4 个）
        for (let tx = 0; tx < this.mapSize; tx++) {
            for (let ty = 0; ty < this.mapSize; ty++) {
                const stoneCount = 2 + Math.floor(Math.random() * 3);
                
                for (let i = 0; i < stoneCount; i++) {
                    this.stones.push({
                        x: (tx + 0.2 + Math.random() * 0.6) * this.tileSize,
                        y: (ty + 0.2 + Math.random() * 0.6) * this.tileSize,
                        size: 30 + Math.random() * 50,
                        color: `hsl(${200 + Math.random() * 20}, ${15 + Math.random() * 10}%, ${20 + Math.random() * 15}%)`,
                        rotation: Math.random() * Math.PI * 2
                    });
                }
            }
        }
        
        // 生成水草（每个 tile 3-5 丛）
        for (let tx = 0; tx < this.mapSize; tx++) {
            for (let ty = 0; ty < this.mapSize; ty++) {
                const plantCount = 3 + Math.floor(Math.random() * 3);
                
                for (let i = 0; i < plantCount; i++) {
                    this.waterPlants.push({
                        x: (tx + 0.1 + Math.random() * 0.8) * this.tileSize,
                        y: (ty + 0.1 + Math.random() * 0.8) * this.tileSize,
                        height: 40 + Math.random() * 60,
                        width: 15 + Math.random() * 20,
                        segments: 4 + Math.floor(Math.random() * 3),
                        phase: Math.random() * Math.PI * 2,
                        speed: 0.5 + Math.random() * 0.5
                    });
                }
            }
        }
        
        // 生成静态涟漪圆环（每个 tile 1-2 个）
        for (let tx = 0; tx < this.mapSize; tx++) {
            for (let ty = 0; ty < this.mapSize; ty++) {
                const rippleCount = 1 + Math.floor(Math.random() * 2);
                
                for (let i = 0; i < rippleCount; i++) {
                    this.ripples.push({
                        x: (tx + 0.3 + Math.random() * 0.4) * this.tileSize,
                        y: (ty + 0.3 + Math.random() * 0.4) * this.tileSize,
                        radius: 60 + Math.random() * 80,
                        rings: 2 + Math.floor(Math.random() * 2)
                    });
                }
            }
        }
        
        console.log(`生成了 ${this.stones.length} 个石头, ${this.waterPlants.length} 丛水草, ${this.ripples.length} 个涟漪`);
    }
    
    // 渲染石头（简化版）
    renderStones(ctx, camera) {
        for (let stone of this.stones) {
            if (!camera.isInView(stone.x, stone.y, stone.size + 100)) continue;
            
            ctx.save();
            ctx.translate(stone.x, stone.y);
            ctx.rotate(stone.rotation);
            
            // 石头主体 - 更柔和的渐变
            const gradient = ctx.createRadialGradient(-stone.size * 0.2, -stone.size * 0.2, 0, 0, 0, stone.size);
            gradient.addColorStop(0, 'rgba(180, 190, 210, 0.12)');
            gradient.addColorStop(0.6, 'rgba(140, 160, 180, 0.08)');
            gradient.addColorStop(1, 'rgba(100, 120, 150, 0.04)');
            
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.ellipse(0, 0, stone.size, stone.size * 0.8, 0, 0, Math.PI * 2);
            ctx.fill();
            
            // 轮廓线
            ctx.strokeStyle = 'rgba(150, 170, 200, 0.15)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.ellipse(0, 0, stone.size, stone.size * 0.8, 0, 0, Math.PI * 2);
            ctx.stroke();
            
            ctx.restore();
        }
    }
    
    // 渲染水草（简化版 - 更优雅）
    renderWaterPlants(ctx, camera, time) {
        const timeInSeconds = time / 1000;
        
        for (let plant of this.waterPlants) {
            if (!camera.isInView(plant.x, plant.y, plant.height + 50)) continue;
            
            ctx.save();
            ctx.translate(plant.x, plant.y);
            
            // 绘制优雅的水草曲线
            const sway = Math.sin(timeInSeconds * plant.speed + plant.phase) * 12;
            
            // 使用二次贝塞尔曲线绘制流畅的水草
            ctx.strokeStyle = 'rgba(120, 180, 150, 0.18)';
            ctx.lineWidth = plant.width * 0.4;
            ctx.lineCap = 'round';
            
            ctx.beginPath();
            ctx.moveTo(0, 0);
            
            // 绘制流畅的曲线
            const cp1x = sway * 0.3;
            const cp1y = -plant.height * 0.4;
            const cp2x = sway * 0.7;
            const cp2y = -plant.height * 0.7;
            const endX = sway;
            const endY = -plant.height;
            
            ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, endX, endY);
            ctx.stroke();
            
            // 绘制内层更亮的线
            ctx.strokeStyle = 'rgba(150, 200, 180, 0.12)';
            ctx.lineWidth = plant.width * 0.2;
            ctx.stroke();
            
            ctx.restore();
        }
    }
    
    // 渲染涟漪圆环
    renderRipples(ctx, camera) {
        for (let ripple of this.ripples) {
            if (!camera.isInView(ripple.x, ripple.y, ripple.radius + 50)) continue;
            
            ctx.save();
            ctx.translate(ripple.x, ripple.y);
            
            for (let r = 0; r < ripple.rings; r++) {
                const ringRadius = ripple.radius + r * 20;
                const opacity = 0.08 - r * 0.02;
                
                ctx.strokeStyle = `rgba(100, 130, 180, ${opacity})`;
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(0, 0, ringRadius, 0, Math.PI * 2);
                ctx.stroke();
            }
            
            ctx.restore();
        }
    }
    
    // 渲染 Tile 边界（淡淡的分割线）
    renderTileBorders(ctx, camera) {
        ctx.strokeStyle = 'rgba(80, 100, 140, 0.15)';
        ctx.lineWidth = 2;
        ctx.setLineDash([10, 10]);
        
        for (let i = 1; i < this.mapSize; i++) {
            // 垂直线
            const x = i * this.tileSize;
            if (camera.isInView(x, this.worldHeight / 2, this.worldHeight)) {
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, this.worldHeight);
                ctx.stroke();
            }
            
            // 水平线
            const y = i * this.tileSize;
            if (camera.isInView(this.worldWidth / 2, y, this.worldWidth)) {
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(this.worldWidth, y);
                ctx.stroke();
            }
        }
        
        ctx.setLineDash([]);
    }
    
    // 渲染所有参照物
    render(ctx, camera, time) {
        this.renderTileBorders(ctx, camera);
        this.renderRipples(ctx, camera);
        this.renderStones(ctx, camera);
        this.renderWaterPlants(ctx, camera, time);
    }
}

window.Landmarks = Landmarks;

