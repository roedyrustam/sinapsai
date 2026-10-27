/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */
import type { StateStorage } from './StateStorage.js';
export interface InMemoryStorageOptions {
    sweepIntervalMs?: number;
    autoSweep?: boolean;
}
export declare class InMemoryStorage implements StateStorage {
    private store;
    private sweepInterval?;
    constructor(options?: number | InMemoryStorageOptions);
    private sweep;
    get<T>(key: string): Promise<T | null>;
    set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
    delete(key: string): Promise<void>;
    increment(key: string, ttlSeconds?: number): Promise<number>;
    clear(): Promise<void>;
    destroy(): void;
}
//# sourceMappingURL=InMemoryStorage.d.ts.map