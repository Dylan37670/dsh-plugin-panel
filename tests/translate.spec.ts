import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseTranslationReply, chunkText, TranslationStore, translateBatch, type LlmLike } from '../src/translate.ts';

describe('parseTranslationReply', () => {
  it('parses numbered title ||| description lines', () => {
    const reply = '1: 测试插件 ||| 这是一个描述。\n2: 另一个 ||| 描述二\n3: 只有标题 |||';
    const parsed = parseTranslationReply(reply);
    expect(parsed.get(0)).toEqual(['测试插件', '这是一个描述。']);
    expect(parsed.get(1)).toEqual(['另一个', '描述二']);
    expect(parsed.get(2)).toEqual(['只有标题', '']);
  });

  it('tolerates markdown code fences and noise', () => {
    const reply = '```\n1: 甲 ||| 乙\n\nnoise line\n2: 丙 ||| 丁\n```';
    const parsed = parseTranslationReply(reply);
    expect(parsed.get(0)).toEqual(['甲', '乙']);
    expect(parsed.get(1)).toEqual(['丙', '丁']);
  });

  it('parses JSON arrays and JSONL without fragile delimiters', () => {
    const array = parseTranslationReply('[{"index":1,"titleZh":"工具","descriptionZh":"中文描述"}]');
    expect(array.get(0)).toEqual(['工具', '中文描述']);
    const lines = parseTranslationReply('{"index":1,"titleZh":"甲","descriptionZh":"乙"}\n{"index":2,"titleZh":"丙","descriptionZh":"丁"}');
    expect(lines.get(0)).toEqual(['甲', '乙']);
    expect(lines.get(1)).toEqual(['丙', '丁']);
  });
});

describe('chunkText', () => {
  it('extracts text from plain and delta chunks', () => {
    expect(chunkText({ type: 'delta', text: 'hi' })).toBe('hi');
    expect(chunkText({ delta: { text: 'yo' } })).toBe('yo');
    expect(chunkText({ type: 'done' })).toBe('');
    expect(chunkText('plain')).toBe('plain');
  });

  it('extracts DSH text-delta and nested content events', () => {
    expect(chunkText({ type: 'text-delta', delta: '你好' })).toBe('你好');
    expect(chunkText({ type: 'reasoning-delta', delta: 'hidden' })).toBe('');
    expect(chunkText({ content: [{ type: 'text', text: '甲' }, { type: 'text', text: '乙' }] })).toBe('甲乙');
    expect(chunkText({ message: { content: '完成' } })).toBe('完成');
  });
});

describe('TranslationStore', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pp-tr-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('persists and partitions cached vs missing', async () => {
    const store = new TranslationStore(dir);
    await store.load();
    await store.setMany(
      [{ id: 'a/b', title: 'A', description: 'B' }],
      [{ id: 'a/b', titleZh: '甲', descriptionZh: '乙' }],
    );
    const store2 = new TranslationStore(dir);
    await store2.load();
    const { cached, missing } = store2.partition([
      { id: 'a/b', title: 'A', description: 'B' },
      { id: 'c/d', title: 'C', description: 'D' },
    ]);
    expect(cached.map((c) => c.id)).toEqual(['a/b']);
    expect(missing.map((m) => m.id)).toEqual(['c/d']);
  });

  it('invalidates a cached translation when its source text changes', async () => {
    const store = new TranslationStore(dir);
    await store.load();
    await store.setMany(
      [{ id: 'a', title: 'A', description: 'Old text' }],
      [{ id: 'a', titleZh: '甲', descriptionZh: '旧文本' }],
    );
    expect(store.partition([{ id: 'a', title: 'A', description: 'New text' }]).missing).toHaveLength(1);
  });
});

describe('translateBatch', () => {
  it('serves cached items without calling the LLM', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pp-tr2-'));
    try {
      const store = new TranslationStore(dir);
      await store.load();
      await store.setMany(
        [{ id: 'x/y', title: 'X', description: 'Y' }],
        [{ id: 'x/y', titleZh: '中', descriptionZh: '文' }],
      );
      let calls = 0;
      const llm: LlmLike = {
        stream: async function* () {
          calls += 1;
          yield { text: '1: 新 ||| 新描述' };
        },
      };
      const results = await translateBatch({ llm, route: { provider: 'p', model: 'm' } }, store, [
        { id: 'x/y', title: 'X', description: 'Y' },
      ]);
      expect(calls).toBe(0); // fully cached → no LLM call
      expect(results[0].titleZh).toBe('中');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('translates missing items through the LLM and caches them', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pp-tr3-'));
    try {
      const store = new TranslationStore(dir);
      await store.load();
      const llm: LlmLike = {
        stream: async function* () {
          yield { text: '1: 插件甲 ||| 描述甲。\n2: 插件乙 ||| 描述乙。' };
        },
      };
      const results = await translateBatch({ llm, route: { provider: 'p', model: 'm' } }, store, [
        { id: 'a', title: 'A', description: 'D1' },
        { id: 'b', title: 'B', description: 'D2' },
      ]);
      expect(results.length).toBe(2);
      expect(results[0].titleZh).toBe('插件甲');
      expect(results[1].descriptionZh).toBe('描述乙。');
      // Cached on disk: a second store sees them.
      const store2 = new TranslationStore(dir);
      await store2.load();
      expect(store2.get('a')?.titleZh).toBe('插件甲');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('translates AI-SDK-style text-delta streams used by DSH', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pp-tr4-'));
    try {
      const store = new TranslationStore(dir);
      await store.load();
      const llm: LlmLike = {
        stream: async function* () {
          yield { type: 'text-delta', delta: '1: 图片工具' };
          yield { type: 'text-delta', delta: ' ||| 创建和编辑图片。' };
        },
      };
      const results = await translateBatch({ llm, route: { provider: 'p', model: 'm' } }, store, [
        { id: 'image', title: 'Image toolkit', description: 'Create images.' },
      ]);
      expect(results).toEqual([{ id: 'image', titleZh: '图片工具', descriptionZh: '创建和编辑图片。' }]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('retries only entries omitted by a partial LLM reply', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pp-tr5-'));
    try {
      const store = new TranslationStore(dir);
      await store.load();
      let calls = 0;
      const llm: LlmLike = {
        stream: async function* () {
          calls += 1;
          if (calls === 1) yield '{"index":1,"titleZh":"甲","descriptionZh":"描述甲"}';
          else yield '{"index":1,"titleZh":"乙","descriptionZh":"描述乙"}';
        },
      };
      const results = await translateBatch({ llm, route: { provider: 'p', model: 'm' } }, store, [
        { id: 'a', title: 'A', description: 'First description' },
        { id: 'b', title: 'B', description: 'Second description' },
      ]);
      expect(calls).toBe(2);
      expect(results.map((item) => item.id)).toEqual(['a', 'b']);
      expect(results[1].descriptionZh).toBe('描述乙');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('falls back per item when no Harness model route is available', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pp-tr6-'));
    try {
      const store = new TranslationStore(dir);
      await store.load();
      const fakeFetch = (async () => ({
        ok: true,
        json: async () => [[['创建和编辑图片。']]],
      })) as unknown as typeof fetch;
      const results = await translateBatch({ fetch: fakeFetch }, store, [
        { id: 'image', title: 'Image toolkit', description: 'Create and edit images.' },
      ]);
      expect(results).toEqual([{ id: 'image', titleZh: 'Image toolkit', descriptionZh: '创建和编辑图片。' }]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
