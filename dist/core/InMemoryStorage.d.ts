import type { StateStorage } from './StateStorage.js';
export declare class InMemoryStorage implements StateStorage {
    private store;
    private sweepInterval?;
    constructor(sweepIntervalMs?: number);
    private sweep;
    get<T>(key: string): Promise<T | null>;
    set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
    delete(key: string): Promise<void>;
    increment(key: string): Promise<number>;
    destroy(): void;
}
//# sourceMappingURL=InMemoryStorage.d.ts.map