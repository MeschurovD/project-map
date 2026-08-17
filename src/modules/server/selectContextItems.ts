export type SelectableContextItem = {
  id: string;
  selected: boolean;
};

export function selectContextItems<TItem extends SelectableContextItem>(
  items: TItem[],
  selectedContextIds: string[] | undefined
) {
  if (!selectedContextIds) return items.filter((entry) => entry.selected);

  const byId = new Map(items.map((entry) => [entry.id, entry]));
  const selected = selectedContextIds.map((id) => byId.get(id));
  const unknown = selectedContextIds.find((id, index) => !selected[index]);
  if (unknown) throw Object.assign(new Error(`Unknown context id: ${unknown}`), { statusCode: 400 });

  return selected.filter((entry): entry is TItem => Boolean(entry));
}
