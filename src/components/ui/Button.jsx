import styles from './Controls.module.css';

export default function Button({ variant = 'primary', className = '', children, ...props }) {
  return <button type="button" {...props} className={`${styles.button} ${styles[variant]} ${className}`}>{children}</button>;
}
