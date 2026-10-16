/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */
import type { BatchItemResult, BatchOptions, BatchResult } from '../types/index.js';
export declare class BatchExecutionError<T> extends Error {
    readonly results: BatchItemResult<T>[];
    readonly cause?: Error;
    constructor(message: string, results: BatchItemResult<T>[], cause?: Error);
}
/**
 * Executes an array of items concurrently through an async handler function
 * with configurable concurrency limits, fail-soft or fail-fast semantics,
 * progress tracking, and abort signal support.
 */
export declare function executeBatch<TReq, TRes>(items: TReq[], handler: (item: TReq, index: number) => Promise<TRes>, options?: BatchOptions): Promise<BatchResult<TRes>>;
//# sourceMappingURL=BatchExecutor.d.ts.map