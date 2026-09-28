export interface StateStorage {
    get<T>(key: string): Promise<T | null>;
    set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
    delete(key: string): Promise<void>;
    increment(key: string): Promise<number>;
}
//# sourceMappingURL=StateStorage.d.ts.map