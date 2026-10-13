/** Proves to the hub's WebSocket handler that a connection is one of its own remote-MCP bridges. */
export const INTERNAL_HEADER = 'x-crosstalk-internal';
/** The remote client's address, trusted only alongside a valid INTERNAL_HEADER. */
export const CLIENT_HEADER = 'x-crosstalk-client';
