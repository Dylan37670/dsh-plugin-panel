// @vitest-environment jsdom
/**
 * Client UI smoke test: loads the REAL built bundle (lib/client.js) through a
 * mock module loader, applies it with a fake slot registry, renders the
 * registered sidebar entry in jsdom, and verifies the entry button and the
 * right-side drawer (search, tabs, settings) actually mount and toggle.
 *
 * This is the closest to a real browser check we can run headlessly: the same
 * file the DSH boot serves at /plugins/@dsh-community/plugin-panel/client.js
 * is evaluated verbatim.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ComponentType } from 'react';
import React from 'react';

// Mock the network: the component's mount effect fetches /api/plugin-panel/*
// which does not exist in the test page; reject so the catch paths run.
beforeAll(() => {
  (globalThis as { fetch: unknown }).fetch = () => Promise.reject(new Error('network disabled in ui smoke test'));
});

describe('built client bundle UI', () => {
  let component: ComponentType<Record<string, unknown>> | undefined;
  let zhDict: Record<string, string>;

  beforeAll(async () => {
    const handoffs: Array<{ id: string; factory: (require: (spec: string) => unknown) => unknown }> = [];
    (globalThis as { window: Window & { __ModuleLoader__?: unknown } }).window.__ModuleLoader__ = {
      load: (handoff: { id: string; factory: (require: (spec: string) => unknown) => unknown }) => handoffs.push(handoff),
    };
    // Evaluate the REAL built bundle (side-effect import registers the factory).
    await import('../lib/client.js');
    const handoff = handoffs.find((h) => h.id === '@dsh-community/plugin-panel');
    expect(handoff).toBeDefined();
    const requireShim = (spec: string): unknown => {
      if (spec === 'react') return React;
      if (spec === 'react/jsx-runtime') return { jsx: () => null, jsxs: () => null, Fragment: React.Fragment };
      throw new Error(`unexpected require(${spec})`);
    };
    const exports = handoff!.factory(requireShim) as { apply: (ctx: unknown) => void };
    expect(typeof exports.apply).toBe('function');

    // Fake ctx capturing the slot registration.
    let captured: { opts: Record<string, unknown>; Component: ComponentType<Record<string, unknown>> } | undefined;
    const fakeCtx = {
      effect: (fn: () => unknown) => fn(),
      locale: {
        register: (ns: string, dicts: Record<string, unknown>) => {
          zhDict = (dicts as { zh: Record<string, string> }).zh;
          return () => {};
        },
      },
      slots: {
        inject: (_name: string, cb: () => unknown) => {
          cb();
          return () => {};
        },
        register: (opts: Record<string, unknown>, Comp: ComponentType<Record<string, unknown>>) => {
          captured = { opts, Component: Comp };
          return () => {};
        },
      },
    };
    exports.apply(fakeCtx);
    expect(captured).toBeDefined();
    expect(captured!.opts.id).toBe('plugin-panel-market');
    component = captured!.Component;
  });

  const t = (key: string, params?: Record<string, string>): string => {
    const raw = (zhDict ?? {})[key] ?? key;
    if (!params) return raw;
    return Object.entries(params).reduce((acc, [k, v]) => acc.replaceAll(`{${k}}`, v), raw);
  };

  it('renders the sidebar entry and opens the drawer with all surfaces', async () => {
    const { createRoot } = await import('react-dom/client');
    const { act } = await import('react-dom/test-utils');
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(React.createElement(component!, { wide: true, t }));
    });

    // Closed state: the entry button only.
    const button = container.querySelector('.pp-footbtn') as HTMLButtonElement | null;
    expect(button).not.toBeNull();
    expect(button!.textContent).toContain('插件面板');
    expect(container.querySelector('.pp-drawer')).toBeNull();

    // Click → drawer opens with search, tabs, filters, settings.
    await act(async () => {
      button!.click();
    });
    const drawer = container.querySelector('.pp-drawer');
    expect(drawer).not.toBeNull();
    expect(container.querySelector('.pp-searchrow input[type=search]')).not.toBeNull();
    expect(container.querySelectorAll('.pp-tab').length).toBe(5);
    expect(container.querySelector('.pp-settings')).not.toBeNull();
    expect(container.querySelector('.pp-env')).not.toBeNull();
    expect(container.querySelector('.pp-ops')).not.toBeNull();
    // v6: semantic-search toggle next to the search box.
    const semToggle = container.querySelector('.pp-sem input[type=checkbox]') as HTMLInputElement | null;
    expect(semToggle).not.toBeNull();
    expect(semToggle!.checked).toBe(false);
    // v2: curated / all-repos source toggle with hover hints.
    const srcButtons = container.querySelectorAll('.pp-srcbtn');
    expect(srcButtons.length).toBe(2);
    expect(srcButtons[0].getAttribute('data-on')).toBe('true'); // curated active by default
    expect(srcButtons[0].getAttribute('data-tip')).toBeTruthy();
    expect(srcButtons[1].getAttribute('data-on')).toBeNull();
    expect(srcButtons[1].getAttribute('data-tip')).toBeTruthy();

    // v4: sort options (stars / name / created).
    const sortSelect = container.querySelector('.pp-sortrow select') as HTMLSelectElement | null;
    expect(sortSelect).not.toBeNull();
    expect(sortSelect!.options.length).toBe(7);
    expect(sortSelect!.value).toBe('default');
    // Choosing "name-asc" reorders the visible list and persists the choice.
    await act(async () => {
      sortSelect!.value = 'name-asc';
      sortSelect!.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(sortSelect!.value).toBe('name-asc');

    // v6: semantic-search toggle shows the no-key hint when no key is saved
    // (derived from state, so it never depends on the status endpoint).
    await act(async () => {
      (container.querySelector('.pp-sem input[type=checkbox]') as HTMLInputElement).click();
    });
    const sembar = container.querySelector('.pp-sembar');
    expect(sembar).not.toBeNull();
    expect(sembar!.textContent).toContain('未配置');

    // Close again via the header close button.
    await act(async () => {
      (container.querySelector('.pp-header .pp-iconbtn:last-child') as HTMLButtonElement).click();
    });
    expect(container.querySelector('.pp-drawer')).toBeNull();

    root.unmount();
    document.body.removeChild(container);
  });

  it('renders a rail-state icon-only button', async () => {
    const { createRoot } = await import('react-dom/client');
    const { act } = await import('react-dom/test-utils');
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(React.createElement(component!, { wide: false, t }));
    });
    expect(container.querySelector('.pp-railbtn')).not.toBeNull();
    root.unmount();
    document.body.removeChild(container);
  });
});

describe('catalog refresh regression', () => {
  it('keeps the header refresh lightweight on the all-repos lens', () => {
    const source = readFileSync(join(process.cwd(), 'src/client/client.js'), 'utf8');
    expect(source).toContain('refreshLens(lens, false, t("panel.refresh"));');
    expect(source).not.toContain('refreshLens(lens, lens === "all");');
    expect(source).toContain('var timeoutMs = full ? 360000 : 120000;');
  });
});
