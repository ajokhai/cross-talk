/**
 * CrossTalk: Universal Multi-Agent Communication & Coordination Protocol
 */
export { startServer } from './server/index.js';
export { MeshHub } from './server/hub.js';
export { LockManager } from './server/locks.js';
export { GibberlinkEngine, type GibberlinkSignalPacket } from './server/gibberlink.js';
export { BinaryCodec, BinaryOpcode, type BinaryFrame } from './server/binary.js';
export { CrossTalkClient, CrossTalk, type CrossTalkClientOptions } from './client/sdk.js';
export { DIALECT_V1, type DialectDictionary, type DialectToken } from './dialect/dictionary.js';
export { DialectEngine, type ParsedDialectMessage } from './dialect/engine.js';
export { ICrossTalkTransport, StreamFramer } from './transport/interface.js';
export { UnixSocketTransport } from './transport/unix.js';
export { StreamTransport } from './transport/stream.js';
