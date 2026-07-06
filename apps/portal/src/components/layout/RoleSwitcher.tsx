import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { Check, ChevronDown } from "lucide-react";
import { getRoleDefinition, roleFromPath, ROLES, type MeridianRole } from "../../lib/roles";
import { cn } from "../../lib/utils";

export function RoleSwitcher() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const currentRole = roleFromPath(pathname);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(
    null
  );
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPosition({
      top: rect.bottom + 8,
      left: rect.right - 220,
      width: 220,
    });
  }, []);

  useEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    updatePosition();
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
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  if (!currentRole) return null;

  const current = getRoleDefinition(currentRole);
  const CurrentIcon = current.icon;

  function switchRole(role: MeridianRole) {
    if (role === currentRole) {
      setOpen(false);
      return;
    }
    const target = getRoleDefinition(role);
    navigate(target.homePath);
    setOpen(false);
  }

  const menu =
    open && position ? (
      <div
        id={listId}
        ref={menuRef}
        role="menu"
        aria-label="Switch role"
        className="fixed z-[200] overflow-hidden rounded-2xl border border-border bg-popover shadow-[0_16px_48px_rgba(0,0,0,0.35)]"
        style={{ top: position.top, left: Math.max(12, position.left), width: position.width }}
      >
        {ROLES.map((role) => {
          const Icon = role.icon;
          const isActive = role.id === currentRole;
          return (
            <button
              key={role.id}
              type="button"
              role="menuitemradio"
              aria-checked={isActive}
              className={cn(
                "flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition-colors hover:bg-muted/40",
                isActive && "bg-primary/10"
              )}
              onClick={() => switchRole(role.id)}
            >
              <span className="grid size-8 place-items-center rounded-lg bg-muted/50 text-muted-foreground">
                <Icon className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-foreground">{role.shortLabel}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {role.id === "ops" ? "Compliance & monitoring" : role.description.split(".")[0]}
                </span>
              </span>
              {isActive ? <Check className="size-4 shrink-0 text-primary" /> : null}
            </button>
          );
        })}
      </div>
    ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex shrink-0 items-center gap-2 rounded-full border border-border bg-card/50 py-2 pr-3 pl-2.5 text-sm font-medium text-foreground transition-colors hover:border-primary/35"
      >
        <span className="grid size-7 place-items-center rounded-full bg-primary/15 text-primary">
          <CurrentIcon className="size-3.5" />
        </span>
        <span className="hidden sm:inline">{current.shortLabel}</span>
        <ChevronDown
          className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")}
        />
      </button>
      {menu ? createPortal(menu, document.body) : null}
    </>
  );
}
