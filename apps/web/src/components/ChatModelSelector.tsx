import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties
} from "react";
import { Check, ChevronDown, ChevronRight, Search } from "lucide-react";
import {
  UI_COMPLEXITY_MAX,
  UI_COMPLEXITY_MIN,
  normalizeUiComplexity,
  type ReasoningEffort
} from "../core/apiSettings";

type ChatModelSelectorProps = {
  model: string;
  modelOptions: string[];
  reasoningEffort: ReasoningEffort;
  uiComplexity: number;
  disabled?: boolean;
  onModelChange(model: string): void;
  onReasoningEffortChange(reasoningEffort: ReasoningEffort): void;
  onUiComplexityChange(uiComplexity: number): void;
};

const REASONING_OPTIONS: Array<{
  value: ReasoningEffort;
  label: string;
}> = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Ultra" }
];

const REASONING_MAX_INDEX = REASONING_OPTIONS.length - 1;

function getDisplayModelName(model: string): string {
  const trimmed = model.trim();
  const lastSegment = trimmed.split("/").filter(Boolean).pop();

  return lastSegment || trimmed || "Model";
}

function getReasoningLabel(reasoningEffort: ReasoningEffort): string {
  return (
    REASONING_OPTIONS.find((option) => option.value === reasoningEffort)?.label ??
    ""
  );
}

function getReasoningIndex(reasoningEffort: ReasoningEffort): number {
  const index = REASONING_OPTIONS.findIndex(
    (option) => option.value === reasoningEffort
  );
  return index >= 0 ? index : 0;
}

function clampSliderIndex(value: string): number {
  const index = Number.parseInt(value, 10);
  if (!Number.isFinite(index)) {
    return 0;
  }

  return Math.min(REASONING_MAX_INDEX, Math.max(0, index));
}

function getSliderStyle(value: number, min: number, max: number): CSSProperties {
  const range = Math.max(1, max - min);
  const progress = ((value - min) / range) * 100;

  return {
    "--slider-progress": `${Math.min(100, Math.max(0, progress))}%`
  } as CSSProperties;
}

export function ChatModelSelector({
  model,
  modelOptions,
  reasoningEffort,
  uiComplexity,
  disabled = false,
  onModelChange,
  onReasoningEffortChange,
  onUiComplexityChange
}: ChatModelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const closeModelMenuTimeoutRef = useRef<number | null>(null);
  const normalizedQuery = query.trim().toLowerCase();
  const reasoningLabel = getReasoningLabel(reasoningEffort);
  const reasoningIndex = getReasoningIndex(reasoningEffort);
  const normalizedUiComplexity = normalizeUiComplexity(uiComplexity);
  const parameterLabel = [
    reasoningLabel,
    `UI ${normalizedUiComplexity}`
  ].filter(Boolean).join(" · ");
  const filteredModels = useMemo(() => {
    if (!normalizedQuery) {
      return modelOptions;
    }

    return modelOptions.filter((option) =>
      option.toLowerCase().includes(normalizedQuery)
    );
  }, [modelOptions, normalizedQuery]);

  const clearModelMenuCloseTimeout = () => {
    if (closeModelMenuTimeoutRef.current !== null) {
      window.clearTimeout(closeModelMenuTimeoutRef.current);
      closeModelMenuTimeoutRef.current = null;
    }
  };

  const scheduleModelMenuClose = () => {
    clearModelMenuCloseTimeout();
    closeModelMenuTimeoutRef.current = window.setTimeout(() => {
      setIsModelMenuOpen(false);
      closeModelMenuTimeoutRef.current = null;
    }, 120);
  };

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
        setIsModelMenuOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      clearModelMenuCloseTimeout();
    };
  }, [isOpen]);

  return (
    <div className="chat-model-selector" ref={rootRef}>
      {isOpen ? (
        <div
          className="chat-model-menu-shell"
          onMouseEnter={clearModelMenuCloseTimeout}
          onMouseLeave={scheduleModelMenuClose}
        >
          {isModelMenuOpen ? (
            <div
              className="chat-model-submenu"
              role="listbox"
              aria-label="Choose model"
              onMouseEnter={() => {
                clearModelMenuCloseTimeout();
                setIsModelMenuOpen(true);
              }}
            >
              {modelOptions.length > 7 ? (
                <label className="chat-model-search">
                  <Search size={14} strokeWidth={2.1} aria-hidden="true" />
                  <input
                    value={query}
                    autoFocus
                    placeholder="Search models"
                    spellCheck={false}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </label>
              ) : null}
              <div className="chat-model-menu-title">Model</div>
              <div className="chat-model-menu-list">
                {filteredModels.length ? (
                  filteredModels.map((option) => {
                    const isSelected = option === model;

                    return (
                      <button
                        key={option}
                        className={`chat-model-option ${
                          isSelected ? "is-selected" : ""
                        }`}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        onClick={() => {
                          onModelChange(option);
                          setIsOpen(false);
                          setIsModelMenuOpen(false);
                        }}
                      >
                        <span>{getDisplayModelName(option)}</span>
                        {isSelected ? (
                          <Check size={17} strokeWidth={2.1} aria-hidden="true" />
                        ) : null}
                      </button>
                    );
                  })
                ) : (
                  <div className="chat-model-empty">No models</div>
                )}
              </div>
            </div>
          ) : null}

          <div className="chat-model-menu" role="menu" aria-label="Model controls">
            <div className="chat-model-slider-block">
              <div className="chat-model-slider-header">
                <span>Reasoning</span>
                <strong>{reasoningLabel || "Off"}</strong>
              </div>
              <div
                className="chat-model-slider-wrap"
                style={getSliderStyle(reasoningIndex, 0, REASONING_MAX_INDEX)}
              >
                <div className="chat-model-slider-ticks" aria-hidden="true">
                  {REASONING_OPTIONS.map((option) => (
                    <span key={option.value} />
                  ))}
                </div>
                <input
                  className="chat-model-slider"
                  type="range"
                  min={0}
                  max={REASONING_MAX_INDEX}
                  step={1}
                  value={reasoningIndex}
                  aria-label="Reasoning level"
                  aria-valuetext={reasoningLabel || "Off"}
                  onChange={(event) => {
                    const nextIndex = clampSliderIndex(event.target.value);
                    onReasoningEffortChange(REASONING_OPTIONS[nextIndex].value);
                  }}
                />
              </div>
              <div className="chat-model-slider-captions" aria-hidden="true">
                {REASONING_OPTIONS.map((option) => (
                  <span key={option.value}>{option.label}</span>
                ))}
              </div>
            </div>
            <div className="chat-model-slider-block">
              <div className="chat-model-slider-header">
                <span>UI complexity</span>
                <strong>{normalizedUiComplexity}</strong>
              </div>
              <div
                className="chat-model-slider-wrap"
                style={getSliderStyle(
                  normalizedUiComplexity,
                  UI_COMPLEXITY_MIN,
                  UI_COMPLEXITY_MAX
                )}
              >
                <div className="chat-model-slider-ticks is-compact" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                  <span />
                  <span />
                </div>
                <input
                  className="chat-model-slider"
                  type="range"
                  min={UI_COMPLEXITY_MIN}
                  max={UI_COMPLEXITY_MAX}
                  step={1}
                  value={normalizedUiComplexity}
                  aria-label="UI complexity"
                  aria-valuetext={`${normalizedUiComplexity} out of 100`}
                  onChange={(event) =>
                    onUiComplexityChange(normalizeUiComplexity(event.target.value))
                  }
                />
              </div>
              <div className="chat-model-slider-captions" aria-hidden="true">
                <span>Simple</span>
                <span>Detailed</span>
              </div>
            </div>
            <div className="chat-model-menu-separator" />
            <button
              className="chat-model-menu-item is-parent"
              type="button"
              role="menuitem"
              onMouseEnter={() => {
                clearModelMenuCloseTimeout();
                setIsModelMenuOpen(true);
              }}
              onMouseLeave={scheduleModelMenuClose}
              onFocus={() => setIsModelMenuOpen(true)}
              onClick={() => setIsModelMenuOpen(true)}
            >
              <span>{getDisplayModelName(model)}</span>
              <ChevronRight size={18} strokeWidth={2.1} aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : null}
      <button
        className="chat-model-button"
        type="button"
        disabled={disabled || !modelOptions.length}
        aria-expanded={isOpen}
        aria-label="Choose model"
        onClick={() => {
          setQuery("");
          setIsModelMenuOpen(false);
          setIsOpen((current) => !current);
        }}
      >
        <span>{getDisplayModelName(model)}</span>
        {parameterLabel ? (
          <span className="chat-model-button-reasoning">{parameterLabel}</span>
        ) : null}
        <ChevronDown size={14} strokeWidth={2.1} aria-hidden="true" />
      </button>
    </div>
  );
}
