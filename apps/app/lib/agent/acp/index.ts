/**
 * The ACP-native Engine seam (ADR 0006). ACP is the canonical conversation
 * representation end-to-end: the engine boundary's vocabulary, the durable log,
 * and the server's broadcast all speak it. This barrel is the public surface.
 */
export * from "./schema"
export * from "./record"
export * from "./engine-seam"
export * from "./adapter"
export { AcpUpdateConsumer, type AcpConsumerPorts } from "./consumer"
export { InProcessAiSdkEngine, inProcessEngine } from "./in-process-engine"
