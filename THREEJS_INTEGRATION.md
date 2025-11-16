# Three.js 3D 渲染集成指南

## 安装步骤

1. **安装 three.js 依赖**：
```bash
npm install three
```

或者使用 CDN（在 `index.html` 中）：
```html
<script src="https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js"></script>
```

## 集成方式

### 方式一：完全替换为 Three.js（推荐）

在 `js/main.js` 的 `bootstrap()` 函数中，添加 Three.js 场景初始化：

```javascript
// 在 bootstrap() 函数中添加
let threeScene = null;

function bootstrap() {
    // ... 现有代码 ...
    
    // 初始化 Three.js 场景（替代 regl 粒子系统）
    if (!threeScene) {
        threeScene = new ThreeScene(canvas); // 使用主 canvas
        
        // 创建水的粒子
        const waterParticles = backgroundParticleSystem.particles.filter(p => {
            // 根据位置判断是否为水粒子（不在荷叶范围内）
            return !lilyPads.some(pad => {
                const dx = p.x - pad.x;
                const dy = p.y - pad.y;
                return dx * dx + dy * dy < pad.size * pad.size;
            });
        });
        threeScene.createWaterParticles(waterParticles, WORLD_WIDTH, WORLD_HEIGHT);
        
        // 创建荷叶的粒子
        const lilyPadParticles = backgroundParticleSystem.particles.filter(p => {
            return lilyPads.some(pad => {
                const dx = p.x - pad.x;
                const dy = p.y - pad.y;
                return dx * dx + dy * dy < pad.size * pad.size;
            });
        });
        threeScene.createLilyPadParticles(lilyPadParticles);
    }
}
```

在动画循环中更新：

```javascript
function animate(currentTime) {
    // ... 现有更新逻辑 ...
    
    // 更新 Three.js 相机（跟随玩家）
    if (threeScene && playerFish) {
        const head = playerFish.spine.joints[0];
        threeScene.updateCamera(head.x, head.y, camera.zoom);
    }
    
    // 更新鱼的粒子
    if (threeScene && particleSystem && visibleFishes.length > 0) {
        const allSkeletonPoints = [];
        // ... 收集粒子点 ...
        threeScene.updateFishParticles(allSkeletonPoints, WORLD_WIDTH, WORLD_HEIGHT);
    }
    
    // 渲染 Three.js 场景（替代 regl 渲染）
    if (threeScene) {
        threeScene.render();
    } else {
        // 原有的 regl 渲染代码
    }
}
```

### 方式二：混合使用（Three.js 渲染背景，Regl 渲染鱼）

保持现有鱼的粒子系统使用 regl，只将背景改为 Three.js：

```javascript
// 在渲染循环中
// 先渲染 Three.js 背景
if (threeScene) {
    threeScene.render();
}

// 然后渲染 regl 的鱼粒子（在 particle-canvas 上）
if (particleSystem) {
    // ... 原有 regl 渲染代码 ...
}
```

## 主要功能

### 1. 正交相机（OrthographicCamera）
- 模拟 2D 俯视效果，避免透视失真
- 支持缩放和跟随玩家

### 2. 粒子系统
- 水的粒子：深蓝色系，支持多种蓝色变化
- 荷叶的粒子：黄色/黄绿色系
- 鱼的粒子：动态更新，支持颜色和透明度

### 3. 光照系统
- 环境光：整体照明
- 方向光：模拟太阳光

### 4. 水面平面（可选）
- 使用 PBR 材质
- 支持反射和折射效果
- 当前默认关闭，可取消注释启用

## 高级功能扩展

### 添加水面反射
```javascript
// 在 three-scene.js 中启用水面平面
this.scene.add(this.waterPlane);

// 添加反射纹理
const renderTarget = new THREE.WebGLRenderTarget(width, height);
// ... 配置反射 ...
```

### 添加动态波纹
```javascript
// 使用 ShaderMaterial 创建动态水面
const waterMaterial = new THREE.ShaderMaterial({
    uniforms: {
        time: { value: 0 }
    },
    // ... shader 代码 ...
});
```

### 导入 3D 模型
```javascript
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
loader.load('models/fish.gltf', (gltf) => {
    const fishModel = gltf.scene;
    this.scene.add(fishModel);
});
```

## 性能优化

1. **使用 InstancedMesh**：如果有很多相同的对象（如鱼），使用实例化渲染
2. **LOD 系统**：根据距离使用不同细节级别的模型
3. **视锥剔除**：Three.js 自动处理，但可以手动优化
4. **合并几何体**：将静态粒子合并为单个几何体

## 注意事项

1. **坐标系统**：Three.js 使用右手坐标系，Y 轴向上，需要翻转 Y 坐标
2. **性能**：大量粒子可能影响性能，建议使用 `BufferGeometry` 和合并渲染
3. **兼容性**：确保浏览器支持 WebGL 2.0

## 切换回 Regl

如果想切换回原有的 regl 系统，只需：
1. 注释掉 Three.js 相关代码
2. 恢复原有的 regl 渲染逻辑
3. 两个系统可以并存，通过标志位切换

