/**
 * Semantic search (v6): embed the catalog with an OpenAI-compatible embeddings
 * provider (default: SiliconFlow BAAI/bge-m3, multilingual) and rank queries
 * by cosine similarity. Vectors are cached to disk so the index is built once.
 *
 * Provider contract (OpenAI-compatible):
 *   POST {baseUrl}/embeddings
 *   { model, input: string[] }
 *   Authorization: Bearer {apiKey}
 *   → { data: [{ embedding: number[], index }] }
 */
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
/** Cosine similarity between two vectors (same length). */
export function cosine(a, b) {
    if (a.length !== b.length)
        throw new RangeError(`向量维度不一致：${a.length} != ${b.length}`);
    let dot = 0;
    let na = 0;
    let nb = 0;
    const len = a.length;
    for (let i = 0; i < len; i += 1) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    if (na === 0 || nb === 0)
        return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
/** Accept either an API base URL or a complete embeddings endpoint. */
export function embeddingEndpoint(baseUrl) {
    const base = baseUrl.trim().replace(/\/+$/, '');
    if (!base)
        throw new Error('未配置嵌入 API 地址');
    return /\/embeddings$/i.test(base) ? base : `${base}/embeddings`;
}
/** Call the provider to embed a batch of texts (≤100 per call). */
export async function embedTexts(config, texts, signal) {
    if (!config.apiKey)
        throw new Error('未配置 API Key');
    if (texts.length === 0)
        return [];
    const response = await fetch(embeddingEndpoint(config.baseUrl), {
        method: 'POST',
        signal,
        headers: {
            'content-type': 'application/json',
            Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({ model: config.model, input: texts }),
    });
    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`嵌入请求失败：HTTP ${response.status} ${detail.slice(0, 200)}`);
    }
    const body = (await response.json());
    const data = body.data ?? [];
    const result = new Array(texts.length);
    for (const [position, item] of data.entries()) {
        const index = Number.isInteger(item.index) ? item.index : position;
        if (item.embedding && index >= 0 && index < result.length)
            result[index] = item.embedding;
    }
    for (let i = 0; i < result.length; i += 1) {
        if (!result[i])
            throw new Error(`嵌入响应缺少第 ${i} 条（模型 ${config.model}）`);
        if (result[i].length === 0 || result[i].some((value) => !Number.isFinite(value))) {
            throw new Error(`嵌入响应第 ${i} 条不是有效的数值向量（模型 ${config.model}）`);
        }
    }
    return result;
}
/** Search text used for one catalog entry. */
export function entrySearchText(entry) {
    return [
        entry.title,
        entry.titleZh ?? '',
        entry.description,
        entry.descriptionZh ?? '',
        (entry.tags ?? []).join(' '),
        entry.author ?? '',
    ].join(' | ');
}
export function catalogHash(entries) {
    const hash = createHash('sha256');
    for (const entry of entries)
        hash.update(entry.id).update('\0').update(entrySearchText(entry)).update('\0');
    return hash.digest('hex');
}
/** Explain why an index cannot safely serve the current configuration. */
export function indexCompatibilityIssue(index, config, entries) {
    if (index.version !== 2)
        return '索引格式已升级';
    if (index.model !== config.model)
        return `模型已从 ${index.model} 改为 ${config.model}`;
    if (index.endpoint !== embeddingEndpoint(config.baseUrl))
        return '嵌入 API 地址已更改';
    if (index.dim <= 0)
        return '索引维度无效';
    if (index.vectors.some((record) => record.v.length !== index.dim))
        return '索引中存在维度不一致的向量';
    if (entries && index.catalogHash !== catalogHash(entries))
        return '插件目录已变化';
    return undefined;
}
/** Disk-backed vector index for the catalog (v6). */
export class VectorStore {
    file;
    index;
    constructor(dshHome) {
        this.file = join(dshHome, 'plugin-panel', 'vectors.json');
    }
    async load() {
        if (this.index)
            return this.index;
        try {
            const parsed = JSON.parse(await readFile(this.file, 'utf8'));
            if (Array.isArray(parsed.vectors)) {
                this.index = parsed;
                return parsed;
            }
        }
        catch {
            /* no index yet */
        }
        return undefined;
    }
    async save(index) {
        await mkdir(join(this.file, '..'), { recursive: true });
        const tmp = `${this.file}.tmp`;
        await writeFile(tmp, JSON.stringify(index), 'utf8');
        await rename(tmp, this.file);
        this.index = index;
    }
    get() {
        return this.index;
    }
}
/** Build/refresh the vector index for the given entries (batched). */
export async function buildIndex(config, store, entries, signal, batchSize = 100) {
    const vectors = [];
    for (let i = 0; i < entries.length; i += batchSize) {
        if (signal?.aborted)
            throw new Error('索引构建已取消');
        const batch = entries.slice(i, i + batchSize);
        const texts = batch.map(entrySearchText);
        const embedded = await embedTexts(config, texts, signal);
        const expectedDim = vectors[0]?.v.length ?? embedded[0]?.length ?? 0;
        for (let j = 0; j < batch.length; j += 1) {
            if (embedded[j].length !== expectedDim) {
                throw new Error(`嵌入维度不一致：期望 ${expectedDim}，收到 ${embedded[j].length}`);
            }
            vectors.push({ id: batch[j].id, v: embedded[j] });
        }
    }
    const index = {
        version: 2,
        model: config.model,
        provider: config.provider,
        endpoint: embeddingEndpoint(config.baseUrl),
        catalogHash: catalogHash(entries),
        builtAt: new Date().toISOString(),
        dim: vectors[0]?.v.length ?? 0,
        vectors,
    };
    await store.save(index);
    return index;
}
/** Rank entries by cosine similarity to a query (top `limit`). */
export async function semanticRank(config, store, entries, query, limit, signal) {
    const index = await store.load();
    if (!index || index.vectors.length === 0)
        throw new Error('向量索引未构建');
    const incompatibility = indexCompatibilityIssue(index, config, entries);
    if (incompatibility)
        throw new Error(`向量索引已过期（${incompatibility}），请重新构建`);
    const [queryVector] = await embedTexts(config, [query], signal);
    if (queryVector.length !== index.dim) {
        throw new Error(`查询向量维度 ${queryVector.length} 与索引维度 ${index.dim} 不一致，请重新构建索引`);
    }
    const byId = new Map(entries.map((e) => [e.id, e]));
    const scored = [];
    for (const record of index.vectors) {
        const entry = byId.get(record.id);
        if (!entry)
            continue;
        scored.push({ entry, score: cosine(queryVector, record.v) });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => s.entry);
}
