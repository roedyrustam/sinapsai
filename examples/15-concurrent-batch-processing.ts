/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import {
  type CreateChatCompletionRequestNonStreaming,
  OpenAiProvider,
  SinapsClient,
} from '../src/index.js';

/**
 * Example 15: Concurrent In-Process Batch Processing (`client.batch`)
 *
 * Demonstrates:
 * 1. Zero-dependency in-process concurrency worker pool (`concurrency: 3`).
 * 2. Progress reporting via `onProgress` callback.
 * 3. Fail-soft settled execution (`stopOnError: false`) processing both successful and failing requests.
 * 4. Preserved index ordering matching original requests.
 */
async function run() {
  console.log('=== SinapsAI Concurrent Batch Processing ===\n');

  const provider = new OpenAiProvider({
    apiKey: process.env.OPENAI_API_KEY || 'dummy-key',
    defaultModel: 'gpt-4o-mini',
  });

  const client = new SinapsClient({
    providers: [provider],
  });

  const prompts = [
    'Translate "Good morning" to French.',
    'Translate "Good morning" to Spanish.',
    'Translate "Good morning" to Japanese.',
    'Translate "Good morning" to German.',
    'Translate "Good morning" to Indonesian.',
    'Translate "Good morning" to Italian.',
  ];

  const requests: CreateChatCompletionRequestNonStreaming[] = prompts.map(
    (prompt) => ({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
    }),
  );

  console.log(
    `Dispatching ${requests.length} requests in parallel with concurrency = 3...\n`,
  );

  const batchResult = await client.batch.chat(requests, {
    concurrency: 3,
    stopOnError: false,
    onProgress: (progress) => {
      console.log(
        `[Progress] ${progress.completed}/${progress.total} (${progress.percentage}%) - Successful: ${progress.successful}, Failed: ${progress.failed}`,
      );
    },
  });

  console.log('\n=== Batch Execution Finished ===');
  console.log(`Total duration: ${batchResult.durationMs}ms`);
  console.log(`Successful: ${batchResult.successful} / ${batchResult.total}`);
  console.log(`Failed: ${batchResult.failed}`);
  console.log('\n--- Settled Results Summary ---');

  for (const item of batchResult.results) {
    if (item.status === 'fulfilled') {
      const answer =
        item.value?.choices[0]?.message.content?.trim() || '(No content)';
      console.log(`[Item #${item.index}] SUCCESS: ${prompts[item.index]}`);
      console.log(`         Answer: ${answer}`);
    } else {
      console.log(
        `[Item #${item.index}] FAILED: ${prompts[item.index]} -> ${item.error?.message}`,
      );
    }
  }
}

run().catch(console.error);
