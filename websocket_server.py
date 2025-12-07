# coding:UTF-8
import asyncio
import json
import websockets
import bleak
import device_model
import math

# 设备1: 用于控制鱼的游动方向（角度数据）
DEVICE1_ADDRESS = "C219403B-FFD5-1498-8536-83D18AECC3CD"  # 方向控制设备
DEVICE1_PORT = 8765
connected_clients_device1 = set()
BLEDevice1 = None
current_sensor_data_device1 = {"AngX": 0, "AngY": 0, "AngZ": 0, "angle": 0}

# 设备2: 用于检测加速度和鱼儿游动状态（加速度数据）
DEVICE2_ADDRESS = "96E44DEC-04DC-F743-C8CF-691590A7277F"  # 加速度检测设备
DEVICE2_PORT = 8766
connected_clients_device2 = set()
BLEDevice2 = None
current_sensor_data_device2 = {
    "AccX": 0,
    "AccY": 0,
    "AccZ": 0,
    "magnitude": 0,
    "phase": "静水",
    "dynamic_acc": 0,
}

# 扫描到的设备
devices = []


# 扫描并连接指定设备
async def connect_device(target_address, device_name):
    global devices

    print(f"正在搜索指定设备: {target_address} ({device_name})...")
    try:
        # 1. 尝试直接通过地址查找 (快速路径)
        device = await bleak.BleakScanner.find_device_by_address(
            target_address, timeout=10.0
        )

        if device:
            print(
                f"\n⚡ 成功锁定目标设备 [{device_name}]: {device.name or 'Unknown'} ({device.address})"
            )
            return device

        print(f"⚠️ 未能直接通过地址找到 {device_name}，尝试全域扫描...")

        # 2. 备用：全域扫描
        devices = await bleak.BleakScanner.discover(timeout=5.0)
        for d in devices:
            if d.address == target_address:
                print(
                    f"\n✅ 在扫描结果中找到目标设备 [{device_name}]: {d.name} ({d.address})"
                )
                return d

        print(f"\n❌ 未找到设备 [{device_name}] {target_address}")
        print("附近设备列表:")
        for d in devices:
            print(f"  - {d.name or '未知'}: {d.address}")

        return None

    except Exception as ex:
        print(f"❌ 蓝牙搜索失败 [{device_name}]:", ex)
        return None


# 设备1的传感器数据更新回调（方向控制）
def updateData_device1(DeviceModel):
    global current_sensor_data_device1

    # 获取角度数据 (单位: 度)
    angX = DeviceModel.get("AngX") or 0
    angY = DeviceModel.get("AngY") or 0
    angZ = DeviceModel.get("AngZ") or 0

    # 更新数据
    current_sensor_data_device1 = {
        "AngX": angX,
        "AngY": angY,
        "AngZ": angZ,
        "angle": angX,  # 主要使用 AngX 作为方向角度
    }

    print(f"[方向设备] 角度: X={angX:.2f}° Y={angY:.2f}° Z={angZ:.2f}°")

    # 广播数据给设备1的所有连接客户端
    asyncio.create_task(
        broadcast_data(connected_clients_device1, current_sensor_data_device1)
    )


# 设备2的传感器数据更新回调（加速度检测）
def updateData_device2(DeviceModel):
    global current_sensor_data_device2

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
    if magnitude < 1.5:
        phase = "静水"
    elif magnitude < 3:
        phase = "微扰"
    else:
        phase = "惊扰"

    # 更新数据
    current_sensor_data_device2 = {
        "x": accX,
        "y": accY,
        "z": accZ,
        "a": dynamic_acc * 50,  # 将动态加速度放大，作为 jerk/动荡值传递
        "magnitude": magnitude,
        "dynamic_acc": dynamic_acc,
        "phase": phase,
    }

    print(
        f"[加速度设备] 加速度: ({accX:.2f}, {accY:.2f}, {accZ:.2f}) | 强度: {magnitude:.2f}g | 动态: {dynamic_acc:.2f}g | 状态: {phase}"
    )

    # 广播数据给设备2的所有连接客户端
    asyncio.create_task(
        broadcast_data(connected_clients_device2, current_sensor_data_device2)
    )


# 广播数据到所有客户端
async def broadcast_data(clients, data):
    if clients:
        message = json.dumps(data)
        # 并发发送给所有客户端
        await asyncio.gather(
            *[client.send(message) for client in clients],
            return_exceptions=True,
        )


# WebSocket 服务器处理函数 - 设备1（方向控制）
async def websocket_handler_device1(websocket):
    # 注册新客户端
    connected_clients_device1.add(websocket)
    print(f"[设备1-方向] 新客户端连接，当前连接数: {len(connected_clients_device1)}")

    try:
        # 立即发送当前数据
        await websocket.send(json.dumps(current_sensor_data_device1))

        # 保持连接，等待客户端消息（心跳）
        async for message in websocket:
            pass
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        # 注销客户端
        connected_clients_device1.remove(websocket)
        print(f"[设备1-方向] 客户端断开，当前连接数: {len(connected_clients_device1)}")


# WebSocket 服务器处理函数 - 设备2（加速度检测）
async def websocket_handler_device2(websocket):
    # 注册新客户端
    connected_clients_device2.add(websocket)
    print(f"[设备2-加速度] 新客户端连接，当前连接数: {len(connected_clients_device2)}")

    try:
        # 立即发送当前数据
        await websocket.send(json.dumps(current_sensor_data_device2))

        # 保持连接，等待客户端消息（心跳）
        async for message in websocket:
            pass
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        # 注销客户端
        connected_clients_device2.remove(websocket)
        print(
            f"[设备2-加速度] 客户端断开，当前连接数: {len(connected_clients_device2)}"
        )


# 设备1连接任务（方向控制）
async def device1_task():
    global BLEDevice1

    while True:
        try:
            print("\n" + "=" * 50)
            print(f"[设备1-方向] 连接传感器 {DEVICE1_ADDRESS}")
            print("=" * 50)

            BLEDevice1 = await connect_device(DEVICE1_ADDRESS, "方向控制设备")

            if BLEDevice1 is None:
                print("[设备1-方向] 未找到设备，5秒后重试...")
                await asyncio.sleep(5)
                continue

            print("\n" + "=" * 50)
            print("[设备1-方向] 建立数据连接")
            print("=" * 50)

            # 等待蓝牙栈稳定
            print("⏳ [设备1-方向] 等待设备蓝牙栈就绪 (5s)...")
            await asyncio.sleep(5)

            device = device_model.DeviceModel(
                "BWT901BLE", BLEDevice1, updateData_device1
            )

            # 打开设备连接
            await device.openDevice()

            print("⚠️ [设备1-方向] 设备连接断开，准备重连...")

        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"❌ [设备1-方向] 发生错误: {e}")
            print("5秒后尝试重连...")
            await asyncio.sleep(5)
            continue


# 设备2连接任务（加速度检测）
async def device2_task():
    global BLEDevice2

    while True:
        try:
            print("\n" + "=" * 50)
            print(f"[设备2-加速度] 连接传感器 {DEVICE2_ADDRESS}")
            print("=" * 50)

            BLEDevice2 = await connect_device(DEVICE2_ADDRESS, "加速度检测设备")

            if BLEDevice2 is None:
                print("[设备2-加速度] 未找到设备，5秒后重试...")
                await asyncio.sleep(5)
                continue

            print("\n" + "=" * 50)
            print("[设备2-加速度] 建立数据连接")
            print("=" * 50)

            # 等待蓝牙栈稳定
            print("⏳ [设备2-加速度] 等待设备蓝牙栈就绪 (5s)...")
            await asyncio.sleep(5)

            device = device_model.DeviceModel(
                "BWT901BLE", BLEDevice2, updateData_device2
            )

            # 打开设备连接
            await device.openDevice()

            print("⚠️ [设备2-加速度] 设备连接断开，准备重连...")

        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"❌ [设备2-加速度] 发生错误: {e}")
            print("5秒后尝试重连...")
            await asyncio.sleep(5)
            continue


# 主函数
async def main():
    # 1. 启动两个 WebSocket 服务器
    print("\n" + "=" * 70)
    print("步骤 1: 启动 WebSocket 服务器")
    print("=" * 70)
    print(f"设备1 (方向控制) 服务器地址: ws://localhost:{DEVICE1_PORT}")
    print(f"设备2 (加速度检测) 服务器地址: ws://localhost:{DEVICE2_PORT}")

    websocket_server1 = await websockets.serve(
        websocket_handler_device1, "localhost", DEVICE1_PORT
    )
    websocket_server2 = await websockets.serve(
        websocket_handler_device2, "localhost", DEVICE2_PORT
    )

    # 2. 并行运行两个设备的连接任务
    try:
        await asyncio.gather(device1_task(), device2_task())
    except asyncio.CancelledError:
        pass

    # 清理工作
    websocket_server1.close()
    websocket_server2.close()
    await websocket_server1.wait_closed()
    await websocket_server2.wait_closed()


if __name__ == "__main__":
    print(
        """
    ╔═══════════════════════════════════════════════════════════════════╗
    ║   双设备 WT901BLE67 → 锦鲤池塘 WebSocket 服务器                  ║
    ║                                                                   ║
    ║   设备1 (方向控制):                                               ║
    ║     地址: C219403B-FFD5-1498-8536-83D18AECC3CD                   ║
    ║     端口: 8765                                                    ║
    ║     功能: 控制鱼的游动方向（角度数据）                            ║
    ║                                                                   ║
    ║   设备2 (加速度检测):                                             ║
    ║     地址: 96E44DEC-04DC-F743-C8CF-691590A7277F                   ║
    ║     端口: 8766                                                    ║
    ║     功能: 检测鱼儿的游动状态（加速度数据）                        ║
    ╚═══════════════════════════════════════════════════════════════════╝
    """
    )

    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n程序已停止")
