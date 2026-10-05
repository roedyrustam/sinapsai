# Entity Relationship Diagram - SinapsAI (In-Memory State & Architecture)

Karena SinapsAI berjalan secara lokal sebagai SDK/Paket NPM (tanpa database eksternal), diagram ini merepresentasikan arsitektur relasi antar-komponen inti dan struktur manajemen *state in-memory*.

```mermaid
classDiagram
    class SinapsClient {
        -Router router
        -StateStorage storage
        +chat.completions.create(request)
    }
    class Router {
        -List~Provider~ providers
        -CircuitBreaker circuitBreaker
        -RouterStrategy strategy
        -SinapsEventHooks hooks
        +execute(request)
        +getProviderById(id)
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
    class Provider {
        <<interface>>
        +string id
        +string name
        +number costPer1kTokens
        +generateContent(request)
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

    StateStorage <|.. InMemoryStorage : implements
    Provider <|.. OpenAiProvider : implements
    Provider <|.. AnthropicProvider : implements
    Provider <|.. GeminiProvider : implements

    SinapsClient "1" *-- "1" Router : delegates to
    SinapsClient "1" *-- "1" StateStorage : maintains
    Router "1" *-- "1" CircuitBreaker : protects with
    Router "1" o-- "many" Provider : routes across
    CircuitBreaker "1" o-- "1" StateStorage : persists state in
```

