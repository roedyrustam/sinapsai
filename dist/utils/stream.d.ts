/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */
export interface SSEMessage {
    event?: string;
    data: string;
}
export declare function parseSSE(response: Response): AsyncGenerator<SSEMessage, void, unknown>;
//# sourceMappingURL=stream.d.ts.map