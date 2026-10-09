#!/usr/bin/env node
/**
 * crosstalk-bridge: connect hardware to a CrossTalk conversation.
 *
 *   crosstalk-bridge --channel xt_... --serial /dev/tty.usbserial-0001 --baud 115200
 *   crosstalk-bridge --channel xt_... --tcp-listen 7777          # one agent per TCP device
 *   crosstalk-bridge --channel xt_... --unix /tmp/device.sock
 *   crosstalk-bridge --channel xt_... --stdio                    # pipe frames through stdin/stdout
 *
 * Each device link becomes one agent in the channel (see DeviceBridge for the
 * frame profile). Hub: --url or $CROSSTALK_URL; token: $CROSSTALK_AUTH_TOKEN.
 */
import fs from 'node:fs';
import net from 'node:net';
import { Duplex } from 'node:stream';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { DeviceBridge } from './bridge.js';
import { ResyncingLink } from './transport/resync.js';

function openSerial(path: string, baud: number): Duplex {
  // Configure the tty without a native dependency: raw mode at the requested baud.
  const flag = process.platform === 'darwin' ? '-f' : '-F';
  execFileSync('stty', [flag, path, String(baud), 'raw', '-echo'], { stdio: 'inherit' });
  const fd = fs.openSync(path, fs.constants.O_RDWR | fs.constants.O_NOCTTY);
  return Duplex.from({
    readable: fs.createReadStream('', { fd, autoClose: false }),
    writable: fs.createWriteStream('', { fd })
  });
}

async function main() {
  const { values } = parseArgs({
    options: {
      channel: { type: 'string', short: 'c' },
      name: { type: 'string', short: 'n', default: 'device' },
      url: { type: 'string', short: 'u' },
      token: { type: 'string' },
      serial: { type: 'string' },
      baud: { type: 'string', default: '115200' },
      'tcp-listen': { type: 'string' },
      'tcp-host': { type: 'string', default: '127.0.0.1' },
      'max-devices': { type: 'string', default: '16' },
      unix: { type: 'string' },
      stdio: { type: 'boolean', default: false },
      'max-frame': { type: 'string', default: '128' },
      help: { type: 'boolean', short: 'h' }
    }
  });

  const links = [values.serial, values['tcp-listen'], values.unix, values.stdio || undefined].filter(Boolean);
  if (values.help || !values.channel || links.length !== 1) {
    console.error(`Usage: crosstalk-bridge --channel <xt_address> (--serial <tty> [--baud 115200] | --tcp-listen <port> | --unix <path> | --stdio)
                       [--name device] [--url ws://localhost:4488] [--max-frame 128]
Each device link joins the channel as one agent. A device may send a REGISTER frame first to pick its name.`);
    process.exit(values.help ? 0 : 1);
  }
  if (values.token) {
    console.error('[bridge] warning: --token is visible to other users in `ps`; prefer CROSSTALK_AUTH_TOKEN');
  }

  const maxFrame = Number(values['max-frame']);
  const hub = { url: values.url, token: values.token };
  // Logs go to stderr so --stdio keeps stdout for frames.
  const log = (...args: unknown[]) => console.error('[bridge]', ...args);

  const bridge = async (link: ResyncingLink, name: string) => {
    const b = new DeviceBridge({ transport: link, channel: values.channel!, name, hub, maxPayloadBytes: maxFrame - 10 });
    b.on('error', err => log(`${name}:`, err instanceof Error ? err.message : err));
    b.on('closed', () => log(`${name} disconnected`));
    const ch = await b.start();
    log(`${name} joined #${ch.name} (${ch.address})`);
    return b;
  };

  if (values.serial) {
    await bridge(new ResyncingLink(openSerial(values.serial, Number(values.baud)), maxFrame), values.name!);
  } else if (values.unix) {
    const socket = net.createConnection(values.unix);
    await new Promise((resolve, reject) => socket.once('connect', resolve).once('error', reject));
    await bridge(new ResyncingLink(socket, maxFrame), values.name!);
  } else if (values.stdio) {
    await bridge(new ResyncingLink(Duplex.from({ readable: process.stdin, writable: process.stdout }), maxFrame), values.name!);
  } else {
    const host = values['tcp-host']!;
    const maxDevices = Number(values['max-devices']);
    if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
      log(`warning: listening on ${host}; any device that can reach this port can join the channel`);
    }
    let active = 0;
    let seq = 0;
    const server = net.createServer(socket => {
      if (active >= maxDevices) {
        socket.destroy();
        return;
      }
      active++;
      socket.once('close', () => active--);
      const name = `${values.name}-${++seq}`;
      bridge(new ResyncingLink(socket, maxFrame), name).catch(err => {
        log(`${name}:`, err.message);
        socket.destroy();
      });
    });
    server.listen(Number(values['tcp-listen']), host, () => log(`listening for devices on ${host}:${values['tcp-listen']}`));
  }
}

main().catch(err => {
  console.error('[bridge] fatal:', err?.message ?? err);
  process.exit(1);
});
