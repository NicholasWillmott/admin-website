import { createSignal, createMemo, For, Show } from "solid-js";
import { createStore, produce } from "solid-js/store";
import {
    extractPresetsFromFile,
    extractMetricsFromFile,
    replacePresetInFile,
    insertPresetInFile,
    deletePresetFromFile,
    type ExtractedPreset,
} from "./vizPresetParser";

// === Constants ===

const PRESENTATION_TYPES = ["timeseries", "table", "chart"];
const PERIOD_OPTIONS = ["period_id", "quarter_id", "year"];
const DIS_DISPLAY_OPTIONS = ["col", "row", "series", "cell", "indicator", "replicant"];
const DISAGGREGATION_OPTIONS = [
    "indicator_common_id", "admin_area_2", "admin_area_3", "admin_area_4",
    "facility_name", "facility_type", "facility_ownership",
    "denominator", "denominator_best_or_survey", "source_indicator",
    "target_population", "ratio_type", "hfa_indicator", "hfa_category", "time_point",
];
const CONTENT_OPTIONS = ["lines", "bars", "points", "areas"];
const ASPECT_RATIO_OPTIONS = ["none", "video", "square", "ideal"];
const CONDITIONAL_FORMATTING_OPTIONS = [
    "none", "fmt-90-80", "fmt-80-70", "fmt-10-20", "fmt-05-10",
    "fmt-01-03", "fmt-neg10-pos10", "fmt-thresholds-1-2-5",
    "fmt-thresholds-2-5-10", "fmt-thresholds-5-10-20",
];
const COLOR_SCALE_OPTIONS = [
    "pastel-discrete", "alt-discrete", "red-green", "blue-green", "single-grey", "custom",
];
const SORT_OPTIONS = ["none", "ascending", "descending"];

interface StyleFieldDef {
    key: string;
    label: string;
    type: "boolean" | "number" | "select";
    default: any;
    options?: string[];
    min?: number;
    max?: number;
    step?: number;
}

const STYLE_FIELD_DEFS: StyleFieldDef[] = [
    { key: "content", label: "Display Format", type: "select", default: "bars", options: CONTENT_OPTIONS },
    { key: "scale", label: "Scale", type: "number", default: 3, min: 0.1, max: 5, step: 0.1 },
    { key: "idealAspectRatio", label: "Aspect Ratio", type: "select", default: "none", options: ASPECT_RATIO_OPTIONS },
    { key: "decimalPlaces", label: "Decimal Places", type: "number", default: 0, min: 0, max: 3, step: 1 },
    { key: "conditionalFormatting", label: "Conditional Formatting", type: "select", default: "none", options: CONDITIONAL_FORMATTING_OPTIONS },
    { key: "colorScale", label: "Color Scale", type: "select", default: "pastel-discrete", options: COLOR_SCALE_OPTIONS },
    { key: "sortIndicatorValues", label: "Sort Values", type: "select", default: "none", options: SORT_OPTIONS },
    { key: "showDataLabels", label: "Show Data Labels", type: "boolean", default: false },
    { key: "showDataLabelsLineCharts", label: "Show Data Labels (Lines)", type: "boolean", default: false },
    { key: "barsStacked", label: "Stacked Bars", type: "boolean", default: false },
    { key: "verticalTickLabels", label: "Vertical Tick Labels", type: "boolean", default: false },
    { key: "forceYMax1", label: "Force Y-axis Max 100%", type: "boolean", default: false },
    { key: "forceYMinAuto", label: "Allow Auto Y-axis Min", type: "boolean", default: false },
    { key: "hideLegend", label: "Hide Legend", type: "boolean", default: false },
    { key: "allowIndividualRowLimits", label: "Allow Row Limits", type: "boolean", default: true },
    { key: "allowVerticalColHeaders", label: "Vertical Col Headers", type: "boolean", default: true },
    { key: "specialCoverageChart", label: "Special Coverage Chart", type: "boolean", default: false },
    { key: "specialBarChart", label: "Special % Change Chart", type: "boolean", default: false },
    { key: "specialBarChartDiffThreshold", label: "Change Threshold", type: "number", default: 0.1, min: 0, max: 0.25, step: 0.01 },
    { key: "specialBarChartInverted", label: "Invert Change Colors", type: "boolean", default: false },
    { key: "specialBarChartDataLabels", label: "Change Data Labels", type: "select", default: "threshold-values", options: ["all-values", "threshold-values"] },
    { key: "specialScorecardTable", label: "Special Scorecard", type: "boolean", default: false },
    { key: "diffAreas", label: "Diff Areas", type: "boolean", default: false },
    { key: "diffInverted", label: "Invert Diff Colors", type: "boolean", default: false },
];

// === Main Component ===

interface Props {
    fileContent: string;
    onFileContentChange: (content: string) => void;
}

export function VizPresetFormEditor(props: Props) {
    const extractedPresets = createMemo(() => extractPresetsFromFile(props.fileContent));

    const [selectedKey, setSelectedKey] = createSignal<string | null>(null);
    const [activeTab, setActiveTab] = createSignal<"general" | "data" | "style" | "text">("general");
    const [formDirty, setFormDirty] = createSignal(false);

    const [form, setForm] = createStore<{ preset: any }>({ preset: null });

    function makeKey(p: ExtractedPreset): string {
        return `${p.metricId}::${p.preset.id}::${p.presetIndex}`;
    }

    const selectedExtracted = createMemo(() => {
        const key = selectedKey();
        if (!key) return null;
        return extractedPresets().find((p) => makeKey(p) === key) || null;
    });

    function selectPreset(key: string) {
        if (formDirty() && selectedExtracted()) {
            applyToCode();
        }
        const preset = extractedPresets().find((p) => makeKey(p) === key);
        if (!preset) return;

        setSelectedKey(key);
        setForm("preset", structuredClone(preset.preset));
        setFormDirty(false);
    }

    function updateField(updater: (draft: any) => void) {
        setForm("preset", produce(updater));
        setFormDirty(true);
    }

    function applyToCode() {
        const extracted = selectedExtracted();
        if (!extracted || !form.preset) return;

        const newContent = replacePresetInFile(props.fileContent, extracted, form.preset);
        props.onFileContentChange(newContent);

        const newKey = `${extracted.metricId}::${form.preset.id}::${extracted.presetIndex}`;
        setSelectedKey(newKey);
        setFormDirty(false);
    }

    // --- New preset ---
    const [showNewPanel, setShowNewPanel] = createSignal(false);
    const [newMetricId, setNewMetricId] = createSignal("");

    const availableMetrics = createMemo(() => extractMetricsFromFile(props.fileContent));

    function createNewPreset() {
        const metricId = newMetricId();
        if (!metricId) return;

        const newPreset = {
            id: "new-viz-preset",
            label: { en: "New Visualization", fr: "Nouvelle visualisation" },
            description: { en: "", fr: "" },
            createDefaultVisualizationOnInstall: crypto.randomUUID(),
            config: {
                d: {
                    type: "timeseries",
                    periodOpt: "period_id",
                    valuesDisDisplayOpt: "series",
                    disaggregateBy: [],
                    filterBy: [],
                },
            },
        };

        const result = insertPresetInFile(props.fileContent, metricId, newPreset);
        if (!result) return;

        props.onFileContentChange(result.content);
        setShowNewPanel(false);
        setNewMetricId("");

        // Select the newly created preset
        queueMicrotask(() => {
            setSelectedKey(result.insertedKey);
            const presets = extractPresetsFromFile(result.content);
            const found = presets.find((p) => makeKey(p) === result.insertedKey);
            if (found) {
                setForm("preset", structuredClone(found.preset));
                setFormDirty(false);
                setActiveTab("general");
            }
        });
    }

    // --- Delete preset ---
    function deleteSelectedPreset() {
        const extracted = selectedExtracted();
        if (!extracted) return;

        const label = extracted.preset.label?.en || extracted.preset.id;
        if (!confirm(`Delete vizPreset "${label}" from ${extracted.metricId}?`)) return;

        const newContent = deletePresetFromFile(props.fileContent, extracted);
        props.onFileContentChange(newContent);
        setSelectedKey(null);
        setForm("preset", null);
        setFormDirty(false);
    }

    // Group presets by metric for the selector
    const groupedPresets = createMemo(() => {
        const groups: { metricId: string; metricLabel: string; presets: ExtractedPreset[] }[] = [];
        for (const p of extractedPresets()) {
            let group = groups.find((g) => g.metricId === p.metricId);
            if (!group) {
                group = { metricId: p.metricId, metricLabel: p.metricLabel, presets: [] };
                groups.push(group);
            }
            group.presets.push(p);
        }
        return groups;
    });

    return (
        <div class="form-editor-layout">
            {/* Header: preset selector + action buttons */}
            <div class="form-editor-header">
                <div class="preset-selector">
                    <label>VizPreset:</label>
                    <select
                        value={selectedKey() || ""}
                        onChange={(e) => {
                            const val = e.currentTarget.value;
                            if (val) selectPreset(val);
                        }}
                    >
                        <option value="">-- Choose a vizPreset --</option>
                        <For each={groupedPresets()}>
                            {(group) => (
                                <optgroup label={`${group.metricId} - ${group.metricLabel}`}>
                                    <For each={group.presets}>
                                        {(p) => (
                                            <option value={makeKey(p)}>
                                                {p.preset.label?.en || p.preset.id}
                                            </option>
                                        )}
                                    </For>
                                </optgroup>
                            )}
                        </For>
                    </select>
                </div>
                <div class="form-editor-actions">
                    <button
                        class="new-preset-btn"
                        onClick={() => setShowNewPanel(!showNewPanel())}
                    >
                        {showNewPanel() ? "Cancel" : "New VizPreset"}
                    </button>
                    <Show when={selectedKey()}>
                        <button class="delete-preset-btn" onClick={deleteSelectedPreset}>
                            Delete
                        </button>
                    </Show>
                    <Show when={formDirty()}>
                        <button class="apply-btn" onClick={applyToCode}>
                            Apply to Code
                        </button>
                    </Show>
                </div>
            </div>

            {/* Inline panel for creating a new preset */}
            <Show when={showNewPanel()}>
                <div class="new-preset-panel">
                    <label>Add to metric:</label>
                    <select
                        value={newMetricId()}
                        onChange={(e) => setNewMetricId(e.currentTarget.value)}
                    >
                        <option value="">-- Select metric --</option>
                        <For each={availableMetrics()}>
                            {(m) => (
                                <option value={m.metricId}>
                                    {m.metricId} - {m.metricLabel} ({m.presetCount} presets)
                                </option>
                            )}
                        </For>
                    </select>
                    <button
                        class="add-btn"
                        disabled={!newMetricId()}
                        onClick={createNewPreset}
                    >
                        Create
                    </button>
                </div>
            </Show>

            <Show
                when={form.preset}
                fallback={
                    <div class="form-editor-empty">
                        Select a vizPreset from the dropdown above to edit its configuration
                    </div>
                }
            >
                {/* Parse error warning */}
                <Show when={form.preset?._parseError}>
                    <div class="form-parse-error">
                        This preset could not be fully parsed. Some fields may be missing. Edit in code view for full control.
                    </div>
                </Show>

                {/* Tab bar */}
                <div class="form-tabs">
                    <For each={["general", "data", "style", "text"] as const}>
                        {(tab) => (
                            <button
                                class="form-tab"
                                data-selected={activeTab() === tab}
                                onClick={() => setActiveTab(tab)}
                            >
                                {tab.charAt(0).toUpperCase() + tab.slice(1)}
                            </button>
                        )}
                    </For>
                </div>

                {/* Tab content */}
                <div class="form-tab-content">
                    <Show when={activeTab() === "general"}>
                        <GeneralTab preset={form.preset} updateField={updateField} />
                    </Show>
                    <Show when={activeTab() === "data"}>
                        <DataTab preset={form.preset} updateField={updateField} />
                    </Show>
                    <Show when={activeTab() === "style"}>
                        <StyleTab preset={form.preset} updateField={updateField} />
                    </Show>
                    <Show when={activeTab() === "text"}>
                        <TextTab preset={form.preset} updateField={updateField} />
                    </Show>
                </div>
            </Show>
        </div>
    );
}

// === Tab Components ===

interface TabProps {
    preset: any;
    updateField: (fn: (d: any) => void) => void;
}

// --- General Tab ---

function GeneralTab(props: TabProps) {
    return (
        <div class="form-section">
            <div class="form-group">
                <label>ID</label>
                <input
                    type="text"
                    value={props.preset.id || ""}
                    onInput={(e) => props.updateField((d) => { d.id = e.currentTarget.value; })}
                />
            </div>

            <div class="form-row">
                <div class="form-group">
                    <label>Label (EN)</label>
                    <input
                        type="text"
                        value={props.preset.label?.en || ""}
                        onInput={(e) => props.updateField((d) => {
                            if (!d.label) d.label = { en: "", fr: "" };
                            d.label.en = e.currentTarget.value;
                        })}
                    />
                </div>
                <div class="form-group">
                    <label>Label (FR)</label>
                    <input
                        type="text"
                        value={props.preset.label?.fr || ""}
                        onInput={(e) => props.updateField((d) => {
                            if (!d.label) d.label = { en: "", fr: "" };
                            d.label.fr = e.currentTarget.value;
                        })}
                    />
                </div>
            </div>

            <div class="form-row">
                <div class="form-group">
                    <label>Description (EN)</label>
                    <textarea
                        value={props.preset.description?.en || ""}
                        onInput={(e) => props.updateField((d) => {
                            if (!d.description) d.description = { en: "", fr: "" };
                            d.description.en = e.currentTarget.value;
                        })}
                        rows={3}
                    />
                </div>
                <div class="form-group">
                    <label>Description (FR)</label>
                    <textarea
                        value={props.preset.description?.fr || ""}
                        onInput={(e) => props.updateField((d) => {
                            if (!d.description) d.description = { en: "", fr: "" };
                            d.description.fr = e.currentTarget.value;
                        })}
                        rows={3}
                    />
                </div>
            </div>

            <div class="form-group">
                <label class="checkbox-label">
                    <input
                        type="checkbox"
                        checked={props.preset.needsReplicant || false}
                        onChange={(e) => props.updateField((d) => {
                            if (e.currentTarget.checked) {
                                d.needsReplicant = true;
                            } else {
                                delete d.needsReplicant;
                            }
                        })}
                    />
                    Needs Replicant
                </label>
            </div>

            <div class="form-group">
                <label>Default Visualization UUID</label>
                <input
                    type="text"
                    value={props.preset.createDefaultVisualizationOnInstall || ""}
                    onInput={(e) => props.updateField((d) => {
                        const val = e.currentTarget.value.trim();
                        if (val) {
                            d.createDefaultVisualizationOnInstall = val;
                        } else {
                            delete d.createDefaultVisualizationOnInstall;
                        }
                    })}
                    placeholder="UUID (optional)"
                />
            </div>

            <div class="form-group">
                <label>Default Period Filter (months)</label>
                <input
                    type="number"
                    value={props.preset.defaultPeriodFilterForDefaultVisualizations?.nMonths ?? ""}
                    onInput={(e) => props.updateField((d) => {
                        const val = parseInt(e.currentTarget.value);
                        if (!isNaN(val) && val > 0) {
                            d.defaultPeriodFilterForDefaultVisualizations = { nMonths: val };
                        } else {
                            delete d.defaultPeriodFilterForDefaultVisualizations;
                        }
                    })}
                    min={1}
                    max={60}
                />
            </div>

            <div class="form-group">
                <label>Allowed Filters</label>
                <div class="chip-group">
                    <For each={DISAGGREGATION_OPTIONS}>
                        {(opt) => {
                            const isChecked = () => (props.preset.allowedFilters || []).includes(opt);
                            return (
                                <label class="chip-label" data-checked={isChecked()}>
                                    <input
                                        type="checkbox"
                                        checked={isChecked()}
                                        onChange={(e) => props.updateField((d) => {
                                            if (!d.allowedFilters) d.allowedFilters = [];
                                            if (e.currentTarget.checked) {
                                                d.allowedFilters.push(opt);
                                            } else {
                                                d.allowedFilters = d.allowedFilters.filter((f: string) => f !== opt);
                                            }
                                            if (d.allowedFilters.length === 0) delete d.allowedFilters;
                                        })}
                                    />
                                    {opt.replace(/_/g, " ")}
                                </label>
                            );
                        }}
                    </For>
                </div>
            </div>
        </div>
    );
}

// --- Data Tab ---

function DataTab(props: TabProps) {
    const config = () => props.preset.config?.d || {};

    return (
        <div class="form-section">
            <div class="form-row">
                <div class="form-group">
                    <label>Presentation Type</label>
                    <select
                        value={config().type || "table"}
                        onChange={(e) => props.updateField((d) => { d.config.d.type = e.currentTarget.value; })}
                    >
                        <For each={PRESENTATION_TYPES}>
                            {(t) => <option value={t}>{t}</option>}
                        </For>
                    </select>
                </div>
                <div class="form-group">
                    <label>Period Option</label>
                    <select
                        value={config().periodOpt || "period_id"}
                        onChange={(e) => props.updateField((d) => { d.config.d.periodOpt = e.currentTarget.value; })}
                    >
                        <For each={PERIOD_OPTIONS}>
                            {(t) => <option value={t}>{t}</option>}
                        </For>
                    </select>
                </div>
                <div class="form-group">
                    <label>Values Display</label>
                    <select
                        value={config().valuesDisDisplayOpt || "col"}
                        onChange={(e) => props.updateField((d) => { d.config.d.valuesDisDisplayOpt = e.currentTarget.value; })}
                    >
                        <For each={DIS_DISPLAY_OPTIONS}>
                            {(t) => <option value={t}>{t}</option>}
                        </For>
                    </select>
                </div>
            </div>

            {/* Disaggregate By */}
            <div class="form-group">
                <label>Disaggregate By</label>
                <div class="list-editor">
                    <For each={config().disaggregateBy || []}>
                        {(entry: any, idx) => (
                            <div class="list-editor-row">
                                <select
                                    value={entry.disOpt}
                                    onChange={(e) => props.updateField((d) => {
                                        d.config.d.disaggregateBy[idx()].disOpt = e.currentTarget.value;
                                    })}
                                >
                                    <For each={DISAGGREGATION_OPTIONS}>
                                        {(opt) => <option value={opt}>{opt.replace(/_/g, " ")}</option>}
                                    </For>
                                </select>
                                <select
                                    value={entry.disDisplayOpt}
                                    onChange={(e) => props.updateField((d) => {
                                        d.config.d.disaggregateBy[idx()].disDisplayOpt = e.currentTarget.value;
                                    })}
                                >
                                    <For each={DIS_DISPLAY_OPTIONS}>
                                        {(opt) => <option value={opt}>{opt}</option>}
                                    </For>
                                </select>
                                <button
                                    class="remove-btn"
                                    onClick={() => props.updateField((d) => {
                                        d.config.d.disaggregateBy.splice(idx(), 1);
                                    })}
                                >
                                    &times;
                                </button>
                            </div>
                        )}
                    </For>
                    <button
                        class="add-btn"
                        onClick={() => props.updateField((d) => {
                            if (!d.config.d.disaggregateBy) d.config.d.disaggregateBy = [];
                            d.config.d.disaggregateBy.push({ disOpt: "indicator_common_id", disDisplayOpt: "row" });
                        })}
                    >
                        + Add Disaggregation
                    </button>
                </div>
            </div>

            {/* Filter By */}
            <div class="form-group">
                <label>Filter By</label>
                <div class="list-editor">
                    <For each={config().filterBy || []}>
                        {(entry: any, idx) => (
                            <div class="list-editor-row">
                                <select
                                    value={entry.disOpt}
                                    onChange={(e) => props.updateField((d) => {
                                        d.config.d.filterBy[idx()].disOpt = e.currentTarget.value;
                                    })}
                                >
                                    <For each={DISAGGREGATION_OPTIONS}>
                                        {(opt) => <option value={opt}>{opt.replace(/_/g, " ")}</option>}
                                    </For>
                                </select>
                                <input
                                    type="text"
                                    value={(entry.values || []).join(", ")}
                                    onInput={(e) => props.updateField((d) => {
                                        d.config.d.filterBy[idx()].values = e.currentTarget.value
                                            .split(",")
                                            .map((s: string) => s.trim())
                                            .filter(Boolean);
                                    })}
                                    placeholder="Comma-separated values"
                                />
                                <button
                                    class="remove-btn"
                                    onClick={() => props.updateField((d) => {
                                        d.config.d.filterBy.splice(idx(), 1);
                                    })}
                                >
                                    &times;
                                </button>
                            </div>
                        )}
                    </For>
                    <button
                        class="add-btn"
                        onClick={() => props.updateField((d) => {
                            if (!d.config.d.filterBy) d.config.d.filterBy = [];
                            d.config.d.filterBy.push({ disOpt: "indicator_common_id", values: [] });
                        })}
                    >
                        + Add Filter
                    </button>
                </div>
            </div>

            {/* Values Filter */}
            <div class="form-group">
                <label>Values Filter</label>
                <input
                    type="text"
                    value={(config().valuesFilter || []).join(", ")}
                    onInput={(e) => props.updateField((d) => {
                        const vals = e.currentTarget.value.split(",").map((s: string) => s.trim()).filter(Boolean);
                        if (vals.length > 0) {
                            d.config.d.valuesFilter = vals;
                        } else {
                            delete d.config.d.valuesFilter;
                        }
                    })}
                    placeholder="Comma-separated value prop names (optional)"
                />
            </div>

            {/* Replicant */}
            <Show when={props.preset.needsReplicant}>
                <div class="form-group">
                    <label>Selected Replicant Value</label>
                    <input
                        type="text"
                        value={config().selectedReplicantValue || ""}
                        onInput={(e) => props.updateField((d) => {
                            const val = e.currentTarget.value.trim();
                            if (val) d.config.d.selectedReplicantValue = val;
                            else delete d.config.d.selectedReplicantValue;
                        })}
                    />
                </div>
            </Show>

            {/* National options */}
            <div class="form-group">
                <label class="checkbox-label">
                    <input
                        type="checkbox"
                        checked={config().includeNationalForAdminArea2 || false}
                        onChange={(e) => props.updateField((d) => {
                            if (e.currentTarget.checked) {
                                d.config.d.includeNationalForAdminArea2 = true;
                            } else {
                                delete d.config.d.includeNationalForAdminArea2;
                                delete d.config.d.includeNationalPosition;
                            }
                        })}
                    />
                    Include National for Admin Area 2
                </label>
            </div>
            <Show when={config().includeNationalForAdminArea2}>
                <div class="form-group">
                    <label>National Position</label>
                    <select
                        value={config().includeNationalPosition || "bottom"}
                        onChange={(e) => props.updateField((d) => {
                            d.config.d.includeNationalPosition = e.currentTarget.value;
                        })}
                    >
                        <option value="top">Top</option>
                        <option value="bottom">Bottom</option>
                    </select>
                </div>
            </Show>
        </div>
    );
}

// --- Style Tab ---

function StyleTab(props: TabProps) {
    const style = () => props.preset.config?.s || {};
    const presentKeys = createMemo(() => new Set(Object.keys(style())));

    const activeFields = createMemo(() =>
        STYLE_FIELD_DEFS.filter((f) => presentKeys().has(f.key))
    );
    const availableFields = createMemo(() =>
        STYLE_FIELD_DEFS.filter((f) => !presentKeys().has(f.key))
    );

    const [addFieldKey, setAddFieldKey] = createSignal("");

    function addStyleField(key: string) {
        const def = STYLE_FIELD_DEFS.find((f) => f.key === key);
        if (!def) return;
        props.updateField((d) => {
            if (!d.config.s) d.config.s = {};
            d.config.s[key] = def.default;
        });
        setAddFieldKey("");
    }

    function removeStyleField(key: string) {
        props.updateField((d) => {
            if (d.config.s) {
                delete d.config.s[key];
                if (Object.keys(d.config.s).length === 0) {
                    delete d.config.s;
                }
            }
        });
    }

    return (
        <div class="form-section">
            <Show when={activeFields().length === 0}>
                <p class="form-hint">No style properties set. Add properties below.</p>
            </Show>

            <For each={activeFields()}>
                {(field) => (
                    <div class="style-field-row">
                        <div class="form-group" style={{ flex: "1" }}>
                            <Show when={field.type === "boolean"}>
                                <label class="checkbox-label">
                                    <input
                                        type="checkbox"
                                        checked={style()[field.key] || false}
                                        onChange={(e) => props.updateField((d) => {
                                            if (!d.config.s) d.config.s = {};
                                            d.config.s[field.key] = e.currentTarget.checked;
                                        })}
                                    />
                                    {field.label}
                                </label>
                            </Show>
                            <Show when={field.type === "select"}>
                                <label>{field.label}</label>
                                <select
                                    value={style()[field.key] ?? field.default}
                                    onChange={(e) => props.updateField((d) => {
                                        if (!d.config.s) d.config.s = {};
                                        d.config.s[field.key] = e.currentTarget.value;
                                    })}
                                >
                                    <For each={field.options || []}>
                                        {(opt) => <option value={opt}>{opt}</option>}
                                    </For>
                                </select>
                            </Show>
                            <Show when={field.type === "number"}>
                                <label>{field.label}: {style()[field.key] ?? field.default}</label>
                                <input
                                    type="range"
                                    min={field.min ?? 0}
                                    max={field.max ?? 10}
                                    step={field.step ?? 1}
                                    value={style()[field.key] ?? field.default}
                                    onInput={(e) => props.updateField((d) => {
                                        if (!d.config.s) d.config.s = {};
                                        d.config.s[field.key] = parseFloat(e.currentTarget.value);
                                    })}
                                />
                            </Show>
                        </div>
                        <button
                            class="remove-btn"
                            onClick={() => removeStyleField(field.key)}
                            title="Remove property"
                        >
                            &times;
                        </button>
                    </div>
                )}
            </For>

            {/* Add style property */}
            <Show when={availableFields().length > 0}>
                <div class="add-field-row">
                    <select
                        value={addFieldKey()}
                        onChange={(e) => setAddFieldKey(e.currentTarget.value)}
                    >
                        <option value="">+ Add style property...</option>
                        <For each={availableFields()}>
                            {(f) => <option value={f.key}>{f.label}</option>}
                        </For>
                    </select>
                    <Show when={addFieldKey()}>
                        <button class="add-btn" onClick={() => addStyleField(addFieldKey())}>
                            Add
                        </button>
                    </Show>
                </div>
            </Show>

            {/* Unknown/custom style fields */}
            <Show when={Object.keys(style()).some((k) => !STYLE_FIELD_DEFS.find((f) => f.key === k))}>
                <div class="form-group" style={{ "margin-top": "16px" }}>
                    <label>Other Properties (edit in code view)</label>
                    <div class="unknown-fields">
                        <For each={Object.keys(style()).filter((k) => !STYLE_FIELD_DEFS.find((f) => f.key === k))}>
                            {(key) => (
                                <span class="unknown-field">
                                    {key}: {JSON.stringify(style()[key])}
                                </span>
                            )}
                        </For>
                    </div>
                </div>
            </Show>
        </div>
    );
}

// --- Text Tab ---

function TextTab(props: TabProps) {
    const text = () => props.preset.config?.t || {};

    function ensureTextConfig(d: any) {
        if (!d.config.t) d.config.t = {};
    }

    return (
        <div class="form-section">
            {/* Caption */}
            <h4 class="form-section-title">Caption</h4>
            <div class="form-row">
                <div class="form-group">
                    <label>EN</label>
                    <textarea
                        value={text().caption?.en || ""}
                        onInput={(e) => props.updateField((d) => {
                            ensureTextConfig(d);
                            if (!d.config.t.caption) d.config.t.caption = { en: "", fr: "" };
                            d.config.t.caption.en = e.currentTarget.value;
                        })}
                        rows={3}
                    />
                </div>
                <div class="form-group">
                    <label>FR</label>
                    <textarea
                        value={text().caption?.fr || ""}
                        onInput={(e) => props.updateField((d) => {
                            ensureTextConfig(d);
                            if (!d.config.t.caption) d.config.t.caption = { en: "", fr: "" };
                            d.config.t.caption.fr = e.currentTarget.value;
                        })}
                        rows={3}
                    />
                </div>
            </div>
            <Show when={text().captionRelFontSize !== undefined}>
                <div class="form-group">
                    <label>Font Size: {text().captionRelFontSize}</label>
                    <input
                        type="range"
                        min={0.5} max={3} step={0.1}
                        value={text().captionRelFontSize || 2}
                        onInput={(e) => props.updateField((d) => {
                            ensureTextConfig(d);
                            d.config.t.captionRelFontSize = parseFloat(e.currentTarget.value);
                        })}
                    />
                </div>
            </Show>

            {/* Sub-Caption */}
            <h4 class="form-section-title">Sub-Caption</h4>
            <div class="form-row">
                <div class="form-group">
                    <label>EN</label>
                    <textarea
                        value={text().subCaption?.en || ""}
                        onInput={(e) => props.updateField((d) => {
                            ensureTextConfig(d);
                            if (!d.config.t.subCaption) d.config.t.subCaption = { en: "", fr: "" };
                            d.config.t.subCaption.en = e.currentTarget.value;
                        })}
                        rows={3}
                    />
                </div>
                <div class="form-group">
                    <label>FR</label>
                    <textarea
                        value={text().subCaption?.fr || ""}
                        onInput={(e) => props.updateField((d) => {
                            ensureTextConfig(d);
                            if (!d.config.t.subCaption) d.config.t.subCaption = { en: "", fr: "" };
                            d.config.t.subCaption.fr = e.currentTarget.value;
                        })}
                        rows={3}
                    />
                </div>
            </div>
            <Show when={text().subCaptionRelFontSize !== undefined}>
                <div class="form-group">
                    <label>Font Size: {text().subCaptionRelFontSize}</label>
                    <input
                        type="range"
                        min={0.5} max={3} step={0.1}
                        value={text().subCaptionRelFontSize || 1.3}
                        onInput={(e) => props.updateField((d) => {
                            ensureTextConfig(d);
                            d.config.t.subCaptionRelFontSize = parseFloat(e.currentTarget.value);
                        })}
                    />
                </div>
            </Show>

            {/* Footnote */}
            <h4 class="form-section-title">Footnote</h4>
            <div class="form-row">
                <div class="form-group">
                    <label>EN</label>
                    <textarea
                        value={text().footnote?.en || ""}
                        onInput={(e) => props.updateField((d) => {
                            ensureTextConfig(d);
                            if (!d.config.t.footnote) d.config.t.footnote = { en: "", fr: "" };
                            d.config.t.footnote.en = e.currentTarget.value;
                        })}
                        rows={6}
                    />
                </div>
                <div class="form-group">
                    <label>FR</label>
                    <textarea
                        value={text().footnote?.fr || ""}
                        onInput={(e) => props.updateField((d) => {
                            ensureTextConfig(d);
                            if (!d.config.t.footnote) d.config.t.footnote = { en: "", fr: "" };
                            d.config.t.footnote.fr = e.currentTarget.value;
                        })}
                        rows={6}
                    />
                </div>
            </div>
            <Show when={text().footnoteRelFontSize !== undefined}>
                <div class="form-group">
                    <label>Font Size: {text().footnoteRelFontSize}</label>
                    <input
                        type="range"
                        min={0.1} max={3} step={0.1}
                        value={text().footnoteRelFontSize || 0.9}
                        onInput={(e) => props.updateField((d) => {
                            ensureTextConfig(d);
                            d.config.t.footnoteRelFontSize = parseFloat(e.currentTarget.value);
                        })}
                    />
                </div>
            </Show>

            <p class="form-hint">
                Special tokens: <code>DATE_RANGE</code> (inserts date range), <code>REPLICANT</code> (inserts indicator name)
            </p>
        </div>
    );
}
