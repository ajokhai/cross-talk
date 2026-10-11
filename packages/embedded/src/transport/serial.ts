import fs from 'node:fs';
import { Duplex } from 'node:stream';
import { execFileSync } from 'node:child_process';

/**
 * Opens a serial port (USB serial, UART, Bluetooth SPP, a radio module in
 * transparent mode) as a byte stream, without a native dependency: the tty
 * is put in raw mode at `baud` with stty. macOS and Linux.
 */
export function openSerialPort(path: string, baud = 115200): Duplex {
  const flag = process.platform === 'darwin' ? '-f' : '-F';
  execFileSync('stty', [flag, path, String(baud), 'raw', '-echo'], { stdio: 'inherit' });
  const fd = fs.openSync(path, fs.constants.O_RDWR | fs.constants.O_NOCTTY);
  return Duplex.from({
    readable: fs.createReadStream('', { fd, autoClose: false }),
    writable: fs.createWriteStream('', { fd })
  });
}
