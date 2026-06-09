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
  planResolutionText,
  type PlanResolutionPorts,
} from "./resolution"
export { driveEngineTurn, type DriveTurnDeps } from "./live-turn"
export { InProcessEngine, inProcessEngine } from "./in-process-engine"
export {
  ExternalEngine,
  type ExternalEngineConfig,
  type AcpSessionFactory,
} from "./acp-engine"
export {
  SpawnAcpSessionFactory,
  type SpawnAcpSessionFactoryConfig,
  type AcpSpawn,
  type SpawnedAcpChild,
} from "./spawn-session-factory"
export {
  selectEngine,
  engineChoiceFromEnv,
  ENGINE_ENV_VAR,
  type EngineChoice,
} from "./engine-select"
export {
  AcpSession,
  type AcpSessionPorts,
  type AcpTransport,
  type OpenSessionOptions,
  type PlanDecision,
} from "./session"
