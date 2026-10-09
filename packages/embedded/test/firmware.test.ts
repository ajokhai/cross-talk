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

// ---------------------------------------------------------------------------
// Conversation profile (host bridge): device -> host and host -> device frames
// ---------------------------------------------------------------------------

/** Host -> device BROADCAST / DIRECT_MSG payload: [from_len:1][from][text]. */
function attributed(from: string, text: string): Buffer {
  const name = Buffer.from(from, 'utf8');
  return Buffer.concat([Buffer.from([name.length]), name, Buffer.from(text, 'utf8')]);
}

function hostFrame(opcode: BinaryOpcode, payload: Buffer, flags: Record<string, boolean> = {}): Buffer {
  return BinaryCodec.encode({ opcode, flags, timestamp: Date.now(), payload });
}

test('C -> Node: register, text, DM, heartbeat and state query follow the bridge profile', { skip: !has('cc') }, () => {
  const frames = execFileSync(c(), ['emit-chat']).toString().trim().split('\n').map(h => BinaryCodec.decode(Buffer.from(h, 'hex'))!);
  const [register, text, dm, heartbeat, state] = frames;
  assert.equal(register.opcode, BinaryOpcode.REGISTER);
  assert.equal(register.raw!.toString('utf8'), 'esp32-imu');
  assert.equal(text.opcode, BinaryOpcode.BROADCAST);
  assert.equal(text.raw!.toString('utf8'), 'temp 21.5C, ok');
  assert.equal(dm.opcode, BinaryOpcode.DIRECT_MSG);
  assert.equal(dm.raw![0], 'claude-bot'.length);
  assert.equal(dm.raw!.subarray(1, 11).toString(), 'claude-bot');
  assert.equal(dm.raw!.subarray(11).toString(), 'calibration done');
  assert.equal(dm.flags.ackRequested, false, 'reply_expected = 0 clears the ack bit');
  assert.equal(heartbeat.opcode, BinaryOpcode.HEARTBEAT);
  assert.equal(heartbeat.raw!.toString(), 'calibrating');
  assert.equal(state.opcode, BinaryOpcode.STATE_QUERY);
  assert.equal(state.raw!.length, 0);
});

test('Node -> C: downlink chat, DM, lock events and a conflict alert decode', { skip: !has('cc') }, () => {
  const downlink = (frame: Buffer) => execFileSync(c(), ['downlink', frame.toString('hex')]).toString().trim();
  assert.equal(downlink(hostFrame(BinaryOpcode.BROADCAST, attributed('claude-bot', 'what is the bias?'))), 'chat claude-bot|what is the bias?');
  assert.equal(downlink(hostFrame(BinaryOpcode.DIRECT_MSG, attributed('gemini', 'héllo ✓'))), 'chat gemini|héllo ✓');
  assert.equal(
    downlink(hostFrame(BinaryOpcode.LOCK_ACQUIRE, DialectEngine.packToBits('!LCK @src/motor.c "claude-bot" &WAIT'))),
    'lock 16 0 src/motor.c|claude-bot'
  );
  assert.equal(
    downlink(hostFrame(BinaryOpcode.LOCK_ACQUIRE, DialectEngine.packToBits('!WARN @src/imu.c "claude-bot"'), { conflictAlert: true })),
    'lock 20 4 src/imu.c|claude-bot'
  );
  assert.equal(
    downlink(hostFrame(BinaryOpcode.LOCK_DENIED, DialectEngine.packToBits('!WARN @a.c "held by bob"'), { isResponse: true })),
    'lock 20 2 a.c|held by bob'
  );
  // A sender name that claims more bytes than the payload has is rejected, not over-read.
  assert.equal(downlink(hostFrame(BinaryOpcode.BROADCAST, Buffer.from([40, 0x61, 0x62]))), 'other 2');
});

test('MicroPython: conversation frames round-trip with Node and the stream reader resyncs', { skip: !has('python3') }, () => {
  const chat = hostFrame(BinaryOpcode.BROADCAST, attributed('claude-bot', 'hi there'));
  const lock = hostFrame(BinaryOpcode.LOCK_ACQUIRE, DialectEngine.packToBits('!WARN @src/imu.c "bob"'), { conflictAlert: true });
  const stream = Buffer.concat([Buffer.from('ff1358', 'hex'), StreamFramer.frame(chat), StreamFramer.frame(lock)]);
  const out = micropython(
    'from crosstalk_micro import CrossTalkMicro as M, FrameReader\n' +
    'for b in (M.pack_register("pico"), M.pack_text("hi"), M.pack_dm("bob", "ok", False), M.pack_heartbeat(), M.pack_state_query()):\n' +
    '  print(b.hex())\n' +
    `r = FrameReader(); fs = r.feed(bytes.fromhex("${stream.toString('hex')}"))\n` +
    'print(len(fs), M.unpack_attributed(fs[0]["payload"]))\n' +
    'p = M.unpack_packed(fs[1]["payload"]); print(fs[1]["flags"], p["action"], p["target"], p["reason"])\n' +
    'try:\n  M.pack_text("\\x10x")\nexcept ValueError:\n  print("rejected")'
  ).split('\n');

  const packets: Buffer[] = [];
  StreamFramer.unframe(Buffer.from(out.slice(0, 5).join(''), 'hex'), p => packets.push(Buffer.from(p)));
  const decoded = packets.map(p => BinaryCodec.decode(p)!);
  assert.deepEqual(decoded.map(d => d.opcode), [
    BinaryOpcode.REGISTER, BinaryOpcode.BROADCAST, BinaryOpcode.DIRECT_MSG, BinaryOpcode.HEARTBEAT, BinaryOpcode.STATE_QUERY
  ]);
  assert.equal(decoded[0].raw!.toString(), 'pico');
  assert.deepEqual([...decoded[2].raw!], [3, ...Buffer.from('bobok')]);
  assert.equal(decoded[2].flags.ackRequested, false);
  assert.equal(out[5], "2 ('claude-bot', 'hi there')");
  assert.equal(out[6], '4 20 src/imu.c bob');
  assert.equal(out[7], 'rejected');
});
