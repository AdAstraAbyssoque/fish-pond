# coding:UTF-8
import asyncio
import json
import websockets
import bleak
import device_model
import math

# 已连接的 WebSocket 客户端
connected_clients = set()

# 扫描到的设备
devices = []
BLEDevice = None

# 当前传感器数据
current_sensor_data = {
    "AccX": 0,
    "AccY": 0,
    "AccZ": 0,
    "magnitude": 0,
    "phase": "静水"
}

# 直接连接指定设备地址
async def connect_device():
    global devices, BLEDevice
    
    # 硬编码的设备地址（macOS UUID 格式）
    target_address = "5DB5FA1C-1769-3437-97C2-516AE169E43C"
    
    print(f"正在搜索设备: {target_address} ...")
    try:
        devices = await bleak.BleakScanner.discover(timeout=15.0)
        print(f"搜索完成，共找到 {len(devices)} 个蓝牙设备")
        
        for d in devices:
            if d.address == target_address:
                BLEDevice = d
                print(f"✅ 找到目标设备: {d.name or '未知名称'} ({d.address})")
                return True
        
        # 未找到设备
        print(f"❌ 未找到设备 {target_address}")
        print("\n可能的原因：")
        print("  1. 传感器未开机或电量不足")
        print("  2. 设备超出蓝牙范围（建议 <5米）")
        print("  3. 设备地址不正确")
        print("\n尝试列出附近所有设备：")
        for d in devices:
            print(f"  - {d.name or '未知'}: {d.address}")
        return False
        
    except Exception as ex:
        print("❌ 蓝牙搜索失败:", ex)
        return False

# 传感器数据更新回调
def updateData(DeviceModel):
    global current_sensor_data
    
    # 获取加速度数据 (单位: g)
    accX = DeviceModel.get("AccX") or 0
    accY = DeviceModel.get("AccY") or 0
    accZ = DeviceModel.get("AccZ") or 0
    
    # 计算加速度向量的模（总强度）
    magnitude = math.sqrt(accX**2 + accY**2 + accZ**2)
    
    # 根据加速度大小判断阶段（更合理的阈值）
    if magnitude < 1.3:
        phase = "静水"
    elif magnitude < 2.5:
        phase = "微扰"
    else:
        phase = "惊扰"
    
    # 获取角度数据 (单位: 度) - 只使用 AngX
    angX = DeviceModel.get("AngX") or 0
    
    # 更新数据
    current_sensor_data = {
        # 加速度数据
        "x": accX,
        "y": accY,
        "z": accZ,
        "a": magnitude * 25,  # jerk/急动度，提高到25倍（之前8倍太小，150倍太大）
        "magnitude": magnitude,
        "phase": phase,
        # 角度数据（只传 AngX）
        "AngX": angX,
        # 主要角度（用于控制鱼的方向）
        # AngX 0-180度 → 鱼左转0-180度
        # AngX 0到-180度 → 鱼右转0-180度
        "angle": angX,
    }
    
    print(f"加速度: ({accX:.2f}, {accY:.2f}, {accZ:.2f}) | 强度: {magnitude:.2f}g | 状态: {phase} | 角度: AngX={angX:.1f}°")
    
    # 广播数据给所有连接的客户端
    asyncio.create_task(broadcast_data())

# 广播数据到所有客户端
async def broadcast_data():
    if connected_clients:
        message = json.dumps(current_sensor_data)
        # 并发发送给所有客户端
        await asyncio.gather(
            *[client.send(message) for client in connected_clients],
            return_exceptions=True
        )

# WebSocket 服务器处理函数
async def websocket_handler(websocket):
    # 注册新客户端
    connected_clients.add(websocket)
    print(f"新客户端连接，当前连接数: {len(connected_clients)}")
    
    try:
        # 立即发送当前数据
        await websocket.send(json.dumps(current_sensor_data))
        
        # 保持连接，等待客户端消息（心跳）
        async for message in websocket:
            # 客户端可以发送心跳或控制指令
            pass
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        # 注销客户端
        connected_clients.remove(websocket)
        print(f"客户端断开，当前连接数: {len(connected_clients)}")

# 主函数
async def main():
    global BLEDevice
    
    # 1. 连接指定的蓝牙设备
    print("=" * 50)
    print("步骤 1: 连接蓝牙传感器")
    print("=" * 50)
    success = await connect_device()
    
    if not success or BLEDevice is None:
        print("未找到蓝牙设备，退出程序")
        return
    
    # 2. 启动 WebSocket 服务器
    print("\n" + "=" * 50)
    print("步骤 2: 启动 WebSocket 服务器")
    print("=" * 50)
    print("服务器地址: ws://localhost:8765")
    print("等待客户端连接...")
    
    # 启动 WebSocket 服务器（异步任务）
    websocket_server = await websockets.serve(websocket_handler, "localhost", 8765)
    
    # 3. 连接蓝牙设备并开始接收数据
    print("\n" + "=" * 50)
    print("步骤 3: 连接传感器并开始数据传输")
    print("=" * 50)
    
    device = device_model.DeviceModel("BWT901BLE", BLEDevice, updateData)
    
    # 创建设备连接任务
    device_task = asyncio.create_task(device.openDevice())
    
    # 等待任务完成（实际上会一直运行）
    try:
        await device_task
    except KeyboardInterrupt:
        print("\n程序中断，正在关闭...")
        device.closeDevice()
        websocket_server.close()
        await websocket_server.wait_closed()

if __name__ == '__main__':
    print("""
    ╔════════════════════════════════════════════════════╗
    ║   BWT901BLE5.0 → 锦鲤池塘 WebSocket 服务器        ║
    ║   实时加速度数据传输                               ║
    ╚════════════════════════════════════════════════════╝
    """)
    
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n程序已停止")

