# Entity & Architecture Relationship Diagram — SinapsAI v3.2.0

Karena SinapsAI berjalan secara in-process sebagai SDK/Paket NPM (tanpa ketergantungan database eksternal mandatory), diagram ini merepresentasikan topologi relasi antar-komponen modul inti (*Aggregate Roots & Bounded Contexts*), struktur manajemen memori kognitif (*In-Process State*), serta adaptasi penyimpanan terdistribusi.

```mermaid
classDiagram
    class SinapsClient {
        -Router router
        -StateStorage storage
        +PIIGuardrails guardrails
        +SecurityGuardrails securityGuardrails
        +BudgetGuardrails budgetGuardrails
        +ContextCompressor contextCompressor
        +HedgedExecutor hedgedExecutor
        +GatewayRateLimiter rateLimiter
        +CanaryProber canary
        +FaithfulnessSentinel sentinel
        +DashboardServer dashboard
        +McpToolBridge mcp
        +CognitiveBrain brain
        +EpisodicMemory memory
        +HybridRagEngine rag
        +KnowledgeGraph graph
        +DurableWorkflowEngine workflows
        +LlmEvals evals
        +ConsensusEngine consensus
        +RealtimeClient realtime
        +chat.completions.create(request)
        +embeddings.create(request)
        +batch.chat(requests, options)
        +runWithTools(options)
        +runWithToolsStream(options)
        +swarm(options)
        +runActorCritic(options)
        +checkHealth(options)
        +getMetrics()
        +getCircuitBreakerStatus()
        +resetCircuitBreaker()
        +clearCache()
        +exportPrometheusMetrics(options)
        +exportOtelMetrics(options)
        +exportOtelTraces(options)
    }

    class Router {
        -List~Provider~ providers
        -CircuitBreaker circuitBreaker
        -RouterStrategy strategy
        -SinapsEventHooks hooks
        +execute(request)
        +executeSingleProvider(provider, request)
        +executeStreaming(request)
        +getProviderById(id)
        +clearCache()
    }

    class CircuitBreaker {
        -StateStorage storage
        -number failureThreshold
        -number recoverySuccessThreshold
        -number resetTimeoutMs
        +isAvailable(providerId)
        +recordSuccess(providerId)
        +recordFailure(providerId)
        +getStatus()
        +reset()
    }

    class CanaryProber {
        -SinapsClient client
        -number intervalMs
        +start()
        +stop()
        +probeProvider(providerId)
        +getAllHealth()
    }

    class StateStorage {
        <<interface>>
        +get(key)
        +set(key, value, ttlSeconds)
        +delete(key)
        +increment(key, ttlSeconds)
    }

    class InMemoryStorage {
        -Map store
        +get(key)
        +set(key, value, ttlSeconds)
        +delete(key)
        +increment(key, ttlSeconds)
    }

    class CloudflareKVStorage {
        -KVNamespace kv
        +get(key)
        +set(key, value, ttlSeconds)
        +delete(key)
        +increment(key, ttlSeconds)
    }

    class RedisStorage {
        -RedisClient client
        +get(key)
        +set(key, value, ttlSeconds)
        +delete(key)
        +increment(key, ttlSeconds)
    }

    class D1Storage {
        -D1Database db
        +get(key)
        +set(key, value, ttlSeconds)
        +delete(key)
        +increment(key, ttlSeconds)
    }

    class Provider {
        <<interface>>
        +string id
        +string name
        +number costPer1kTokens
        +number promptCostPer1k
        +number completionCostPer1k
        +string defaultModel
        +List~string~ fallbackModels
        +generateContent(request)
        +generateEmbedding(request)
    }

    class CognitiveBrain {
        +EpisodicMemory memory
        +KnowledgeGraph graph
        +HybridRagEngine rag
        +rememberFact(fact, userId)
        +retrieveContext(options)
    }

    class EpisodicMemory {
        -StateStorage storage
        +store(options)
        +recall(query, options)
        +delete(id)
    }

    class KnowledgeGraph {
        -Map nodes
        -Map edges
        +addTriple(subject, predicate, object)
        +findSubgraph(query, maxDepth)
    }

    class HybridRagEngine {
        -List~DocumentChunk~ chunks
        +addDocuments(docs)
        +search(query, options)
    }

    class AgentSwarm {
        -SinapsClient client
        -Map agents
        -SwarmContext context
        +run(options)
        +runStream(options)
        +runParallel(options)
        +runActorCritic(options)
        +exportAgentCards(baseUrl)
    }

    class SwarmContext {
        -Map state
        +get(key)
        +set(key, value)
        +getAll()
        +toPromptSection()
    }

    class DurableWorkflowEngine {
        -StateStorage storage
        +startWorkflow(id, initialData)
        +recordStep(id, step)
        +onStep(listener)
        +suspendForApproval(id, request)
        +resolveApproval(id, resolution)
        +resume(id)
        +getCheckpoint(id)
        +deleteWorkflow(id)
    }

    class McpToolBridge {
        -Map tools
        +registerTool(tool)
        +unregisterTool(name)
        +executeToolCalls(calls, context)
        +handleJsonRpc(request)
        +toUnifiedTools()
    }

    class McpClientConnector {
        +connectExternalServer(config)
        +disconnect(serverName)
    }

    class AutonomousDriftHealer {
        +heal(rawArgs, schema)
        +diagnoseProviderError(error)
    }

    class DashboardServer {
        -http.Server server
        +start()
        +stop()
        +getUrl()
    }

    StateStorage <|.. InMemoryStorage : implements
    StateStorage <|.. CloudflareKVStorage : implements
    StateStorage <|.. RedisStorage : implements
    StateStorage <|.. D1Storage : implements

    Provider <|.. OpenAiProvider : implements
    Provider <|.. AnthropicProvider : implements
    Provider <|.. GeminiProvider : implements
    Provider <|.. AwsBedrockProvider : implements
    Provider <|.. AzureOpenAiProvider : implements
    Provider <|.. DeepSeekProvider : implements
    Provider <|.. GroqProvider : implements
    Provider <|.. MistralProvider : implements
    Provider <|.. OpenRouterProvider : implements
    Provider <|.. OllamaProvider : implements
    Provider <|.. XAiProvider : implements
    Provider <|.. CohereProvider : implements

    SinapsClient "1" *-- "1" Router : routes requests via
    SinapsClient "1" *-- "1" StateStorage : maintains persistence
    SinapsClient "1" *-- "1" CognitiveBrain : synthesizes memory
    SinapsClient "1" *-- "1" McpToolBridge : orchestrates tools
    SinapsClient "1" *-- "1" McpClientConnector : ingests external MCP
    SinapsClient "1" *-- "1" DurableWorkflowEngine : checkpoints workflows
    SinapsClient "1" *-- "many" AgentSwarm : spawns multi-agent
    AgentSwarm "1" *-- "1" SwarmContext : shares context
    McpClientConnector "1" o-- "1" AutonomousDriftHealer : heals schema drift
    CognitiveBrain "1" *-- "1" EpisodicMemory : tracks facts
    CognitiveBrain "1" *-- "1" KnowledgeGraph : traverses relational triples
    CognitiveBrain "1" *-- "1" HybridRagEngine : fuses BM25 & dense vectors
    Router "1" *-- "1" CircuitBreaker : protects with
    SinapsClient "1" *-- "0..1" CanaryProber : active probing
    SinapsClient "1" *-- "0..1" DashboardServer : serves web UI
