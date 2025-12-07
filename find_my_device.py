import asyncio
from bleak import BleakScanner

async def main():
    print("正在扫描附近的蓝牙设备，请确保传感器已开机...")
    devices = await BleakScanner.discover()
    
    found = False
    for d in devices:
        # 打印所有发现的设备
        # 重点关注名字里带 WT901 的
        if d.name and "WT901" in d.name:
            print("\n" + "="*40)
            print(f"🎯 找到传感器了！")
            print(f"设备名称: {d.name}")
            print(f"你的真实地址 (UUID): {d.address}") # <--- 就是这个！
            print("="*40 + "\n")
            found = True
    
    if not found:
        print("未找到名为 WT901 的设备，请检查它是否在闪灯。")

asyncio.run(main())
