const sections = new Set(['profile', 'appearance', 'notifications', 'stickers', 'security', 'storage']);

export function normalizeSettingsSection(section) {
  const resolved = ({ settings: 'appearance', e2ee: 'security' })[section] || section;
  return sections.has(resolved) ? resolved : null;
}
