import { ChevronDown } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { KeyboardEvent } from 'react';
import type { Priority } from '../types';

const priorityOptions: readonly Priority[] = ['S', 'A', 'B'];

interface PriorityPickerProps {
  value: Priority;
  onChange: (priority: Priority) => void;
  ariaLabel: string;
  variant?: 'compact' | 'form';
  disabled?: boolean;
}

interface MenuPosition {
  left: number;
  top: number;
  placement: 'above' | 'below';
}

export function PriorityPicker({
  value,
  onChange,
  ariaLabel,
  variant = 'compact',
  disabled = false,
}: PriorityPickerProps) {
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition>();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();

  const closeAndFocusTrigger = () => {
    setOpen(false);
    setMenuPosition(undefined);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  useEffect(() => {
    if (!open) return undefined;
    const closeFromOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
      setMenuPosition(undefined);
    };
    const closeFromEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      closeAndFocusTrigger();
    };
    document.addEventListener('pointerdown', closeFromOutside);
    document.addEventListener('keydown', closeFromEscape);
    return () => {
      document.removeEventListener('pointerdown', closeFromOutside);
      document.removeEventListener('keydown', closeFromEscape);
    };
  }, [open]);

  useEffect(() => {
    if (!disabled || !open) return;
    setOpen(false);
    setMenuPosition(undefined);
  }, [disabled, open]);

  useLayoutEffect(() => {
    if (!open) return undefined;
    const updatePosition = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const triggerBounds = trigger.getBoundingClientRect();
      const menuBounds = menuRef.current?.getBoundingClientRect();
      const menuWidth = menuBounds?.width || 148;
      const menuHeight = menuBounds?.height || 52;
      const viewportGutter = 8;
      const menuGap = 7;
      const placement = window.innerHeight - triggerBounds.bottom >= menuHeight + menuGap + viewportGutter
        ? 'below'
        : 'above';
      const top = placement === 'below'
        ? triggerBounds.bottom + menuGap
        : Math.max(viewportGutter, triggerBounds.top - menuHeight - menuGap);
      const left = Math.min(
        window.innerWidth - menuWidth - viewportGutter,
        Math.max(viewportGutter, triggerBounds.right - menuWidth),
      );
      setMenuPosition({ left, top, placement });
    };
    updatePosition();
    const frame = window.requestAnimationFrame(() => {
      updatePosition();
      optionRefs.current[priorityOptions.indexOf(value)]?.focus();
    });
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, value]);

  const selectPriority = (priority: Priority) => {
    setOpen(false);
    setMenuPosition(undefined);
    if (priority !== value) onChange(priority);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const moveOptionFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    const currentIndex = optionRefs.current.findIndex((option) => option === document.activeElement);
    let nextIndex: number | undefined;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (Math.max(currentIndex, -1) + 1) % priorityOptions.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (currentIndex <= 0 ? priorityOptions.length : currentIndex) - 1;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = priorityOptions.length - 1;
    } else if (event.key === 'Tab') {
      event.preventDefault();
      closeAndFocusTrigger();
      return;
    }
    if (nextIndex === undefined) return;
    event.preventDefault();
    optionRefs.current[nextIndex]?.focus();
  };

  return (
    <div className={`priority-picker priority-picker--${variant}`} ref={rootRef}>
      <button
        type="button"
        className={`priority priority--${value.toLowerCase()} priority-picker__trigger`}
        ref={triggerRef}
        aria-label={`${ariaLabel}，当前为 ${value} 级，点击快速调整`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title={`当前 ${value} 级，点击快速调整`}
        disabled={disabled}
        draggable={false}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((current) => !current);
          if (open) setMenuPosition(undefined);
        }}
        onKeyDown={(event) => {
          if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        onDragStart={(event) => event.preventDefault()}
      >
        <span>{value}</span>
        <ChevronDown className="priority-picker__chevron" size={11} strokeWidth={2.3} aria-hidden="true" />
      </button>
      {open && typeof document !== 'undefined' && createPortal(
        <div
          className="priority-picker__menu"
          id={menuId}
          ref={menuRef}
          role="menu"
          aria-label={`调整${ariaLabel}`}
          data-placement={menuPosition?.placement || 'below'}
          style={{
            left: menuPosition?.left ?? 0,
            top: menuPosition?.top ?? 0,
            visibility: menuPosition ? 'visible' : 'hidden',
          }}
          onKeyDown={moveOptionFocus}
        >
          <span className="priority-picker__menu-label" aria-hidden="true">设为</span>
          {priorityOptions.map((priority, index) => (
            <button
              type="button"
              className={`priority priority--${priority.toLowerCase()} priority-picker__option ${value === priority ? 'is-current' : ''}`}
              key={priority}
              ref={(element) => { optionRefs.current[index] = element; }}
              role="menuitemradio"
              aria-checked={value === priority}
              aria-label={`设为 ${priority} 级`}
              title={`设为 ${priority} 级`}
              draggable={false}
              onClick={() => selectPriority(priority)}
              onDragStart={(event) => event.preventDefault()}
            >
              {priority}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
