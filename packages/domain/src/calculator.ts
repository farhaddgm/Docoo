/**
 * The agents' calculator (ADR-0023): exact enough arithmetic for a model that must not do sums in
 * its head. A hand-written parser, never `eval` or `Function`: it knows numbers, the five
 * operators, parentheses, two constants and a short list of functions, and nothing else, so no
 * input can reach code, the network or the file system. Pure, so the worker and the tests share it.
 */
export const CALCULATOR_LIMITS = {
  maxLength: 300,
  maxDepth: 40,
  /** Results at or beyond this size are refused rather than shown as 1e+308. */
  maxMagnitude: 1e15,
} as const;

export type CalculatorError =
  | 'empty'
  | 'too_long'
  | 'syntax'
  | 'unknown_name'
  | 'wrong_arguments'
  | 'too_deep'
  | 'division_by_zero'
  | 'out_of_range';

export type CalculatorResult =
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly error: CalculatorError };

class Refusal extends Error {
  constructor(readonly code: CalculatorError) {
    super(code);
  }
}

const CONSTANTS: Readonly<Record<string, number>> = { pi: Math.PI, e: Math.E };

const FUNCTIONS: Readonly<
  Record<string, { arity: number | 'many'; run: (...x: number[]) => number }>
> = {
  sqrt: { arity: 1, run: (x) => Math.sqrt(x) },
  abs: { arity: 1, run: (x) => Math.abs(x) },
  round: { arity: 1, run: (x) => Math.round(x) },
  floor: { arity: 1, run: (x) => Math.floor(x) },
  ceil: { arity: 1, run: (x) => Math.ceil(x) },
  ln: { arity: 1, run: (x) => Math.log(x) },
  log10: { arity: 1, run: (x) => Math.log10(x) },
  exp: { arity: 1, run: (x) => Math.exp(x) },
  pow: { arity: 2, run: (x, y) => Math.pow(x, y) },
  min: { arity: 'many', run: (...x) => Math.min(...x) },
  max: { arity: 'many', run: (...x) => Math.max(...x) },
};

/** Persian and Arabic-Indic digits and separators become the ASCII a parser reads. */
export function normalizeExpression(text: string): string {
  return text
    .replace(/[۰-۹]/gu, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/gu, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[٫]/gu, '.')
    .replace(/[٬،]/gu, '')
    .replace(/[×·]/gu, '*')
    .replace(/÷/gu, '/')
    .replace(/[−–]/gu, '-');
}

type Token =
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'name'; readonly value: string }
  | { readonly kind: 'op'; readonly value: string };

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let at = 0;
  while (at < text.length) {
    const char = text[at]!;
    if (/\s/u.test(char)) {
      at += 1;
      continue;
    }
    const number = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/u.exec(text.slice(at));
    if (number) {
      tokens.push({ kind: 'number', value: Number(number[0]) });
      at += number[0].length;
      continue;
    }
    const name = /^[A-Za-z][A-Za-z0-9]*/u.exec(text.slice(at));
    if (name) {
      tokens.push({ kind: 'name', value: name[0].toLowerCase() });
      at += name[0].length;
      continue;
    }
    if ('+-*/%^(),'.includes(char)) {
      tokens.push({ kind: 'op', value: char });
      at += 1;
      continue;
    }
    throw new Refusal('syntax');
  }
  return tokens;
}

function finite(value: number): number {
  if (Number.isNaN(value)) throw new Refusal('out_of_range');
  if (!Number.isFinite(value) || Math.abs(value) >= CALCULATOR_LIMITS.maxMagnitude)
    throw new Refusal('out_of_range');
  return value;
}

class Parser {
  private at = 0;
  constructor(private readonly tokens: readonly Token[]) {}

  parse(): number {
    const value = this.expression(0);
    if (this.at < this.tokens.length) throw new Refusal('syntax');
    return value;
  }

  private peek(): Token | undefined {
    return this.tokens[this.at];
  }

  private takeOp(...ops: string[]): string | null {
    const token = this.peek();
    if (token?.kind === 'op' && ops.includes(token.value)) {
      this.at += 1;
      return token.value;
    }
    return null;
  }

  private guard(depth: number): number {
    if (depth > CALCULATOR_LIMITS.maxDepth) throw new Refusal('too_deep');
    return depth + 1;
  }

  private expression(depth: number): number {
    const next = this.guard(depth);
    let value = this.term(next);
    for (let op = this.takeOp('+', '-'); op; op = this.takeOp('+', '-')) {
      const right = this.term(next);
      value = finite(op === '+' ? value + right : value - right);
    }
    return value;
  }

  private term(depth: number): number {
    let value = this.unary(depth);
    for (let op = this.takeOp('*', '/', '%'); op; op = this.takeOp('*', '/', '%')) {
      const right = this.unary(depth);
      if (op !== '*' && right === 0) throw new Refusal('division_by_zero');
      value = finite(op === '*' ? value * right : op === '/' ? value / right : value % right);
    }
    return value;
  }

  /** `-2^2` is `-(2^2)`: the power binds tighter than the sign, as in school arithmetic. */
  private unary(depth: number): number {
    const next = this.guard(depth);
    const sign = this.takeOp('-', '+');
    if (sign) {
      const value = this.unary(next);
      return sign === '-' ? -value : value;
    }
    const base = this.primary(next);
    return this.takeOp('^') ? finite(Math.pow(base, this.unary(next))) : base;
  }

  private primary(depth: number): number {
    const token = this.peek();
    if (!token) throw new Refusal('syntax');
    if (token.kind === 'number') {
      this.at += 1;
      return finite(token.value);
    }
    if (token.kind === 'op' && token.value === '(') {
      this.at += 1;
      const value = this.expression(this.guard(depth));
      if (!this.takeOp(')')) throw new Refusal('syntax');
      return value;
    }
    if (token.kind === 'name') {
      this.at += 1;
      if (this.takeOp('(')) {
        const fn = Object.hasOwn(FUNCTIONS, token.value) ? FUNCTIONS[token.value] : undefined;
        if (!fn) throw new Refusal('unknown_name');
        const args: number[] = [];
        if (!this.takeOp(')')) {
          do args.push(this.expression(this.guard(depth)));
          while (this.takeOp(','));
          if (!this.takeOp(')')) throw new Refusal('syntax');
        }
        if (fn.arity === 'many' ? args.length < 1 : args.length !== fn.arity)
          throw new Refusal('wrong_arguments');
        return finite(fn.run(...args));
      }
      const constant = Object.hasOwn(CONSTANTS, token.value) ? CONSTANTS[token.value] : undefined;
      if (constant === undefined) throw new Refusal('unknown_name');
      return constant;
    }
    throw new Refusal('syntax');
  }
}

/** Evaluates one arithmetic expression; never throws. */
export function evaluateExpression(input: string): CalculatorResult {
  const text = normalizeExpression(input).trim();
  if (text === '') return { ok: false, error: 'empty' };
  if (text.length > CALCULATOR_LIMITS.maxLength) return { ok: false, error: 'too_long' };
  try {
    return { ok: true, value: new Parser(tokenize(text)).parse() };
  } catch (error) {
    if (error instanceof Refusal) return { ok: false, error: error.code };
    // A parser bug must not become a crash of the worker; the call is simply refused.
    return { ok: false, error: 'syntax' };
  }
}

/** 12 significant digits: enough for money and rates, and free of 0.1 + 0.2 noise. */
export const formatNumber = (value: number): number => Number(value.toPrecision(12));
