import { createEffect, createSignal, For, on, Show, type JSX } from "solid-js";
import { createStore, reconcile, unwrap, type SetStoreFunction } from "solid-js/store";
import {
    type ExtractedPreset,
    type ExtractedMetric,
    extractPresetsFromFile,
    extractResultsObjectsFromFile,
    extractFullMetricsFromFile,
    replacePresetInFile,
    replaceResultsObjectInFile,
    replaceMetricInFile,
    insertPresetInFile,
    deletePresetFromFile,
    insertResultsObjectInFile,
    deleteResultsObjectFromFile,
    insertMetricInFile,
    deleteMetricFromFile,
} from "./vizPresetParser.ts";

// ────────────────────────────────────────────
// Types
// ────────────────────────────────────────────

interface TranslatableString {
    en: string;
    fr: string;
}

interface DisaggregateByEntry {
    disOpt: string;
    disDisplayOpt: string;
}

interface FilterByEntry {
    disOpt: string;
    values: string[];
}

type PeriodFilterType = "last_n_months" | "from_month" | "last_calendar_year" | "custom";

interface PeriodFilterConfig {
    filterType: PeriodFilterType;
    nMonths?: number;
    min?: number;
    max?: number;
}

interface DataConfig {
    type: "table" | "timeseries" | "chart" | "map";
    periodOpt: string;
    periodFilter?: PeriodFilterConfig;
    valuesDisDisplayOpt: string;
    disaggregateBy: DisaggregateByEntry[];
    filterBy: FilterByEntry[];
    valuesFilter?: string[];
    selectedReplicantValue?: string;
    includeNationalForAdminArea2?: boolean;
    includeNationalPosition?: "bottom" | "top";
}

interface StyleConfig {
    scale?: number;
    content?: string;
    conditionalFormatting?: string;
    colorScale?: string;
    decimalPlaces?: number;
    hideLegend?: boolean;
    showDataLabels?: boolean;
    showDataLabelsLineCharts?: boolean;
    barsStacked?: boolean;
    sortIndicatorValues?: string;
    idealAspectRatio?: string;
    allowVerticalColHeaders?: boolean;
    specialCoverageChart?: boolean;
    specialScorecardTable?: boolean;
    forceYMax1?: boolean;
    forceYMinAuto?: boolean;
    verticalTickLabels?: boolean;
    allowIndividualRowLimits?: boolean;
    diffAreas?: boolean;
    diffInverted?: boolean;
    formatAdminArea3Labels?: boolean;
    seriesColorFuncPropToUse?: string;
    customSeriesStyles?: { color: string; strokeWidth: number; lineStyle: string }[];
    [key: string]: any;
}

interface TextConfig {
    caption?: TranslatableString;
    subCaption?: TranslatableString;
    footnote?: TranslatableString;
    captionRelFontSize?: number;
    subCaptionRelFontSize?: number;
    footnoteRelFontSize?: number;
}

interface PresetFormData {
    id: string;
    label: TranslatableString;
    description: TranslatableString;
    needsReplicant?: boolean;
    allowedFilters?: string[];
    createDefaultVisualizationOnInstall?: string;
    defaultPeriodFilterForDefaultVisualizations?: { nMonths: number };
    config: {
        d: DataConfig;
        s?: StyleConfig;
        t?: TextConfig;
    };
}

interface ResultsObjectFormData {
    id: string;
    description: string;
    createTableStatementPossibleColumns?: Record<string, string>;
}

interface MetricFormData {
    id: string;
    resultsObjectId: string;
    label: TranslatableString;
    valueProps: string[];
    valueFunc: string;
    formatAs: string;
    requiredDisaggregationOptions: string[];
    periodOptions: string[];
    valueLabelReplacements?: Record<string, string>;
    postAggregationExpression?: {
        ingredientValues: { prop: string; func: string }[];
        expression: string;
    };
    hide?: boolean;
    variantLabel?: TranslatableString;
    importantNotes?: TranslatableString;
    aiDescription?: any;
}

type EditLevel = "resultsObject" | "metric" | "preset";

// ────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────

const DISAGGREGATION_OPTIONS = [
    "indicator_common_id",
    "admin_area_2",
    "admin_area_3",
    "admin_area_4",
    "year",
    "month",
    "quarter_id",
    "period_id",
    "denominator",
    "denominator_best_or_survey",
    "source_indicator",
    "target_population",
    "ratio_type",
    "facility_name",
    "facility_type",
    "facility_ownership",
    "facility_custom_1",
    "facility_custom_2",
    "facility_custom_3",
    "facility_custom_4",
    "facility_custom_5",
    "hfa_indicator",
    "hfa_category",
    "time_point",
];

const DIS_DISPLAY_OPTIONS_TABLE = [
    { value: "row", label: "Rows" },
    { value: "col", label: "Columns" },
    { value: "cell", label: "Grid cells" },
    { value: "indicator", label: "Indicator axis" },
    { value: "replicant", label: "Different charts" },
];

const DIS_DISPLAY_OPTIONS_TIMESERIES = [
    { value: "series", label: "Series (lines/bars)" },
    { value: "row", label: "Row groups" },
    { value: "col", label: "Column groups" },
    { value: "cell", label: "Grid cells" },
    { value: "replicant", label: "Different charts" },
];

const DIS_DISPLAY_OPTIONS_CHART = [
    { value: "indicator", label: "Indicator axis" },
    { value: "series", label: "Series (sub-bars)" },
    { value: "row", label: "Row groups" },
    { value: "col", label: "Column groups" },
    { value: "cell", label: "Grid cells" },
    { value: "replicant", label: "Different charts" },
];

const DIS_DISPLAY_OPTIONS_MAP = [
    { value: "mapArea", label: "Map regions" },
    { value: "cell", label: "Grid cells" },
    { value: "row", label: "Rows" },
    { value: "col", label: "Columns" },
    { value: "replicant", label: "Different charts" },
];

function getDisplayOptions(type: string) {
    if (type === "table") return DIS_DISPLAY_OPTIONS_TABLE;
    if (type === "timeseries") return DIS_DISPLAY_OPTIONS_TIMESERIES;
    if (type === "map") return DIS_DISPLAY_OPTIONS_MAP;
    return DIS_DISPLAY_OPTIONS_CHART;
}

const CONDITIONAL_FORMATTING_OPTIONS = [
    "none",
    "fmt-90-80",
    "fmt-80-70",
    "fmt-10-20",
    "fmt-05-10",
    "fmt-01-03",
    "fmt-neg10-pos10",
    "fmt-thresholds-1-2-5",
    "fmt-thresholds-2-5-10",
    "fmt-thresholds-5-10-20",
];

const COLOR_SCALE_OPTIONS = [
    { value: "pastel-discrete", label: "Discrete 1" },
    { value: "alt-discrete", label: "Discrete 2" },
    { value: "red-green", label: "Red-green" },
    { value: "blue-green", label: "Blue-green" },
    { value: "single-grey", label: "Single grey" },
    { value: "custom", label: "Custom colours" },
];

const FIXED_FILTER_OPTIONS = [
    { disOpt: "admin_area_1", label: "Admin area 1" },
    { disOpt: "admin_area_2", label: "Admin area 2" },
    { disOpt: "admin_area_3", label: "Admin area 3" },
    { disOpt: "indicator_common_id", label: "Indicator" },
];

const SQL_TYPE_OPTIONS = [
    "TEXT",
    "TEXT NOT NULL",
    "INTEGER",
    "INTEGER NOT NULL",
    "REAL",
    "REAL NOT NULL",
    "NUMERIC",
    "NUMERIC NOT NULL",
];

function defaultPreset(): PresetFormData {
    return {
        id: "new-preset",
        label: { en: "New Preset", fr: "" },
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
    };
}

function defaultResultsObject(): ResultsObjectFormData {
    return {
        id: "new-results-object",
        description: "",
    };
}

function defaultMetric(resultsObjectId: string): MetricFormData {
    return {
        id: "new-metric",
        resultsObjectId,
        label: { en: "New Metric", fr: "" },
        valueProps: [],
        valueFunc: "COUNT",
        formatAs: "number",
        requiredDisaggregationOptions: [],
        periodOptions: ["period_id"],
    };
}

// ────────────────────────────────────────────
// Reusable sub-components (platform-matching)
// ────────────────────────────────────────────

function PRadioGroup(p: {
    label: string;
    options: { value: string; label: string }[];
    value: string | undefined;
    onChange: (v: string) => void;
    horizontal?: boolean;
}) {
    return (
        <div class="p-radio-group">
            <legend>{p.label}</legend>
            <div
                class="p-radio-options"
                data-horizontal={p.horizontal ? "true" : "false"}
            >
                <For each={p.options}>
                    {(opt) => (
                        <label class="p-radio-label">
                            <div class="p-radio-wrapper">
                                <input
                                    type="radio"
                                    class="p-radio-input"
                                    name={p.label.replace(/\s/g, "-")}
                                    checked={p.value === opt.value}
                                    onChange={() => p.onChange(opt.value)}
                                />
                                <div class="p-radio-dot" />
                            </div>
                            <span class="p-radio-text">{opt.label}</span>
                        </label>
                    )}
                </For>
            </div>
        </div>
    );
}

function PCheckbox(p: {
    label: string | JSX.Element;
    checked: boolean | undefined;
    onChange: (v: boolean) => void;
    disabled?: boolean;
}) {
    return (
        <label
            class="p-checkbox-label"
            data-disabled={p.disabled ? "true" : "false"}
        >
            <div class="p-checkbox-wrapper">
                <input
                    type="checkbox"
                    class="p-checkbox-input"
                    checked={!!p.checked}
                    onChange={(e) => p.onChange(e.currentTarget.checked)}
                    disabled={p.disabled}
                />
                <svg
                    class="p-checkbox-icon"
                    viewBox="0 0 20 20"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                >
                    <path d="M5 10l4 4l6 -7" />
                </svg>
            </div>
            <span class="p-checkbox-text">{p.label}</span>
        </label>
    );
}

function PLabelHolder(p: { label: string; children: JSX.Element }) {
    return (
        <div class="p-label-holder">
            <div class="p-label">{p.label}</div>
            {p.children}
        </div>
    );
}

function PSelect(p: {
    label?: string;
    options: { value: string; label: string }[];
    value: string | undefined;
    onChange: (v: string) => void;
}) {
    return (
        <div class="p-select-container">
            <Show when={p.label}>
                <div class="p-label">{p.label}</div>
            </Show>
            <div class="p-select-wrapper">
                <select
                    class="p-select-input"
                    value={p.value ?? ""}
                    onChange={(e) => p.onChange(e.currentTarget.value)}
                >
                    <For each={p.options}>
                        {(opt) => (
                            <option value={opt.value}>{opt.label}</option>
                        )}
                    </For>
                </select>
                <div class="p-select-chevron">
                    <svg
                        width="16"
                        height="16"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                    >
                        <path d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" />
                    </svg>
                </div>
            </div>
        </div>
    );
}

function PInput(p: {
    label?: string;
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    type?: string;
}) {
    return (
        <div class="p-input-container">
            <Show when={p.label}>
                <div class="p-label">{p.label}</div>
            </Show>
            <input
                class="p-input"
                type={p.type ?? "text"}
                value={p.value}
                onInput={(e) => p.onChange(e.currentTarget.value)}
                placeholder={p.placeholder}
            />
        </div>
    );
}

function PTextArea(p: {
    label?: string;
    value: string;
    onChange: (v: string) => void;
    height?: string;
}) {
    return (
        <div class="p-textarea-container">
            <Show when={p.label}>
                <div class="p-label">{p.label}</div>
            </Show>
            <textarea
                class="p-textarea"
                value={p.value}
                onInput={(e) => p.onChange(e.currentTarget.value)}
                style={{ height: p.height ?? "80px" }}
            />
        </div>
    );
}

function PSlider(p: {
    label: string;
    min: number;
    max: number;
    step: number;
    value: number;
    onChange: (v: number) => void;
}) {
    return (
        <div class="p-slider-container">
            <div class="p-slider-label-row">
                <div class="p-label">{p.label}</div>
                <span class="p-slider-value">{p.value}</span>
            </div>
            <input
                class="p-slider-input"
                type="range"
                min={p.min}
                max={p.max}
                step={p.step}
                value={p.value}
                onInput={(e) => p.onChange(Number(e.currentTarget.value))}
            />
        </div>
    );
}

// ────────────────────────────────────────────
// Filter/chip value editors
// ────────────────────────────────────────────

function FilterValuesEditor(p: {
    values: string[];
    onChange: (v: string[]) => void;
}) {
    const [inputValue, setInputValue] = createSignal("");

    function addValue() {
        const v = inputValue().trim();
        if (v && !p.values.includes(v)) {
            p.onChange([...p.values, v]);
            setInputValue("");
        }
    }

    function removeValue(val: string) {
        p.onChange(p.values.filter((v) => v !== val));
    }

    return (
        <div class="p-filter-values">
            <For each={p.values}>
                {(val) => (
                    <span class="p-filter-chip">
                        {val}
                        <button onClick={() => removeValue(val)}>&times;</button>
                    </span>
                )}
            </For>
            <input
                value={inputValue()}
                onInput={(e) => setInputValue(e.currentTarget.value)}
                onKeyDown={(e) => {
                    if (e.key === "Enter") {
                        e.preventDefault();
                        addValue();
                    }
                }}
                placeholder="Type and press Enter..."
            />
        </div>
    );
}

// Key-value pair editor (for columns, valueLabelReplacements)
function KeyValueEditor(p: {
    entries: Record<string, string>;
    onChange: (entries: Record<string, string>) => void;
    keyLabel?: string;
    valueLabel?: string;
    valueOptions?: string[];
}) {
    const pairs = () => Object.entries(p.entries);

    function updateKey(oldKey: string, newKey: string) {
        const newEntries: Record<string, string> = {};
        for (const [k, v] of Object.entries(p.entries)) {
            newEntries[k === oldKey ? newKey : k] = v;
        }
        p.onChange(newEntries);
    }

    function updateValue(key: string, newValue: string) {
        p.onChange({ ...p.entries, [key]: newValue });
    }

    function removeEntry(key: string) {
        const { [key]: _, ...rest } = p.entries;
        p.onChange(rest);
    }

    function addEntry() {
        const newKey = `new_column_${Object.keys(p.entries).length}`;
        p.onChange({ ...p.entries, [newKey]: p.valueOptions?.[0] ?? "" });
    }

    return (
        <div class="p-spy-sm">
            <For each={pairs()}>
                {([key, value]) => (
                    <div class="p-kv-row">
                        <input
                            class="p-input"
                            value={key}
                            onInput={(e) => updateKey(key, e.currentTarget.value)}
                            placeholder={p.keyLabel ?? "Key"}
                        />
                        <Show
                            when={p.valueOptions}
                            fallback={
                                <input
                                    class="p-input"
                                    value={value}
                                    onInput={(e) =>
                                        updateValue(key, e.currentTarget.value)
                                    }
                                    placeholder={p.valueLabel ?? "Value"}
                                />
                            }
                        >
                            <select
                                class="p-select-input"
                                onChange={(e) =>
                                    updateValue(key, e.currentTarget.value)
                                }
                            >
                                <For each={p.valueOptions!}>
                                    {(opt) => (
                                        <option value={opt} selected={opt === value}>
                                            {opt}
                                        </option>
                                    )}
                                </For>
                                <Show when={!p.valueOptions!.includes(value)}>
                                    <option value={value} selected>
                                        {value}
                                    </option>
                                </Show>
                            </select>
                        </Show>
                        <button
                            class="p-btn-remove"
                            onClick={() => removeEntry(key)}
                        >
                            &times;
                        </button>
                    </div>
                )}
            </For>
            <button class="p-btn-sm p-btn-primary" onClick={addEntry}>
                + Add
            </button>
        </div>
    );
}

// ────────────────────────────────────────────
// Period filter section
// ────────────────────────────────────────────

const PERIOD_FILTER_MIN_YEAR = 2010;
const PERIOD_FILTER_MAX_YEAR = new Date().getFullYear() + 5;
const PERIOD_FILTER_MAX_IDX = (PERIOD_FILTER_MAX_YEAR - PERIOD_FILTER_MIN_YEAR + 1) * 12 - 1;

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function yyyymmToIdx(yyyymm: number): number {
    const year = Math.floor(yyyymm / 100);
    const month = yyyymm % 100;
    return (year - PERIOD_FILTER_MIN_YEAR) * 12 + (month - 1);
}

function idxToYYYYMM(idx: number): number {
    const year = PERIOD_FILTER_MIN_YEAR + Math.floor(idx / 12);
    const month = (idx % 12) + 1;
    return year * 100 + month;
}

function formatYYYYMM(yyyymm: number): string {
    const year = Math.floor(yyyymm / 100);
    const month = yyyymm % 100;
    return `${MONTH_NAMES[(month - 1) % 12]} ${year}`;
}

function defaultMin(): number {
    const d = new Date();
    return (d.getFullYear() - 2) * 100 + 1;
}

function defaultMax(): number {
    const d = new Date();
    return d.getFullYear() * 100 + (d.getMonth() + 1);
}

function PMonthSlider(p: {
    label: string;
    value: number;   // YYYYMM
    onChange: (v: number) => void;
}) {
    return (
        <div class="p-slider-container">
            <div class="p-slider-label-row">
                <div class="p-label">{p.label}</div>
                <span class="p-slider-value">{formatYYYYMM(p.value)}</span>
            </div>
            <input
                class="p-slider-input"
                type="range"
                min={0}
                max={PERIOD_FILTER_MAX_IDX}
                step={1}
                value={yyyymmToIdx(p.value)}
                onInput={(e) => p.onChange(idxToYYYYMM(Number(e.currentTarget.value)))}
            />
        </div>
    );
}

function PeriodFilterSection(p: {
    form: PresetFormData;
    setForm: SetStoreFunction<PresetFormData>;
}) {
    const pf = () => p.form.config.d.periodFilter;

    function enable() {
        p.setForm("config", "d", "periodFilter", {
            filterType: "last_n_months",
            nMonths: 12,
        });
    }

    function disable() {
        (p.setForm as any)("config", "d", "periodFilter", undefined);
    }

    function setFilterType(v: PeriodFilterType) {
        const defaults: Record<PeriodFilterType, Partial<PeriodFilterConfig>> = {
            last_n_months: { nMonths: 12 },
            from_month: { min: defaultMin() },
            last_calendar_year: {},
            custom: { min: defaultMin(), max: defaultMax() },
        };
        p.setForm("config", "d", "periodFilter", { filterType: v, ...defaults[v] });
    }

    return (
        <div class="p-spy-sm">
            <PCheckbox
                label="Time period"
                checked={!!pf()}
                onChange={(checked) => (checked ? enable() : disable())}
            />
            <Show when={pf()}>
                <div style={{ "padding-left": "16px" }} class="p-spy-sm">
                    <PRadioGroup
                        label="Filter type"
                        options={[
                            { value: "last_n_months", label: "Last N months" },
                            { value: "from_month", label: "From specific month to present" },
                            { value: "last_calendar_year", label: "Last full calendar year" },
                            { value: "custom", label: "Custom" },
                        ]}
                        value={pf()!.filterType}
                        onChange={(v) => setFilterType(v as PeriodFilterType)}
                    />
                    <Show when={pf()!.filterType === "last_n_months"}>
                        <PSlider
                            label="Number of months"
                            min={1}
                            max={60}
                            step={1}
                            value={pf()!.nMonths ?? 12}
                            onChange={(v) =>
                                p.setForm("config", "d", "periodFilter", "nMonths", v)
                            }
                        />
                    </Show>
                    <Show when={pf()!.filterType === "from_month"}>
                        <PMonthSlider
                            label="Starting month"
                            value={pf()!.min ?? defaultMin()}
                            onChange={(v) =>
                                p.setForm("config", "d", "periodFilter", "min", v)
                            }
                        />
                    </Show>
                    <Show when={pf()!.filterType === "custom"}>
                        <PMonthSlider
                            label="From"
                            value={pf()!.min ?? defaultMin()}
                            onChange={(v) =>
                                p.setForm("config", "d", "periodFilter", "min", v)
                            }
                        />
                        <PMonthSlider
                            label="To"
                            value={pf()!.max ?? defaultMax()}
                            onChange={(v) =>
                                p.setForm("config", "d", "periodFilter", "max", v)
                            }
                        />
                    </Show>
                </div>
            </Show>
        </div>
    );
}

// ────────────────────────────────────────────
// ResultsObject editor
// ────────────────────────────────────────────

function ResultsObjectEditor(p: {
    form: ResultsObjectFormData;
    setForm: SetStoreFunction<ResultsObjectFormData>;
}) {
    return (
        <div class="p-pad p-spy">
            <PInput
                label="ID"
                value={p.form.id}
                onChange={(v) => p.setForm("id", v)}
            />
            <PTextArea
                label="Description"
                value={p.form.description}
                onChange={(v) => p.setForm("description", v)}
            />
            <PLabelHolder label="Columns (createTableStatementPossibleColumns)">
                <Show
                    when={p.form.createTableStatementPossibleColumns}
                    fallback={
                        <button
                            class="p-btn-sm p-btn-primary"
                            onClick={() =>
                                p.setForm("createTableStatementPossibleColumns", {})
                            }
                        >
                            + Add columns
                        </button>
                    }
                >
                    <KeyValueEditor
                        entries={p.form.createTableStatementPossibleColumns!}
                        onChange={(entries) =>
                            p.setForm("createTableStatementPossibleColumns", reconcile(entries))
                        }
                        keyLabel="Column name"
                        valueLabel="SQL type"
                        valueOptions={SQL_TYPE_OPTIONS}
                    />
                </Show>
            </PLabelHolder>
        </div>
    );
}

// ────────────────────────────────────────────
// Metric editor
// ────────────────────────────────────────────

function MetricEditor(p: {
    form: MetricFormData;
    setForm: SetStoreFunction<MetricFormData>;
    resultsObjectIds: string[];
}) {
    return (
        <div class="p-pad p-spy">
            {/* Identity */}
            <div class="p-form-section-title">Identity</div>
            <PInput
                label="ID"
                value={p.form.id}
                onChange={(v) => p.setForm("id", v)}
            />
            <PSelect
                label="Results Object"
                options={p.resultsObjectIds.map((id) => ({ value: id, label: id }))}
                value={p.form.resultsObjectId}
                onChange={(v) => p.setForm("resultsObjectId", v)}
            />
            <div class="p-form-row">
                <PInput
                    label="Label (EN)"
                    value={p.form.label.en}
                    onChange={(v) => p.setForm("label", "en", v)}
                />
                <PInput
                    label="Label (FR)"
                    value={p.form.label.fr}
                    onChange={(v) => p.setForm("label", "fr", v)}
                />
            </div>
            <Show when={p.form.variantLabel !== undefined}>
                <div class="p-form-row">
                    <PInput
                        label="Variant Label (EN)"
                        value={p.form.variantLabel?.en ?? ""}
                        onChange={(v) => (p.setForm as any)("variantLabel", "en", v)}
                    />
                    <PInput
                        label="Variant Label (FR)"
                        value={p.form.variantLabel?.fr ?? ""}
                        onChange={(v) => (p.setForm as any)("variantLabel", "fr", v)}
                    />
                </div>
            </Show>
            <PCheckbox
                label="Add variant label"
                checked={p.form.variantLabel !== undefined}
                onChange={(checked) =>
                    p.setForm("variantLabel", checked ? { en: "", fr: "" } : undefined)
                }
            />
            <PCheckbox
                label="Hidden"
                checked={p.form.hide}
                onChange={(v) => p.setForm("hide", v || undefined)}
            />

            {/* Data */}
            <div class="p-form-section-title">Data</div>
            <PLabelHolder label="Value props">
                <FilterValuesEditor
                    values={p.form.valueProps}
                    onChange={(vals) => p.setForm("valueProps", vals)}
                />
            </PLabelHolder>
            <PRadioGroup
                label="Value function"
                options={[
                    { value: "COUNT", label: "COUNT" },
                    { value: "AVG", label: "AVG" },
                    { value: "SUM", label: "SUM" },
                    { value: "identity", label: "Identity" },
                ]}
                value={p.form.valueFunc}
                onChange={(v) => p.setForm("valueFunc", v)}
            />
            <PRadioGroup
                label="Format as"
                options={[
                    { value: "number", label: "Number" },
                    { value: "percent", label: "Percent" },
                ]}
                value={p.form.formatAs}
                onChange={(v) => p.setForm("formatAs", v)}
                horizontal
            />
            <PLabelHolder label="Period options">
                <div style={{ display: "flex", "flex-wrap": "wrap", gap: "4px" }}>
                    <For each={["period_id", "quarter_id", "year"]}>
                        {(opt) => (
                            <PCheckbox
                                label={opt}
                                checked={p.form.periodOptions.includes(opt)}
                                onChange={(checked) =>
                                    p.setForm("periodOptions", (prev) =>
                                        checked
                                            ? prev.includes(opt) ? prev : [...prev, opt]
                                            : prev.filter((x) => x !== opt)
                                    )
                                }
                            />
                        )}
                    </For>
                </div>
            </PLabelHolder>
            <PLabelHolder label="Required disaggregation options">
                <div style={{ display: "flex", "flex-wrap": "wrap", gap: "4px" }}>
                    <For each={DISAGGREGATION_OPTIONS}>
                        {(opt) => (
                            <PCheckbox
                                label={opt}
                                checked={p.form.requiredDisaggregationOptions.includes(opt)}
                                onChange={(checked) =>
                                    p.setForm("requiredDisaggregationOptions", (prev) =>
                                        checked
                                            ? prev.includes(opt) ? prev : [...prev, opt]
                                            : prev.filter((x) => x !== opt)
                                    )
                                }
                            />
                        )}
                    </For>
                </div>
            </PLabelHolder>

            {/* Advanced */}
            <div class="p-form-section-title">Advanced</div>
            <PLabelHolder label="Value label replacements">
                <Show
                    when={p.form.valueLabelReplacements}
                    fallback={
                        <button
                            class="p-btn-sm p-btn-primary"
                            onClick={() =>
                                p.setForm("valueLabelReplacements", {})
                            }
                        >
                            + Add replacements
                        </button>
                    }
                >
                    <KeyValueEditor
                        entries={p.form.valueLabelReplacements!}
                        onChange={(entries) =>
                            p.setForm("valueLabelReplacements",
                                Object.keys(entries).length > 0
                                    ? reconcile(entries)
                                    : undefined
                            )
                        }
                        keyLabel="Prop name"
                        valueLabel="Display label"
                    />
                </Show>
            </PLabelHolder>

            {/* Post aggregation expression */}
            <PLabelHolder label="Post aggregation expression">
                <Show
                    when={p.form.postAggregationExpression}
                    fallback={
                        <button
                            class="p-btn-sm p-btn-primary"
                            onClick={() =>
                                p.setForm("postAggregationExpression", {
                                    ingredientValues: [],
                                    expression: "",
                                })
                            }
                        >
                            + Add expression
                        </button>
                    }
                >
                    <div class="p-spy-sm">
                        <PLabelHolder label="Ingredient values">
                            <div class="p-spy-sm">
                                <For
                                    each={
                                        p.form.postAggregationExpression!
                                            .ingredientValues
                                    }
                                >
                                    {(iv, idx) => (
                                        <div class="p-kv-row">
                                            <input
                                                class="p-input"
                                                value={iv.prop}
                                                onInput={(e) =>
                                                    (p.setForm as any)(
                                                        "postAggregationExpression",
                                                        "ingredientValues",
                                                        idx(),
                                                        "prop",
                                                        e.currentTarget.value
                                                    )
                                                }
                                                placeholder="prop"
                                            />
                                            <select
                                                class="p-select-input"
                                                value={iv.func}
                                                onChange={(e) =>
                                                    (p.setForm as any)(
                                                        "postAggregationExpression",
                                                        "ingredientValues",
                                                        idx(),
                                                        "func",
                                                        e.currentTarget.value
                                                    )
                                                }
                                            >
                                                <For
                                                    each={[
                                                        "COUNT",
                                                        "AVG",
                                                        "SUM",
                                                        "identity",
                                                    ]}
                                                >
                                                    {(f) => (
                                                        <option value={f}>
                                                            {f}
                                                        </option>
                                                    )}
                                                </For>
                                            </select>
                                            <button
                                                class="p-btn-remove"
                                                onClick={() =>
                                                    (p.setForm as any)(
                                                        "postAggregationExpression",
                                                        "ingredientValues",
                                                        (prev: any[]) => [
                                                            ...prev.slice(0, idx()),
                                                            ...prev.slice(idx() + 1),
                                                        ]
                                                    )
                                                }
                                            >
                                                &times;
                                            </button>
                                        </div>
                                    )}
                                </For>
                                <button
                                    class="p-btn-sm p-btn-primary"
                                    onClick={() =>
                                        (p.setForm as any)(
                                            "postAggregationExpression",
                                            "ingredientValues",
                                            (prev: any[]) => [
                                                ...prev,
                                                { prop: "", func: "SUM" },
                                            ]
                                        )
                                    }
                                >
                                    + Add ingredient
                                </button>
                            </div>
                        </PLabelHolder>
                        <PInput
                            label="Expression"
                            value={
                                p.form.postAggregationExpression!.expression
                            }
                            onChange={(v) =>
                                (p.setForm as any)(
                                    "postAggregationExpression",
                                    "expression",
                                    v
                                )
                            }
                            placeholder="e.g. result = A/B"
                        />
                        <button
                            class="p-btn-sm p-btn-danger"
                            onClick={() =>
                                p.setForm("postAggregationExpression", undefined)
                            }
                        >
                            Remove expression
                        </button>
                    </div>
                </Show>
            </PLabelHolder>

            {/* Important notes */}
            <PCheckbox
                label="Has important notes"
                checked={p.form.importantNotes !== undefined}
                onChange={(checked) =>
                    p.setForm("importantNotes", checked ? { en: "", fr: "" } : undefined)
                }
            />
            <Show when={p.form.importantNotes}>
                <div class="p-form-row">
                    <PTextArea
                        label="Important Notes (EN)"
                        value={p.form.importantNotes!.en}
                        onChange={(v) =>
                            (p.setForm as any)("importantNotes", "en", v)
                        }
                    />
                    <PTextArea
                        label="Important Notes (FR)"
                        value={p.form.importantNotes!.fr}
                        onChange={(v) =>
                            (p.setForm as any)("importantNotes", "fr", v)
                        }
                    />
                </div>
            </Show>

            {/* AI Description (raw JSON) */}
            <Show when={p.form.aiDescription !== undefined}>
                <PTextArea
                    label="AI Description (JSON)"
                    value={JSON.stringify(p.form.aiDescription, null, 2)}
                    onChange={(v) => {
                        try {
                            p.setForm("aiDescription", JSON.parse(v));
                        } catch {
                            // keep as-is until valid JSON
                        }
                    }}
                    height="200px"
                />
            </Show>
        </div>
    );
}

// ────────────────────────────────────────────
// VizPreset tab panels (unchanged from original)
// ────────────────────────────────────────────

function InfoTab(p: {
    form: PresetFormData;
    setForm: SetStoreFunction<PresetFormData>;
}) {
    return (
        <div class="p-pad p-spy">
            <PInput
                label="ID"
                value={p.form.id}
                onChange={(v) => p.setForm("id", v)}
            />
            <div class="p-form-row">
                <PInput
                    label="Label (EN)"
                    value={p.form.label.en}
                    onChange={(v) => p.setForm("label", "en", v)}
                />
                <PInput
                    label="Label (FR)"
                    value={p.form.label.fr}
                    onChange={(v) => p.setForm("label", "fr", v)}
                />
            </div>
            <div class="p-form-row">
                <PTextArea
                    label="Description (EN)"
                    value={p.form.description.en}
                    onChange={(v) => p.setForm("description", "en", v)}
                />
                <PTextArea
                    label="Description (FR)"
                    value={p.form.description.fr}
                    onChange={(v) => p.setForm("description", "fr", v)}
                />
            </div>
            <PCheckbox
                label="Needs replicant"
                checked={p.form.needsReplicant}
                onChange={(v) => p.setForm("needsReplicant", v || undefined)}
            />
            <PLabelHolder label="Allowed filters">
                <div style={{ display: "flex", "flex-wrap": "wrap", gap: "4px" }}>
                    <For each={DISAGGREGATION_OPTIONS}>
                        {(opt) => (
                            <PCheckbox
                                label={opt}
                                checked={p.form.allowedFilters?.includes(opt)}
                                onChange={(checked) => {
                                    const arr = p.form.allowedFilters ?? [];
                                    if (checked) {
                                        if (!arr.includes(opt))
                                            p.setForm("allowedFilters", [...arr, opt]);
                                    } else {
                                        const filtered = arr.filter((x) => x !== opt);
                                        p.setForm("allowedFilters",
                                            filtered.length > 0 ? filtered : undefined
                                        );
                                    }
                                }}
                            />
                        )}
                    </For>
                </div>
            </PLabelHolder>
            <PInput
                label="createDefaultVisualizationOnInstall"
                value={p.form.createDefaultVisualizationOnInstall ?? ""}
                onChange={(v) => p.setForm("createDefaultVisualizationOnInstall", v || undefined)}
                placeholder="UUID (optional)"
            />
            <PInput
                label="Default period filter (nMonths)"
                value={String(
                    p.form.defaultPeriodFilterForDefaultVisualizations?.nMonths ?? ""
                )}
                onChange={(v) => {
                    const n = parseInt(v, 10);
                    p.setForm("defaultPeriodFilterForDefaultVisualizations",
                        isNaN(n) || v === "" ? undefined : { nMonths: n }
                    );
                }}
                type="number"
            />
        </div>
    );
}

function DataTab(p: {
    form: PresetFormData;
    setForm: SetStoreFunction<PresetFormData>;
}) {
    const d = () => p.form.config.d;
    const disDisplayOpts = () => getDisplayOptions(d().type);

    return (
        <div class="p-pad p-spy">
            <PRadioGroup
                label="Present as"
                options={[
                    { value: "table", label: "Table" },
                    { value: "timeseries", label: "Timeseries" },
                    { value: "chart", label: "Bar chart" },
                    { value: "map", label: "Map" },
                ]}
                value={d().type}
                onChange={(v) =>
                    p.setForm("config", "d", "type", v as DataConfig["type"])
                }
            />
            <PSelect
                label="Data values display"
                options={disDisplayOpts()}
                value={d().valuesDisDisplayOpt}
                onChange={(v) =>
                    p.setForm("config", "d", "valuesDisDisplayOpt", v)
                }
            />

            {/* Disaggregate by */}
            <PLabelHolder label="Disaggregate by">
                <div class="p-spy-sm">
                    <For each={d().disaggregateBy}>
                        {(entry, idx) => (
                            <div class="p-dis-row">
                                <select
                                    class="p-select-input"
                                    value={entry.disOpt}
                                    onChange={(e) =>
                                        p.setForm("config", "d", "disaggregateBy", idx(), "disOpt",
                                            e.currentTarget.value
                                        )
                                    }
                                >
                                    <For each={DISAGGREGATION_OPTIONS}>
                                        {(opt) => (
                                            <option value={opt}>{opt}</option>
                                        )}
                                    </For>
                                </select>
                                <select
                                    class="p-select-input"
                                    value={entry.disDisplayOpt}
                                    onChange={(e) =>
                                        p.setForm("config", "d", "disaggregateBy", idx(), "disDisplayOpt",
                                            e.currentTarget.value
                                        )
                                    }
                                >
                                    <For each={disDisplayOpts()}>
                                        {(opt) => (
                                            <option value={opt.value}>
                                                {opt.label}
                                            </option>
                                        )}
                                    </For>
                                </select>
                                <button
                                    class="p-btn-remove"
                                    onClick={() =>
                                        p.setForm("config", "d", "disaggregateBy", (prev) => [
                                            ...prev.slice(0, idx()),
                                            ...prev.slice(idx() + 1),
                                        ])
                                    }
                                >
                                    &times;
                                </button>
                            </div>
                        )}
                    </For>
                    <button
                        class="p-btn-sm p-btn-primary"
                        onClick={() =>
                            p.setForm("config", "d", "disaggregateBy", (prev) => [
                                ...prev,
                                { disOpt: "indicator_common_id", disDisplayOpt: "row" },
                            ])
                        }
                    >
                        + Add disaggregation
                    </button>
                </div>
            </PLabelHolder>

            {/* Filter by */}
            <PLabelHolder label="Filter by">
                <div class="p-spy-sm">
                    <PeriodFilterSection form={p.form} setForm={p.setForm} />
                    <For each={FIXED_FILTER_OPTIONS}>
                        {(opt) => {
                            const entry = () => d().filterBy.find(e => e.disOpt === opt.disOpt);
                            return (
                                <div class="p-spy-sm">
                                    <PCheckbox
                                        label={opt.label}
                                        checked={!!entry()}
                                        onChange={(checked) => {
                                            if (checked) {
                                                p.setForm("config", "d", "filterBy", (prev) => [
                                                    ...prev,
                                                    { disOpt: opt.disOpt, values: [] },
                                                ]);
                                            } else {
                                                p.setForm("config", "d", "filterBy", (prev) =>
                                                    prev.filter(e => e.disOpt !== opt.disOpt)
                                                );
                                            }
                                        }}
                                    />
                                    <Show when={entry()}>
                                        <FilterValuesEditor
                                            values={entry()!.values}
                                            onChange={(vals) => {
                                                const idx = d().filterBy.findIndex(e => e.disOpt === opt.disOpt);
                                                if (idx !== -1) {
                                                    p.setForm("config", "d", "filterBy", idx, "values", vals);
                                                }
                                            }}
                                        />
                                    </Show>
                                </div>
                            );
                        }}
                    </For>
                </div>
            </PLabelHolder>

            {/* Values filter */}
            <PLabelHolder label="Values filter">
                <FilterValuesEditor
                    values={d().valuesFilter ?? []}
                    onChange={(vals) =>
                        p.setForm("config", "d", "valuesFilter",
                            vals.length > 0 ? vals : undefined
                        )
                    }
                />
            </PLabelHolder>

            {/* Include national */}
            <Show
                when={d().disaggregateBy.some(
                    (x) => x.disOpt === "admin_area_2"
                )}
            >
                <div class="p-spy-sm">
                    <PCheckbox
                        label="Include National results"
                        checked={d().includeNationalForAdminArea2}
                        onChange={(v) =>
                            p.setForm("config", "d", "includeNationalForAdminArea2",
                                v || undefined
                            )
                        }
                    />
                    <Show when={d().includeNationalForAdminArea2}>
                        <PRadioGroup
                            label="National position"
                            options={[
                                { value: "top", label: "Top" },
                                { value: "bottom", label: "Bottom" },
                            ]}
                            value={d().includeNationalPosition ?? "bottom"}
                            onChange={(v) =>
                                p.setForm("config", "d", "includeNationalPosition",
                                    v as "top" | "bottom"
                                )
                            }
                            horizontal
                        />
                    </Show>
                </div>
            </Show>
        </div>
    );
}

function PresentationTab(p: {
    form: PresetFormData;
    setForm: SetStoreFunction<PresetFormData>;
}) {
    const s = () => p.form.config.s ?? {};
    const type = () => p.form.config.d.type;

    function setS<K extends keyof StyleConfig>(key: K, value: StyleConfig[K]) {
        if (!p.form.config.s) p.setForm("config", "s", {} as StyleConfig);
        (p.setForm as any)("config", "s", key, value === false ? undefined : value);
    }

    return (
        <div class="p-pad p-spy">
            <PSlider
                label="Scale"
                min={0.1}
                max={5}
                step={0.1}
                value={s().scale ?? 1}
                onChange={(v) => setS("scale", v)}
            />

            {/* Aspect ratio */}
            <Show when={type() !== "table"}>
                <PRadioGroup
                    label="Aspect ratio"
                    options={[
                        { value: "none", label: "Fit to area" },
                        { value: "video", label: "16 x 9" },
                        { value: "square", label: "1 x 1" },
                    ]}
                    value={s().idealAspectRatio ?? "none"}
                    onChange={(v) => setS("idealAspectRatio", v)}
                />
            </Show>
            <Show when={type() === "table"}>
                <PRadioGroup
                    label="Aspect ratio"
                    options={[
                        { value: "none", label: "Fit to area" },
                        { value: "ideal", label: "Ideal for table" },
                    ]}
                    value={s().idealAspectRatio ?? "none"}
                    onChange={(v) => setS("idealAspectRatio", v)}
                />
            </Show>

            {/* Table-specific */}
            <Show when={type() === "table"}>
                <PCheckbox
                    label="Allow vertical column headers"
                    checked={s().allowVerticalColHeaders}
                    onChange={(v) => setS("allowVerticalColHeaders", v || undefined)}
                />
                <PCheckbox
                    label="Special RMNCAH Scorecard table"
                    checked={s().specialScorecardTable}
                    onChange={(v) => setS("specialScorecardTable", v || undefined)}
                />
            </Show>

            {/* Display format - timeseries */}
            <Show when={type() === "timeseries"}>
                <PRadioGroup
                    label="Display format"
                    options={[
                        { value: "lines", label: "Lines" },
                        { value: "areas", label: "Areas" },
                        { value: "bars", label: "Bars" },
                    ]}
                    value={s().content ?? "lines"}
                    onChange={(v) => setS("content", v)}
                />
                <PCheckbox
                    label="Special coverage chart"
                    checked={s().specialCoverageChart}
                    onChange={(v) => setS("specialCoverageChart", v || undefined)}
                />
            </Show>

            {/* Display format - chart */}
            <Show when={type() === "chart"}>
                <PRadioGroup
                    label="Display format"
                    options={[
                        { value: "bars", label: "Bars" },
                        { value: "points", label: "Points" },
                        { value: "lines", label: "Lines" },
                    ]}
                    value={s().content ?? "bars"}
                    onChange={(v) => setS("content", v)}
                />
                <PLabelHolder label="Sort indicator values">
                    <div class="p-spy-sm">
                        <PCheckbox
                            label="Descending"
                            checked={s().sortIndicatorValues === "descending"}
                            onChange={(v) =>
                                setS(
                                    "sortIndicatorValues",
                                    v ? "descending" : undefined
                                )
                            }
                        />
                        <PCheckbox
                            label="Ascending"
                            checked={s().sortIndicatorValues === "ascending"}
                            onChange={(v) =>
                                setS(
                                    "sortIndicatorValues",
                                    v ? "ascending" : undefined
                                )
                            }
                        />
                    </div>
                </PLabelHolder>
                <PCheckbox
                    label="Vertical tick labels"
                    checked={s().verticalTickLabels}
                    onChange={(v) => setS("verticalTickLabels", v || undefined)}
                />
            </Show>

            {/* Stacked bars */}
            <Show
                when={
                    type() !== "table" && s().content === "bars"
                }
            >
                <PCheckbox
                    label="Stacked bars"
                    checked={s().barsStacked}
                    onChange={(v) => setS("barsStacked", v || undefined)}
                />
            </Show>

            {/* Data labels */}
            <Show when={type() !== "table"}>
                <Show
                    when={
                        s().content === "bars" || s().content === "points"
                    }
                >
                    <PCheckbox
                        label="Show data labels"
                        checked={s().showDataLabels}
                        onChange={(v) => setS("showDataLabels", v || undefined)}
                    />
                </Show>
                <Show
                    when={
                        s().content === "lines" || s().content === "areas"
                    }
                >
                    <PCheckbox
                        label="Show data labels in line charts"
                        checked={s().showDataLabelsLineCharts}
                        onChange={(v) =>
                            setS("showDataLabelsLineCharts", v || undefined)
                        }
                    />
                </Show>
                <PCheckbox
                    label="Force y-axis max of 100%"
                    checked={s().forceYMax1}
                    onChange={(v) => setS("forceYMax1", v || undefined)}
                />
                <PCheckbox
                    label="Allow auto y-axis min"
                    checked={s().forceYMinAuto}
                    onChange={(v) => setS("forceYMinAuto", v || undefined)}
                />
                <PCheckbox
                    label="Allow individual row limits"
                    checked={s().allowIndividualRowLimits}
                    onChange={(v) => setS("allowIndividualRowLimits", v || undefined)}
                />
            </Show>

            {/* Diff areas */}
            <Show when={type() === "timeseries" && s().content === "areas"}>
                <div class="p-spy-sm">
                    <PCheckbox
                        label="Diff areas"
                        checked={s().diffAreas}
                        onChange={(v) => setS("diffAreas", v || undefined)}
                    />
                    <Show when={s().diffAreas}>
                        <PCheckbox
                            label="Invert red/green for surplus/disruptions"
                            checked={s().diffInverted}
                            onChange={(v) => setS("diffInverted", v || undefined)}
                        />
                    </Show>
                </div>
            </Show>

            {/* Decimal places */}
            <PRadioGroup
                label="Decimal places"
                options={[
                    { value: "0", label: "0" },
                    { value: "1", label: "1" },
                    { value: "2", label: "2" },
                    { value: "3", label: "3" },
                ]}
                value={String(s().decimalPlaces ?? 0)}
                onChange={(v) => setS("decimalPlaces", Number(v))}
                horizontal
            />

            {/* Conditional formatting */}
            <PRadioGroup
                label="Conditional formatting"
                options={CONDITIONAL_FORMATTING_OPTIONS.map((v) => ({
                    value: v,
                    label: v === "none" ? "None" : v,
                }))}
                value={s().conditionalFormatting ?? "none"}
                onChange={(v) =>
                    setS("conditionalFormatting", v === "none" ? undefined : v)
                }
            />

            {/* Color scale */}
            <Show when={type() !== "table"}>
                <PRadioGroup
                    label="Color scale"
                    options={COLOR_SCALE_OPTIONS}
                    value={s().colorScale ?? "pastel-discrete"}
                    onChange={(v) => setS("colorScale", v)}
                />
                <PSelect
                    label="Color scale mapping"
                    options={
                        type() === "timeseries"
                            ? [
                                  { value: "series", label: "Series (lines/bars)" },
                                  { value: "cell", label: "Grid cells" },
                                  { value: "col", label: "Column groups" },
                                  { value: "row", label: "Row groups" },
                              ]
                            : [
                                  { value: "series", label: "Series (sub-bars)" },
                                  { value: "cell", label: "Grid cells" },
                                  { value: "col", label: "Column groups" },
                                  { value: "row", label: "Row groups" },
                              ]
                    }
                    value={s().seriesColorFuncPropToUse ?? "series"}
                    onChange={(v) => setS("seriesColorFuncPropToUse", v)}
                />
            </Show>

            {/* Hide legend */}
            <PCheckbox
                label="Hide legend"
                checked={s().hideLegend}
                onChange={(v) => setS("hideLegend", v || undefined)}
            />
        </div>
    );
}

function TextTab(p: {
    form: PresetFormData;
    setForm: SetStoreFunction<PresetFormData>;
}) {
    const t = () => p.form.config.t ?? {};

    function ensureT() {
        if (!p.form.config.t) p.setForm("config", "t", {} as TextConfig);
    }

    function setTextProp(field: "caption" | "subCaption" | "footnote", lang: "en" | "fr", v: string) {
        ensureT();
        if (!(p.form.config.t as any)?.[field]) {
            (p.setForm as any)("config", "t", field, { en: "", fr: "" });
        }
        (p.setForm as any)("config", "t", field, lang, v);
    }

    function setTextSize(field: string, v: number) {
        ensureT();
        (p.setForm as any)("config", "t", field, v);
    }

    return (
        <div class="p-pad p-spy">
            <div class="p-spy-sm">
                <div class="p-form-row">
                    <PTextArea
                        label="Caption (EN)"
                        value={t().caption?.en ?? ""}
                        onChange={(v) => setTextProp("caption", "en", v)}
                    />
                    <PTextArea
                        label="Caption (FR)"
                        value={t().caption?.fr ?? ""}
                        onChange={(v) => setTextProp("caption", "fr", v)}
                    />
                </div>
                <PSlider
                    label="Caption font size"
                    min={0.5}
                    max={3}
                    step={0.1}
                    value={t().captionRelFontSize ?? 2}
                    onChange={(v) => setTextSize("captionRelFontSize", v)}
                />
            </div>

            <div class="p-spy-sm">
                <div class="p-form-row">
                    <PTextArea
                        label="Sub-caption (EN)"
                        value={t().subCaption?.en ?? ""}
                        onChange={(v) => setTextProp("subCaption", "en", v)}
                    />
                    <PTextArea
                        label="Sub-caption (FR)"
                        value={t().subCaption?.fr ?? ""}
                        onChange={(v) => setTextProp("subCaption", "fr", v)}
                    />
                </div>
                <PSlider
                    label="Sub-caption font size"
                    min={0.5}
                    max={3}
                    step={0.1}
                    value={t().subCaptionRelFontSize ?? 1.3}
                    onChange={(v) => setTextSize("subCaptionRelFontSize", v)}
                />
            </div>

            <div class="p-spy-sm">
                <div class="p-form-row">
                    <PTextArea
                        label="Footnote (EN)"
                        value={t().footnote?.en ?? ""}
                        onChange={(v) => setTextProp("footnote", "en", v)}
                        height="160px"
                    />
                    <PTextArea
                        label="Footnote (FR)"
                        value={t().footnote?.fr ?? ""}
                        onChange={(v) => setTextProp("footnote", "fr", v)}
                        height="160px"
                    />
                </div>
                <PSlider
                    label="Footnote font size"
                    min={0.1}
                    max={3}
                    step={0.1}
                    value={t().footnoteRelFontSize ?? 0.9}
                    onChange={(v) => setTextSize("footnoteRelFontSize", v)}
                />
            </div>

            <div class="p-info-text p-spy-sm">
                <div>
                    In the text fields above, you can use special words to dynamically
                    insert text.
                </div>
                <div>
                    Use <strong>DATE_RANGE</strong> or{" "}
                    <strong>PLAGE_DE_DATES</strong> to insert the date range of the
                    data shown in the figure.
                </div>
                <div>
                    Use <strong>REPLICANT</strong> to insert the full replicant name
                    (e.g. an indicator, or an admin area).
                </div>
            </div>
        </div>
    );
}

// ────────────────────────────────────────────
// Main component
// ────────────────────────────────────────────

type VizPresetFormEditorProps = {
    fileContent: string;
    onFileContentChange: (content: string) => void;
};

export function VizPresetFormEditor(p: VizPresetFormEditorProps) {
    // ── Selection state ──
    const [selectedROId, setSelectedROId] = createSignal<string | null>(null);
    const [selectedMetricId, setSelectedMetricId] = createSignal<string | null>(null);
    const [selectedPresetKey, setSelectedPresetKey] = createSignal<string | null>(null);
    const [editLevel, setEditLevel] = createSignal<EditLevel>("preset");

    // ── Form state (one per level, stores with direct types — platform pattern) ──
    const [roForm, setRoForm] = createStore<ResultsObjectFormData>({ id: "", description: "" });
    const [metricForm, setMetricForm] = createStore<MetricFormData>({
        id: "", resultsObjectId: "", label: { en: "", fr: "" },
        valueProps: [], valueFunc: "COUNT", formatAs: "number",
        requiredDisaggregationOptions: [], periodOptions: [],
    });
    const [presetForm, setPresetForm] = createStore<PresetFormData>(defaultPreset());

    // ── Dirty state ──
    const [roDirty, setRoDirty] = createSignal(false);
    const [metricDirty, setMetricDirty] = createSignal(false);
    const [presetDirty, setPresetDirty] = createSignal(false);
    const anyDirty = () => roDirty() || metricDirty() || presetDirty();

    // ── Preset tab state ──
    const [presetTab, setPresetTab] = createSignal<"info" | "data" | "style" | "text">("info");

    // ── Derived data from file content ──
    const resultsObjects = () => extractResultsObjectsFromFile(p.fileContent);
    const allMetrics = () => extractFullMetricsFromFile(p.fileContent);
    const allPresets = () => extractPresetsFromFile(p.fileContent);

    // Filtered by parent selection
    const metricsForSelectedRO = () => {
        const roId = selectedROId();
        if (!roId) return [];
        return allMetrics().filter((m) => m.resultsObjectId === roId);
    };

    const presetsForSelectedMetric = () => {
        const mId = selectedMetricId();
        if (!mId) return [];
        return allPresets().filter((ep) => ep.metricId === mId);
    };

    const presetOptions = () => {
        return presetsForSelectedMetric().map((ep) => ({
            key: `${ep.metricId}::${ep.preset.id ?? ""}::${ep.presetIndex}`,
            label: ep.preset.label?.en ?? ep.preset.id ?? `Preset ${ep.presetIndex}`,
            extracted: ep,
        }));
    };

    // ── Selection helpers ──

    function selectResultsObject(roId: string, force = false) {
        if (!force && anyDirty()) {
            if (!confirm("You have unsaved changes. Discard and switch?")) return;
        }
        setSelectedROId(roId);
        setSelectedMetricId(null);
        setSelectedPresetKey(null);

        const ro = resultsObjects().find((r) => r.id === roId);
        if (ro) {
            setRoForm(reconcile(ro.data));
            setRoDirty(false);
        }
        setMetricDirty(false);
        setPresetDirty(false);
        setEditLevel("resultsObject");

        // Auto-select first metric for this RO
        const roMetrics = allMetrics().filter((m) => m.resultsObjectId === roId);
        if (roMetrics.length > 0) {
            loadMetric(roMetrics[0]);
        }
    }

    function selectMetric(metricId: string, force = false) {
        if (!force && (metricDirty() || presetDirty())) {
            if (!confirm("You have unsaved changes. Discard and switch?")) return;
        }
        setSelectedMetricId(metricId);
        setSelectedPresetKey(null);

        const m = allMetrics().find((m) => m.metricId === metricId);
        if (m) {
            loadMetric(m);
        }
        setPresetDirty(false);
        setEditLevel("metric");

        // Auto-select first preset for this metric
        const metricPresets = allPresets().filter((ep) => ep.metricId === metricId);
        if (metricPresets.length > 0) {
            loadPreset(metricPresets[0]);
        }
    }

    function loadMetric(m: ExtractedMetric) {
        setSelectedMetricId(m.metricId);
        if (m.data) {
            const formData: MetricFormData = {
                id: m.data.id ?? m.metricId,
                resultsObjectId: m.data.resultsObjectId ?? m.resultsObjectId,
                label: m.data.label ?? { en: "", fr: "" },
                valueProps: m.data.valueProps ?? [],
                valueFunc: m.data.valueFunc ?? "COUNT",
                formatAs: m.data.formatAs ?? "number",
                requiredDisaggregationOptions: m.data.requiredDisaggregationOptions ?? [],
                periodOptions: m.data.periodOptions ?? [],
                valueLabelReplacements: m.data.valueLabelReplacements,
                postAggregationExpression: m.data.postAggregationExpression,
                hide: m.data.hide,
                variantLabel: m.data.variantLabel,
                importantNotes: m.data.importantNotes,
                aiDescription: m.data.aiDescription,
            };
            setMetricForm(reconcile(formData));
        }
        setMetricDirty(false);
    }

    function selectPreset(key: string, force = false) {
        if (!force && presetDirty()) {
            if (!confirm("You have unsaved changes. Discard and switch?")) return;
        }
        const opt = presetOptions().find((o) => o.key === key);
        if (opt) {
            loadPreset(opt.extracted);
        }
        setEditLevel("preset");
    }

    function loadPreset(ep: ExtractedPreset) {
        const key = `${ep.metricId}::${ep.preset.id ?? ""}::${ep.presetIndex}`;
        setSelectedPresetKey(key);
        setPresetForm(reconcile(ep.preset));
        setPresetDirty(false);
        setPresetTab("info");
    }

    // ── Auto-select first RO on file load or module switch ──
    createEffect(
        on(
            () => p.fileContent,
            () => {
                const ros = resultsObjects();
                const currentRO = selectedROId();

                // If no ROs, clear everything
                if (ros.length === 0) {
                    setSelectedROId(null);
                    setSelectedMetricId(null);
                    setSelectedPresetKey(null);
                    setRoDirty(false);
                    setMetricDirty(false);
                    setPresetDirty(false);
                    return;
                }

                // If current selection is invalid (module switch), reset and select first
                if (!currentRO || !ros.some((r) => r.id === currentRO)) {
                    setSelectedROId(null);
                    setSelectedMetricId(null);
                    setSelectedPresetKey(null);
                    setRoDirty(false);
                    setMetricDirty(false);
                    setPresetDirty(false);
                    selectResultsObject(ros[0].id, true);
                }
            }
        )
    );

    // ── Dirty-tracking store wrappers (platform pattern) ──

    const trackRoForm: SetStoreFunction<ResultsObjectFormData> = (...args: any[]) => {
        (setRoForm as any)(...args);
        setRoDirty(true);
    };

    const trackMetricForm: SetStoreFunction<MetricFormData> = (...args: any[]) => {
        (setMetricForm as any)(...args);
        setMetricDirty(true);
    };

    const trackPresetForm: SetStoreFunction<PresetFormData> = (...args: any[]) => {
        (setPresetForm as any)(...args);
        setPresetDirty(true);
    };

    // ── Apply functions ──

    function applyResultsObjectChanges() {
        const roId = selectedROId();
        if (!roId) return;

        const ro = resultsObjects().find((r) => r.id === roId);
        if (!ro) return;

        const formData = unwrap(roForm);
        const newContent = replaceResultsObjectInFile(p.fileContent, ro, formData);
        p.onFileContentChange(newContent);
        setRoDirty(false);
        setSelectedROId(formData.id);
    }

    function applyMetricChanges() {
        const mId = selectedMetricId();
        if (!mId) return;

        const m = allMetrics().find((m) => m.metricId === mId);
        if (!m) return;

        const formData = unwrap(metricForm);
        const newContent = replaceMetricInFile(p.fileContent, m, formData);
        p.onFileContentChange(newContent);
        setMetricDirty(false);
        setSelectedMetricId(formData.id);
    }

    function applyPresetChanges() {
        const key = selectedPresetKey();
        if (!key) return;

        const opt = presetOptions().find((o) => o.key === key);
        if (!opt) return;

        const formData = unwrap(presetForm);
        const preset = cleanPreset(formData);
        const newContent = replacePresetInFile(p.fileContent, opt.extracted, preset);
        p.onFileContentChange(newContent);
        setPresetDirty(false);

        const newKey = `${opt.extracted.metricId}::${preset.id}::${opt.extracted.presetIndex}`;
        setSelectedPresetKey(newKey);
    }

    function cleanPreset(f: PresetFormData): any {
        const result: any = {
            id: f.id,
            label: f.label,
            description: f.description,
            config: {
                d: { ...f.config.d },
            },
        };

        if (!result.config.d.valuesFilter || result.config.d.valuesFilter.length === 0) {
            delete result.config.d.valuesFilter;
        }
        if (!result.config.d.includeNationalForAdminArea2) {
            delete result.config.d.includeNationalForAdminArea2;
            delete result.config.d.includeNationalPosition;
        }
        if (!result.config.d.selectedReplicantValue) {
            delete result.config.d.selectedReplicantValue;
        }

        if (f.needsReplicant) result.needsReplicant = true;
        if (f.allowedFilters && f.allowedFilters.length > 0)
            result.allowedFilters = f.allowedFilters;
        if (f.createDefaultVisualizationOnInstall)
            result.createDefaultVisualizationOnInstall = f.createDefaultVisualizationOnInstall;
        if (f.defaultPeriodFilterForDefaultVisualizations)
            result.defaultPeriodFilterForDefaultVisualizations =
                f.defaultPeriodFilterForDefaultVisualizations;

        if (f.config.s && Object.keys(f.config.s).length > 0) {
            result.config.s = { ...f.config.s };
        }

        if (f.config.t) {
            const t = f.config.t;
            const hasContent =
                t.caption?.en || t.caption?.fr ||
                t.subCaption?.en || t.subCaption?.fr ||
                t.footnote?.en || t.footnote?.fr;
            if (hasContent) {
                result.config.t = {};
                if (t.caption?.en || t.caption?.fr) result.config.t.caption = t.caption;
                if (t.subCaption?.en || t.subCaption?.fr) result.config.t.subCaption = t.subCaption;
                if (t.footnote?.en || t.footnote?.fr) result.config.t.footnote = t.footnote;
                if (t.captionRelFontSize !== undefined)
                    result.config.t.captionRelFontSize = t.captionRelFontSize;
                if (t.subCaptionRelFontSize !== undefined)
                    result.config.t.subCaptionRelFontSize = t.subCaptionRelFontSize;
                if (t.footnoteRelFontSize !== undefined)
                    result.config.t.footnoteRelFontSize = t.footnoteRelFontSize;
            }
        }

        return result;
    }

    // ── New / Delete preset ──

    function addNewPreset() {
        const metricId = selectedMetricId();
        if (!metricId) return;
        const preset = defaultPreset();
        const result = insertPresetInFile(p.fileContent, metricId, preset);
        if (result) {
            p.onFileContentChange(result.content);
            setPresetDirty(false);
            setSelectedPresetKey(null);
            setTimeout(() => {
                const opts = presetOptions();
                const newOpt = opts.find((o) => o.key === result.insertedKey);
                if (newOpt) selectPreset(newOpt.key, true);
                else if (opts.length > 0) selectPreset(opts[opts.length - 1].key, true);
            }, 0);
        }
    }

    function deleteCurrentPreset() {
        const key = selectedPresetKey();
        if (!key) return;
        const opt = presetOptions().find((o) => o.key === key);
        if (!opt) return;
        if (!confirm(`Delete preset "${opt.extracted.preset.label?.en ?? opt.extracted.preset.id}"?`))
            return;
        const newContent = deletePresetFromFile(p.fileContent, opt.extracted);
        p.onFileContentChange(newContent);
        setSelectedPresetKey(null);
        setPresetDirty(false);
        setTimeout(() => {
            const opts = presetOptions();
            if (opts.length > 0) selectPreset(opts[0].key, true);
        }, 0);
    }

    // ── New / Delete results object ──

    function addNewResultsObject() {
        const ro = defaultResultsObject();
        const result = insertResultsObjectInFile(p.fileContent, ro);
        if (result) {
            p.onFileContentChange(result.content);
            setRoDirty(false);
            setSelectedROId(null);
            setTimeout(() => {
                const ros = resultsObjects();
                const newRo = ros.find((r) => r.id === result.insertedId);
                if (newRo) selectResultsObject(newRo.id, true);
                else if (ros.length > 0) selectResultsObject(ros[ros.length - 1].id, true);
            }, 0);
        }
    }

    function deleteCurrentResultsObject() {
        const roId = selectedROId();
        if (!roId) return;
        const ro = resultsObjects().find((r) => r.id === roId);
        if (!ro) return;
        if (!confirm(`Delete results object "${roId}"? This will NOT remove associated metrics.`)) return;
        const newContent = deleteResultsObjectFromFile(p.fileContent, ro);
        p.onFileContentChange(newContent);
        setSelectedROId(null);
        setSelectedMetricId(null);
        setSelectedPresetKey(null);
        setRoDirty(false);
        setMetricDirty(false);
        setPresetDirty(false);
        setTimeout(() => {
            const ros = resultsObjects();
            if (ros.length > 0) selectResultsObject(ros[0].id, true);
        }, 0);
    }

    // ── New / Delete metric ──

    function addNewMetric() {
        const roId = selectedROId();
        if (!roId) return;
        const metric = defaultMetric(roId);
        const result = insertMetricInFile(p.fileContent, metric);
        if (result) {
            p.onFileContentChange(result.content);
            setMetricDirty(false);
            setSelectedMetricId(null);
            setTimeout(() => {
                const metrics = metricsForSelectedRO();
                const newM = metrics.find((m) => m.metricId === result.insertedId);
                if (newM) selectMetric(newM.metricId, true);
                else if (metrics.length > 0) selectMetric(metrics[metrics.length - 1].metricId, true);
            }, 0);
        }
    }

    function deleteCurrentMetric() {
        const mId = selectedMetricId();
        if (!mId) return;
        const m = allMetrics().find((m) => m.metricId === mId);
        if (!m) return;
        if (!confirm(`Delete metric "${m.label.en}" (${mId})? This will also remove all its viz presets.`)) return;
        const newContent = deleteMetricFromFile(p.fileContent, m);
        p.onFileContentChange(newContent);
        setSelectedMetricId(null);
        setSelectedPresetKey(null);
        setMetricDirty(false);
        setPresetDirty(false);
        setTimeout(() => {
            const metrics = metricsForSelectedRO();
            if (metrics.length > 0) selectMetric(metrics[0].metricId, true);
        }, 0);
    }

    // ── Render ──

    return (
        <div
            style={{
                display: "flex",
                "flex-direction": "column",
                height: "100%",
                overflow: "hidden",
            }}
        >
            {/* Hierarchy selectors */}
            <div class="p-hierarchy-selectors">
                {/* Row 1: Results Object */}
                <div class="p-hierarchy-row">
                    <span class="p-hierarchy-label">Results Object</span>
                    <select
                        class="p-select-input"
                        value={selectedROId() ?? ""}
                        onChange={(e) => {
                            if (e.currentTarget.value) {
                                selectResultsObject(e.currentTarget.value);
                            }
                        }}
                    >
                        <option value="" disabled>
                            Select...
                        </option>
                        <For each={resultsObjects()}>
                            {(ro) => <option value={ro.id}>{ro.id}</option>}
                        </For>
                    </select>
                    <div class="p-hierarchy-actions">
                        <button
                            type="button"
                            class="p-btn-sm p-btn-primary"
                            onClick={() => addNewResultsObject()}
                        >
                            + New
                        </button>
                        <Show when={selectedROId()}>
                            <button
                                type="button"
                                class="p-btn-sm p-btn-danger"
                                onClick={deleteCurrentResultsObject}
                            >
                                Delete
                            </button>
                        </Show>
                        <button
                            class="p-edit-level-btn"
                            data-active={editLevel() === "resultsObject"}
                            onClick={() => setEditLevel("resultsObject")}
                            disabled={!selectedROId()}
                        >
                            Edit
                        </button>
                    </div>
                </div>

                {/* Row 2: Metric */}
                <div class="p-hierarchy-row">
                    <span class="p-hierarchy-label">Metric</span>
                    <select
                        class="p-select-input"
                        value={selectedMetricId() ?? ""}
                        onChange={(e) => {
                            if (e.currentTarget.value) {
                                selectMetric(e.currentTarget.value);
                            }
                        }}
                        disabled={!selectedROId()}
                    >
                        <option value="" disabled>
                            {selectedROId()
                                ? metricsForSelectedRO().length === 0
                                    ? "No metrics for this RO"
                                    : "Select..."
                                : "Select a Results Object first"}
                        </option>
                        <For each={metricsForSelectedRO()}>
                            {(m) => (
                                <option value={m.metricId}>
                                    {m.label.en} ({m.metricId})
                                </option>
                            )}
                        </For>
                    </select>
                    <div class="p-hierarchy-actions">
                        <Show when={selectedROId()}>
                            <button
                                type="button"
                                class="p-btn-sm p-btn-primary"
                                onClick={() => addNewMetric()}
                            >
                                + New
                            </button>
                        </Show>
                        <Show when={selectedMetricId()}>
                            <button
                                type="button"
                                class="p-btn-sm p-btn-danger"
                                onClick={deleteCurrentMetric}
                            >
                                Delete
                            </button>
                        </Show>
                        <button
                            class="p-edit-level-btn"
                            data-active={editLevel() === "metric"}
                            onClick={() => setEditLevel("metric")}
                            disabled={!selectedMetricId()}
                        >
                            Edit
                        </button>
                    </div>
                </div>

                {/* Row 3: VizPreset */}
                <div class="p-hierarchy-row">
                    <span class="p-hierarchy-label">Viz Preset</span>
                    <select
                        class="p-select-input"
                        value={selectedPresetKey() ?? ""}
                        onChange={(e) => {
                            if (e.currentTarget.value) {
                                selectPreset(e.currentTarget.value);
                            }
                        }}
                        disabled={!selectedMetricId()}
                    >
                        <option value="" disabled>
                            {selectedMetricId()
                                ? presetOptions().length === 0
                                    ? "No presets for this metric"
                                    : "Select..."
                                : "Select a Metric first"}
                        </option>
                        <For each={presetOptions()}>
                            {(opt) => (
                                <option value={opt.key}>{opt.label}</option>
                            )}
                        </For>
                    </select>
                    <div class="p-hierarchy-actions">
                        <Show when={selectedMetricId()}>
                            <button
                                class="p-btn-sm p-btn-primary"
                                onClick={() => addNewPreset()}
                            >
                                + New
                            </button>
                        </Show>
                        <Show when={selectedPresetKey()}>
                            <button
                                class="p-btn-sm p-btn-danger"
                                onClick={deleteCurrentPreset}
                            >
                                Delete
                            </button>
                        </Show>
                        <button
                            class="p-edit-level-btn"
                            data-active={editLevel() === "preset"}
                            onClick={() => setEditLevel("preset")}
                            disabled={!selectedPresetKey()}
                        >
                            Edit
                        </button>
                    </div>
                </div>
            </div>

            {/* Main form area */}
            <div
                style={{
                    flex: "1",
                    "overflow-y": "auto",
                    "min-height": "0",
                }}
            >
                {/* ResultsObject editor */}
                <Show when={editLevel() === "resultsObject" && selectedROId()}>
                    <ResultsObjectEditor
                        form={roForm}
                        setForm={trackRoForm}
                    />
                </Show>

                {/* Metric editor */}
                <Show when={editLevel() === "metric" && selectedMetricId()}>
                    <MetricEditor
                        form={metricForm}
                        setForm={trackMetricForm}
                        resultsObjectIds={resultsObjects().map((r) => r.id)}
                    />
                </Show>

                {/* VizPreset editor */}
                <Show when={editLevel() === "preset" && selectedPresetKey()}>
                    <div class="p-tabs">
                        <button
                            class="p-tab"
                            data-selected={presetTab() === "info"}
                            onClick={() => setPresetTab("info")}
                        >
                            Info
                        </button>
                        <button
                            class="p-tab"
                            data-selected={presetTab() === "data"}
                            onClick={() => setPresetTab("data")}
                        >
                            Data
                        </button>
                        <button
                            class="p-tab"
                            data-selected={presetTab() === "style"}
                            onClick={() => setPresetTab("style")}
                        >
                            Presentation
                        </button>
                        <button
                            class="p-tab"
                            data-selected={presetTab() === "text"}
                            onClick={() => setPresetTab("text")}
                        >
                            Text
                        </button>
                    </div>
                    <Show when={presetTab() === "info"}>
                        <InfoTab form={presetForm} setForm={trackPresetForm} />
                    </Show>
                    <Show when={presetTab() === "data"}>
                        <DataTab form={presetForm} setForm={trackPresetForm} />
                    </Show>
                    <Show when={presetTab() === "style"}>
                        <PresentationTab form={presetForm} setForm={trackPresetForm} />
                    </Show>
                    <Show when={presetTab() === "text"}>
                        <TextTab form={presetForm} setForm={trackPresetForm} />
                    </Show>
                </Show>

                {/* Empty state */}
                <Show
                    when={
                        (editLevel() === "resultsObject" && !selectedROId()) ||
                        (editLevel() === "metric" && !selectedMetricId()) ||
                        (editLevel() === "preset" && !selectedPresetKey())
                    }
                >
                    <div
                        style={{
                            display: "flex",
                            "align-items": "center",
                            "justify-content": "center",
                            padding: "40px",
                            color: "#a1a1a1",
                            "font-size": "14px",
                        }}
                    >
                        {editLevel() === "resultsObject"
                            ? "Select a Results Object to edit"
                            : editLevel() === "metric"
                            ? "Select a Metric to edit"
                            : "Select a Viz Preset to edit"}
                    </div>
                </Show>
            </div>

            {/* Apply bar */}
            <div class="p-apply-bar">
                <div style={{ display: "flex", gap: "12px", "align-items": "center" }}>
                    <Show when={roDirty()}>
                        <span class="p-dirty-indicator">RO: unsaved</span>
                    </Show>
                    <Show when={metricDirty()}>
                        <span class="p-dirty-indicator">Metric: unsaved</span>
                    </Show>
                    <Show when={presetDirty()}>
                        <span class="p-dirty-indicator">Preset: unsaved</span>
                    </Show>
                </div>
                <div style={{ "margin-left": "auto", display: "flex", gap: "8px" }}>
                    <Show when={roDirty() && editLevel() === "resultsObject"}>
                        <button
                            class="p-btn-sm p-btn-primary"
                            onClick={applyResultsObjectChanges}
                        >
                            Apply Results Object
                        </button>
                    </Show>
                    <Show when={metricDirty() && editLevel() === "metric"}>
                        <button
                            class="p-btn-sm p-btn-primary"
                            onClick={applyMetricChanges}
                        >
                            Apply Metric
                        </button>
                    </Show>
                    <Show when={presetDirty() && editLevel() === "preset"}>
                        <button
                            class="p-btn-sm p-btn-primary"
                            onClick={applyPresetChanges}
                        >
                            Apply Preset
                        </button>
                    </Show>
                </div>
            </div>
        </div>
    );
}
