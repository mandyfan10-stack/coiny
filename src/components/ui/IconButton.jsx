import styles from './Controls.module.css';

export default function IconButton({ label, active = false, variant = 'quiet', className = '', children, ...props }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...props}
      className={`${styles.iconButton} ${variant === 'primary' ? styles.primary : ''} ${active ? styles.active : ''} ${className}`}
    >
      {children}
    </button>
  );
}
