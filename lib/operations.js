import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
const MAX_OPERATIONS = 100;
function cleanText(value, limit) {
    if (typeof value !== 'string')
        return '';
    return value.replace(/(?:sk-|Bearer\s+)[A-Za-z0-9._-]{12,}/gi, '[已隐藏]').slice(0, limit);
}
function normalize(value) {
    if (!value || typeof value !== 'object')
        return undefined;
    const row = value;
    if (typeof row.id !== 'string' || typeof row.startedAt !== 'number')
        return undefined;
    const state = row.state === 'ok' || row.state === 'error' ? row.state : 'running';
    return {
        id: cleanText(row.id, 120),
        label: cleanText(row.label, 200) || '操作',
        state,
        detail: cleanText(row.detail, 500) || undefined,
        startedAt: row.startedAt,
        finishedAt: typeof row.finishedAt === 'number' ? row.finishedAt : undefined,
    };
}
export class OperationStore {
    file;
    current = [];
    loaded = false;
    loading;
    constructor(dshHome) {
        this.file = join(dshHome, 'plugin-panel', 'operations.json');
    }
    async load() {
        if (this.loaded)
            return this.get();
        if (!this.loading)
            this.loading = (async () => {
                try {
                    const parsed = JSON.parse(await readFile(this.file, 'utf8'));
                    const now = Date.now();
                    this.current = (Array.isArray(parsed) ? parsed : []).map(normalize).filter((x) => !!x)
                        .map((op) => op.state === 'running' ? { ...op, state: 'error', detail: '上次运行被中断', finishedAt: now } : op)
                        .sort((a, b) => b.startedAt - a.startedAt).slice(0, MAX_OPERATIONS);
                    await this.write();
                }
                catch {
                    this.current = [];
                }
                this.loaded = true;
            })();
        await this.loading;
        return this.get();
    }
    get() { return structuredClone(this.current); }
    async upsert(value) {
        await this.load();
        const op = normalize(value);
        if (!op)
            throw new Error('invalid operation');
        this.current = [op, ...this.current.filter((x) => x.id !== op.id)]
            .sort((a, b) => b.startedAt - a.startedAt).slice(0, MAX_OPERATIONS);
        await this.write();
        return this.get();
    }
    async clear() {
        await this.load();
        this.current = [];
        await this.write();
    }
    async write() {
        await mkdir(dirname(this.file), { recursive: true });
        const tmp = `${this.file}.tmp`;
        await writeFile(tmp, JSON.stringify(this.current, null, 2), { encoding: 'utf8', mode: 0o600 });
        await rename(tmp, this.file);
        if (process.platform !== 'win32')
            await chmod(this.file, 0o600);
    }
}
