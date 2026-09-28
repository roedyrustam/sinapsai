# Blueprint

## Architecture
SinapsAI is a universal AI gateway NPM package. It consists of:
1. **Providers Layer**: Native integrations for top LLMs via unified `Provider` interface.
2. **Core Layer**: 
   - `Router`: Strategizes fallback/failover configurations.
   - `CircuitBreaker`: Hardened reliability against provider failures.
   - `Storage`: Extensible key-value states for managing rate limits and circuit breaker statuses.
3. **Client Layer**: `SinapsClient` mimicking standard OpenAI patterns for seamless developer migration.
