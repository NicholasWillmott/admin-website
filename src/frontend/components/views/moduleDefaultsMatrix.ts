import type { ModuleDefaultsCountry, ModuleDefaultsSnapshot } from '../../types.ts';

// The fleet matrix's rows (ModuleDefaultsView). A cell's baseline value
// follows the platform editor's rule: the baseline's pinned value, else the
// definition default it follows today, so a highlighted cell is exactly one
// the editor marks "Changed from baseline".

export interface Cell {
  text: string;
  baselineText?: string;
  drift: boolean;
  differsFromDefinition: boolean;
}

export interface Row {
  key: string;
  label: string;
  sublabel?: string;
  definitionText: string;
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

  const familyRows: Row[] = FAMILIES.map((f) => {
    const cells: Record<string, Cell | undefined> = {};
    for (const c of live) {
      const current = c.snapshot!.stored.step1?.[f.key] === true;
      const baseline = c.baseline ? c.baseline.stored.step1?.[f.key] === true : undefined;
      cells[c.id] = {
        text: yesNo(current),
        baselineText: baseline === undefined ? undefined : yesNo(baseline),
        drift: baseline !== undefined && baseline !== current,
        differsFromDefinition: false,
      };
    }
    return { key: `family|${f.key}`, label: f.label, definitionText: '—', cells };
  });

  const selectionRows: Row[] = [...modules.values()].map((m) => {
    const cells: Record<string, Cell | undefined> = {};
    for (const c of live) {
      const current = c.snapshot!.stored.moduleIds.includes(m.id);
      const baseline = c.baseline ? c.baseline.stored.moduleIds.includes(m.id) : undefined;
      cells[c.id] = {
        text: yesNo(current),
        baselineText: baseline === undefined ? undefined : yesNo(baseline),
        drift: baseline !== undefined && baseline !== current,
        differsFromDefinition: false,
      };
    }
    return { key: `selected|${m.id}`, label: m.label, sublabel: m.id, definitionText: '—', cells };
  });

  const paramSections: Section[] = [...modules.values()]
    .filter((m) => m.parameters.length > 0)
    .map((m) => ({
      key: `params|${m.id}`,
      label: `${m.label} (${m.id})`,
      rows: m.parameters.map((param) => {
        const cells: Record<string, Cell | undefined> = {};
        for (const c of live) {
          const own = c.snapshot!.modules.find((x) => x.id === m.id);
          const ownParam = own?.parameters.find((x) => x.replacementString === param.replacementString);
          const current = c.snapshot!.effective[m.id]?.[param.replacementString];
          if (current === undefined || ownParam === undefined) {
            cells[c.id] = undefined;
            continue;
          }
          const baseline = c.baseline
            ? c.baseline.stored.parameterSelections[m.id]?.[param.replacementString] ??
              ownParam.defaultValue
            : undefined;
          cells[c.id] = {
            text: current,
            baselineText: baseline,
            drift: baseline !== undefined && baseline !== current,
            differsFromDefinition: current !== ownParam.defaultValue,
          };
        }
        return {
          key: `param|${m.id}|${param.replacementString}`,
          label: param.description,
          sublabel: param.replacementString,
          definitionText: param.defaultValue,
          cells,
        };
      }),
    }));

  return [
    { key: 'families', label: 'Default data families', rows: familyRows },
    { key: 'selected', label: 'Pre-selected modules', rows: selectionRows },
    ...paramSections,
  ];
}
