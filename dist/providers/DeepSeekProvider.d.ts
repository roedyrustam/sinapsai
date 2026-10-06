import type { ProviderConfig, UnifiedApiRequest, UnifiedApiResponse, UnifiedApiStreamChunk } from '../types/index.js';
import type { Provider } from './Provider.js';
export declare class DeepSeekProvider implements Provider {
    id: string;
    name: string;
    private config;
    constructor(config: ProviderConfig);
    get costPer1kTokens(): number | undefined;
    get promptCostPer1k(): number | undefined;
    get completionCostPer1k(): number | undefined;
    get retries(): number | undefined;
    get retryDelayMs(): number | undefined;
    resolveModel(model: string): string;
    formatRequest(request: UnifiedApiRequest): any;
    formatResponse(data: any): UnifiedApiResponse;
    generateContent(request: UnifiedApiRequest): Promise<UnifiedApiResponse | AsyncIterable<UnifiedApiStreamChunk>>;
}
//# sourceMappingURL=DeepSeekProvider.d.ts.map