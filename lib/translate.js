/** Reliable on-demand Chinese translation with per-item recovery. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
export function userMessage(text) {
    return {
        id: `pp-tr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        role: 'user',
        content: [{ type: 'text', text }],
        source: { kind: 'user' },
    };
}
function sourceHash(item) {
    return createHash('sha256').update(`${item.title}\n${item.description}`).digest('base64url').slice(0, 22);
}
function cleanText(value) {
    return typeof value === 'string' ? value.trim().replace(/^['"]|['"]$/g, '') : '';
}
function acceptTranslation(item, titleZh, descriptionZh) {
    const title = cleanText(titleZh) || item.title;
    const description = cleanText(descriptionZh);
    if (!description && item.description.trim())
        return undefined;
    // An English description echoed verbatim is an incomplete translation.
    if (!/[\u3400-\u9fff]/u.test(item.description) && item.description.trim() === description)
        return undefined;
    const latinWords = item.description.match(/[A-Za-z]{2,}/g)?.length ?? 0;
    if (latinWords >= 3 && !/[\u3400-\u9fff]/u.test(description))
        return undefined;
    return { id: item.id, titleZh: title, descriptionZh: description || item.description };
}
/** Parse JSON/JSONL replies, with the v6.4 numbered format kept for compatibility. */
export function parseTranslationReply(reply) {
    const result = new Map();
    const parseObject = (value) => {
        if (!value || typeof value !== 'object')
            return;
        const record = value;
        for (const key of ['translations', 'results', 'items']) {
            if (Array.isArray(record[key]))
                record[key].forEach(parseObject);
        }
        const rawIndex = typeof record.index === 'number' ? record.index : Number(record.index);
        if (!Number.isInteger(rawIndex) || rawIndex < 1)
            return;
        const title = cleanText(record.titleZh ?? record.title_zh ?? record.title);
        const description = cleanText(record.descriptionZh ?? record.description_zh ?? record.description);
        if (title || description)
            result.set(rawIndex - 1, [title, description]);
    };
    const unfenced = reply.replace(/```(?:json)?\s*|```/gi, '').trim();
    try {
        const json = JSON.parse(unfenced);
        if (Array.isArray(json))
            json.forEach(parseObject);
        else
            parseObject(json);
    }
    catch {
        for (const rawLine of unfenced.split(/\r?\n/)) {
            const line = rawLine.trim();
            if (!line)
                continue;
            if (line.startsWith('{')) {
                try {
                    parseObject(JSON.parse(line));
                }
                catch { /* try legacy syntax below */ }
            }
            const match = /^(\d+)\s*[:.)]\s*(.*)$/.exec(line);
            if (!match)
                continue;
            const [titleZh, descriptionZh] = match[2].split(/\s*\|\|\|\s*/, 2);
            result.set(Number(match[1]) - 1, [cleanText(titleZh), cleanText(descriptionZh)]);
        }
    }
    return result;
}
/** Extract text from the stream shapes used by current and older DSH adapters. */
export function chunkText(chunk) {
    if (typeof chunk === 'string')
        return chunk;
    if (chunk !== null && typeof chunk === 'object') {
        const record = chunk;
        if (typeof record.text === 'string')
            return record.text;
        if (typeof record.delta === 'string') {
            const type = typeof record.type === 'string' ? record.type : '';
            return !type || /text|content/i.test(type) ? record.delta : '';
        }
        if (record.delta && typeof record.delta === 'object')
            return chunkText(record.delta);
        if (typeof record.content === 'string')
            return record.content;
        if (Array.isArray(record.content))
            return record.content.map(chunkText).join('');
        if (record.message && typeof record.message === 'object')
            return chunkText(record.message);
        if (record.part && typeof record.part === 'object')
            return chunkText(record.part);
    }
    return '';
}
export class TranslationStore {
    file;
    cache = {};
    writeChain = Promise.resolve();
    constructor(dshHome) {
        this.file = join(dshHome, 'plugin-panel', 'translations-v2.json');
    }
    async load() {
        try {
            const parsed = JSON.parse(await readFile(this.file, 'utf8'));
            this.cache = parsed ?? {};
        }
        catch {
            this.cache = {};
        }
    }
    get(id) {
        const hit = this.cache[id];
        return hit ? { id, titleZh: hit.titleZh, descriptionZh: hit.descriptionZh } : undefined;
    }
    async setMany(items, results) {
        const sources = new Map(items.map((item) => [item.id, item]));
        for (const result of results) {
            const source = sources.get(result.id);
            if (source)
                this.cache[result.id] = { ...result, sourceHash: sourceHash(source) };
        }
        this.writeChain = this.writeChain.catch(() => undefined).then(async () => {
            await mkdir(dirname(this.file), { recursive: true });
            const tmp = `${this.file}.${process.pid}.tmp`;
            await writeFile(tmp, JSON.stringify(this.cache), 'utf8');
            await rename(tmp, this.file);
        });
        await this.writeChain;
    }
    partition(items) {
        const missing = [];
        const cached = [];
        for (const item of items) {
            const hit = this.cache[item.id];
            if (hit?.sourceHash === sourceHash(item) && hit.descriptionZh) {
                cached.push({ id: item.id, titleZh: hit.titleZh, descriptionZh: hit.descriptionZh });
            }
            else {
                missing.push(item);
            }
        }
        return { missing, cached };
    }
}
const SYSTEM = [
    '你是专业的软件本地化译者。把 DSH 插件名与描述译成自然、准确、简洁的简体中文。',
    '品牌名、包名、API、MCP、CLI、模型名和代码标识保持原样；不要添加原文没有的信息。',
    '每个输入必须输出一行 JSON，不得使用 Markdown。字段严格为：index、titleZh、descriptionZh。',
].join('');
function promptFor(items) {
    return items.map((item, index) => JSON.stringify({ index: index + 1, title: item.title, description: item.description })).join('\n');
}
async function translateWithLlm(route, items, signal) {
    if (!route.llm || !route.route?.provider || !route.route?.model)
        return [];
    let reply = '';
    const stream = route.llm.stream({
        provider: route.route.provider,
        model: route.route.model,
        system: SYSTEM,
        messages: [userMessage(promptFor(items))],
        maxTokens: Math.min(4096, 640 + items.length * 320),
        temperature: 0.1,
    });
    for await (const chunk of stream) {
        if (signal?.aborted)
            throw signal.reason ?? new Error('translation aborted');
        reply += chunkText(chunk);
    }
    const parsed = parseTranslationReply(reply);
    return items.flatMap((item, index) => {
        const pair = parsed.get(index);
        const accepted = pair && acceptTranslation(item, pair[0], pair[1]);
        return accepted ? [accepted] : [];
    });
}
async function googleFallback(route, items, signal) {
    const fetcher = route.fetch ?? globalThis.fetch;
    if (!fetcher)
        return [];
    const translated = [];
    // Keep fallback traffic bounded and isolate failures per entry.
    for (let offset = 0; offset < items.length; offset += 6) {
        const batch = items.slice(offset, offset + 6);
        const settled = await Promise.all(batch.map(async (item) => {
            if (!item.description.trim())
                return { id: item.id, titleZh: item.title, descriptionZh: item.description };
            try {
                const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t&q=${encodeURIComponent(item.description)}`;
                const response = await fetcher(url, { signal });
                if (!response.ok)
                    return undefined;
                const payload = await response.json();
                if (!Array.isArray(payload) || !Array.isArray(payload[0]))
                    return undefined;
                const description = payload[0].map((part) => Array.isArray(part) && typeof part[0] === 'string' ? part[0] : '').join('');
                return acceptTranslation(item, item.title, description);
            }
            catch {
                return undefined;
            }
        }));
        translated.push(...settled.filter((value) => value !== undefined));
    }
    return translated;
}
/** Translate every requested item; partial model replies no longer drop the rest. */
export async function translateBatch(route, store, items, signal) {
    const unique = [...new Map(items.filter((item) => item?.id && typeof item.title === 'string' && typeof item.description === 'string').map((item) => [item.id, item])).values()];
    const { missing, cached } = store.partition(unique);
    const completed = new Map(cached.map((item) => [item.id, item]));
    // Smaller batches reduce truncation and malformed-output blast radius.
    for (let offset = 0; offset < missing.length; offset += 8) {
        const batch = missing.slice(offset, offset + 8);
        try {
            const first = await translateWithLlm(route, batch, signal);
            first.forEach((item) => completed.set(item.id, item));
            const incomplete = batch.filter((item) => !completed.has(item.id));
            for (const item of incomplete) {
                try {
                    const retry = await translateWithLlm(route, [item], signal);
                    retry.forEach((value) => completed.set(value.id, value));
                }
                catch (error) {
                    console.warn('[plugin-panel] translation retry failed:', error);
                }
            }
        }
        catch (error) {
            console.warn('[plugin-panel] translation batch failed:', error);
        }
    }
    const stillMissing = missing.filter((item) => !completed.has(item.id));
    if (stillMissing.length > 0 && !signal?.aborted) {
        const fallback = await googleFallback(route, stillMissing, signal);
        fallback.forEach((item) => completed.set(item.id, item));
    }
    const fresh = missing.flatMap((item) => {
        const result = completed.get(item.id);
        return result ? [result] : [];
    });
    if (fresh.length > 0)
        await store.setMany(missing, fresh);
    return unique.flatMap((item) => {
        const result = completed.get(item.id);
        return result ? [result] : [];
    });
}
