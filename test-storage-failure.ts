import { CircuitBreaker } from './src/core/CircuitBreaker.js';
import { Router } from './src/core/Router.js';
import { Provider } from './src/providers/Provider.js';
import { StateStorage } from './src/core/StateStorage.js';
import { UnifiedApiRequest } from './src/types/index.js';

class FaultyStorage implements StateStorage {
  async get<T>(key: string): Promise<T | null> {
    throw new Error('Storage GET failed');
  }
  async set(key: string, value: any, ttlSeconds?: number): Promise<void> {
    throw new Error('Storage SET failed');
  }
  async delete(key: string): Promise<void> {
    throw new Error('Storage DELETE failed');
  }
  async increment(key: string): Promise<number> {
    throw new Error('Storage INCREMENT failed');
  }
}

class MockProvider implements Provider {
  name: string;
  constructor(name: string) {
    this.name = name;
  }
  async generateContent(request: UnifiedApiRequest) {
    return {
      content: 'success from ' + this.name,
      model: 'test-model',
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 }
    };
  }
}

async function run() {
  const providers = [new MockProvider('P1'), new MockProvider('P2')];
  const storage = new FaultyStorage();
  const cb = new CircuitBreaker(storage);
  const router = new Router(providers, cb);

  try {
    const res = await router.execute({ model: 'test', messages: [] });
    console.log('SUCCESS:', res);
  } catch (err) {
    console.error('FAILED:', err);
  }
}

run();
