import { z } from 'zod';
import { createRubricSchema } from './rubric.js';

/**
 * Candidate-only project problem templates. These are not approved defaults and
 * must not be treated as evidence that a template improves analysis quality.
 */
export const problemTemplateLifecycleSchema = z.enum(['candidate']);

export const problemTemplateIdSchema = z.enum([
  'business-plan',
  'go-to-market',
  'product-redesign',
]);

const localizedTextSchema = z
  .object({ fa: z.string().trim().min(1).max(2_000), en: z.string().trim().min(1).max(2_000) })
  .strict();

export const problemTemplatePromptSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/u),
    label: localizedTextSchema,
    guidance: localizedTextSchema,
  })
  .strict();

/** Candidate scoring proposal only; it is not passed to the production evaluator. */
export const problemTemplateRubricSchema = createRubricSchema(localizedTextSchema, {
  minCriteria: 3,
  maxCriteria: 12,
  minWeight: 1,
  integerThreshold: true,
  integerMinimums: true,
  validateSemantics: true,
});

export const problemTemplateSchema = z
  .object({
    id: problemTemplateIdSchema,
    version: z.number().int().positive(),
    lifecycle: problemTemplateLifecycleSchema,
    name: localizedTextSchema,
    description: localizedTextSchema,
    prompts: z.array(problemTemplatePromptSchema).min(3).max(12),
    rubric: problemTemplateRubricSchema,
    /** Advisory mapping only; it does not create or alter rendered document sections. */
    suggestedSections: z.array(localizedTextSchema).min(1).max(12),
  })
  .strict()
  .superRefine((template, context) => {
    const promptIds = template.prompts.map(({ id }) => id);
    if (new Set(promptIds).size !== promptIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['prompts'],
        message: 'Prompt IDs must be unique.',
      });
    }
    if (
      new Set(template.suggestedSections.map(({ en }) => en.toLocaleLowerCase('en'))).size !==
      template.suggestedSections.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['suggestedSections'],
        message: 'Suggested sections must be unique.',
      });
    }
  });

/** Immutable project-level copy; snapshots intentionally do not depend on future catalog edits. */
export const problemTemplateSnapshotSchema = problemTemplateSchema;

const candidate = (template: z.input<typeof problemTemplateSchema>) =>
  problemTemplateSchema.parse(template);

/** Frozen catalog snapshot. Keep existing versions stable once referenced by data. */
export const candidateProblemTemplates = [
  candidate({
    id: 'business-plan',
    version: 1,
    lifecycle: 'candidate',
    name: { fa: 'طرح کسب‌وکار', en: 'Business plan' },
    description: {
      fa: 'برای صورت‌بندی فرصت، مشتری، مدل اجرا و فرض‌های اقتصادی.',
      en: 'For framing an opportunity, customers, operating model, and economic assumptions.',
    },
    prompts: [
      {
        id: 'customer',
        label: { fa: 'مشتری و نیاز', en: 'Customer and need' },
        guidance: {
          fa: 'مشتری مشخص و مسئله‌ای را که اکنون تجربه می‌کند توصیف کنید.',
          en: 'Describe a specific customer and the problem they currently experience.',
        },
      },
      {
        id: 'value',
        label: { fa: 'ارزش پیشنهادی', en: 'Value proposition' },
        guidance: {
          fa: 'نتیجه قابل مشاهده و جایگزین‌های فعلی را بیان کنید.',
          en: 'State the observable outcome and current alternatives.',
        },
      },
      {
        id: 'delivery',
        label: { fa: 'اجرا و منابع', en: 'Delivery and resources' },
        guidance: {
          fa: 'توانمندی‌ها، شرکا، عملیات و وابستگی‌های لازم را فهرست کنید.',
          en: 'List capabilities, partners, operations, and dependencies required.',
        },
      },
      {
        id: 'economics',
        label: { fa: 'اقتصاد و درآمد', en: 'Economics and revenue' },
        guidance: {
          fa: 'هزینه‌ها، جریان درآمد و فرض‌های نیازمند اعتبارسنجی را مشخص کنید.',
          en: 'Identify costs, revenue streams, and assumptions requiring validation.',
        },
      },
      {
        id: 'risk',
        label: { fa: 'ریسک و سنجش', en: 'Risk and measurement' },
        guidance: {
          fa: 'مهم‌ترین ریسک و شاخص آزمون‌پذیر آن را بنویسید.',
          en: 'Name the most important risk and a testable indicator for it.',
        },
      },
    ],
    rubric: {
      criteria: [
        {
          key: 'customer_fit',
          label: { fa: 'تناسب با مشتری', en: 'Customer fit' },
          weight: 20,
          targetStage: 'analysis',
        },
        {
          key: 'market_evidence',
          label: { fa: 'شواهد بازار', en: 'Market evidence' },
          weight: 20,
          targetStage: 'research',
        },
        {
          key: 'value_proposition',
          label: { fa: 'ارزش پیشنهادی', en: 'Value proposition' },
          weight: 15,
          targetStage: 'ideation',
        },
        {
          key: 'business_model',
          label: { fa: 'مدل کسب‌وکار', en: 'Business model' },
          weight: 15,
          targetStage: 'ideation',
        },
        {
          key: 'financial_feasibility',
          label: { fa: 'امکان‌پذیری اقتصادی', en: 'Financial feasibility' },
          weight: 15,
          targetStage: 'ideation',
        },
        {
          key: 'execution_plan',
          label: { fa: 'برنامه اجرا', en: 'Execution plan' },
          weight: 10,
          targetStage: 'documentation',
        },
        {
          key: 'risk_validation',
          label: { fa: 'اعتبارسنجی ریسک', en: 'Risk validation' },
          weight: 5,
          targetStage: 'documentation',
        },
      ],
      passThreshold: 80,
      minimums: { market_evidence: 60 },
    },
    suggestedSections: [
      { fa: 'مشتری و مسئله', en: 'Customer and problem' },
      { fa: 'ارزش پیشنهادی', en: 'Value proposition' },
      { fa: 'مدل اجرا و درآمد', en: 'Operating and revenue model' },
      { fa: 'ریسک‌ها و اعتبارسنجی', en: 'Risks and validation' },
    ],
  }),
  candidate({
    id: 'go-to-market',
    version: 1,
    lifecycle: 'candidate',
    name: { fa: 'ورود به بازار', en: 'Go to market' },
    description: {
      fa: 'برای برنامه‌ریزی دسترسی به مشتری، جایگاه‌یابی و یادگیری بازار.',
      en: 'For planning customer access, positioning, and market learning.',
    },
    prompts: [
      {
        id: 'segment',
        label: { fa: 'بخش بازار', en: 'Market segment' },
        guidance: {
          fa: 'بخش آغازین بازار و دلیل انتخاب آن را تعریف کنید.',
          en: 'Define the initial market segment and why it is selected.',
        },
      },
      {
        id: 'positioning',
        label: { fa: 'جایگاه‌یابی', en: 'Positioning' },
        guidance: {
          fa: 'تمایز قابل اثبات در برابر گزینه‌های جایگزین را بیان کنید.',
          en: 'State a defensible differentiation against available alternatives.',
        },
      },
      {
        id: 'channels',
        label: { fa: 'کانال‌ها', en: 'Channels' },
        guidance: {
          fa: 'کانال‌های دسترسی و فرض‌های هزینه یا تبدیل آن‌ها را مشخص کنید.',
          en: 'Identify acquisition channels and assumptions about cost or conversion.',
        },
      },
      {
        id: 'adoption',
        label: { fa: 'پذیرش مشتری', en: 'Customer adoption' },
        guidance: {
          fa: 'موانع خرید، فعال‌سازی و حفظ مشتری را توصیف کنید.',
          en: 'Describe barriers to purchase, activation, and retention.',
        },
      },
      {
        id: 'experiment',
        label: { fa: 'آزمایش بازار', en: 'Market experiment' },
        guidance: {
          fa: 'آزمایش کم‌هزینه و معیار توقف یا ادامه را تعریف کنید.',
          en: 'Define a low-cost experiment and its stop-or-continue criterion.',
        },
      },
    ],
    rubric: {
      criteria: [
        {
          key: 'segment_fit',
          label: { fa: 'تناسب بخش بازار', en: 'Segment fit' },
          weight: 20,
          targetStage: 'analysis',
        },
        {
          key: 'channel_evidence',
          label: { fa: 'شواهد کانال', en: 'Channel evidence' },
          weight: 20,
          targetStage: 'research',
        },
        {
          key: 'positioning',
          label: { fa: 'جایگاه‌یابی', en: 'Positioning' },
          weight: 15,
          targetStage: 'ideation',
        },
        {
          key: 'acquisition_economics',
          label: { fa: 'اقتصاد جذب', en: 'Acquisition economics' },
          weight: 15,
          targetStage: 'ideation',
        },
        {
          key: 'experiment_quality',
          label: { fa: 'کیفیت آزمایش', en: 'Experiment quality' },
          weight: 15,
          targetStage: 'ideation',
        },
        {
          key: 'adoption_measurement',
          label: { fa: 'سنجش پذیرش', en: 'Adoption measurement' },
          weight: 10,
          targetStage: 'documentation',
        },
        {
          key: 'risk_compliance',
          label: { fa: 'ریسک و انطباق', en: 'Risk and compliance' },
          weight: 5,
          targetStage: 'documentation',
        },
      ],
      passThreshold: 80,
      minimums: { channel_evidence: 60 },
    },
    suggestedSections: [
      { fa: 'بخش هدف و جایگاه‌یابی', en: 'Target segment and positioning' },
      { fa: 'کانال و مسیر جذب', en: 'Channels and acquisition path' },
      { fa: 'فرض‌ها و آزمایش‌ها', en: 'Assumptions and experiments' },
    ],
  }),
  candidate({
    id: 'product-redesign',
    version: 1,
    lifecycle: 'candidate',
    name: { fa: 'بازطراحی محصول', en: 'Product redesign' },
    description: {
      fa: 'برای بررسی تجربه فعلی، نیازها، محدودیت‌ها و تغییرات محصول.',
      en: 'For examining the current experience, needs, constraints, and product changes.',
    },
    prompts: [
      {
        id: 'users',
        label: { fa: 'کاربران و زمینه', en: 'Users and context' },
        guidance: {
          fa: 'گروه‌های کاربر و موقعیت استفاده را با شواهد توصیف کنید.',
          en: 'Describe user groups and usage contexts with available evidence.',
        },
      },
      {
        id: 'friction',
        label: { fa: 'اصطکاک فعلی', en: 'Current friction' },
        guidance: {
          fa: 'نقاط شکست و شدت اثر آن‌ها را از دید کاربر مشخص کنید.',
          en: 'Identify user-facing failure points and their impact.',
        },
      },
      {
        id: 'requirements',
        label: { fa: 'نیازمندی‌ها', en: 'Requirements' },
        guidance: {
          fa: 'نیازهای عملکردی و غیرعملکردی و محدودیت‌های قطعی را جدا کنید.',
          en: 'Separate functional and non-functional needs from hard constraints.',
        },
      },
      {
        id: 'migration',
        label: { fa: 'مهاجرت و سازگاری', en: 'Migration and compatibility' },
        guidance: {
          fa: 'اثر بر کاربران فعلی، داده‌ها و یکپارچگی‌ها را در نظر بگیرید.',
          en: 'Consider effects on existing users, data, and integrations.',
        },
      },
      {
        id: 'success',
        label: { fa: 'موفقیت و بازگشت', en: 'Success and rollback' },
        guidance: {
          fa: 'شاخص پذیرش و شرط بازگشت امن را تعریف کنید.',
          en: 'Define an adoption measure and a safe rollback condition.',
        },
      },
    ],
    rubric: {
      criteria: [
        {
          key: 'user_evidence',
          label: { fa: 'شواهد کاربران', en: 'User evidence' },
          weight: 20,
          targetStage: 'research',
        },
        {
          key: 'problem_fit',
          label: { fa: 'تناسب با مسئله', en: 'Problem fit' },
          weight: 15,
          targetStage: 'analysis',
        },
        {
          key: 'requirement_coverage',
          label: { fa: 'پوشش نیازمندی‌ها', en: 'Requirement coverage' },
          weight: 15,
          targetStage: 'analysis',
        },
        {
          key: 'accessibility_inclusion',
          label: { fa: 'دسترس‌پذیری و شمول', en: 'Accessibility and inclusion' },
          weight: 10,
          targetStage: 'documentation',
        },
        {
          key: 'technical_feasibility',
          label: { fa: 'امکان‌پذیری فنی', en: 'Technical feasibility' },
          weight: 15,
          targetStage: 'ideation',
        },
        {
          key: 'migration_safety',
          label: { fa: 'ایمنی مهاجرت', en: 'Migration safety' },
          weight: 15,
          targetStage: 'documentation',
        },
        {
          key: 'success_rollback',
          label: { fa: 'موفقیت و بازگشت', en: 'Success and rollback' },
          weight: 10,
          targetStage: 'documentation',
        },
      ],
      passThreshold: 80,
      minimums: { user_evidence: 60 },
    },
    suggestedSections: [
      { fa: 'کاربران و شواهد تجربه', en: 'Users and experience evidence' },
      { fa: 'نیازمندی‌ها و محدودیت‌ها', en: 'Requirements and constraints' },
      { fa: 'گزینه‌های طراحی و مهاجرت', en: 'Design options and migration' },
      { fa: 'معیار موفقیت و بازگشت', en: 'Success and rollback criteria' },
    ],
  }),
] as const satisfies readonly z.infer<typeof problemTemplateSchema>[];

export type ProblemTemplateId = z.infer<typeof problemTemplateIdSchema>;
export type ProblemTemplate = z.infer<typeof problemTemplateSchema>;
