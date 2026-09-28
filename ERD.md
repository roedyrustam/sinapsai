# Entity Relationship Diagram - SinapsAI (In-Memory State)

Karena SinapsAI berjalan secara lokal sebagai SDK/Paket NPM (tanpa database eksternal), diagram ini merepresentasikan struktur *in-memory state* dan arsitektur kelas inti.

```mermaid
classDiagram
    class SinapsClient {
        +Config config
        +Router router
        +createChatCompletion(payload)
    }
    class Config {
        +List~Provider~ providers
        +FallbackStrategy strategy
    }
    class Provider {
        +String name
        +String apiKey
        +String baseUrl
        +CircuitBreaker circuitBreaker
    }
    class CircuitBreaker {
        +int failureCount
        +Date lastFailure
        +boolean isOpen()
        +recordFailure()
        +recordSuccess()
    }
    class Router {
        +routeRequest(payload)
        +executeWithFallback(payload)
    }

    SinapsClient "1" *-- "1" Config
    SinapsClient "1" *-- "1" Router
    Config "1" *-- "many" Provider
    Provider "1" *-- "1" CircuitBreaker
```
