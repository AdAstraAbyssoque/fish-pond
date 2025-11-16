# Regl 背景渲染系统使用指南

## 素材要求

将你的 PNG 素材放在 `assets/` 目录下，建议的文件结构：

```
assets/
├── water-texture.png      # 水的纹理（可平铺）
├── lily-pads.png          # 荷叶
├── lotus-flowers.png      # 荷花
├── stones.png             # 石块
└── underwater-plants.png  # 水底植物
```

## 在 main.js 中初始化

在 `bootstrap()` 函数中添加：

```javascript
// 创建 Regl 背景渲染系统
let reglBackground = null;

function bootstrap() {
    // ... 现有代码 ...
    
    // 初始化 Regl 背景渲染
    if (!reglBackground) {
        reglBackground = new ReglBackground(regl, camera);
        
        // 添加图层（按 zIndex 从低到高）
        reglBackground.addLayers([
            // 1. 水的纹理（最底层，可平铺）
            {
                name: 'water-texture',
                zIndex: 0,
                texturePath: 'assets/water-texture.png',
                x: 0,
                y: 0,
                width: WORLD_WIDTH,
                height: WORLD_HEIGHT,
                opacity: 1.0,
                tile: [4, 4],  // 平铺 4x4
                parallax: 0,   // 无视差
                offset: [0, 0]
            },
            
            // 2. 水底植物（在水的纹理之上）
            {
                name: 'underwater-plants',
                zIndex: 1,
                texturePath: 'assets/underwater-plants.png',
                x: 0,
                y: 0,
                width: WORLD_WIDTH,
                height: WORLD_HEIGHT,
                opacity: 0.8,
                tile: [0, 0],  // 不平铺
                parallax: 0.2, // 轻微视差
                offset: [0, 0]
            },
            
            // 3. 石块（在水底植物之上）
            {
                name: 'stones',
                zIndex: 2,
                texturePath: 'assets/stones.png',
                x: 0,
                y: 0,
                width: WORLD_WIDTH,
                height: WORLD_HEIGHT,
                opacity: 1.0,
                tile: [0, 0],
                parallax: 0.3,
                offset: [0, 0]
            },
            
            // 4. 荷叶（在石块之上）
            {
                name: 'lily-pads',
                zIndex: 3,
                texturePath: 'assets/lily-pads.png',
                x: 0,
                y: 0,
                width: WORLD_WIDTH,
                height: WORLD_HEIGHT,
                opacity: 1.0,
                tile: [0, 0],
                parallax: 0.4,
                offset: [0, 0]
            },
            
            // 5. 荷花（最上层）
            {
                name: 'lotus-flowers',
                zIndex: 4,
                texturePath: 'assets/lotus-flowers.png',
                x: 0,
                y: 0,
                width: WORLD_WIDTH,
                height: WORLD_HEIGHT,
                opacity: 1.0,
                tile: [0, 0],
                parallax: 0.5,
                offset: [0, 0]
            }
        ]);
    }
}
```

## 在渲染循环中使用

在 `animate()` 函数中，在渲染背景粒子之前添加：

```javascript
function animate(currentTime) {
    // ... 现有更新逻辑 ...
    
    // ===== 渲染 Regl 背景（在粒子之前） =====
    if (reglBackground) {
        reglBackground.render(currentTime / 1000); // 传入时间（秒）
    }
    
    // ===== 渲染背景粒子（在 Regl 背景之上） =====
    if (backgroundParticleSystem) {
        // ... 原有代码 ...
    }
    
    // ... 其他渲染 ...
}
```

## 图层配置参数说明

- **name**: 图层名称（唯一标识）
- **zIndex**: 渲染顺序，数字越小越先渲染（在底层）
- **texturePath**: PNG 文件路径
- **x, y**: 世界坐标位置
- **width, height**: 世界坐标尺寸
- **opacity**: 透明度（0-1）
- **tile**: 平铺次数 `[x, y]`，`[0, 0]` 表示不平铺
- **parallax**: 视差系数（0-1），0=无视差，1=完全跟随相机
- **offset**: UV 偏移 `[x, y]`，用于动画或调整位置

## 动态效果示例

### 水的纹理动画
```javascript
// 在渲染循环中更新水的纹理偏移
const waterLayer = reglBackground.layers.find(l => l.name === 'water-texture');
if (waterLayer) {
    const time = currentTime / 1000;
    waterLayer.offset = [time * 0.1, time * 0.05]; // 缓慢移动
}
```

### 调整图层透明度
```javascript
reglBackground.updateLayer('underwater-plants', {
    opacity: 0.6  // 降低透明度
});
```

## 性能优化

1. **纹理尺寸**：建议使用 2 的幂次方尺寸（如 512x512, 1024x1024）
2. **平铺纹理**：对于重复的纹理（如水），使用平铺而不是大图
3. **视野剔除**：系统自动进行视野剔除，只渲染可见图层
4. **纹理缓存**：相同路径的纹理会被缓存，不会重复加载

## 注意事项

1. **坐标系统**：使用世界坐标，系统会自动转换为屏幕坐标
2. **纹理加载**：纹理是异步加载的，确保在渲染前已加载完成
3. **混合模式**：当前使用 alpha 混合，如需其他混合模式可以修改 shader
4. **视差效果**：视差系数越大，图层移动越慢，产生深度感

