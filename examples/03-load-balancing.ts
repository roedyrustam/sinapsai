import { GroqProvider, SinapsClient } from '../src/index.js';

/**
 * Example 03: Round-Robin Load Balancing Across API Keys
 *
 * Prevents 429 Rate Limits by rotating traffic evenly across multiple keys.
 */
async function run() {
  const client = new SinapsClient({
    strategy: 'load-balance',
    providers: [
      new GroqProvider({
        id: 'groq-us-east',
        apiKey: process.env.GROQ_KEY_1 || 'gsk_mock_key_1',
      }),
      new GroqProvider({
        id: 'groq-us-west',
        apiKey: process.env.GROQ_KEY_2 || 'gsk_mock_key_2',
      }),
    ],
    hooks: {
      onRateLimit: (provider, error) => {
        console.warn(`Provider ${provider.id} rate limited: ${error.message}`);
      },
    },
  });

  console.log('Dispatching multiple requests with Round-Robin load balancing...');
  // Every call alternates smoothly between groq-us-east and groq-us-west
}

run();
