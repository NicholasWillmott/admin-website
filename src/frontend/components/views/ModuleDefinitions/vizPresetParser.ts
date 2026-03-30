// vizPresetParser.ts
// Parse and serialize vizPresets from JSON module definition files.

export interface ExtractedPreset {
    metricId: string;
    metricLabel: string;
    presetIndex: number;   // index within the metric's vizPresets array
    metricIndex: number;   // index within the top-level metrics array
    preset: any;
}

export interface ExtractedResultsObject {
    id: string;
    data: any;
    index: number;
}

export interface ExtractedMetric {
    metricId: string;
    resultsObjectId: string;
    label: { en: string; fr: string };
    data: any;     // full parsed metric data (excluding vizPresets)
    index: number;
}

function parseJson(fileContent: string): any {
    try {
        return JSON.parse(fileContent);
    } catch {
        return null;
    }
}

function stringify(obj: any): string {
    return JSON.stringify(obj, null, 2);
}

// ────────────────────────────────────────────
// VizPreset extraction and mutation
// ────────────────────────────────────────────

export function extractPresetsFromFile(fileContent: string): ExtractedPreset[] {
    const parsed = parseJson(fileContent);
    if (!parsed || !Array.isArray(parsed.metrics)) return [];

    const results: ExtractedPreset[] = [];

    parsed.metrics.forEach((metric: any, metricIndex: number) => {
        const metricId = metric.id ?? `metric-${metricIndex}`;
        const metricLabel = metric.label?.en ?? metricId;
        const vizPresets = Array.isArray(metric.vizPresets) ? metric.vizPresets : [];

        vizPresets.forEach((preset: any, presetIndex: number) => {
            results.push({ metricId, metricLabel, presetIndex, metricIndex, preset });
        });
    });

    return results;
}

export function replacePresetInFile(
    fileContent: string,
    extracted: ExtractedPreset,
    newPreset: any
): string {
    const parsed = parseJson(fileContent);
    if (!parsed) return fileContent;

    parsed.metrics[extracted.metricIndex].vizPresets[extracted.presetIndex] = newPreset;
    return stringify(parsed);
}

export function insertPresetInFile(
    fileContent: string,
    targetMetricId: string,
    newPreset: any
): { content: string; insertedKey: string } | null {
    const parsed = parseJson(fileContent);
    if (!parsed || !Array.isArray(parsed.metrics)) return null;

    const metricIndex = parsed.metrics.findIndex((m: any) => m.id === targetMetricId);
    if (metricIndex === -1) return null;

    const metric = parsed.metrics[metricIndex];
    if (!Array.isArray(metric.vizPresets)) metric.vizPresets = [];

    const presetIndex = metric.vizPresets.length;
    metric.vizPresets.push(newPreset);

    return {
        content: stringify(parsed),
        insertedKey: `${targetMetricId}::${newPreset.id}::${presetIndex}`,
    };
}

export function deletePresetFromFile(
    fileContent: string,
    extracted: ExtractedPreset
): string {
    const parsed = parseJson(fileContent);
    if (!parsed) return fileContent;

    parsed.metrics[extracted.metricIndex].vizPresets.splice(extracted.presetIndex, 1);
    return stringify(parsed);
}

// ────────────────────────────────────────────
// ResultsObject extraction and mutation
// ────────────────────────────────────────────

export function extractResultsObjectsFromFile(fileContent: string): ExtractedResultsObject[] {
    const parsed = parseJson(fileContent);
    if (!parsed || !Array.isArray(parsed.resultsObjects)) return [];

    return parsed.resultsObjects.map((ro: any, index: number) => ({
        id: ro.id ?? `ro-${index}`,
        data: ro,
        index,
    }));
}

export function insertResultsObjectInFile(
    fileContent: string,
    newData: any
): { content: string; insertedId: string } | null {
    const parsed = parseJson(fileContent);
    if (!parsed) return null;

    if (!Array.isArray(parsed.resultsObjects)) parsed.resultsObjects = [];
    parsed.resultsObjects.push(newData);

    return { content: stringify(parsed), insertedId: newData.id };
}

export function deleteResultsObjectFromFile(
    fileContent: string,
    extracted: ExtractedResultsObject
): string {
    const parsed = parseJson(fileContent);
    if (!parsed) return fileContent;

    parsed.resultsObjects.splice(extracted.index, 1);
    return stringify(parsed);
}

export function replaceResultsObjectInFile(
    fileContent: string,
    extracted: ExtractedResultsObject,
    newData: any
): string {
    const parsed = parseJson(fileContent);
    if (!parsed) return fileContent;

    parsed.resultsObjects[extracted.index] = newData;
    return stringify(parsed);
}

// ────────────────────────────────────────────
// Metric extraction and mutation
// ────────────────────────────────────────────

export function extractFullMetricsFromFile(fileContent: string): ExtractedMetric[] {
    const parsed = parseJson(fileContent);
    if (!parsed || !Array.isArray(parsed.metrics)) return [];

    return parsed.metrics.map((metric: any, index: number) => {
        const { vizPresets: _, ...dataWithoutPresets } = metric;
        return {
            metricId: metric.id ?? `metric-${index}`,
            resultsObjectId: metric.resultsObjectId ?? "",
            label: {
                en: metric.label?.en ?? metric.id ?? `metric-${index}`,
                fr: metric.label?.fr ?? "",
            },
            data: dataWithoutPresets,
            index,
        };
    });
}

export function insertMetricInFile(
    fileContent: string,
    newMetricData: any
): { content: string; insertedId: string } | null {
    const parsed = parseJson(fileContent);
    if (!parsed) return null;

    if (!Array.isArray(parsed.metrics)) parsed.metrics = [];
    parsed.metrics.push({ ...newMetricData, vizPresets: [] });

    return { content: stringify(parsed), insertedId: newMetricData.id };
}

export function deleteMetricFromFile(
    fileContent: string,
    extracted: ExtractedMetric
): string {
    const parsed = parseJson(fileContent);
    if (!parsed) return fileContent;

    parsed.metrics.splice(extracted.index, 1);
    return stringify(parsed);
}

export function replaceMetricInFile(
    fileContent: string,
    extracted: ExtractedMetric,
    newMetricData: any
): string {
    const parsed = parseJson(fileContent);
    if (!parsed) return fileContent;

    // Preserve existing vizPresets — they are edited separately
    const existingVizPresets = parsed.metrics[extracted.index].vizPresets ?? [];
    parsed.metrics[extracted.index] = { ...newMetricData, vizPresets: existingVizPresets };
    return stringify(parsed);
}
