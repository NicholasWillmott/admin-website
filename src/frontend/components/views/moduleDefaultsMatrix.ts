import type {
  ModuleDefaultsCountry,
  ModuleDefaultsGlobalFile,
  ModuleDefaultsSnapshot,
} from '../../types.ts';

// The fleet matrix's rows (ModuleDefaultsView). Parameters are compared with
// the fleet's global default, the frozen most-common value; a highlighted
// cell is exactly one the platform editor marks "Differs from global
// default". Default families and pre-selected modules are each country's own
// choice, so they are shown but never compared.

export interface Cell {
  text: string;
  differsFromGlobal: boolean;
}

export interface Row {
  key: string;
  label: string;
  sublabel?: string;
  globalText: string;
  globalNote?: string;
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

export function buildSections(
  countries: ModuleDefaultsCountry[],
  global: ModuleDefaultsGlobalFile | null,
): Section[] {
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
      cells[c.id] = { text: yesNo(read(c.snapshot!)), differsFromGlobal: false };
    }
    return cells;
  };

  const familyRows: Row[] = FAMILIES.map((f) => ({
    key: `family|${f.key}`,
    label: f.label,
    globalText: '—',
    cells: uncompared((s) => s.stored.step1?.[f.key] === true),
  }));

  const selectionRows: Row[] = [...modules.values()].map((m) => ({
    key: `selected|${m.id}`,
    label: m.label,
    sublabel: m.id,
    globalText: '—',
    cells: uncompared((s) => s.stored.moduleIds.includes(m.id)),
  }));

  const paramSections: Section[] = [...modules.values()]
    .filter((m) => m.parameters.length > 0)
    .map((m) => ({
      key: `params|${m.id}`,
      label: `${m.label} (${m.id})`,
      rows: m.parameters.map((param) => {
        const g = global?.parameters[m.id]?.[param.replacementString];
        const cells: Record<string, Cell | undefined> = {};
        for (const c of live) {
          const current = c.snapshot!.effective[m.id]?.[param.replacementString];
          cells[c.id] = current === undefined ? undefined : {
            text: current,
            differsFromGlobal: g !== undefined && current !== g.value,
          };
        }
        return {
          key: `param|${m.id}|${param.replacementString}`,
          label: param.description,
          sublabel: param.replacementString,
          globalText: g?.value ?? '—',
          globalNote: g
            ? `${g.agreeing}/${g.counted} countries` +
              (g.value !== param.defaultValue ? ` · definition ${param.defaultValue}` : '')
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
