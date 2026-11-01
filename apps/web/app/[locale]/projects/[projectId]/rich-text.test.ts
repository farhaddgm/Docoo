import { describe, expect, it } from 'vitest';

import { parseInline, parseRichText } from './rich-text';

describe('parseInline', () => {
  it('splits bold text and web addresses, nothing else', () => {
    expect(parseInline('a **b** https://x.example/p?q=1, c')).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'bold', text: 'b' },
      { kind: 'text', text: ' ' },
      { kind: 'link', text: 'https://x.example/p?q=1' },
      { kind: 'text', text: ', c' },
    ]);
    expect(parseInline('javascript:alert(1)')).toEqual([
      { kind: 'text', text: 'javascript:alert(1)' },
    ]);
    expect(parseInline('<b>x</b>')).toEqual([{ kind: 'text', text: '<b>x</b>' }]);
  });
});

describe('parseRichText', () => {
  it('reads headings, bullet lists and numbered lists, with Persian digits too', () => {
    const blocks = parseRichText('## سارا\nمتن\n- یک\n- دو\n\n۱. الف\n2) ب');
    expect(blocks.map((block) => block.type)).toEqual(['heading', 'paragraph', 'list', 'list']);
    expect(blocks[2]).toMatchObject({ ordered: false });
    expect(blocks[3]).toMatchObject({ ordered: true });
    expect(blocks[3]).toMatchObject({ items: [expect.any(Array), expect.any(Array)] });
  });

  it('keeps each written line as its own paragraph', () => {
    const blocks = parseRichText('**الف:** یک\n**ب:** دو');
    expect(blocks).toHaveLength(2);
  });

  it('does not take a year or decimal at the start of a sentence for a list', () => {
    expect(parseRichText('۱۴۰۲ سال خوبی بود.')[0]).toMatchObject({ type: 'paragraph' });
    expect(parseRichText('3.5 درصد رشد')[0]).toMatchObject({ type: 'paragraph' });
  });

  it('breaks a long run of sentences into short paragraphs', () => {
    const sentence = 'این یک جمله نسبتا بلند برای آزمون است و باید کوتاه‌تر نمایش داده شود.';
    const blocks = parseRichText(Array.from({ length: 6 }, () => sentence).join(' '));
    expect(blocks.length).toBeGreaterThan(1);
    expect(blocks.every((block) => block.type === 'paragraph')).toBe(true);
  });

  it('pairs each question with its answer', () => {
    const text =
      'سقف وام چقدر است؟ تا ۵۰۰ میلیون تومان برای حقوق‌بگیران و کارمندان رسمی کشور. زمان واریز چقدر است؟ معمولا کمتر از ۱۰ دقیقه پس از تأیید نهایی. آیا ضامن لازم است؟ خیر، هیچ ضامنی لازم نیست و همه‌چیز آنلاین است.';
    const blocks = parseRichText(text);
    expect(blocks).toHaveLength(3);
    expect(blocks.every((block) => block.type === 'question')).toBe(true);
  });

  it('leaves a short text alone', () => {
    expect(parseRichText('کوتاه. است.')).toHaveLength(1);
    expect(parseRichText('')).toEqual([]);
  });
});
