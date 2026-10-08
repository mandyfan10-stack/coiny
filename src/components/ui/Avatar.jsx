import styles from './Avatar.module.css';

export default function Avatar({ size, className = '', children, style, ...props }) {
  return <div {...props} className={`${styles.avatar} ${className}`} style={{ ...style, ...(size ? { '--avatar-size': `${size}px` } : {}) }}>{children}</div>;
}
