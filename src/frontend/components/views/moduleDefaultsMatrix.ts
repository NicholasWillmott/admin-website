import type {
  ModuleDefaultsCountry,
  ModuleDefaultsSnapshot,
} from '../../types.ts';

// The fleet matrix's rows (ModuleDefaultsView). Each parameter is compared
// with its definition default (the module's own defaultValue), read from that
// country's own snapshot, so a highlighted cell is exactly one the platform
// editor marks "Differs from default". Default families and pre-selected
// modules have no shared default: they are shown but never compared.

export interface Cell {
  text: string;
  differsFromDefault: boolean;
}

export interface Row {
  key: string;
  label: string;
  sublabel?: string;
  defaultText: string;
  defaultNote?: string;
  cells: Record<string, Cell | undefined>;
}

export interface Section {
  key: string;
  label: string;
  rows: Row[];
}

const FAMILIES = [
  { key: 'hmis', label: 'HMIS data' },
  { key: 'hfa', label: 'HFA data' },
  { key: 'iceh', label: 'ICEH equity data' },
] as const;

const yesNo = (v: boolean) => (v ? 'Yes' : 'No');

export function shortRef(ref: string): string {
  return ref.length > 10 ? ref.slice(0, 7) : ref;
}

export function buildSections(countries: ModuleDefaultsCountry[]): Section[] {
  const live = countries.filter((c) => c.state === 'ok' && c.snapshot);
  if (live.length === 0) return [];

  // Row labels come from an English-language instance when there is one.
  const reference = (live.find((c) => !c.french) ?? live[0]).snapshot!;
  const modules = new Map<string, ModuleDefaultsSnapshot['modules'][number]>();
  for (const m of reference.modules) modules.set(m.id, m);
  for (const c of live) {
    for (const m of c.snapshot!.modules) if (!modules.has(m.id)) modules.set(m.id, m);
  }

  const uncompared = (read: (s: ModuleDefaultsSnapshot) => boolean) => {
    const cells: Record<string, Cell | undefined> = {};
    for (const c of live) {
      cells[c.id] = { text: yesNo(read(c.snapshot!)), differsFromDefault: false };
    }
    return cells;
  };

  const familyRows: Row[] = FAMILIES.map((f) => ({
    key: `family|${f.key}`,
    label: f.label,
    defaultText: '—',
    cells: uncompared((s) => s.stored.step1?.[f.key] === true),
  }));

  const selectionRows: Row[] = [...modules.values()].map((m) => ({
    key: `selected|${m.id}`,
    label: m.label,
    sublabel: m.id,
    defaultText: '—',
    cells: uncompared((s) => s.stored.moduleIds.includes(m.id)),
  }));

  const paramSections: Section[] = [...modules.values()]
    .filter((m) => m.parameters.length > 0)
    .map((m) => ({
      key: `params|${m.id}`,
      label: `${m.label} (${m.id})`,
      rows: m.parameters.map((param) => {
        const cells: Record<string, Cell | undefined> = {};
        const defaults = new Set<string>();
        for (const c of live) {
          const own = c.snapshot!.modules
            .find((x) => x.id === m.id)?.parameters
            .find((x) => x.replacementString === param.replacementString);
          const current = c.snapshot!.effective[m.id]?.[param.replacementString];
          if (own === undefined || current === undefined) {
            cells[c.id] = undefined;
            continue;
          }
          defaults.add(own.defaultValue);
          cells[c.id] = { text: current, differsFromDefault: current !== own.defaultValue };
        }
        return {
          key: `param|${m.id}|${param.replacementString}`,
          label: param.description,
          sublabel: param.replacementString,
          defaultText: param.defaultValue,
          // Countries resolved different modules commits that disagree on
          // this default: each cell is compared with its own country's.
          defaultNote: defaults.size > 1
            ? `varies by modules version: ${[...defaults].join(', ')}`
            : undefined,
          cells,
        };
      }),
    }));

  return [
    { key: 'families', label: 'Default data families (per country, not compared)', rows: familyRows },
    { key: 'selected', label: 'Pre-selected modules (per country, not compared)', rows: selectionRows },
    ...paramSections,
  ];
}
