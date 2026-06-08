/**
 * The ACP-native Engine seam (ADR 0006). ACP is the canonical conversation
 * representation end-to-end: the engine boundary's vocabulary, the durable log,
 * and the server's broadcast all speak it. This barrel is the public surface.
 */
export * from "./schema"
export * from "./record"
export * from "./engine-seam"
export * from "./adapter"
export * from "./markers"
export {
  AcpUpdateConsumer,
  type AcpConsumerPorts,
  type ConsumerPlanCall,
} from "./consumer"
export {
  resolvePlanGate,
  planResolutionRecord,
  type PlanResolutionPorts,
} from "./resolution"
export { InProcessAiSdkEngine, inProcessEngine } from "./in-process-engine"
export {
  AcpSession,
  type AcpSessionPorts,
  type AcpTransport,
  type OpenSessionOptions,
  type PlanDecision,
} from "./session"
