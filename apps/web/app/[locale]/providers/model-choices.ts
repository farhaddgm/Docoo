/**
 * The models the "full model test" can try on one connection. They come from the provider's own
 * list; a model that is not in it (the current default may have been retired from the list) is
 * still offered, marked, so choosing it is possible and nothing is silently swapped.
 */
export interface ModelChoice {
  readonly id: string;
  readonly label: string;
  /** Not in the connection's list. */
  readonly outside: boolean;
}

export function modelChoices(
  models: readonly { id: string; name: string }[],
  selected: string,
): ModelChoice[] {
  const seen = new Set<string>();
  const choices: ModelChoice[] = [];
  for (const model of models) {
    if (seen.has(model.id)) continue;
    seen.add(model.id);
    choices.push({ id: model.id, label: model.name || model.id, outside: false });
  }
  const chosen = selected.trim();
  if (chosen !== '' && !seen.has(chosen)) {
    choices.push({ id: chosen, label: chosen, outside: true });
  }
  return choices;
}

/** Changing the connection keeps the model only if the new connection offers it. */
export function modelAfterConnectionChange(
  models: readonly { id: string }[],
  model: string,
): string {
  return models.some((item) => item.id === model) ? model : '';
}
