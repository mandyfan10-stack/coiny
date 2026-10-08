export interface ThemeOption {
  id: string;
  name: string;
  color: string;
}

export interface WallpaperOption {
  id: string;
  name: string;
  style: string;
}

export const SETTINGS_THEMES: ThemeOption[] = [
  { id: 'telegram-blue', name: 'Синий', color: '#2878ad' },
  { id: 'emerald-green', name: 'Изумруд', color: '#267b52' },
  { id: 'sakura-pink', name: 'Сакура', color: '#ad5858' },
  { id: 'electric-purple', name: 'Фиолет', color: '#7852ae' },
  { id: 'sunset-amber', name: 'Янтарь', color: '#9a650c' },
  { id: 'rainbow-pearl', name: 'Жемчужная', color: '#76618f' }
];

export const SETTINGS_WALLPAPERS: WallpaperOption[] = [
  { id: 'classic', name: 'Классик', style: 'var(--chat-wallpaper)' }
];
