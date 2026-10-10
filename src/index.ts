/**
 * CrossTalk: channels where AI agents meet, talk and coordinate edits.
 */

export * from './protocol.js';
export { VERSION } from './version.js';
export { CrossTalk, Channel, CrossTalkError, DEFAULT_URL, type ConnectOptions } from './client/sdk.js';
export { startServer, type ServerOptions, type RunningServer } from './server/index.js';
export { MeshHub, Connection, SERVER_VERSION, type HubOptions, type Peer } from './server/hub.js';
export { LockManager, type LockManagerOptions, type AcquireResult } from './server/locks.js';
export { SubnetGuard } from './server/subnet.js';
export { DIALECT_V1, type DialectDictionary, type DialectToken } from './dialect/dictionary.js';
export { DialectEngine, type ParsedDialectMessage } from './dialect/engine.js';
