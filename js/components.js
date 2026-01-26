/* ============================================
   Youth Baseball Lineup - Reusable Components
   ============================================ */

// ============================================
// Modal Component
// ============================================
function Modal({ title, children, onClose, footer }) {
  // Close on escape key
  React.useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">{title}</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
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
function Toggle({ checked, onChange, label, disabled = false }) {
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
function Stepper({ value, onChange, min = 0, max = 99, size = 'normal' }) {
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
function Checkbox({ checked, onChange, label, disabled = false }) {
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
function Alert({ type = 'info', children, onDismiss }) {
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
function EmptyState({ icon, title, text, action }) {
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
function StatCard({ value, label }) {
  return (
    <div className="stat-card">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

// ============================================
// Option List Component (for action menus)
// ============================================
function OptionList({ children }) {
  return <div className="option-list">{children}</div>;
}

function OptionItem({ title, description, onClick, danger = false }) {
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
function PlayerTag({ type, children }) {
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
function PositionBadge({ position, size = 'normal' }) {
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
function DragHandle() {
  return <span className="drag-handle">☰</span>;
}

// ============================================
// Confirm Dialog Component
// ============================================
function ConfirmDialog({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', onConfirm, onCancel, danger = false }) {
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

// ============================================
// Loading Spinner Component
// ============================================
function Spinner({ size = 24 }) {
  return (
    <div 
      style={{
        width: size,
        height: size,
        border: '3px solid var(--border)',
        borderTopColor: 'var(--accent)',
        borderRadius: '50%',
        animation: 'spin 0.8s linear infinite'
      }}
    />
  );
}

// Add keyframes for spinner (injected once)
if (typeof document !== 'undefined' && !document.getElementById('spinner-styles')) {
  const style = document.createElement('style');
  style.id = 'spinner-styles';
  style.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
  document.head.appendChild(style);
}
