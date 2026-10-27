# Entity Relationship Diagram - SinapsAI (In-Memory State & Architecture)

Karena SinapsAI berjalan secara lokal sebagai SDK/Paket NPM (tanpa database eksternal), diagram ini merepresentasikan arsitektur relasi antar-komponen inti dan struktur manajemen *state in-process* serta adaptasi storage terdistribusi.

```mermaid
classDiagram
    class SinapsClient {
        -Router router
        -StateStorage storage
        -PIIGuardrails piiGuardrails
        -SecurityGuardrails securityGuardrails
        -BudgetGuardrails budgetGuardrails
        -ContextCompressor contextCompressor
        -HedgedExecutor hedgedExecutor
        -GatewayRateLimiter rateLimiter
        +McpToolBridge mcp
        +contextCache
        +chat.completions.create(request)
        +embeddings.create(request)
        +batch.chat(requests, options)
        +batch.embeddings(requests, options)
        +runWithTools(options)
        +runWithToolsStream(options)
        +checkHealth(options)
        +getMetrics()
        +getCircuitBreakerStatus()
        +resetCircuitBreaker()
        +clearCache()
        +exportPrometheusMetrics(options)
        +toPrometheusMetrics(options)
        +exportOtelMetrics(options)
        +toOtelMetrics(options)
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
        +execute(provider, request)
        +recordSuccess(providerId)
        +recordFailure(providerId)
        +getStatus()
        +reset()
    }

    class StateStorage {
        <<interface>>
        +get(key)
        +set(key, value, ttlSeconds)
        +delete(key)
        +increment(key)
    }

    class InMemoryStorage {
        -Map store
        +sweep()
        +get(key)
        +set(key, value, ttlSeconds)
        +delete(key)
        +increment(key)
        +destroy()
    }

    class CloudflareKVStorage {
        -KVNamespace kv
        +get(key)
        +set(key, value, ttlSeconds)
        +delete(key)
        +increment(key)
    }

    class RedisStorage {
        -RedisClient client
        +get(key)
        +set(key, value, ttlSeconds)
        +delete(key)
        +increment(key)
    }

    class D1Storage {
        -D1Database db
        +get(key)
        +set(key, value, ttlSeconds)
        +delete(key)
        +increment(key)
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

    class OpenAiProvider {
        +resolveModel(model)
        +formatRequest(request)
        +formatResponse(data)
        +generateContent(request)
    }
    class AnthropicProvider {
        +resolveModel(model)
        +formatRequest(request)
        +formatResponse(data)
        +generateContent(request)
    }
    class GeminiProvider {
        +resolveModel(model)
        +formatRequest(request)
        +formatResponse(data, model)
        +generateContent(request)
    }
    class DeepSeekProvider {
        +resolveModel(model)
        +generateContent(request)
    }
    class GroqProvider {
        +resolveModel(model)
        +generateContent(request)
    }
    class MistralProvider {
        +resolveModel(model)
        +generateContent(request)
    }
    class OpenRouterProvider {
        +resolveModel(model)
        +generateContent(request)
    }
    class OllamaProvider {
        +resolveModel(model)
        +generateContent(request)
    }
    class XAiProvider {
        +resolveModel(model)
        +generateContent(request)
    }
    class CohereProvider {
        +resolveModel(model)
        +generateContent(request)
    }

    class PIIGuardrails {
        +detect(text)
        +redact(text)
        +tokenize(text)
        +detokenize(text, map)
    }

    class SecurityGuardrails {
        +inspect(messages)
    }

    class BudgetGuardrails {
        +trackUsage(usage, cost)
        +checkBudget()
    }

    class ContextCompressor {
        +compress(messages, options)
    }

    class HedgedExecutor {
        +execute(providers, request, executor)
    }

    class GatewayRateLimiter {
        -StateStorage storage
        -GatewayRateLimitOptions options
        +resolveRule(model, providerId)
        +getKey(request)
        +estimateTokens(request)
        +check(request, options)
        +adjustTokens(request, actualTokens, estimatedTokens, providerId)
    }

    class McpToolBridge {
        -Map tools
        +registerTool(tool)
        +unregisterTool(name)
        +hasTool(name)
        +getTool(name)
        +listTools()
        +toUnifiedTools()
        +getTools()
        +executeToolCall(call, context)
        +executeToolCalls(calls, context)
        +handleJsonRpc(request)
    }

    class GeminiAgentBooster {
        +analyzeComplexity(options)
        +canonicalizeTools(tools)
        +extractGroundingCitations(metadata)
        +extractCodeExecution(metadata)
    }

    StateStorage <|.. InMemoryStorage : implements
    StateStorage <|.. CloudflareKVStorage : implements
    StateStorage <|.. RedisStorage : implements
    StateStorage <|.. D1Storage : implements

    Provider <|.. OpenAiProvider : implements
    Provider <|.. AnthropicProvider : implements
    Provider <|.. GeminiProvider : implements
    Provider <|.. DeepSeekProvider : implements
    Provider <|.. GroqProvider : implements
    Provider <|.. MistralProvider : implements
    Provider <|.. OpenRouterProvider : implements
    Provider <|.. OllamaProvider : implements
    Provider <|.. XAiProvider : implements
    Provider <|.. CohereProvider : implements

    SinapsClient "1" *-- "1" Router : delegates to
    SinapsClient "1" *-- "1" StateStorage : maintains
    SinapsClient "1" *-- "1" McpToolBridge : orchestrates tools via
    SinapsClient "1" *-- "0..1" GeminiAgentBooster : optimizes via
    SinapsClient "1" *-- "0..1" PIIGuardrails : safeguards with
    SinapsClient "1" *-- "0..1" SecurityGuardrails : secures with
    SinapsClient "1" *-- "0..1" BudgetGuardrails : caps budget with
    SinapsClient "1" *-- "0..1" ContextCompressor : trims context with
    SinapsClient "1" *-- "0..1" HedgedExecutor : hedges latency with
    SinapsClient "1" *-- "0..1" GatewayRateLimiter : limits rate with
    GatewayRateLimiter "1" o-- "1" StateStorage : tracks counters in
    Router "1" *-- "1" CircuitBreaker : protects with
    Router "1" o-- "many" Provider : routes across
    CircuitBreaker "1" o-- "1" StateStorage : persists state in
```
