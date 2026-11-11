const THEME_STORAGE_KEY = 'panapp-color-theme';

function getStoredTheme() {
    try {
        const theme = localStorage.getItem(THEME_STORAGE_KEY);
        return theme === 'dark' ? 'dark' : 'light';
    } catch (error) {
        console.warn('No se pudo leer la preferencia de tema.', error);
        return 'light';
    }
}

function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    document.querySelectorAll('[data-theme-toggle]').forEach(button => {
        const nextTheme = theme === 'dark' ? 'claro' : 'oscuro';
        button.textContent = button.dataset.themeCompact === 'true'
            ? (theme === 'dark' ? '☀️' : '🌙')
            : (theme === 'dark' ? '☀️ Modo claro' : '🌙 Modo oscuro');
        button.setAttribute('aria-label', `Activar modo ${nextTheme}`);
        button.setAttribute('aria-pressed', String(theme === 'dark'));
        button.title = `Activar modo ${nextTheme}`;
    });
}

applyTheme(getStoredTheme());

document.addEventListener('DOMContentLoaded', () => {
    applyTheme(document.documentElement.dataset.theme);
    document.querySelectorAll('[data-theme-toggle]').forEach(button => {
        button.addEventListener('click', () => {
            const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
            try {
                localStorage.setItem(THEME_STORAGE_KEY, theme);
            } catch (error) {
                console.warn('No se pudo guardar la preferencia de tema.', error);
            }
            applyTheme(theme);
        });
    });
});
