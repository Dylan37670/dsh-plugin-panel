/**
 * Shared JSON wire types for the Plugin Panel (host ↔ client).
 *
 * Everything crossing the HTTP boundary must be plain JSON. Keep this module
 * free of Node and Cordis imports so it stays trivially testable and safe to
 * share with the hand-written client bundle.
 */
export const CATEGORY_LABELS = {
    plugin: '插件',
    skill: 'Skill',
    client: '客户端',
    'dev-resource': '开发资源',
};
export const CATEGORY_ORDER = ['plugin', 'skill', 'client', 'dev-resource'];
export const DEFAULT_EMBEDDING = {
    enabled: false,
    provider: '硅基流动',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'BAAI/bge-m3',
    apiKey: '',
};
export const DEFAULT_STATE = {
    favorites: [],
    settings: {
        profile: 'web',
        remoteCatalogUrl: '',
        descriptionLang: 'auto',
        catalogSource: 'curated',
        sort: 'default',
        embedding: DEFAULT_EMBEDDING,
    },
};
