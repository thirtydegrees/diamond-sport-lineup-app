/* ============================================
   Diamond Lineup - Reusable Components
   ============================================ */

import React from 'react';
import { getPositionColorClass } from '../domain/constants';

// ============================================
// Modal Component
// ============================================
export function Modal({ title, children, onClose, footer, dismissible = true }) {
  // Close on escape key
  React.useEffect(() => {
    const handleEscape = (e) => {
      if (dismissible && e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose, dismissible]);

  return (
    <div className="modal-overlay" onClick={dismissible ? onClose : undefined}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">{title}</h3>
          {dismissible && <button className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>}
        </div>
        <div className="modal-body">
          {children}
        </div>
        {footer && (
          <div className="modal-footer">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================
// Toggle Switch Component
// ============================================
export function Toggle({ checked, onChange, label, disabled = false }) {
  const handleClick = () => {
    if (!disabled) {
      onChange(!checked);
    }
  };

  return (
    <label className={`toggle ${disabled ? 'disabled' : ''}`}>
      <div
        className={`toggle-track ${checked ? 'active' : ''}`}
        onClick={handleClick}
        role="switch"
        aria-checked={checked}
        tabIndex={disabled ? -1 : 0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleClick();
          }
        }}
      >
        <div className="toggle-thumb" />
      </div>
      {label && <span className="toggle-label">{label}</span>}
    </label>
  );
}

// ============================================
// Stepper Component (+/- buttons)
// ============================================
export function Stepper({ value, onChange, min = 0, max = 99, size = 'normal' }) {
  const decrement = () => {
    if (value > min) {
      onChange(value - 1);
    }
  };

  const increment = () => {
    if (value < max) {
      onChange(value + 1);
    }
  };

  return (
    <div className="stepper">
      <button
        className={`stepper-btn ${size === 'small' ? 'sm' : ''}`}
        onClick={decrement}
        disabled={value <= min}
        aria-label="Decrease"
      >
        −
      </button>
      <span className="stepper-value">{value}</span>
      <button
        className={`stepper-btn ${size === 'small' ? 'sm' : ''}`}
        onClick={increment}
        disabled={value >= max}
        aria-label="Increase"
      >
        +
      </button>
    </div>
  );
}

// ============================================
// Checkbox Component
// ============================================
export function Checkbox({ checked, onChange, label, disabled = false }) {
  return (
    <label className={`checkbox ${disabled ? 'disabled' : ''}`}>
      <input
        type="checkbox"
        className="checkbox-input"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
      />
      {label && <span className="checkbox-label">{label}</span>}
    </label>
  );
}

// ============================================
// Alert Component
// ============================================
export function Alert({ type = 'info', children, onDismiss }) {
  return (
    <div className={`alert alert-${type}`}>
      <div style={{ flex: 1 }}>{children}</div>
      {onDismiss && (
        <button
          className="btn-icon"
          onClick={onDismiss}
          style={{ marginLeft: '8px', background: 'transparent' }}
          aria-label="Dismiss"
        >
          ×
        </button>
      )}
    </div>
  );
}

// ============================================
// Empty State Component
// ============================================
export function EmptyState({ icon, title, text, action }) {
  return (
    <div className="empty-state">
      {icon && <div className="empty-state-icon">{icon}</div>}
      {title && <div className="empty-state-title">{title}</div>}
      {text && <div className="empty-state-text">{text}</div>}
      {action}
    </div>
  );
}

// ============================================
// Stat Card Component
// ============================================
export function StatCard({ value, label, title }) {
  return (
    <div className="stat-card" title={title}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

// ============================================
// Option List Component (for action menus)
// ============================================
export function OptionList({ children }) {
  return <div className="option-list">{children}</div>;
}

export function OptionItem({ title, description, onClick, danger = false }) {
  return (
    <div
      className={`option-item ${danger ? 'danger' : ''}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className="option-title">{title}</div>
      {description && <div className="option-desc">{description}</div>}
    </div>
  );
}

// ============================================
// Player Tag Component
// ============================================
export function PlayerTag({ type, children }) {
  const classMap = {
    pitcher: 'tag-pitcher',
    catcher: 'tag-catcher',
    eligible: 'tag-eligible',
    ineligible: 'tag-ineligible'
  };

  return (
    <span className={`player-tag ${classMap[type] || ''}`}>
      {children}
    </span>
  );
}

// ============================================
// Position Badge Component
// ============================================
export function PositionBadge({ position, size = 'normal' }) {
  const colorClass = getPositionColorClass(position);

  return (
    <span
      className={`pos-text ${colorClass}`}
      style={size === 'small' ? { fontSize: '12px' } : {}}
    >
      {position}
    </span>
  );
}

// ============================================
// Drag Handle Component
// ============================================
export function DragHandle() {
  return <span className="drag-handle">☰</span>;
}

// ============================================
// Confirm Dialog Component
// ============================================
export function ConfirmDialog({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', onConfirm, onCancel, danger = false }) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <p>{message}</p>
    </Modal>
  );
}
