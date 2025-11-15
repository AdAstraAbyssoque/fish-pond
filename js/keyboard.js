// ============= 键盘控制系统 =============

class KeyboardController {
    constructor() {
        this.keys = new Set();
        this.setupListeners();
    }
    
    setupListeners() {
        window.addEventListener('keydown', (e) => {
            this.keys.add(e.key.toLowerCase());
        });
        
        window.addEventListener('keyup', (e) => {
            this.keys.delete(e.key.toLowerCase());
        });
    }
    
    isPressed(key) {
        return this.keys.has(key.toLowerCase());
    }
    
    // 获取 WASD 方向向量
    getMovementVector() {
        let x = 0;
        let y = 0;
        
        if (this.isPressed('w')) y -= 1;
        if (this.isPressed('s')) y += 1;
        if (this.isPressed('a')) x -= 1;
        if (this.isPressed('d')) x += 1;
        
        // 归一化
        const length = Math.sqrt(x * x + y * y);
        if (length > 0) {
            x /= length;
            y /= length;
        }
        
        return { x, y };
    }
    
    // 是否有输入
    hasInput() {
        return this.isPressed('w') || 
               this.isPressed('a') || 
               this.isPressed('s') || 
               this.isPressed('d');
    }
}

window.KeyboardController = KeyboardController;

