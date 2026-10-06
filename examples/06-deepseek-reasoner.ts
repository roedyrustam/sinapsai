/**
 * Example 06: DeepSeek Provider with Chain-of-Thought (deepseek-reasoner / R1)
 *
 * Demonstrates native DeepSeekProvider integration with reasoning_content support.
 */

import { DeepSeekProvider, SinapsClient } from 'sinapsai';

const client = new SinapsClient({
  providers: [
    new DeepSeekProvider({
      apiKey: process.env.DEEPSEEK_API_KEY || 'sk-...',
      defaultModel: 'deepseek-reasoner',
    }),
  ],
});

async function run() {
  console.log('Sending complex reasoning prompt to DeepSeek...');

  try {
    const response = await client.chat.completions.create({
      model: 'deepseek-reasoner',
      messages: [
        {
          role: 'user',
          content: 'How many times does the letter "r" appear in "strawberry"? Explain step by step.',
        },
      ],
    });

    if ('choices' in response) {
      const choice = response.choices[0];
      if (choice.message.reasoning_content) {
        console.log('\n--- 🧠 Thinking / Chain of Thought ---');
        console.log(choice.message.reasoning_content);
      }
      console.log('\n--- 💬 Final Answer ---');
      console.log(choice.message.content);
    }
  } catch (error) {
    console.error('DeepSeek Error:', (error as Error).message);
  }
}

run();
