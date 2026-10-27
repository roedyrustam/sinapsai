/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * Example 20: Streaming Tool Call Accumulator & Structured JSON Extraction
 *
 * Demonstrates:
 * 1. Accumulating real-time streaming chunks (with partial tool calls and reasoning) into a UnifiedApiResponse.
 * 2. Resilient JSON extraction from responses using client.extractJson<T>().
 *
 * Run with: npx tsx examples/20-streaming-tool-accumulator-and-json.ts
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import {
  accumulateStream,
  extractJsonFromText,
  SinapsClient,
  type UnifiedApiStreamChunk,
} from '../src/index.js';

async function main() {
  console.log(
    '=== SinapsAI: Streaming Tool Accumulator & JSON Extraction ===\n',
  );

  // --- PART A: Stream Accumulator Simulation ---
  console.log('--- PART A: Streaming Tool Call Accumulation ---');
  async function* mockStreamGenerator(): AsyncIterable<UnifiedApiStreamChunk> {
    // Delta 1: Assistant begins with thinking reasoning
    yield {
      id: 'msg-stream-1',
      model: 'deepseek-reasoner',
      choices: [
        {
          delta: {
            role: 'assistant',
            reasoning_content:
              'User asked for Tokyo weather. I should call get_weather tool.',
          },
          finishReason: null,
        },
      ],
    };

    // Delta 2: Tool call initiated
    yield {
      id: 'msg-stream-1',
      model: 'deepseek-reasoner',
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_weather_tokyo',
                type: 'function',
                function: { name: 'get_weather', arguments: '' },
              },
            ],
          },
          finishReason: null,
        },
      ],
    };

    // Delta 3: Partial JSON arguments
    yield {
      id: 'msg-stream-1',
      model: 'deepseek-reasoner',
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                function: { arguments: '{"city": "Tokyo"' },
              },
            ],
          },
          finishReason: null,
        },
      ],
    };

    // Delta 4: Final JSON arguments & stop reason
    yield {
      id: 'msg-stream-1',
      model: 'deepseek-reasoner',
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                function: { arguments: ', "units": "celsius"}' },
              },
            ],
          },
          finishReason: 'tool_calls',
        },
      ],
      usage: {
        promptTokens: 25,
        completionTokens: 35,
        totalTokens: 60,
      },
    };
  }

  // Accumulate stream directly
  const accumulatedResponse = await accumulateStream(mockStreamGenerator(), {
    onChunk: (chunk) => {
      if (chunk.choices[0]?.delta?.reasoning_content) {
        process.stdout.write(
          `[Reasoning Chunk]: ${chunk.choices[0].delta.reasoning_content}\n`,
        );
      }
    },
  });

  console.log('\nAccumulated Result:');
  console.log('  Model:', accumulatedResponse.model);
  console.log('  Finish Reason:', accumulatedResponse.choices[0].finishReason);
  console.log(
    '  Reasoning:',
    accumulatedResponse.choices[0].message.reasoning_content,
  );
  console.log(
    '  Tool Calls:',
    JSON.stringify(accumulatedResponse.choices[0].message.tool_calls, null, 2),
  );
  console.log('  Usage:', accumulatedResponse.usage);

  // --- PART B: Structured JSON Extraction ---
  console.log('\n--- PART B: Resilient Structured JSON Extraction ---');
  const markdownJsonResponse = `Here is the requested financial analysis:
\`\`\`json
{
  "ticker": "AAPL",
  "recommendation": "BUY",
  "targetPrice": 250.00,
  "confidence": 0.92
}
\`\`\`
Hope this helps your investment strategy!`;

  interface FinancialAnalysis {
    ticker: string;
    recommendation: 'BUY' | 'HOLD' | 'SELL';
    targetPrice: number;
    confidence: number;
  }

  const analysis = extractJsonFromText<FinancialAnalysis>(markdownJsonResponse);
  console.log('Parsed Object:');
  console.log('  Ticker:', analysis.ticker);
  console.log('  Recommendation:', analysis.recommendation);
  console.log('  Target Price: $' + analysis.targetPrice.toFixed(2));
  console.log('  Confidence:', analysis.confidence * 100 + '%');
}

main();
