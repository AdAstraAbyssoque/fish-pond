# 素材文件夹说明

## 文件夹结构建议

将你的 PNG 素材按以下方式组织：

```
assets/
├── background/      # 背景层（最底层）
│   ├── water.png
│   └── ground.png
├── midground/       # 中景层
│   ├── plants.png
│   └── decorations.png
├── foreground/      # 前景层（最上层）
│   ├── lily-pads.png
│   └── effects.png
└── README.md        # 本文件
```

## 素材要求

1. **格式**：PNG（支持透明通道）
2. **命名**：使用有意义的名称，如 `water-background.png`
3. **尺寸**：建议使用较大的尺寸（如 2000x2000 或更大），以便在不同缩放级别下保持清晰
4. **透明通道**：需要透明效果的地方使用 PNG 的 alpha 通道

## 如何使用

在 `js/main.js` 中初始化图层：

```javascript
// 创建图层渲染器
const layerRenderer = new LayerRenderer(ctx, camera);

// 添加背景层（zIndex 越小越在底层）
layerRenderer.addLayer({
    name: 'water-background',
    zIndex: 0,
    imagePath: 'assets/background/water.png',
    x: 0,
    y: 0,
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    opacity: 1.0,
    blendMode: 'normal',
    repeat: true,  // 如果需要平铺
    parallax: 0    // 无视差
});

// 添加中景层
layerRenderer.addLayer({
    name: 'plants',
    zIndex: 1,
    imagePath: 'assets/midground/plants.png',
    x: 0,
    y: 0,
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    opacity: 0.8,
    blendMode: 'multiply',
    parallax: 0.3  // 轻微视差
});

// 添加前景层
layerRenderer.addLayer({
    name: 'lily-pads',
    zIndex: 2,
    imagePath: 'assets/foreground/lily-pads.png',
    x: 0,
    y: 0,
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    opacity: 1.0,
    blendMode: 'normal',
    parallax: 0.5  // 中等视差
});

// 在渲染循环中调用
layerRenderer.render();
```

## 图层配置说明

- **zIndex**: 渲染顺序，数字越小越先渲染（在底层）
- **opacity**: 透明度，0-1 之间
- **blendMode**: 混合模式
  - `normal`: 正常叠加
  - `multiply`: 正片叠底（变暗）
  - `screen`: 滤色（变亮）
  - `overlay`: 叠加
  - `darken`: 变暗
  - `lighten`: 变亮
- **repeat**: 是否重复平铺（适合纹理）
- **parallax**: 视差系数，0-1，用于创建深度感

## 提供素材的方式

1. **直接放在 assets 文件夹**：将 PNG 文件放在 `assets/` 目录下
2. **告诉我文件路径**：告诉我素材的文件名和用途，我会帮你配置
3. **描述素材内容**：告诉我每层素材应该包含什么内容，我会帮你设置参数

