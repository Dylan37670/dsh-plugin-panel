import type { OperationView } from './types.ts';
export declare class OperationStore {
    readonly file: string;
    private current;
    private loaded;
    private loading?;
    constructor(dshHome: string);
    load(): Promise<OperationView[]>;
    get(): OperationView[];
    upsert(value: unknown): Promise<OperationView[]>;
    clear(): Promise<void>;
    private write;
}
