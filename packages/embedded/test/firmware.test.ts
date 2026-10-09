/**
 * Cross-language conformance: frames built by the C header and the MicroPython
 * client must decode in Node (BinaryCodec + DialectEngine.unpackFromBits), and
 * frames built in Node must decode in C and MicroPython. Each side is skipped
 * when its toolchain (cc, python3) is missing.
 *
 *   node --import tsx --test packages/embedded/test/firmware.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DialectEngine } from 'cross-talk';
import { BinaryCodec, BinaryOpcode, StreamFramer } from '../src/index.js';

const firmware = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'firmware');

function has(cmd: string): boolean {
  try {
    execFileSync(cmd, ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Compiles test_micro.c once; returns the binary path. */
let cBinary: string | undefined;
function c(): string {
  if (!cBinary) {
    cBinary = path.join(mkdtempSync(path.join(tmpdir(), 'xt-micro-')), 'test_micro');
    execFileSync('cc', ['-std=c99', '-Wall', '-Werror', '-I', firmware, path.join(firmware, 'test_micro.c'), '-o', cBinary]);
  }
  return cBinary;
}

/** Runs a snippet with crosstalk_micro.py importable; returns stdout. */
function micropython(code: string): string {
  return execFileSync('python3', ['-I', '-c', `import sys; sys.path.insert(0, ${JSON.stringify(firmware)})\n${code}`]).toString().trim();
}

/** A Node-built LOCK_ACQUIRE frame whose payload has bytes >= 0x80 (TTL 200 = 0x00c8). */
function nodeFrame(): Buffer {
  return BinaryCodec.encode({
    opcode: BinaryOpcode.LOCK_ACQUIRE,
    flags: {},
    timestamp: Date.now(),
    payload: DialectEngine.packToBits('!LCK @src/motor.c #FIX "stall" ~200 &WAIT')
  });
}

test('BinaryCodec keeps raw payload bytes intact', () => {
  const bits = DialectEngine.packToBits('!LCK @a.c #FIX "x" ~200 &WAIT');
  assert.ok(bits.includes(0xc8));
  const frame = BinaryCodec.decode(BinaryCodec.encode({ opcode: BinaryOpcode.LOCK_ACQUIRE, flags: {}, timestamp: 0, payload: bits }))!;
  assert.deepEqual(frame.raw, bits);
  assert.ok(Buffer.isBuffer(frame.payload), 'invalid UTF-8 stays a Buffer');
  assert.equal(DialectEngine.unpackFromBits(frame.raw!).parsed.ttl, 200);

  const json = BinaryCodec.decode(BinaryCodec.encode({ opcode: BinaryOpcode.BROADCAST, flags: {}, timestamp: 0, payload: { hi: 1 } }))!;
  assert.deepEqual(json.payload, { hi: 1 });
  assert.equal(BinaryCodec.decode(Buffer.from('580105', 'hex')), null);
});

test('C: unit tests pass', { skip: !has('cc') }, () => {
  assert.match(execFileSync(c()).toString(), /All MCU C tests passed/);
});

test('C -> Node: claim and release decode', { skip: !has('cc') }, () => {
  const [claim, release] = execFileSync(c(), ['emit']).toString().trim().split('\n').map(h => Buffer.from(h, 'hex'));

  const lock = BinaryCodec.decode(claim)!;
  assert.equal(lock.opcode, BinaryOpcode.LOCK_ACQUIRE);
  assert.equal(DialectEngine.unpackFromBits(lock.raw!).shorthand, '!LCK @src/sensor.c #FIX "imu drift" ~200 &WAIT');

  const rel = BinaryCodec.decode(release)!;
  assert.equal(rel.opcode, BinaryOpcode.LOCK_RELEASE);
  const unpacked = DialectEngine.unpackFromBits(rel.raw!);
  assert.equal(unpacked.parsed.action, '!REL');
  assert.equal(unpacked.parsed.target, 'src/sensor.c');
  assert.deepEqual(unpacked.parsed.flow, ['&DONE', '&PROCEED']);
});

test('Node -> C: frame decodes, partial frame is rejected', { skip: !has('cc') }, () => {
  const frame = nodeFrame();
  assert.equal(execFileSync(c(), ['decode', frame.toString('hex')]).toString().trim(), `${BinaryOpcode.LOCK_ACQUIRE} ${frame.length - 10}`);
  assert.throws(() => execFileSync(c(), ['decode', frame.subarray(0, -1).toString('hex')], { stdio: 'pipe' }));
});

test('MicroPython -> Node: length-prefixed claim and release decode', { skip: !has('python3') }, () => {
  const out = micropython(
    'from crosstalk_micro import CrossTalkMicro as M\n' +
    'print(M.pack_claim("src/led.c", "blink", 200).hex())\n' +
    'print(M.pack_release("src/led.c").hex())'
  );
  const packets: Buffer[] = [];
  const rest = StreamFramer.unframe(Buffer.from(out.split('\n').join(''), 'hex'), p => packets.push(Buffer.from(p)));
  assert.equal(rest.length, 0);
  assert.equal(packets.length, 2);

  const claim = BinaryCodec.decode(packets[0])!;
  assert.equal(claim.opcode, BinaryOpcode.LOCK_ACQUIRE);
  assert.equal(DialectEngine.unpackFromBits(claim.raw!).shorthand, '!LCK @src/led.c #FEAT "blink" ~200 &WAIT');
  const rel = BinaryCodec.decode(packets[1])!;
  assert.deepEqual(DialectEngine.unpackFromBits(rel.raw!).parsed.flow, ['&DONE', '&PROCEED']);
});

test('Node -> MicroPython: frame decodes, partial and oversized input is rejected', { skip: !has('python3') }, () => {
  const hex = nodeFrame().toString('hex');
  const out = micropython(
    'from crosstalk_micro import CrossTalkMicro as M\n' +
    `f = bytes.fromhex("${hex}")\n` +
    'd = M.unpack_frame(f); print(d["opcode"], len(d["payload"]))\n' +
    'print(M.unpack_frame(f[:-1]))\n' +
    'try:\n  M.pack_release("x" * 256)\nexcept ValueError:\n  print("too long")'
  );
  assert.deepEqual(out.split('\n'), [`${BinaryOpcode.LOCK_ACQUIRE} ${hex.length / 2 - 10}`, 'None', 'too long']);
});
