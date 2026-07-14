// UNIT-C6L (Meshtastic) 受信ブリッジ
// CommonJS から dynamic import で呼び出す

import { MeshDevice } from '@meshtastic/core';
import { TransportNodeSerial } from '@meshtastic/transport-node-serial';

const DEDUP_MS = 2000;

/**
 * @param {string} portPath
 * @param {(payload: { from: number, text: string, portnum: string }) => void} onPacket
 * @param {{ nodeMap?: Record<string, string>, defaultPosition?: string }} options
 */
export async function startMeshtasticBridge(portPath, onPacket) {
  const transport = await TransportNodeSerial.create(portPath, 115200);
  const device = new MeshDevice(transport);

  const recentKeys = new Map();

  const shouldEmit = (from, text) => {
    const key = `${from}:${text}`;
    const now = Date.now();
    const last = recentKeys.get(key);
    if (last && now - last < DEDUP_MS) {
      return false;
    }
    recentKeys.set(key, now);
    return true;
  };

  const emitIfNew = (from, text, portnum) => {
    const normalized = (text || '').trim();
    if (!normalized) return;
    if (!shouldEmit(from, normalized)) {
      console.log(`LoRa dedup skip: from=${from} text=${normalized}`);
      return;
    }
    onPacket({ from, text: normalized, portnum });
  };

  const decodeBytes = (data) => {
    if (!data) return '';
    if (typeof data === 'string') return data;
    if (data instanceof Uint8Array) {
      return new TextDecoder('utf-8').decode(data).replace(/\0/g, '').trim();
    }
    return String(data);
  };

  device.events.onMessagePacket.subscribe((packet) => {
    emitIfNew(packet.from, packet.data, 'TEXT_MESSAGE_APP');
  });

  device.events.onDetectionSensorPacket.subscribe((packet) => {
    emitIfNew(packet.from, decodeBytes(packet.data), 'DETECTION_SENSOR_APP');
  });

  device.events.onDeviceStatus.subscribe((status) => {
    console.log(`Meshtastic device status: ${status}`);
  });

  await device.configure();
  console.log(`Meshtastic connected: ${portPath}`);

  return {
    device,
    transport,
    async close() {
      try {
        await transport.disconnect();
      } catch (error) {
        console.error('Meshtastic disconnect error:', error.message);
      }
    },
    isOpen() {
      return true;
    },
    path: portPath,
    baudRate: 115200
  };
}
