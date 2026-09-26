export type Theme = 'light' | 'dark' | 'system';

export function currentTheme(): Theme {
  try {
    return (localStorage.getItem('tracker.theme') as Theme | null) ?? 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(theme: Theme) {
  try {
    if (theme === 'system') localStorage.removeItem('tracker.theme');
    else localStorage.setItem('tracker.theme', theme);
  } catch {
    // storage unavailable: theme applies for this page only
  }
  const dark =
    theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}
