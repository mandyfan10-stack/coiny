import { Search } from 'lucide-react';
import styles from './Controls.module.css';

export default function SearchField({ label, className = '', inputClassName = '', inputRef, children, ...props }) {
  return (
    <div className={`${styles.searchField} ${className}`}>
      <Search size={20} className={`${styles.searchIcon} search-icon`} aria-hidden="true" />
      <input ref={inputRef} type="search" aria-label={label} {...props} className={`${styles.searchInput} ${inputClassName}`} />
      {children}
    </div>
  );
}
