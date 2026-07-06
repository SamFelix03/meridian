import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils";

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

interface CustomSelectProps {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  id?: string;
  className?: string;
  maxVisibleRows?: number;
}

interface ListPosition {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}

const ROW_PX = 44;
const LIST_GAP_PX = 8;
const VIEWPORT_PAD_PX = 12;

function computeListPosition(trigger: HTMLElement, maxVisibleRows: number): ListPosition {
  const rect = trigger.getBoundingClientRect();
  const preferredMax = Math.min(maxVisibleRows * ROW_PX, window.innerHeight * 0.45);
  const spaceBelow = window.innerHeight - rect.bottom - LIST_GAP_PX - VIEWPORT_PAD_PX;
  const spaceAbove = rect.top - LIST_GAP_PX - VIEWPORT_PAD_PX;

  const openBelow = spaceBelow >= ROW_PX * 2 || spaceBelow >= spaceAbove;
  const maxHeight = Math.max(
    ROW_PX * 2,
    Math.min(preferredMax, openBelow ? spaceBelow : spaceAbove)
  );

  const top = openBelow ? rect.bottom + LIST_GAP_PX : rect.top - LIST_GAP_PX - maxHeight;

  return {
    top: Math.max(VIEWPORT_PAD_PX, top),
    left: rect.left,
    width: rect.width,
    maxHeight,
  };
}

export function CustomSelect({
  options,
  value,
  onChange,
  placeholder = "Select…",
  id: idProp,
  className,
  maxVisibleRows = 6,
}: CustomSelectProps) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const listboxId = `${id}-listbox`;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [position, setPosition] = useState<ListPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const selectedOptionRef = useRef<HTMLButtonElement>(null);
  const selected = options.find((o) => o.value === value) ?? null;

  const enabledOptions = useMemo(() => options.filter((o) => !o.disabled), [options]);

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    setPosition(computeListPosition(triggerRef.current, maxVisibleRows));
  }, [maxVisibleRows]);

  useEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    updatePosition();
    const selectedIdx = enabledOptions.findIndex((o) => o.value === value);
    setActiveIndex(selectedIdx >= 0 ? selectedIdx : 0);
    requestAnimationFrame(() => {
      selectedOptionRef.current?.scrollIntoView({ block: "nearest" });
    });
  }, [open, value, enabledOptions, updatePosition]);

  useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || listRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        return;
      }
      if (enabledOptions.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % enabledOptions.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + enabledOptions.length) % enabledOptions.length);
      } else if (e.key === "Home") {
        e.preventDefault();
        setActiveIndex(0);
      } else if (e.key === "End") {
        e.preventDefault();
        setActiveIndex(enabledOptions.length - 1);
      } else if (e.key === "Enter" && activeIndex >= 0) {
        e.preventDefault();
        const opt = enabledOptions[activeIndex];
        if (opt) {
          onChange(opt.value);
          setOpen(false);
        }
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, activeIndex, enabledOptions, onChange]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>(
      '[role="option"]:not(:disabled)'
    );
    buttons?.[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  function selectOption(optValue: string) {
    onChange(optValue);
    setOpen(false);
  }

  const listbox =
    open && position ? (
      <div
        id={listboxId}
        ref={listRef}
        role="listbox"
        aria-label={placeholder}
        className="fixed z-[200] overflow-y-auto overscroll-contain rounded-2xl border border-border bg-popover shadow-[0_16px_48px_rgba(0,0,0,0.35)] [scrollbar-gutter:stable]"
        style={{
          top: position.top,
          left: position.left,
          width: position.width,
          maxHeight: position.maxHeight,
        }}
      >
        {options.map(({ value: optValue, label, description, disabled }) => {
          const enabledIdx = enabledOptions.findIndex((o) => o.value === optValue);
          const isSelected = value === optValue;
          const isActive = !disabled && enabledIdx === activeIndex;
          return (
            <button
              key={optValue}
              ref={isSelected ? selectedOptionRef : undefined}
              type="button"
              role="option"
              aria-selected={isSelected}
              disabled={disabled}
              onClick={() => selectOption(optValue)}
              className={cn(
                "flex min-h-11 w-full touch-manipulation flex-col justify-center gap-0.5 px-4 py-2.5 text-left text-sm transition-colors hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-40",
                isSelected && "bg-primary/10",
                isActive && !isSelected && "bg-muted/30"
              )}
            >
              <span className="flex items-center justify-between gap-2 font-medium">
                {label}
                {isSelected ? (
                  <svg
                    className="size-4 shrink-0 text-primary"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    aria-hidden
                  >
                    <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : null}
              </span>
              {description ? (
                <span className="text-xs text-muted-foreground">{description}</span>
              ) : null}
            </button>
          );
        })}
      </div>
    ) : null;

  return (
    <div className={cn("relative w-full", className)}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        onClick={() => setOpen((v) => !v)}
        className="input-field flex min-h-11 w-full cursor-pointer touch-manipulation items-center justify-between gap-2 text-left"
      >
        <span className="min-w-0 truncate font-medium">
          {selected ? (
            selected.label
          ) : (
            <span className="font-normal text-muted-foreground">{placeholder}</span>
          )}
        </span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180"
          )}
        />
      </button>

      {listbox ? createPortal(listbox, document.body) : null}
    </div>
  );
}
