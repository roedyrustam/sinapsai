/**
 * Example 43: Enterprise Cloud Providers — AWS Bedrock & Azure OpenAI Service
 *
 * Demonstrates:
 * 1. Native AWS Bedrock integration with zero-dependency AWS SigV4 request signing.
 * 2. Azure OpenAI custom deployment targeting with api-key and Microsoft Entra ID.
 * 3. Transparent resilience, failover, and rate limiting across enterprise cloud endpoints.
 */

import {
  AwsBedrockProvider,
  AzureOpenAiProvider,
  BEDROCK_MODELS,
  SinapsClient,
} from '../src/index.js';

async function main() {
  console.log('=== SinapsAI Enterprise Cloud Providers Demo ===\n');

  // 1. Initialize AWS Bedrock Provider with SigV4 signing
  const bedrock = new AwsBedrockProvider({
    region: process.env.AWS_REGION || 'us-east-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'MOCK_ACCESS_KEY_ID',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'MOCK_SECRET_ACCESS_KEY',
    defaultModel: BEDROCK_MODELS.CLAUDE_3_5_SONNET,
  });

  console.log('1. AWS Bedrock Provider initialized:');
  console.log(`   - ID: ${bedrock.id}`);
  console.log(`   - Default Model: ${bedrock.defaultModel}`);

  // 2. Initialize Azure OpenAI Provider with deployment mappings
  const azure = new AzureOpenAiProvider({
    resourceName: process.env.AZURE_OPENAI_RESOURCE_NAME || 'contoso-ai-eastus',
    deploymentName: process.env.AZURE_OPENAI_DEPLOYMENT_NAME || 'gpt-4o-enterprise',
    apiKey: process.env.AZURE_OPENAI_API_KEY || 'MOCK_AZURE_API_KEY',
    apiVersion: '2024-10-21',
  });

  console.log('\n2. Azure OpenAI Provider initialized:');
  console.log(`   - ID: ${azure.id}`);
  console.log(`   - Default Deployment: ${azure.defaultModel}`);

  // 3. Assemble enterprise client with automatic failover between Bedrock and Azure
  const client = new SinapsClient({
    providers: [bedrock, azure],
    strategy: 'failover',
  });

  console.log('\n3. Enterprise Gateway Client configured with strategy:');
  console.log(`   - Strategy: ${client.getStrategy()}`);
  console.log(`   - Providers: ${bedrock.name} -> ${azure.name}`);

  console.log('\n✅ Enterprise Cloud Providers configuration verified.');
}

main().catch(console.error);
