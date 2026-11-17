import { describe, expect, it } from 'vitest';
import {
  findFigures,
  findQuoteSpan,
  fold,
  groundIntake,
  highlightSegments,
  intakeModelSchema,
  type IntakeModelOutput,
} from './intake.js';

const transcript =
  'ما یک فروشگاه آنلاین داریم. فروش ماه گذشته ۱۲ درصد کم شده و بودجه‌ی تبلیغات ما دو میلیارد و پانصد میلیون تومان است. مدیر فروش، آقای کریمی، می‌گوید رقبا قیمت را کم کرده‌اند. باید تا ۳۰ آذر نتیجه بگیریم.';

describe('quotes in a transcript', () => {
  it('finds a quote with Arabic letters, other digits and different spacing', () => {
    const span = findQuoteSpan(transcript, 'فروش ماه گذشته 12 درصد  كم شده');
    expect(span).not.toBeNull();
    expect(transcript.slice(span!.start, span!.end)).toBe('فروش ماه گذشته ۱۲ درصد کم شده');
  });
  it('does not find words that were never said, or a quote that is too short', () => {
    expect(findQuoteSpan(transcript, 'مشتریان ناراضی هستند')).toBeNull();
    expect(findQuoteSpan(transcript, 'یک')).toBeNull();
  });
  it('folds without changing the length, so positions stay valid', () => {
    expect(fold(transcript)).toHaveLength(transcript.length);
  });
});

describe('hostile input', () => {
  it('stays fast on long runs of punctuation in quotes, transcripts and figures', () => {
    const noise = '!'.repeat(50_000) + ','.repeat(50_000);
    const started = Date.now();
    expect(findQuoteSpan(`${noise} سلام دنیا ${noise}`, `سلام دنیا${noise}`)).not.toBeNull();
    expect(findQuoteSpan(noise, `${noise} کلمه`)).toBeNull();
    findFigures(`۱۲${','.repeat(50_000)} ${'٬'.repeat(50_000)}x`);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe('figures found by code', () => {
  it('finds digits, percentages and number words with their unit', () => {
    const figures = findFigures(transcript);
    const texts = figures.map((f) => f.text);
    expect(texts).toContain('۱۲ درصد');
    expect(texts).toContain('دو میلیارد و پانصد میلیون تومان');
    expect(texts).toContain('۳۰');
    expect(figures.find((f) => f.text.startsWith('دو میلیارد'))?.kind).toBe('money');
    expect(figures.find((f) => f.text === '۱۲ درصد')?.kind).toBe('percent');
  });
  it('ignores a lone small word in ordinary speech', () => {
    expect(findFigures('ما یک فروشگاه داریم و سه نفر کار می‌کنند')).toEqual([]);
  });
  it('reports spans that cut the transcript back out exactly', () => {
    for (const figure of findFigures(transcript)) {
      expect(transcript.slice(figure.span.start, figure.span.end)).toBe(figure.text);
    }
  });
});

const output = (over: Partial<IntakeModelOutput> = {}): IntakeModelOutput =>
  intakeModelSchema.parse({
    title: 'افت فروش',
    problem: 'فروش کم شده است.',
    description: '',
    goal: { text: 'نتیجه تا ۳۰ آذر', quote: 'باید تا ۳۰ آذر نتیجه بگیریم' },
    facts: [
      { text: 'فروش ۱۲ درصد افت کرده', quote: 'فروش ماه گذشته ۱۲ درصد کم شده' },
      { text: 'مشتریان ناراضی‌اند', quote: 'مشتریان از کیفیت ناراضی هستند' },
    ],
    constraints: [{ text: 'بودجه ۲٫۵ میلیارد تومان', quote: 'دو میلیارد و پانصد میلیون تومان' }],
    names: [{ text: 'آقای کریمی', quote: 'آقای کریمی' }],
    assumptions: [{ text: 'افت فروش به قیمت رقبا مربوط است' }],
    missing: ['افت در کدام محصولات بوده است؟'],
    ...over,
  });

describe('groundIntake', () => {
  it('keeps what was said, drops what was not, and labels the rest as assumptions', () => {
    const draft = groundIntake(output(), transcript);
    expect(draft.facts.map((f) => f.text)).toEqual(['فروش ۱۲ درصد افت کرده']);
    expect(draft.dropped).toBe(1);
    expect(draft.goal?.text).toBe('نتیجه تا ۳۰ آذر');
    expect(draft.constraints).toHaveLength(1);
    expect(draft.names[0]?.quote).toBe('آقای کریمی');
    expect(draft.assumptions).toEqual([{ text: 'افت فروش به قیمت رقبا مربوط است' }]);
    expect(draft.missing).toEqual(['افت در کدام محصولات بوده است؟']);
    expect(draft.figures.length).toBeGreaterThan(0);
  });
  it('rejects model output outside the contract', () => {
    expect(() => intakeModelSchema.parse({ title: 'x' })).toThrow();
    expect(() => intakeModelSchema.parse({ ...output(), extra: 1 })).toThrow();
  });
});

describe('highlighting', () => {
  it('cuts the transcript into pieces that join back to it, with figures and names marked once', () => {
    const draft = groundIntake(output(), transcript);
    const segments = highlightSegments(transcript, draft.figures, draft.names);
    expect(segments.map((s) => s.text).join('')).toBe(transcript);
    expect(segments.filter((s) => s.mark === 'name').map((s) => s.text)).toEqual(['آقای کریمی']);
    expect(segments.some((s) => s.mark === 'figure' && s.text === '۱۲ درصد')).toBe(true);
  });
});
