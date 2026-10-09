import {
  GibberlinkEngine,
  type GibberlinkDecodeResult,
  type GibberlinkSignalPacket
} from './engine.js';

export { GibberlinkEngine, type GibberlinkDecodeResult, type GibberlinkSignalPacket };

export type GibberlinkMode = GibberlinkSignalPacket['mode'];

/**
 * The part of a cross-talk `Channel` this package needs. Kept structural so
 * the package works with any client that sends channel messages with metadata.
 */
export interface SignalChannel<M = unknown> {
  send(content: string, metadata?: Record<string, unknown>): Promise<M>;
}

/** The part of a cross-talk `ChannelMessage` that `decodeSignal` reads. */
export interface SignalMessage {
  metadata?: Record<string, unknown>;
}

/**
 * Encodes `payload` as a Gibberlink signal packet and sends it as a normal
 * channel message. The readable text goes in `content`; the packet rides in
 * `metadata.gibberlink`.
 */
export async function sendSignal<M>(
  channel: SignalChannel<M>,
  payload: string | object,
  mode: GibberlinkMode = 'audible_fast'
): Promise<M> {
  const signal = GibberlinkEngine.encode(payload, mode);
  return channel.send(signal.text, { gibberlink: signal });
}

/**
 * Reads the Gibberlink packet from a channel message, if it carries one, and
 * decodes it. Returns null for ordinary messages.
 */
export function decodeSignal(message: SignalMessage): GibberlinkDecodeResult | null {
  const packet = message.metadata?.gibberlink;
  if (!isSignalPacket(packet)) return null;
  return GibberlinkEngine.decode(packet);
}

function isSignalPacket(value: unknown): value is GibberlinkSignalPacket {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as GibberlinkSignalPacket).protocol === 'gibberlink/signal-stream-v1' &&
    Array.isArray((value as GibberlinkSignalPacket).payloadTones)
  );
}
