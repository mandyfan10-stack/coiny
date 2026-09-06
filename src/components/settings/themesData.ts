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
  { id: 'telegram-blue', name: 'Синий', color: '#2481cc' },
  { id: 'emerald-green', name: 'Изумруд', color: '#0f9d58' },
  { id: 'sakura-pink', name: 'Сакура', color: '#e07a5f' },
  { id: 'electric-purple', name: 'Фиолет', color: '#8a2be2' },
  { id: 'sunset-amber', name: 'Янтарь', color: '#d97706' },
  { id: 'rainbow-pearl', name: 'Радуга', color: 'linear-gradient(135deg, #ff0000, #ff8800, #ffff00, #00ff00, #00ccff, #8a2be2, #ff00ff)' }
];

export const SETTINGS_WALLPAPERS: WallpaperOption[] = [
  { id: 'classic', name: 'Классик', style: '#0b141a radial-gradient(circle at 30% 20%, rgba(17, 24, 39, 0.6) 0%, rgba(10, 15, 20, 0.95) 100%)' },
  { id: 'sunset', name: 'Закат', style: 'linear-gradient(135deg, #302b63 0%, #24243e 50%, #0f0c1b 100%)' },
  { id: 'space', name: 'Космос', style: 'radial-gradient(ellipse at bottom, #1b2735 0%, #090a0f 100%)' },
  { id: 'mint', name: 'Мята', style: 'linear-gradient(135deg, #11221b 0%, #050b07 100%)' }
];
