'use client';
import type { ProblemPatternDefinition } from '@docoo/contracts';

type Definition = ProblemPatternDefinition;
export function PatternEditor({
  value,
  onChange,
  disabled,
  fa,
}: {
  value: Definition;
  onChange: (value: Definition) => void;
  disabled: boolean;
  fa: boolean;
}) {
  const label = (persian: string, english: string) => (fa ? persian : english);
  const patch = (next: Partial<Definition>) => onChange({ ...value, ...next });
  const lines = (title: string, values: string[], update: (lines: string[]) => void) => (
    <label>
      {title}
      <textarea
        value={values.join('\n')}
        onChange={(event) => update(event.target.value.split('\n'))}
        rows={3}
      />
    </label>
  );
  return (
    <fieldset disabled={disabled} className="pattern-editor">
      <legend>{label('ویرایش پیش‌نویس', 'Edit draft')}</legend>
      <label>
        {label('شناسهٔ ثابت', 'Stable key')}
        <input value={value.key} readOnly dir="ltr" />
      </label>
      <label>
        {label('عنوان', 'Title')}
        <input value={value.title} onChange={(event) => patch({ title: event.target.value })} />
      </label>
      <label>
        {label('هدف', 'Purpose')}
        <textarea
          value={value.purpose}
          onChange={(event) => patch({ purpose: event.target.value })}
        />
      </label>
      {lines(
        label('موارد کاربرد — هر مورد یک خط', 'Applicability — one item per line'),
        value.applicability,
        (applicability) => patch({ applicability }),
      )}
      <h3>{label('اطلاعات مورد نیاز', 'Inputs')}</h3>
      {value.inputs.map((input, index) => (
        <div key={index} className="pattern-box">
          <label>
            {label('کلید', 'Key')}
            <input
              value={input.key}
              onChange={(event) =>
                patch({
                  inputs: value.inputs.map((item, i) =>
                    i === index ? { ...item, key: event.target.value } : item,
                  ),
                  stages: value.stages.map((stage) => ({
                    ...stage,
                    inputKeys: stage.inputKeys.map((key) =>
                      key === input.key ? event.target.value : key,
                    ),
                  })),
                })
              }
            />
          </label>
          <label>
            {label('پرسش', 'Question')}
            <textarea
              value={input.question}
              onChange={(event) =>
                patch({
                  inputs: value.inputs.map((item, i) =>
                    i === index ? { ...item, question: event.target.value } : item,
                  ),
                })
              }
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={input.required}
              onChange={(event) =>
                patch({
                  inputs: value.inputs.map((item, i) =>
                    i === index ? { ...item, required: event.target.checked } : item,
                  ),
                })
              }
            />
            {label('ضروری', 'Required')}
          </label>
          <button
            type="button"
            onClick={() =>
              patch({
                inputs: value.inputs.filter((_, i) => i !== index),
                stages: value.stages.map((stage) => ({
                  ...stage,
                  inputKeys: stage.inputKeys.filter((key) => key !== input.key),
                })),
              })
            }
          >
            {label('حذف ورودی', 'Remove input')}
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          patch({
            inputs: [
              ...value.inputs,
              { key: `input-${value.inputs.length + 1}`, question: '', required: false },
            ],
          })
        }
      >
        {label('افزودن ورودی', 'Add input')}
      </button>
      <h3>{label('مراحل پیشنهادی', 'Suggested stages')}</h3>
      {value.stages.map((stage, index) => {
        const update = (next: Partial<Definition['stages'][number]>) =>
          patch({
            stages: value.stages.map((item, i) => (i === index ? { ...item, ...next } : item)),
          });
        return (
          <div key={index} className="pattern-box">
            <label>
              {label('کلید مرحله', 'Stage key')}
              <input value={stage.key} onChange={(event) => update({ key: event.target.value })} />
            </label>
            <label>
              {label('عنوان مرحله', 'Stage title')}
              <input
                value={stage.title}
                onChange={(event) => update({ title: event.target.value })}
              />
            </label>
            <label>
              {label('نوع فعالیت', 'Activity')}
              <select
                value={stage.activity}
                onChange={(event) =>
                  update({ activity: event.target.value as typeof stage.activity })
                }
              >
                {(
                  ['clarify', 'analyze', 'research', 'rehearse', 'produce', 'reflect'] as const
                ).map((activity) => (
                  <option key={activity} value={activity}>
                    {
                      {
                        clarify: label('روشن‌سازی', 'Clarify'),
                        analyze: label('تحلیل', 'Analyze'),
                        research: label('تحقیق', 'Research'),
                        rehearse: label('تمرین', 'Rehearse'),
                        produce: label('تولید خروجی', 'Produce'),
                        reflect: label('مرور نتیجه', 'Reflect'),
                      }[activity]
                    }
                  </option>
                ))}
              </select>
            </label>
            {lines(label('راهنمای مرحله', 'Stage guidance'), stage.guidance, (guidance) =>
              update({ guidance }),
            )}
            <fieldset>
              <legend>{label('ورودی‌های مرتبط', 'Related inputs')}</legend>
              {value.inputs.map((input, inputIndex) => (
                <label key={inputIndex}>
                  <input
                    type="checkbox"
                    checked={stage.inputKeys.includes(input.key)}
                    onChange={(event) =>
                      update({
                        inputKeys: event.target.checked
                          ? [...stage.inputKeys, input.key]
                          : stage.inputKeys.filter((key) => key !== input.key),
                      })
                    }
                  />
                  {input.question || input.key}
                </label>
              ))}
            </fieldset>
            <button
              type="button"
              onClick={() => patch({ stages: value.stages.filter((_, i) => i !== index) })}
            >
              {label('حذف مرحله', 'Remove stage')}
            </button>
          </div>
        );
      })}
      <button
        type="button"
        onClick={() =>
          patch({
            stages: [
              ...value.stages,
              {
                key: `stage-${value.stages.length + 1}`,
                title: '',
                guidance: [''],
                inputKeys: [],
                activity: 'clarify',
              },
            ],
          })
        }
      >
        {label('افزودن مرحله', 'Add stage')}
      </button>
      <label>
        {label('سیاست تحقیق', 'Research policy')}
        <select
          value={value.research.mode}
          onChange={(event) =>
            patch({
              research: {
                ...value.research,
                mode: event.target.value as Definition['research']['mode'],
              },
            })
          }
        >
          <option value="when-needed">{label('در صورت نیاز', 'When needed')}</option>
          <option value="never">{label('بدون تحقیق', 'Never')}</option>
        </select>
      </label>
      {lines(
        label('شرایط نیاز به تحقیق', 'Research triggers'),
        value.research.triggers,
        (triggers) => patch({ research: { ...value.research, triggers } }),
      )}
      <h3>{label('خروجی‌ها', 'Outputs')}</h3>
      {value.outputs.map((output, index) => {
        const update = (next: Partial<Definition['outputs'][number]>) =>
          patch({
            outputs: value.outputs.map((item, i) => (i === index ? { ...item, ...next } : item)),
          });
        return (
          <div key={index} className="pattern-box">
            <label>
              {label('کلید خروجی', 'Output key')}
              <input value={output.key} onChange={(event) => update({ key: event.target.value })} />
            </label>
            <label>
              {label('عنوان خروجی', 'Output title')}
              <input
                value={output.title}
                onChange={(event) => update({ title: event.target.value })}
              />
            </label>
            {lines(label('بخش‌های خروجی', 'Output sections'), output.sections, (sections) =>
              update({ sections }),
            )}
            <button
              type="button"
              onClick={() => patch({ outputs: value.outputs.filter((_, i) => i !== index) })}
            >
              {label('حذف خروجی', 'Remove output')}
            </button>
          </div>
        );
      })}
      <button
        type="button"
        onClick={() =>
          patch({
            outputs: [
              ...value.outputs,
              { key: `output-${value.outputs.length + 1}`, title: '', sections: [''] },
            ],
          })
        }
      >
        {label('افزودن خروجی', 'Add output')}
      </button>
      {lines(
        label('معیارهای کیفیت', 'Quality criteria'),
        value.qualityCriteria,
        (qualityCriteria) => patch({ qualityCriteria }),
      )}
      {lines(label('مرزها', 'Boundaries'), value.boundaries, (boundaries) => patch({ boundaries }))}
    </fieldset>
  );
}
