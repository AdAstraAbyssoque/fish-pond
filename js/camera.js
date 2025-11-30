// ============= 摄像机系统 =============

class Camera {
    constructor(canvas) {
        this.canvas = canvas;
        this.x = 0;
        this.y = 0;
        this.zoom = 1.0;
        this.targetZoom = 1.0;
        
        // 视野大小（基于 canvas 尺寸）
        this.viewWidth = canvas.width;
        this.viewHeight = canvas.height;
        
        // Debug 模式
        this.debugMode = false;
        this.minZoom = 0.2;  // 可以看到整个 3x3 地图
        this.maxZoom = 3.0;  // 提高最大缩放，支持放大2倍
        
        // 世界边界（池塘图片尺寸）
        this.worldBounds = {
            minX: 0,
            minY: 0,
            maxX: Infinity,
            maxY: Infinity
        };
    }
    
    // 设置世界边界（池塘图片尺寸）
    setWorldBounds(minX, minY, maxX, maxY) {
        this.worldBounds = { minX, minY, maxX, maxY };
    }
    
    // 限制摄像机位置在边界内
    clampPosition() {
        // 计算当前视野在世界坐标中的大小
        const viewWorldWidth = this.viewWidth / this.zoom;
        const viewWorldHeight = this.viewHeight / this.zoom;
        
        // 限制摄像机位置，确保视野不超出池塘边界
        const minX = this.worldBounds.minX;
        const minY = this.worldBounds.minY;
        const maxX = this.worldBounds.maxX - viewWorldWidth;
        const maxY = this.worldBounds.maxY - viewWorldHeight;
        
        // 如果视野大于池塘，居中显示
        if (viewWorldWidth >= this.worldBounds.maxX) {
            this.x = (this.worldBounds.minX + this.worldBounds.maxX) / 2 - viewWorldWidth / 2;
        } else {
            this.x = Math.max(minX, Math.min(maxX, this.x));
        }
        
        if (viewWorldHeight >= this.worldBounds.maxY) {
            this.y = (this.worldBounds.minY + this.worldBounds.maxY) / 2 - viewWorldHeight / 2;
        } else {
            this.y = Math.max(minY, Math.min(maxY, this.y));
        }
    }
    
    // 跟随目标（平滑）
    follow(target, smoothness = 0.1) {
        // 计算让目标在屏幕中心的摄像机位置
        // 考虑缩放：屏幕中心在世界坐标中的偏移 = (viewWidth/2) / zoom
        const targetX = target.x - (this.viewWidth / 2) / this.zoom;
        const targetY = target.y - (this.viewHeight / 2) / this.zoom;
        
        this.x += (targetX - this.x) * smoothness;
        this.y += (targetY - this.y) * smoothness;
        
        // 限制摄像机位置在边界内
        this.clampPosition();
    }
    
    // 设置缩放
    setZoom(zoom) {
        this.targetZoom = Math.max(this.minZoom, Math.min(this.maxZoom, zoom));
    }
    
    // 更新缩放（平滑）
    update() {
        this.zoom += (this.targetZoom - this.zoom) * 0.1;
        
        // 缩放改变后，重新限制位置（因为视野大小改变了）
        this.clampPosition();
    }
    
    // 世界坐标转屏幕坐标
    worldToScreen(worldX, worldY) {
        return {
            x: (worldX - this.x) * this.zoom,
            y: (worldY - this.y) * this.zoom
        };
    }
    
    // 屏幕坐标转世界坐标
    screenToWorld(screenX, screenY) {
        return {
            x: screenX / this.zoom + this.x,
            y: screenY / this.zoom + this.y
        };
    }
    
    // 检查物体是否在视野内
    isInView(x, y, margin = 200) {
        const screenPos = this.worldToScreen(x, y);
        return screenPos.x > -margin && 
               screenPos.x < this.viewWidth + margin &&
               screenPos.y > -margin && 
               screenPos.y < this.viewHeight + margin;
    }
    
    // 应用变换到 canvas context
    applyTransform(ctx) {
        ctx.save();
        ctx.scale(this.zoom, this.zoom);
        ctx.translate(-this.x, -this.y);
    }
    
    // 恢复变换
    restoreTransform(ctx) {
        ctx.restore();
    }
    
    // 获取视野边界（世界坐标）
    getViewBounds() {
        const topLeft = this.screenToWorld(0, 0);
        const bottomRight = this.screenToWorld(this.viewWidth, this.viewHeight);
        return {
            left: topLeft.x,
            top: topLeft.y,
            right: bottomRight.x,
            bottom: bottomRight.y,
            width: bottomRight.x - topLeft.x,
            height: bottomRight.y - topLeft.y
        };
    }
}

window.Camera = Camera;

