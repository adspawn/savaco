#!/usr/bin/env python3
"""Serial Module 検証: 受信側 UNIT-C6L に届いたテキストを時刻付きで表示し、
送信側 ESP32 の "TX <連番>" 行と突き合わせて遅延(ms)を出す。

使い方:
  # 届くかどうかだけ見る (送信側はC3なしでもOK)
  python3 latency_test.py --recv-port /dev/cu.usbmodemXXXX

  # 遅延も測る (C3をUSBでPCにも接続)
  python3 latency_test.py --recv-port /dev/cu.usbmodemXXXX --sender-port /dev/cu.usbmodemYYYY

PC上の同一クロックで「ESP32がTXした瞬間」と「受信ノードから届いた瞬間」を比べるので、
遅延 = UART送信 + LoRa空中時間 + 受信ノード処理 + USB。判定ウィンドウ待ちは含まない。
"""
import argparse
import re
import statistics
import threading
import time

import serial
from pubsub import pub
from meshtastic.serial_interface import SerialInterface

tx_times = {}          # seq -> monotonic秒
deltas = []


def stamp():
    return time.strftime("%H:%M:%S") + f".{int(time.time() * 1000) % 1000:03d}"


def sender_reader(port):
    with serial.Serial(port, 115200, timeout=1) as s:
        while True:
            line = s.readline().decode(errors="ignore").strip()
            if line.startswith("C6L>"):
                print(f"[{stamp()}] {line}")
            m = re.match(r"TX (\d+)", line)
            if m:
                tx_times[int(m.group(1))] = time.monotonic()
                print(f"[{stamp()}] ESP TX  #{m.group(1)}")


def on_text(packet, interface):
    now = time.monotonic()
    text = packet.get("decoded", {}).get("text", "")
    print(f"[{stamp()}] RX  {text!r}  from={packet.get('fromId')} "
          f"rssi={packet.get('rxRssi')} snr={packet.get('rxSnr')} hop={packet.get('hopStart', 0) - packet.get('hopLimit', 0)}")
    m = re.search(r"#(\d+)", text)
    if m and int(m.group(1)) in tx_times:
        d = (now - tx_times.pop(int(m.group(1)))) * 1000
        deltas.append(d)
        print(f"          -> 遅延 {d:.0f} ms")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--recv-port", required=True, help="受信側UNIT-C6L")
    ap.add_argument("--sender-port", help="送信側ESP32 (USB)")
    args = ap.parse_args()

    pub.subscribe(on_text, "meshtastic.receive.text")
    if args.sender_port:
        threading.Thread(target=sender_reader, args=(args.sender_port,), daemon=True).start()
    iface = SerialInterface(args.recv_port)
    print("受信待機中... (Ctrl+C で終了)")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        pass
    finally:
        iface.close()
        if deltas:
            print(f"\n遅延 n={len(deltas)} min={min(deltas):.0f} "
                  f"median={statistics.median(deltas):.0f} max={max(deltas):.0f} ms")


if __name__ == "__main__":
    main()
