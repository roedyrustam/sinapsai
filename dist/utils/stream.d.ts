export interface SSEMessage {
    event?: string;
    data: string;
}
export declare function parseSSE(response: Response): AsyncGenerator<SSEMessage, void, unknown>;
//# sourceMappingURL=stream.d.ts.map