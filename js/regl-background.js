// ============= Regl 池塘背景渲染系统 =============
// 使用 regl 渲染 PNG 纹理：荷叶、荷花、石块、水底植物、水的纹理

class ReglBackground {
    constructor(reglInstance, camera) {
        this.regl = reglInstance;
        this.camera = camera; // 可以为 null（固定背景）
        this.layers = [];
        this.textures = new Map();
        this.quadBuffer = reglInstance.buffer([
            -1, -1,  1, -1,  1, 1,
            -1, -1,  1, 1,  -1, 1
        ]);
        
        this._initShader();
        console.log('ReglBackground 初始化完成');
    }
    
    // 窗口大小改变时更新
    onWindowResize(width, height) {
        // 更新固定背景图层的尺寸
        for (const layer of this.layers) {
            if (layer.fixed) {
                layer.width = width;
                layer.height = height;
            }
        }
    }
    
    _initShader() {
        // 创建纹理渲染命令
        this.renderCommand = this.regl({
            vert: `
                precision highp float;
                attribute vec2 a_position;
                varying vec2 v_uv;
                
                void main() {
                    gl_Position = vec4(a_position, 0.0, 1.0);
                    // 将屏幕坐标转换为 UV 坐标
                    v_uv = (a_position + 1.0) * 0.5;
                    v_uv.y = 1.0 - v_uv.y; // 翻转 Y 轴
                }
            `,
            frag: `
                precision highp float;
                uniform sampler2D u_texture;
                uniform float u_opacity;
                uniform vec2 u_tile;  // 平铺次数 (x, y)
                uniform vec2 u_offset; // UV 偏移
                uniform float u_time;  // 时间（用于动画）
                varying vec2 v_uv;
                
                void main() {
                    vec2 uv = v_uv;
                    
                    // 应用平铺
                    if (u_tile.x > 0.0 || u_tile.y > 0.0) {
                        uv = mod(uv * u_tile + u_offset, 1.0);
                    } else {
                        uv = uv + u_offset;
                    }
                    
                    vec4 color = texture2D(u_texture, uv);
                    color.a *= u_opacity;
                    gl_FragColor = color;
                }
            `,
            attributes: {
                a_position: this.regl.prop('positionBuffer')
            },
            uniforms: {
                u_texture: this.regl.prop('texture'),
                u_opacity: this.regl.prop('opacity'),
                u_tile: this.regl.prop('tile'),
                u_offset: this.regl.prop('offset'),
                u_time: this.regl.prop('time')
            },
            blend: {
                enable: true,
                func: {
                    srcRGB: 'src alpha',
                    srcAlpha: 'one',
                    dstRGB: 'one minus src alpha',
                    dstAlpha: 'one minus src alpha'
                }
            },
            depth: { enable: false },
            count: 6
        });
    }
    
    // 加载纹理
    loadTexture(path) {
        if (this.textures.has(path)) {
            return Promise.resolve(this.textures.get(path));
        }
        
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                const texture = this.regl.texture({
                    data: img,
                    flipY: true,
                    mag: 'linear',
                    min: 'linear'
                });
                this.textures.set(path, texture);
                console.log(`纹理加载完成: ${path}`);
                resolve(texture);
            };
            img.onerror = () => {
                console.error(`纹理加载失败: ${path}`);
                reject(new Error(`无法加载纹理: ${path}`));
            };
            img.src = path;
        });
    }
    
    // 添加图层
    // layerConfig: {
    //   name: 'water',
    //   zIndex: 0,
    //   texturePath: 'assets/water.png',
    //   x: 0, y: 0, width: WORLD_WIDTH, height: WORLD_HEIGHT,
    //   opacity: 1.0,
    //   tile: [1, 1],  // 平铺 [x, y]，0 表示不平铺
    //   parallax: 0,   // 视差系数
    //   offset: [0, 0] // UV 偏移
    // }
    async addLayer(layerConfig) {
        try {
            const texture = await this.loadTexture(layerConfig.texturePath);
            layerConfig.texture = texture;
            this.layers.push(layerConfig);
            this.layers.sort((a, b) => a.zIndex - b.zIndex);
            console.log(`图层 "${layerConfig.name}" 已添加，zIndex: ${layerConfig.zIndex}`);
        } catch (error) {
            console.error(`添加图层 "${layerConfig.name}" 失败:`, error);
        }
    }
    
    // 批量添加图层
    async addLayers(layerConfigs) {
        const promises = layerConfigs.map(config => this.addLayer(config));
        await Promise.all(promises);
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
            if (updates.zIndex !== undefined) {
                this.layers.sort((a, b) => a.zIndex - b.zIndex);
            }
        }
    }
    
    // 计算图层在屏幕上的位置和大小
    _getLayerScreenBounds(layer) {
        // 如果是固定背景，固定在世界坐标，跟随缩放但不跟随平移
        if (layer.fixed) {
            if (this.camera) {
                // 背景固定在世界坐标 (layer.x, layer.y) 到 (layer.x + layer.width, layer.y + layer.height)
                // 使用 worldToScreen 转换，这样背景会固定在世界坐标中，跟随缩放
                // 当摄像机移动时，背景在屏幕上的位置会改变（因为背景在世界中的位置是固定的）
                const topLeftScreen = this.camera.worldToScreen(layer.x, layer.y);
                const bottomRightScreen = this.camera.worldToScreen(layer.x + layer.width, layer.y + layer.height);
                
                return {
                    x: topLeftScreen.x,
                    y: topLeftScreen.y,
                    width: bottomRightScreen.x - topLeftScreen.x,
                    height: bottomRightScreen.y - topLeftScreen.y
                };
            } else {
                // 没有摄像机，直接使用原始尺寸
                return {
                    x: layer.x,
                    y: layer.y,
                    width: layer.width,
                    height: layer.height
                };
            }
        }
        
        // 否则使用摄像机变换（跟随鱼移动）
        if (!this.camera) {
            return {
                x: layer.x,
                y: layer.y,
                width: layer.width,
                height: layer.height
            };
        }
        
        // 计算视差偏移
        let offsetX = 0;
        let offsetY = 0;
        if (layer.parallax && layer.parallax > 0) {
            const cameraOffsetX = this.camera.x - WORLD_WIDTH / 2;
            const cameraOffsetY = this.camera.y - WORLD_HEIGHT / 2;
            offsetX = cameraOffsetX * layer.parallax;
            offsetY = cameraOffsetY * layer.parallax;
        }
        
        const worldX = layer.x + offsetX;
        const worldY = layer.y + offsetY;
        
        // 转换到屏幕坐标
        const screenPos = this.camera.worldToScreen(worldX, worldY);
        const screenWidth = layer.width * this.camera.zoom;
        const screenHeight = layer.height * this.camera.zoom;
        
        return {
            x: screenPos.x,
            y: screenPos.y,
            width: screenWidth,
            height: screenHeight
        };
    }
    
    // 渲染所有图层
    render(time = 0) {
        const width = this.regl._gl.canvas.width;
        const height = this.regl._gl.canvas.height;
        
        for (const layer of this.layers) {
            if (!layer.texture) continue; // 纹理未加载
            
            // 固定背景不需要视野检查
            if (!layer.fixed && this.camera) {
                // 检查是否在视野内
                if (!this.camera.isInView(layer.x, layer.y, Math.max(layer.width, layer.height))) {
                    continue;
                }
            }
            
            const bounds = this._getLayerScreenBounds(layer);
            
            // 计算屏幕空间的位置和大小（归一化到 -1 到 1）
            const x1 = (bounds.x / width) * 2 - 1;
            const y1 = 1 - (bounds.y / height) * 2;
            const x2 = ((bounds.x + bounds.width) / width) * 2 - 1;
            const y2 = 1 - ((bounds.y + bounds.height) / height) * 2;
            
            // 创建自定义的四边形 buffer
            const quadBuffer = this.regl.buffer([
                x1, y2,  // 左下
                x2, y2,  // 右下
                x2, y1,  // 右上
                x1, y2,  // 左下
                x2, y1,  // 右上
                x1, y1   // 左上
            ]);
            
            // 渲染图层
            this.renderCommand({
                positionBuffer: quadBuffer,
                texture: layer.texture,
                opacity: layer.opacity !== undefined ? layer.opacity : 1.0,
                tile: layer.tile || [0, 0],
                offset: layer.offset || [0, 0],
                time: time
            });
            
            // 清理临时 buffer
            quadBuffer.destroy();
        }
    }
    
    // 清空所有图层
    clear() {
        this.layers = [];
        // 清理纹理
        for (const texture of this.textures.values()) {
            texture.destroy();
        }
        this.textures.clear();
    }
    
    // 获取图层列表
    getLayers() {
        return this.layers.map(layer => ({
            name: layer.name,
            zIndex: layer.zIndex,
            loaded: !!layer.texture
        }));
    }
}

window.ReglBackground = ReglBackground;

