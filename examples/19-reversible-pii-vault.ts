/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 * Example 19: Reversible PII Tokenization & Response Vault
 *
 * Demonstrates zero-dependency PII protection with reversible tokenization:
 * 1. Outgoing messages mask sensitive PII (emails, cards, phones) with surrogate tokens (e.g. {{PII_EMAIL_1}}).
 * 2. LLMs never see user data.
 * 3. Incoming responses automatically restore original values into the final response text!
 *
 * Run with: npx tsx examples/19-reversible-pii-vault.ts
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import { PIIGuardrails, SinapsClient } from '../src/index.js';

async function main() {
  console.log(
    '=== SinapsAI: Reversible PII Tokenization & Response Vault ===\n',
  );

  // --- PART A: Standalone Tokenization & Restoration ---
  console.log('--- PART A: Standalone PIIGuardrails Vault ---');
  const guardrails = new PIIGuardrails({
    categories: ['email', 'phone', 'credit_card'],
  });

  const rawText =
    'Please contact our lead engineer at john.doe@enterprise.com or call +1-555-867-5309.';
  console.log('Original Text:\n', rawText);

  const { text: tokenizedText, vault } = guardrails.tokenize(rawText);
  console.log('\nTokenized (Sent to LLM):\n', tokenizedText);
  console.log('\nSession Vault (Stored strictly in-memory):');
  for (const [token, orig] of vault.entries()) {
    console.log(`  ${token} => ${orig}`);
  }

  // Simulate LLM response referencing the token
  const simulatedLlmResponse = `Understood! I will send the quarterly security report directly to ${Array.from(vault.keys())[0]}.`;
  console.log('\nSimulated LLM Output:\n', simulatedLlmResponse);

  const restored = guardrails.restore(simulatedLlmResponse, vault);
  console.log('\nRestored Final Text:\n', restored);

  // --- PART B: Fully Automated Client Integration ---
  console.log('\n--- PART B: Automated SinapsClient Guardrails ---');
  // Mock provider to inspect what is actually received
  const mockProvider = {
    name: 'Secure-LLM',
    id: 'secure-llm-1',
    generateContent: async (req: any) => {
      console.log('Payload received by Provider API:');
      console.log(' ', req.messages[0].content);

      return {
        id: 'msg-1',
        model: 'secure-model',
        choices: [
          {
            message: {
              role: 'assistant',
              content: `A confirmation receipt was sent to ${req.messages[0].content.includes('{{PII_EMAIL_1}}') ? '{{PII_EMAIL_1}}' : 'user'}.`,
            },
            finishReason: 'stop',
          },
        ],
      };
    },
  };

  const client = new SinapsClient({
    providers: [mockProvider as any],
    piiGuardrails: {
      categories: ['email'],
      reversible: true, // Enables automated tokenize -> LLM -> restore flow!
    },
  });

  const response = await client.chat.completions.create({
    messages: [
      {
        role: 'user',
        content: 'Please process refund for alice.secret@domain.com',
      },
    ],
  });

  console.log('\nFinal Response Delivered to Client:');
  console.log(' ', response.choices[0].message.content);
}

main();
