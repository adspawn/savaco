// UNIT-C6L (Meshtastic) 受信ブリッジ
// CommonJS から dynamic import で呼び出す

import { MeshDevice } from '@meshtastic/core';
import { TransportNodeSerial } from '@meshtastic/transport-node-serial';

const DEDUP_MS = 2000;
const CONNECT_TIMEOUT_MS = 20000;
const CONFIG_TIMEOUT_MS = 30000;
const HEARTBEAT_MS = 30000;

// onMeshPacket (生パケット、RSSI/SNRを含む) を id で数秒だけ保持し、
// onDetectionSensorPacket/onMessagePacket (アプリ別デコード済みイベント、RSSI/SNRなし)
// と packet.id で突き合わせて信号品質を補完する
const RADIO_META_TTL_MS = 5000;

/**
 * @param {string} portPath
 * @param {(payload: { from: number, text: string, portnum: string, rssi?: number, snr?: number }) => void} onPacket
 */
export async function startMeshtasticBridge(portPath, onPacket) {
  let transport = null;
  let device = null;

  try {
    transport = await TransportNodeSerial.create(portPath, 115200);
    device = new MeshDevice(transport);

    const recentKeys = new Map();
    const radioMetaById = new Map(); // packet.id -> { rssi, snr, expiresAt }
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

    const pruneRadioMeta = () => {
      const now = Date.now();
      for (const [id, meta] of radioMetaById) {
        if (meta.expiresAt <= now) radioMetaById.delete(id);
      }
    };

    const emitIfNew = (id, from, text, portnum) => {
      const normalized = (text || '').trim();
      if (!normalized) return;
      if (!shouldEmit(from, normalized)) {
        console.log(`LoRa dedup skip: from=${from} text=${normalized}`);
        return;
      }

      const radioMeta = radioMetaById.get(id);
      onPacket({
        from,
        text: normalized,
        portnum,
        rssi: radioMeta ? radioMeta.rssi : undefined,
        snr: radioMeta ? radioMeta.snr : undefined
      });
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

    // 生パケット (RSSI/SNRを含むが、アプリ種別ごとのデコードはされていない)
    // 0/0 は自ノード発の(LoRa経由ではない)パケットで、実際の受信品質ではない
    device.events.onMeshPacket.subscribe((packet) => {
      pruneRadioMeta();
      radioMetaById.set(packet.id, {
        rssi: packet.rxRssi,
        snr: packet.rxSnr,
        expiresAt: Date.now() + RADIO_META_TTL_MS
      });
    });

    device.events.onMessagePacket.subscribe((packet) => {
      emitIfNew(packet.id, packet.from, packet.data, 'TEXT_MESSAGE_APP');
    });

    device.events.onDetectionSensorPacket.subscribe((packet) => {
      emitIfNew(packet.id, packet.from, decodeBytes(packet.data), 'DETECTION_SENSOR_APP');
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
