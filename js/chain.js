// ============= Chain类 - IK骨骼链 =============

class Chain {
    constructor(origin, jointCount, linkSize, angleConstraint = Math.PI * 2) {
        this.linkSize = linkSize;
        this.angleConstraint = angleConstraint;
        this.joints = [];
        this.angles = [];
        
        this.joints.push(origin.copy());
        this.angles.push(0);
        
        for (let i = 1; i < jointCount; i++) {
            this.joints.push(this.joints[i - 1].add(new Vec2(0, this.linkSize)));
            this.angles.push(0);
        }
    }

    resolve(pos) {
        // 设置头部角度和位置
        this.angles[0] = pos.sub(this.joints[0]).heading();
        this.joints[0] = pos.copy();
        
        // 每个关节跟随前一个
        for (let i = 1; i < this.joints.length; i++) {
            const curAngle = this.joints[i - 1].sub(this.joints[i]).heading();
            this.angles[i] = constrainAngle(curAngle, this.angles[i - 1], this.angleConstraint);
            this.joints[i] = this.joints[i - 1].sub(Vec2.fromAngle(this.angles[i]).setMag(this.linkSize));
        }
    }
}

