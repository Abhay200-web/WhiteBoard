/**
 * Selection is a set of item ids. `replace` is a plain click, `add` is shift-click or a box
 * selection that adds to the current one, and `toggle` is ctrl-click.
 */
export type SelectMode = 'replace' | 'add' | 'toggle';

export function selectIds(
  current: ReadonlySet<string>,
  ids: readonly string[],
  mode: SelectMode,
): Set<string> {
  if (mode === 'replace') return new Set(ids);
  const next = new Set(current);
  for (const id of ids) {
    if (mode === 'toggle' && next.has(id)) next.delete(id);
    else next.add(id);
  }
  return next;
}
