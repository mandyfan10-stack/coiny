import styles from './Controls.module.css';

export default function Switch({ id, checked, onChange, disabled, ...props }) {
  return <span className={styles.switch}>
    <input {...props} id={id} type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} />
    <span className={styles.switchTrack} aria-hidden="true" />
  </span>;
}
