import { describe, expect, it } from 'bun:test';
import {
  DeadClickJudge,
  RageDetector,
  buildSelector,
  isFormControl,
  scrollDepthPercent,
  type ElementLike,
} from '../src/interactions';
import { CAPS } from '../src/wire';

describe('rage click rule', () => {
  it('third click within 1 s inside 30 px is rage, and so is every later one', () => {
    const r = new RageDetector();
    expect(r.isRage(0, 100, 100)).toBe(false);
    expect(r.isRage(200, 110, 105)).toBe(false);
    expect(r.isRage(400, 95, 120)).toBe(true);
    expect(r.isRage(600, 100, 100)).toBe(true);
  });

  it('clicks spread beyond 30 px do not count', () => {
    const r = new RageDetector();
    r.isRage(0, 0, 0);
    r.isRage(100, 100, 0);
    expect(r.isRage(200, 200, 0)).toBe(false);
  });

  it('clicks older than 1 s do not count', () => {
    const r = new RageDetector();
    r.isRage(0, 10, 10);
    r.isRage(500, 10, 10);
    expect(r.isRage(1200, 10, 10)).toBe(false);
  });

  it('radius is measured from the current click', () => {
    const r = new RageDetector();
    r.isRage(0, 0, 0);
    r.isRage(100, 25, 0);
    expect(r.isRage(200, 50, 0)).toBe(false);
  });
});

describe('dead click rule', () => {
  it('a click with no activity in 1 s is dead', () => {
    const j = new DeadClickJudge<string>();
    j.add(1000, 'a', true);
    expect(j.drain(1999)).toEqual([]);
    expect(j.drain(2000)).toEqual([{ payload: 'a', dead: true }]);
  });

  it('a mutation, scroll or navigation within 1 s keeps it alive', () => {
    const j = new DeadClickJudge<string>();
    j.add(1000, 'a', true);
    j.activity(1800);
    expect(j.drain(2000)).toEqual([{ payload: 'a', dead: false }]);
  });

  it('activity after the window or before the click does not count', () => {
    const j = new DeadClickJudge<string>();
    j.add(1000, 'a', true);
    j.activity(999);
    j.activity(2001);
    expect(j.drain(2001)).toEqual([{ payload: 'a', dead: true }]);
  });

  it('form controls are never dead', () => {
    const j = new DeadClickJudge<string>();
    j.add(0, 'input', false);
    expect(j.drain(5000)).toEqual([{ payload: 'input', dead: false }]);
  });

  it('forced drain (unload) resolves pending clicks as alive', () => {
    const j = new DeadClickJudge<string>();
    j.add(0, 'a', true);
    expect(j.drain(10, true)).toEqual([{ payload: 'a', dead: false }]);
    expect(j.size).toBe(0);
  });
});

function el(
  tagName: string,
  opts: { id?: string; classes?: string[]; attrs?: Record<string, string> } = {},
  parent: ElementLike | null = null,
): ElementLike & { children: ElementLike[] } {
  const node = {
    tagName: tagName.toUpperCase(),
    id: opts.id ?? '',
    classList: opts.classes ?? [],
    parentElement: parent,
    previousElementSibling: null as ElementLike | null,
    nextElementSibling: null as ElementLike | null,
    children: [] as ElementLike[],
    getAttribute: (n: string) => opts.attrs?.[n] ?? null,
  };
  if (parent) {
    const siblings = (parent as unknown as { children: ElementLike[] }).children;
    const prev = siblings[siblings.length - 1];
    if (prev) {
      prev.nextElementSibling = node;
      node.previousElementSibling = prev;
    }
    siblings.push(node);
  }
  return node;
}

describe('selector building', () => {
  it('builds a structural selector with nth-of-type for ambiguous siblings', () => {
    const body = el('body');
    const main = el('main', { classes: ['content', 'wide', 'third'] }, body);
    el('button', {}, main);
    const btn = el('button', { classes: ['cta', '123bad'] }, main);
    expect(buildSelector(btn)).toBe('body > main.content.wide > button.cta:nth-of-type(2)');
  });

  it('stops at an id', () => {
    const body = el('body');
    const app = el('div', { id: 'app' }, body);
    const a = el('a', {}, app);
    expect(buildSelector(a)).toBe('div#app > a');
  });

  it('never includes text or attribute values other than id/class', () => {
    const body = el('body');
    const a = el('a', { attrs: { href: '/secret?x', title: 'Alice' } }, body);
    expect(buildSelector(a)).toBe('body > a');
  });

  it('is capped at 512 chars', () => {
    let parent: ElementLike = el('body');
    for (let i = 0; i < 10; i++) parent = el('div', { classes: ['c'.repeat(200), 'd'.repeat(200)] }, parent);
    expect(buildSelector(parent).length).toBeLessThanOrEqual(CAPS.sel);
  });

  it('handles a null target', () => {
    expect(buildSelector(null)).toBe('');
  });
});

describe('form controls', () => {
  it('value-entry controls and their descendants are form controls; buttons are not', () => {
    expect(isFormControl(el('input', { attrs: { type: 'text' } }))).toBe(true);
    expect(isFormControl(el('input', { attrs: { type: 'submit' } }))).toBe(false);
    expect(isFormControl(el('textarea'))).toBe(true);
    expect(isFormControl(el('select'))).toBe(true);
    expect(isFormControl(el('span', {}, el('label')))).toBe(true);
    expect(isFormControl(el('div', { attrs: { contenteditable: 'true' } }))).toBe(true);
    expect(isFormControl(el('button'))).toBe(false);
    expect(isFormControl(el('div'))).toBe(false);
  });
});

describe('scroll depth', () => {
  it('is the percentage of the document seen', () => {
    expect(scrollDepthPercent(0, 500, 2000)).toBe(25);
    expect(scrollDepthPercent(1500, 500, 2000)).toBe(100);
    expect(scrollDepthPercent(9999, 500, 2000)).toBe(100);
    expect(scrollDepthPercent(0, 800, 600)).toBe(100);
    expect(scrollDepthPercent(0, 800, 0)).toBe(100);
  });
});
