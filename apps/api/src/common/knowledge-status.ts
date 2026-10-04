/**
 * The status a person sees for a knowledge version: an approved version whose validity has
 * ended is `expired` (docs/02-domain/02-state-machines.md §5), even though the stored status
 * only changes when it is superseded.
 */
export function visibleStatusSql(alias: string): string {
  return `(case when ${alias}.status = 'approved' and ${alias}.valid_until is not null and ${alias}.valid_until <= now()
                then 'expired' else ${alias}.status::text end)`;
}
