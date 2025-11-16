// ============= PNG 分层渲染系统 =============
// 支持多层 PNG 素材叠加渲染

class LayerRenderer {
    constructor(ctx, camera) {
        this.ctx = ctx;
        this.camera = camera;
        this.layers = []; // 存储所有图层
        this.images = new Map(); // 缓存加载的图片
    }
    
    // 添加图层
    // layerConfig: {
    //   name: 'layer1',
    //   zIndex: 0,  // 渲染顺序，数字越小越先渲染（在底层）
    //   imagePath: 'assets/water.png',
    //   x: 0,  // 世界坐标 X
    //   y: 0,  // 世界坐标 Y
    //   width: 1000,  // 世界坐标宽度
    //   height: 1000,  // 世界坐标高度
    //   opacity: 1.0,  // 透明度 0-1
    //   blendMode: 'normal',  // 混合模式: 'normal', 'multiply', 'screen', 'overlay'
    //   repeat: false,  // 是否重复平铺
    //   parallax: 0  // 视差系数 0-1，0=无视差，1=完全跟随
    // }
    addLayer(layerConfig) {
        // 加载图片
        this.loadImage(layerConfig.imagePath).then(img => {
            layerConfig.image = img;
            this.layers.push(layerConfig);
            // 按 zIndex 排序
            this.layers.sort((a, b) => a.zIndex - b.zIndex);
            console.log(`图层 "${layerConfig.name}" 已添加，zIndex: ${layerConfig.zIndex}`);
        }).catch(err => {
            console.error(`加载图层 "${layerConfig.name}" 失败:`, err);
        });
    }
    
    // 加载图片
    loadImage(path) {
        if (this.images.has(path)) {
            return Promise.resolve(this.images.get(path));
        }
        
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                this.images.set(path, img);
                resolve(img);
            };
            img.onerror = () => {
                reject(new Error(`无法加载图片: ${path}`));
            };
            img.src = path;
        });
    }
    
    // 移除图层
    removeLayer(name) {
        const index = this.layers.findIndex(layer => layer.name === name);
        if (index !== -1) {
            this.layers.splice(index, 1);
            console.log(`图层 "${name}" 已移除`);
        }
    }
    
    // 更新图层配置
    updateLayer(name, updates) {
        const layer = this.layers.find(l => l.name === name);
        if (layer) {
            Object.assign(layer, updates);
            // 如果更新了 zIndex，重新排序
            if (updates.zIndex !== undefined) {
                this.layers.sort((a, b) => a.zIndex - b.zIndex);
            }
        }
    }
    
    // 渲染所有图层
    render() {
        for (const layer of this.layers) {
            if (!layer.image) continue; // 图片未加载完成
            
            this.ctx.save();
            
            // 应用混合模式
            if (layer.blendMode && layer.blendMode !== 'normal') {
                this.ctx.globalCompositeOperation = layer.blendMode;
            }
            
            // 应用透明度
            this.ctx.globalAlpha = layer.opacity !== undefined ? layer.opacity : 1.0;
            
            // 计算视差偏移
            let offsetX = 0;
            let offsetY = 0;
            if (layer.parallax && layer.parallax > 0) {
                const cameraOffsetX = this.camera.x - WORLD_WIDTH / 2;
                const cameraOffsetY = this.camera.y - WORLD_HEIGHT / 2;
                offsetX = cameraOffsetX * layer.parallax;
                offsetY = cameraOffsetY * layer.parallax;
            }
            
            // 检查是否在视野内
            const screenX = this.camera.worldToScreen(layer.x + offsetX, layer.y + offsetY).x;
            const screenY = this.camera.worldToScreen(layer.x + offsetX, layer.y + offsetY).y;
            const screenWidth = layer.width * this.camera.zoom;
            const screenHeight = layer.height * this.camera.zoom;
            
            if (this.camera.isInView(layer.x + offsetX, layer.y + offsetY, Math.max(layer.width, layer.height))) {
                // 绘制图片
                if (layer.repeat) {
                    // 重复平铺模式
                    const pattern = this.ctx.createPattern(layer.image, 'repeat');
                    this.ctx.fillStyle = pattern;
                    this.ctx.fillRect(screenX, screenY, screenWidth, screenHeight);
                } else {
                    // 单次绘制
                    this.ctx.drawImage(
                        layer.image,
                        screenX,
                        screenY,
                        screenWidth,
                        screenHeight
                    );
                }
            }
            
            this.ctx.restore();
        }
    }
    
    // 清空所有图层
    clear() {
        this.layers = [];
        this.images.clear();
    }
    
    // 获取图层列表
    getLayers() {
        return this.layers.map(layer => ({
            name: layer.name,
            zIndex: layer.zIndex,
            loaded: !!layer.image
        }));
    }
}

window.LayerRenderer = LayerRenderer;

