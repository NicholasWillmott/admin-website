// vizPresetParser.ts
// Parse and serialize vizPresets from TypeScript module definition files.

export interface ExtractedPreset {
    metricId: string;
    metricLabel: string;
    presetIndex: number;
    preset: any;
    startPos: number;
    endPos: number;
    indent: number;
}

export interface ExtractedResultsObject {
    id: string;
    data: any;
    startPos: number;
    endPos: number;
    indent: number;
    index: number;
}

export interface ExtractedMetric {
    metricId: string;
    resultsObjectId: string;
    label: { en: string; fr: string };
    data: any;           // full parsed metric data (excluding vizPresets)
    startPos: number;
    endPos: number;
    indent: number;
    index: number;
    vizPresetsArrayOpen: number;
    vizPresetsArrayClose: number;
}

/**
 * Find the matching closing bracket for an opening bracket.
 * Correctly handles nested brackets and string boundaries.
 */
function findMatchingBracket(content: string, openPos: number): number {
    const openChar = content[openPos];
    const closeChar = openChar === "[" ? "]" : openChar === "{" ? "}" : "";
    if (!closeChar) return -1;

    let depth = 1;
    let i = openPos + 1;
    let inString = false;
    let stringChar = "";

    while (i < content.length && depth > 0) {
        const ch = content[i];

        if (inString) {
            if (ch === "\\" && i + 1 < content.length) {
                i += 2;
                continue;
            }
            if (ch === stringChar) {
                inString = false;
            }
        } else {
            if (ch === '"' || ch === "'") {
                inString = true;
                stringChar = ch;
            } else if (ch === "/" && i + 1 < content.length && content[i + 1] === "/") {
                while (i < content.length && content[i] !== "\n") i++;
                continue;
            } else if (ch === "/" && i + 1 < content.length && content[i + 1] === "*") {
                i += 2;
                while (i < content.length - 1 && !(content[i] === "*" && content[i + 1] === "/")) i++;
                i += 2;
                continue;
            } else if (ch === openChar) {
                depth++;
            } else if (ch === closeChar) {
                depth--;
                if (depth === 0) return i;
            }
        }
        i++;
    }

    return -1;
}

/**
 * Convert a TypeScript object literal to valid JSON.
 * Handles: unquoted keys, trailing commas, comments, boolean/number values.
 */
function tsLiteralToJson(input: string): string {
    let output = "";
    let i = 0;

    while (i < input.length) {
        const ch = input[i];

        // Strings
        if (ch === '"' || ch === "'") {
            const quoteChar = ch;
            let str = '"';
            i++;
            while (i < input.length) {
                const c = input[i];
                if (c === "\\" && i + 1 < input.length) {
                    str += c + input[i + 1];
                    i += 2;
                } else if (c === quoteChar) {
                    str += '"';
                    i++;
                    break;
                } else if (c === '"' && quoteChar !== '"') {
                    str += '\\"';
                    i++;
                } else {
                    str += c;
                    i++;
                }
            }
            output += str;
            continue;
        }

        // Single-line comments
        if (ch === "/" && i + 1 < input.length && input[i + 1] === "/") {
            while (i < input.length && input[i] !== "\n") i++;
            continue;
        }

        // Multi-line comments
        if (ch === "/" && i + 1 < input.length && input[i + 1] === "*") {
            i += 2;
            while (i < input.length - 1 && !(input[i] === "*" && input[i + 1] === "/")) i++;
            i += 2;
            continue;
        }

        // Identifiers (object keys or keyword values)
        if (/[a-zA-Z_$]/.test(ch)) {
            let word = "";
            while (i < input.length && /[\w$]/.test(input[i])) {
                word += input[i];
                i++;
            }

            // Check if followed by colon (it's an object key)
            let j = i;
            while (j < input.length && /\s/.test(input[j])) j++;

            if (j < input.length && input[j] === ":") {
                output += `"${word}"`;
            } else if (word === "true" || word === "false" || word === "null") {
                output += word;
            } else if (word === "undefined") {
                output += "null";
            } else {
                // Unknown identifier as value - quote it
                output += `"${word}"`;
            }
            continue;
        }

        // Trailing commas - skip comma if next non-whitespace is } or ]
        if (ch === ",") {
            let j = i + 1;
            while (j < input.length && /\s/.test(input[j])) j++;
            if (j < input.length && (input[j] === "}" || input[j] === "]")) {
                i++;
                continue;
            }
            output += ",";
            i++;
            continue;
        }

        // Everything else
        output += ch;
        i++;
    }

    return output;
}

/**
 * Convert a JavaScript value to TypeScript object literal format.
 */
export function toTsLiteral(value: any, indent: number = 0): string {
    const pad = "  ".repeat(indent);
    const padInner = "  ".repeat(indent + 1);

    if (value === null || value === undefined) return "undefined";
    if (typeof value === "boolean") return String(value);
    if (typeof value === "number") return String(value);
    if (typeof value === "string") return JSON.stringify(value);

    if (Array.isArray(value)) {
        if (value.length === 0) return "[]";
        const items = value.map(
            (item) => `${padInner}${toTsLiteral(item, indent + 1)},`
        );
        return `[\n${items.join("\n")}\n${pad}]`;
    }

    if (typeof value === "object") {
        const entries = Object.entries(value).filter(([, v]) => v !== undefined);
        if (entries.length === 0) return "{}";
        const fields = entries.map(
            ([k, v]) => `${padInner}${k}: ${toTsLiteral(v, indent + 1)},`
        );
        return `{\n${fields.join("\n")}\n${pad}}`;
    }

    return String(value);
}

/**
 * Extract all vizPresets from a module definition TypeScript file.
 * Returns metadata about each preset including its position in the source.
 */
export function extractPresetsFromFile(fileContent: string): ExtractedPreset[] {
    const results: ExtractedPreset[] = [];
    const vizPresetsRegex = /vizPresets:\s*\[/g;
    let match;

    while ((match = vizPresetsRegex.exec(fileContent)) !== null) {
        const arrayOpenPos = fileContent.indexOf("[", match.index);
        const arrayClosePos = findMatchingBracket(fileContent, arrayOpenPos);
        if (arrayClosePos === -1) continue;

        // Find the metric ID that owns this vizPresets (look backwards)
        const preceding = fileContent.substring(0, match.index);
        const metricIdMatches = [...preceding.matchAll(/id:\s*"(m\d+-\d+-\d+)"/g)];
        const metricId =
            metricIdMatches.length > 0
                ? metricIdMatches[metricIdMatches.length - 1][1]
                : "unknown";

        // Find the metric label (between last metric id and this vizPresets)
        let metricLabel = metricId;
        if (metricIdMatches.length > 0) {
            const lastMatch = metricIdMatches[metricIdMatches.length - 1];
            const textBetween = fileContent.substring(lastMatch.index!, match.index);
            const labelMatch = textBetween.match(/label:\s*\{\s*en:\s*"([^"]+)"/);
            if (labelMatch) metricLabel = labelMatch[1];
        }

        // Extract individual preset objects from the array
        let pos = arrayOpenPos + 1;
        let presetIndex = 0;

        while (pos < arrayClosePos) {
            // Skip whitespace and commas
            while (pos < arrayClosePos && /[\s,]/.test(fileContent[pos])) pos++;
            if (pos >= arrayClosePos) break;

            if (fileContent[pos] === "{") {
                const presetClosePos = findMatchingBracket(fileContent, pos);
                if (presetClosePos === -1) break;

                const presetStr = fileContent.substring(pos, presetClosePos + 1);
                const lineStart = fileContent.lastIndexOf("\n", pos) + 1;
                const indentSpaces = pos - lineStart;

                try {
                    const jsonStr = tsLiteralToJson(presetStr);
                    const preset = JSON.parse(jsonStr);

                    results.push({
                        metricId,
                        metricLabel,
                        presetIndex,
                        preset,
                        startPos: pos,
                        endPos: presetClosePos + 1,
                        indent: Math.floor(indentSpaces / 2),
                    });
                } catch (e) {
                    // Fallback: extract id/label from raw text
                    const idMatch = presetStr.match(/id:\s*"([^"]+)"/);
                    const labelEnMatch = presetStr.match(/label:\s*\{\s*en:\s*"([^"]+)"/);

                    results.push({
                        metricId,
                        metricLabel,
                        presetIndex,
                        preset: {
                            id: idMatch ? idMatch[1] : `parse-error-${presetIndex}`,
                            label: {
                                en: labelEnMatch ? labelEnMatch[1] : "Parse Error",
                                fr: "",
                            },
                            description: { en: "", fr: "" },
                            config: {
                                d: {
                                    type: "table",
                                    periodOpt: "period_id",
                                    valuesDisDisplayOpt: "col",
                                    disaggregateBy: [],
                                    filterBy: [],
                                },
                            },
                            _parseError: true,
                            _rawText: presetStr,
                        },
                        startPos: pos,
                        endPos: presetClosePos + 1,
                        indent: Math.floor(indentSpaces / 2),
                    });
                }

                pos = presetClosePos + 1;
                presetIndex++;
            } else {
                pos++;
            }
        }
    }

    return results;
}

/**
 * Replace a specific vizPreset in the file content with an updated one.
 */
export function replacePresetInFile(
    fileContent: string,
    extracted: ExtractedPreset,
    newPreset: any
): string {
    const newTsLiteral = toTsLiteral(newPreset, extracted.indent);
    return (
        fileContent.substring(0, extracted.startPos) +
        newTsLiteral +
        fileContent.substring(extracted.endPos)
    );
}

/**
 * Info about a metric in the module definition file.
 */
export interface MetricInfo {
    metricId: string;
    metricLabel: string;
    hasVizPresets: boolean;
    arrayOpenPos: number;   // -1 if no vizPresets field
    arrayClosePos: number;  // -1 if no vizPresets field
    presetCount: number;
    metricObjectEnd: number; // position of the closing } of the metric object
}

/**
 * Extract ALL metrics from the file, whether or not they have a vizPresets array.
 * Finds metrics by walking the `metrics: [...]` array and looking at each object.
 */
export function extractMetricsFromFile(fileContent: string): MetricInfo[] {
    const results: MetricInfo[] = [];

    // Find the metrics: [ array
    const metricsMatch = fileContent.match(/metrics:\s*\[/);
    if (!metricsMatch || metricsMatch.index === undefined) return results;

    const metricsArrayOpen = fileContent.indexOf("[", metricsMatch.index);
    const metricsArrayClose = findMatchingBracket(fileContent, metricsArrayOpen);
    if (metricsArrayClose === -1) return results;

    // Walk each top-level object in the metrics array
    let pos = metricsArrayOpen + 1;
    while (pos < metricsArrayClose) {
        while (pos < metricsArrayClose && /[\s,]/.test(fileContent[pos])) pos++;
        if (pos >= metricsArrayClose) break;

        if (fileContent[pos] === "{") {
            const metricClose = findMatchingBracket(fileContent, pos);
            if (metricClose === -1) break;

            const metricContent = fileContent.substring(pos, metricClose + 1);

            // Extract metric id
            const idMatch = metricContent.match(/id:\s*"([^"]+)"/);
            if (!idMatch) {
                pos = metricClose + 1;
                continue;
            }
            const metricId = idMatch[1];

            // Extract metric label
            const labelMatch = metricContent.match(/label:\s*\{\s*en:\s*"([^"]+)"/);
            const metricLabel = labelMatch ? labelMatch[1] : metricId;

            // Look for vizPresets inside this metric
            const vizPresetsMatch = metricContent.match(/vizPresets:\s*\[/);

            let arrayOpenPos = -1;
            let arrayClosePos = -1;
            let presetCount = 0;

            if (vizPresetsMatch && vizPresetsMatch.index !== undefined) {
                // vizPresets exists — find its bounds in the full file
                const relativeArrayOpen = metricContent.indexOf("[", vizPresetsMatch.index);
                arrayOpenPos = pos + relativeArrayOpen;
                arrayClosePos = findMatchingBracket(fileContent, arrayOpenPos);

                if (arrayClosePos !== -1) {
                    let p = arrayOpenPos + 1;
                    while (p < arrayClosePos) {
                        while (p < arrayClosePos && /[\s,]/.test(fileContent[p])) p++;
                        if (p >= arrayClosePos) break;
                        if (fileContent[p] === "{") {
                            const close = findMatchingBracket(fileContent, p);
                            if (close === -1) break;
                            presetCount++;
                            p = close + 1;
                        } else {
                            p++;
                        }
                    }
                }
            }

            results.push({
                metricId,
                metricLabel,
                hasVizPresets: vizPresetsMatch !== null,
                arrayOpenPos,
                arrayClosePos,
                presetCount,
                metricObjectEnd: metricClose,
            });

            pos = metricClose + 1;
        } else {
            pos++;
        }
    }

    return results;
}

/**
 * Insert a new vizPreset into a metric.
 * Works for metrics with an existing vizPresets array or ones without.
 * Returns the updated file content and a key to select the new preset.
 */
export function insertPresetInFile(
    fileContent: string,
    targetMetricId: string,
    newPreset: any
): { content: string; insertedKey: string } | null {
    const metrics = extractMetricsFromFile(fileContent);
    const metric = metrics.find((m) => m.metricId === targetMetricId);
    if (!metric) return null;

    if (metric.hasVizPresets && metric.arrayOpenPos !== -1 && metric.arrayClosePos !== -1) {
        // --- Metric already has vizPresets: [...] — append to the array ---
        const existingPresets = extractPresetsFromFile(fileContent).filter(
            (p) => p.metricId === targetMetricId
        );
        const indent = existingPresets.length > 0 ? existingPresets[0].indent : 4;

        const newTsLiteral = toTsLiteral(newPreset, indent);
        const pad = "  ".repeat(indent);
        const outerPad = "  ".repeat(Math.max(0, indent - 1));

        const beforeClose = fileContent.substring(metric.arrayOpenPos + 1, metric.arrayClosePos);
        const hasContent = beforeClose.trim().length > 0;

        let newArrayContent: string;
        if (hasContent) {
            newArrayContent = beforeClose.trimEnd() + "\n" + pad + newTsLiteral + ",\n" + outerPad;
        } else {
            newArrayContent = "\n" + pad + newTsLiteral + ",\n" + outerPad;
        }

        const content =
            fileContent.substring(0, metric.arrayOpenPos + 1) +
            newArrayContent +
            fileContent.substring(metric.arrayClosePos);

        return {
            content,
            insertedKey: `${targetMetricId}::${newPreset.id}::${metric.presetCount}`,
        };
    } else {
        // --- Metric has no vizPresets field — add one before the closing } ---
        const metricEndPos = metric.metricObjectEnd;

        // Find the indent of the metric's closing }
        const prevNewline = fileContent.lastIndexOf("\n", metricEndPos - 1);
        const closingIndentStr = fileContent.substring(prevNewline + 1, metricEndPos);
        const closingSpaces = closingIndentStr.length;
        const propSpaces = closingSpaces + 2;   // property indent (one level deeper)
        const presetSpaces = propSpaces + 2;    // preset object indent (two levels deeper)

        const propPad = " ".repeat(propSpaces);
        const presetPad = " ".repeat(presetSpaces);
        const arrayClosePad = " ".repeat(propSpaces);

        const presetIndentLevel = Math.floor(presetSpaces / 2);
        const newTsLiteral = toTsLiteral(newPreset, presetIndentLevel);

        // Find the last non-whitespace before the closing }
        let contentEnd = metricEndPos - 1;
        while (contentEnd > 0 && /\s/.test(fileContent[contentEnd])) contentEnd--;
        contentEnd++; // position after last content char

        // Check if the last property has a trailing comma
        const lastChar = fileContent[contentEnd - 1];
        const needsComma = lastChar !== ",";

        const content =
            fileContent.substring(0, contentEnd) +
            (needsComma ? "," : "") +
            "\n" + propPad + "vizPresets: [\n" +
            presetPad + newTsLiteral + ",\n" +
            arrayClosePad + "],\n" +
            " ".repeat(closingSpaces) +
            fileContent.substring(metricEndPos);

        return {
            content,
            insertedKey: `${targetMetricId}::${newPreset.id}::0`,
        };
    }
}

/**
 * Delete a vizPreset from the file content.
 */
export function deletePresetFromFile(
    fileContent: string,
    extracted: ExtractedPreset
): string {
    let start = extracted.startPos;
    let end = extracted.endPos;

    // Remove trailing comma
    if (end < fileContent.length && fileContent[end] === ",") {
        end++;
    }

    // Remove trailing whitespace until newline
    while (end < fileContent.length && (fileContent[end] === " " || fileContent[end] === "\t")) {
        end++;
    }
    // Remove one trailing newline
    if (end < fileContent.length && fileContent[end] === "\n") {
        end++;
    }

    // Remove leading whitespace on the line
    while (start > 0 && (fileContent[start - 1] === " " || fileContent[start - 1] === "\t")) {
        start--;
    }

    return fileContent.substring(0, start) + fileContent.substring(end);
}

// ────────────────────────────────────────────
// ResultsObject extraction and replacement
// ────────────────────────────────────────────

/**
 * Extract all resultsObjects from a module definition file.
 */
export function extractResultsObjectsFromFile(fileContent: string): ExtractedResultsObject[] {
    const results: ExtractedResultsObject[] = [];

    const roMatch = fileContent.match(/resultsObjects:\s*\[/);
    if (!roMatch || roMatch.index === undefined) return results;

    const arrayOpen = fileContent.indexOf("[", roMatch.index);
    const arrayClose = findMatchingBracket(fileContent, arrayOpen);
    if (arrayClose === -1) return results;

    let pos = arrayOpen + 1;
    let index = 0;

    while (pos < arrayClose) {
        while (pos < arrayClose && /[\s,]/.test(fileContent[pos])) pos++;
        if (pos >= arrayClose) break;

        if (fileContent[pos] === "{") {
            const objClose = findMatchingBracket(fileContent, pos);
            if (objClose === -1) break;

            const objStr = fileContent.substring(pos, objClose + 1);
            const lineStart = fileContent.lastIndexOf("\n", pos) + 1;
            const indentSpaces = pos - lineStart;

            try {
                const jsonStr = tsLiteralToJson(objStr);
                const data = JSON.parse(jsonStr);

                results.push({
                    id: data.id ?? `ro-${index}`,
                    data,
                    startPos: pos,
                    endPos: objClose + 1,
                    indent: Math.floor(indentSpaces / 2),
                    index,
                });
            } catch {
                // Skip unparseable objects
            }

            pos = objClose + 1;
            index++;
        } else {
            pos++;
        }
    }

    return results;
}

/**
 * Replace a resultsObject in the file content.
 */
export function replaceResultsObjectInFile(
    fileContent: string,
    extracted: ExtractedResultsObject,
    newData: any
): string {
    const newTsLiteral = toTsLiteral(newData, extracted.indent);
    return (
        fileContent.substring(0, extracted.startPos) +
        newTsLiteral +
        fileContent.substring(extracted.endPos)
    );
}

// ────────────────────────────────────────────
// Full metric extraction and replacement
// ────────────────────────────────────────────

/**
 * Extract all metrics with full parsed data from a module definition file.
 * The `data` field contains the parsed metric WITHOUT the vizPresets array.
 */
export function extractFullMetricsFromFile(fileContent: string): ExtractedMetric[] {
    const results: ExtractedMetric[] = [];

    const metricsMatch = fileContent.match(/metrics:\s*\[/);
    if (!metricsMatch || metricsMatch.index === undefined) return results;

    const metricsArrayOpen = fileContent.indexOf("[", metricsMatch.index);
    const metricsArrayClose = findMatchingBracket(fileContent, metricsArrayOpen);
    if (metricsArrayClose === -1) return results;

    let pos = metricsArrayOpen + 1;
    let index = 0;

    while (pos < metricsArrayClose) {
        while (pos < metricsArrayClose && /[\s,]/.test(fileContent[pos])) pos++;
        if (pos >= metricsArrayClose) break;

        if (fileContent[pos] === "{") {
            const metricClose = findMatchingBracket(fileContent, pos);
            if (metricClose === -1) break;

            const metricStr = fileContent.substring(pos, metricClose + 1);
            const lineStart = fileContent.lastIndexOf("\n", pos) + 1;
            const indentSpaces = pos - lineStart;

            // Find vizPresets array bounds within this metric
            let vizPresetsArrayOpen = -1;
            let vizPresetsArrayClose = -1;
            const vpMatch = metricStr.match(/vizPresets:\s*\[/);
            if (vpMatch && vpMatch.index !== undefined) {
                const relArrayOpen = metricStr.indexOf("[", vpMatch.index);
                vizPresetsArrayOpen = pos + relArrayOpen;
                vizPresetsArrayClose = findMatchingBracket(fileContent, vizPresetsArrayOpen);
            }

            try {
                const jsonStr = tsLiteralToJson(metricStr);
                const fullData = JSON.parse(jsonStr);

                // Remove vizPresets from parsed data (edited separately)
                const { vizPresets: _, ...dataWithoutPresets } = fullData;

                const metricId = fullData.id ?? `metric-${index}`;
                const resultsObjectId = fullData.resultsObjectId ?? "";
                const labelEn = fullData.label?.en ?? metricId;
                const labelFr = fullData.label?.fr ?? "";

                results.push({
                    metricId,
                    resultsObjectId,
                    label: { en: labelEn, fr: labelFr },
                    data: dataWithoutPresets,
                    startPos: pos,
                    endPos: metricClose + 1,
                    indent: Math.floor(indentSpaces / 2),
                    index,
                    vizPresetsArrayOpen,
                    vizPresetsArrayClose,
                });
            } catch {
                // Fallback: extract basic info from regex
                const idMatch = metricStr.match(/id:\s*"([^"]+)"/);
                const roIdMatch = metricStr.match(/resultsObjectId:\s*"([^"]+)"/);
                const labelMatch = metricStr.match(/label:\s*\{\s*en:\s*"([^"]+)"/);

                if (idMatch) {
                    results.push({
                        metricId: idMatch[1],
                        resultsObjectId: roIdMatch ? roIdMatch[1] : "",
                        label: {
                            en: labelMatch ? labelMatch[1] : idMatch[1],
                            fr: "",
                        },
                        data: null,  // parse failed
                        startPos: pos,
                        endPos: metricClose + 1,
                        indent: Math.floor(indentSpaces / 2),
                        index,
                        vizPresetsArrayOpen,
                        vizPresetsArrayClose,
                    });
                }
            }

            pos = metricClose + 1;
            index++;
        } else {
            pos++;
        }
    }

    return results;
}

/**
 * Replace a metric in the file content, preserving the original vizPresets text.
 */
export function replaceMetricInFile(
    fileContent: string,
    extracted: ExtractedMetric,
    newMetricData: any
): string {
    // Extract the original vizPresets text from the file (if it exists)
    let vizPresetsText = "";
    if (extracted.vizPresetsArrayOpen !== -1 && extracted.vizPresetsArrayClose !== -1) {
        const metricText = fileContent.substring(extracted.startPos, extracted.endPos);
        const vpKeyMatch = metricText.match(/vizPresets:\s*\[/);
        if (vpKeyMatch && vpKeyMatch.index !== undefined) {
            const vpStart = extracted.startPos + vpKeyMatch.index;
            let vpEnd = extracted.vizPresetsArrayClose + 1;
            // Include trailing comma if present
            if (vpEnd < fileContent.length && fileContent[vpEnd] === ",") vpEnd++;
            vizPresetsText = fileContent.substring(vpStart, vpEnd);
        }
    }

    // Build new metric object (without vizPresets)
    let newTsLiteral = toTsLiteral(newMetricData, extracted.indent);

    // If there were vizPresets, inject them before the closing }
    if (vizPresetsText) {
        const closingBrace = newTsLiteral.lastIndexOf("}");
        const innerPad = "  ".repeat(extracted.indent + 1);
        const outerPad = "  ".repeat(extracted.indent);
        newTsLiteral =
            newTsLiteral.substring(0, closingBrace) +
            innerPad + vizPresetsText + "\n" +
            outerPad + "}";
    }

    return (
        fileContent.substring(0, extracted.startPos) +
        newTsLiteral +
        fileContent.substring(extracted.endPos)
    );
}
