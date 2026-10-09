/**
 * CrossTalk: Universal Multi-Agent Communication & Coordination Protocol
 */
export { startServer } from './server/index.js';
export { MeshHub } from './server/hub.js';
export { LockManager } from './server/locks.js';
export { GibberlinkEngine } from './server/gibberlink.js';
export { BinaryCodec, BinaryOpcode } from './server/binary.js';
export { CrossTalkClient, CrossTalk } from './client/sdk.js';
export { DIALECT_V1 } from './dialect/dictionary.js';
export { DialectEngine } from './dialect/engine.js';
export { StreamFramer } from './transport/interface.js';
export { UnixSocketTransport } from './transport/unix.js';
export { StreamTransport } from './transport/stream.js';
