import { explainError } from '../use-action';
import type { SettingsText } from './settings-messages';

/** A localized message for a failed settings request; unknown codes get the generic one. */
export function explainSettingError(error: unknown, text: SettingsText): string {
  return explainError(error, text.errors, text.genericError);
}
