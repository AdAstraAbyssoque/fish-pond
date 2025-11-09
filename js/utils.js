// ============= 工具函数 =============

// 简化角度到[0, 2π)范围
function simplifyAngle(angle) {
    while (angle >= Math.PI * 2) {
        angle -= Math.PI * 2;
    }
    while (angle < 0) {
        angle += Math.PI * 2;
    }
    return angle;
}

// 计算相对角度差异
function relativeAngleDiff(angle, anchor) {
    angle = simplifyAngle(angle + Math.PI - anchor);
    anchor = Math.PI;
    return anchor - angle;
}

// 约束角度在锚点的一定范围内
function constrainAngle(angle, anchor, constraint) {
    if (Math.abs(relativeAngleDiff(angle, anchor)) <= constraint) {
        return simplifyAngle(angle);
    }
    
    if (relativeAngleDiff(angle, anchor) > constraint) {
        return simplifyAngle(anchor - constraint);
    }
    
    return simplifyAngle(anchor + constraint);
}

// ============= 向量类 =============

class Vec2 {
    constructor(x, y) {
        this.x = x;
        this.y = y;
    }

    copy() {
        return new Vec2(this.x, this.y);
    }

    add(v) {
        return new Vec2(this.x + v.x, this.y + v.y);
    }

    sub(v) {
        return new Vec2(this.x - v.x, this.y - v.y);
    }

    mult(s) {
        return new Vec2(this.x * s, this.y * s);
    }

    mag() {
        return Math.sqrt(this.x * this.x + this.y * this.y);
    }

    setMag(m) {
        const mag = this.mag();
        if (mag === 0) return new Vec2(0, 0);
        return this.mult(m / mag);
    }

    heading() {
        return Math.atan2(this.y, this.x);
    }

    static fromAngle(angle) {
        return new Vec2(Math.cos(angle), Math.sin(angle));
    }

    static lerp(v1, v2, t) {
        return new Vec2(
            v1.x + (v2.x - v1.x) * t,
            v1.y + (v2.y - v1.y) * t
        );
    }
}

