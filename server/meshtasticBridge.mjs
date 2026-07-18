// UNIT-C6L (Meshtastic) 受信ブリッジ
// CommonJS から dynamic import で呼び出す

import { MeshDevice } from '@meshtastic/core';
import { TransportNodeSerial } from '@meshtastic/transport-node-serial';

const DEDUP_MS = 2000;
const CONNECT_TIMEOUT_MS = 20000;
const CONFIG_TIMEOUT_MS = 30000;
const HEARTBEAT_MS = 30000;

/**
 * @param {string} portPath
 * @param {(payload: { from: number, text: string, portnum: string }) => void} onPacket
 */
export async function startMeshtasticBridge(portPath, onPacket) {
  let transport = null;
  let device = null;

  try {
    transport = await TransportNodeSerial.create(portPath, 115200);
    device = new MeshDevice(transport);

    const recentKeys = new Map();
    let currentStatus = 2;

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

    const waitForStatus = (targetStatus, timeoutMs, label) =>
      new Promise((resolve, reject) => {
        if (currentStatus === targetStatus) {
          resolve();
          return;
        }

        const timer = setTimeout(() => {
          unsub();
          reject(new Error(`Timeout waiting for ${label} (last status=${currentStatus})`));
        }, timeoutMs);

        const unsub = device.events.onDeviceStatus.subscribe((status) => {
          if (status === targetStatus) {
            clearTimeout(timer);
            unsub();
            resolve();
          }
        });
      });

    device.events.onMessagePacket.subscribe((packet) => {
      emitIfNew(packet.from, packet.data, 'TEXT_MESSAGE_APP');
    });

    device.events.onDetectionSensorPacket.subscribe((packet) => {
      emitIfNew(packet.from, decodeBytes(packet.data), 'DETECTION_SENSOR_APP');
    });

    device.events.onDeviceStatus.subscribe((status) => {
      currentStatus = status;
      console.log(`Meshtastic device status: ${status}`);
    });

    // Connected 前に wantConfig を送ると DeviceConfigured に到達しないことがある
    console.log('Meshtastic: waiting for DeviceConnected...');
    await waitForStatus(5, CONNECT_TIMEOUT_MS, 'DeviceConnected');

    console.log('Meshtastic: requesting configuration...');
    await device.configure();

    console.log('Meshtastic: waiting for DeviceConfigured...');
    await waitForStatus(7, CONFIG_TIMEOUT_MS, 'DeviceConfigured');

    device.setHeartbeatInterval(HEARTBEAT_MS);
    console.log(`Meshtastic connected and configured: ${portPath}`);

    return {
      device,
      transport,
      async close() {
        try {
          await device.disconnect();
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
  } catch (error) {
    try {
      if (device) {
        await device.disconnect();
      } else if (transport) {
        await transport.disconnect();
      }
    } catch (closeError) {
      console.error('Meshtastic cleanup error:', closeError.message);
    }
    throw error;
  }
}
