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

# 硬编码的目标设备地址 (Windows MAC Address)
TARGET_ADDRESS = "F2:8C:C8:0C:15:DB"

# 当前传感器数据
current_sensor_data = {
    "AccX": 0,
    "AccY": 0,
    "AccZ": 0,
    "magnitude": 0,
    "phase": "静水"
}

# 扫描并连接指定设备
async def connect_device():
    global devices, BLEDevice
    
    print(f"正在搜索指定设备: {TARGET_ADDRESS} (WT901BLE67)...")
    try:
        # 1. 尝试直接通过地址查找 (快速路径)
        device = await bleak.BleakScanner.find_device_by_address(TARGET_ADDRESS, timeout=10.0)
        
        if device:
            BLEDevice = device
            print(f"\n⚡ 成功锁定目标设备: {device.name or 'Unknown'} ({device.address})")
            return True
            
        print("⚠️ 未能直接通过地址找到设备，尝试全域扫描...")
        
        # 2. 备用：全域扫描
        devices = await bleak.BleakScanner.discover(timeout=5.0)
        for d in devices:
            if d.address == TARGET_ADDRESS:
                BLEDevice = d
                print(f"\n✅ 在扫描结果中找到目标设备: {d.name} ({d.address})")
                return True
        
        print(f"\n❌ 未找到设备 {TARGET_ADDRESS}")
        print("附近设备列表:")
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
    
    # 计算动态加速度（去除重力分量 1.0g）
    # 这样静止时 dynamic_acc 为 0，摇晃时才会增加
    dynamic_acc = abs(magnitude - 1.0)
    
    # 根据加速度大小判断阶段
    # 降低阈值到原来的 30%
    # 静水: < 1.8 * 0.3 = 0.54
    # 微扰: < 3.5 * 0.3 = 1.05
    if magnitude < 0.54:
        phase = "静水"
    elif magnitude < 1.05:
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
        "a": dynamic_acc * 50, # 将动态加速度放大，作为 jerk/动荡值传递
        "magnitude": magnitude,
        "phase": phase,
        # 角度数据（只传 AngX）
        "AngX": angX,
        "angle": angX,
    }
    
    print(f"加速度: ({accX:.2f}, {accY:.2f}, {accZ:.2f}) | 强度: {magnitude:.2f}g | 动态: {dynamic_acc:.2f}g | 状态: {phase}")
    
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
    
    # 1. 启动 WebSocket 服务器
    print("\n" + "=" * 50)
    print("步骤 1: 启动 WebSocket 服务器")
    print("=" * 50)
    print("服务器地址: ws://localhost:8765")
    
    websocket_server = await websockets.serve(websocket_handler, "localhost", 8765)
    
    # 2. 循环尝试连接蓝牙设备
    while True:
        try:
            print("\n" + "=" * 50)
            print(f"步骤 2: 连接指定传感器 {TARGET_ADDRESS}")
            print("=" * 50)
            
            BLEDevice = None
            success = await connect_device()
            
            if not success or BLEDevice is None:
                print("未找到设备，5秒后重试...")
                await asyncio.sleep(5)
                continue
            
            print("\n" + "=" * 50)
            print("步骤 3: 建立数据连接")
            print("=" * 50)
            
            # 关键：等待蓝牙栈稳定，防止 GATT Unreachable
            # Windows 蓝牙栈可能需要较长时间来准备 GATT 服务
            print("⏳ 等待设备蓝牙栈就绪 (5s)...")
            await asyncio.sleep(5)
            
            device = device_model.DeviceModel("BWT901BLE", BLEDevice, updateData)
            
            # 创建设备连接任务
            device_task = asyncio.create_task(device.openDevice())
            
            # 等待任务完成
            await device_task
            
            print("⚠️ 设备连接断开，准备重连...")
            
        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"❌ 发生错误: {e}")
            print("5秒后尝试重连...")
            await asyncio.sleep(5)
            continue
            
    # 清理工作
    websocket_server.close()
    await websocket_server.wait_closed()

if __name__ == '__main__':
    print("""
    ╔════════════════════════════════════════════════════╗
    ║   BWT901BLE5.0 → 锦鲤池塘 WebSocket 服务器        ║
    ║   定向连接模式: F2:8C:C8:0C:15:DB                  ║
    ╚════════════════════════════════════════════════════╝
    """)
    
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n程序已停止")
