// Frontend del módulo de autenticación; usa exclusivamente la API de sesión.
import { neonAuth } from './neon-auth.js';

const tenantBasePath = window.location.pathname.match(/^\/t\/[^/]+/)?.[0] || '';
const tenantPath = path => `${tenantBasePath}${path}`;
const globalLogin = !tenantBasePath;
const form = document.getElementById('authForm');
const emailInput = document.getElementById('authEmail');
const passwordInput = document.getElementById('authPassword');
const submitButton = document.getElementById('authSubmit');
const errorMessage = document.getElementById('authError');
const instructions = document.getElementById('authInstructions');
const title = document.getElementById('authTitle');
const adminSetupLink = document.getElementById('adminSetupLink');
const authModeToggle = document.getElementById('authModeToggle');
let tenantConfigured = false;
let createAccount = false;

function updateSubmitState() {
    const validCredentials = emailInput.value.trim() && emailInput.checkValidity() && passwordInput.value.length > 0;
    submitButton.disabled = !validCredentials || (!globalLogin && !tenantConfigured);
}

function showError(message) {
    errorMessage.textContent = message;
    errorMessage.classList.remove('hidden');
}

function updateAuthMode() {
    submitButton.textContent = createAccount ? 'Crear cuenta Neon Auth' : 'Entrar al panel';
    authModeToggle.textContent = createAccount
        ? 'Ya tengo una cuenta Neon Auth'
        : '¿Tu correo ya fue habilitado? Crea tu contraseña de Neon Auth';
    instructions.textContent = createAccount
        ? 'Usa el correo que el propietario registró para tu panadería. Verifica tu correo para acceder.'
        : tenantConfigured
            ? `Accede al panel de ${tenantBasePath ? 'tu panadería' : 'tu negocio'}.`
            : 'Ingresa el correo habilitado por el propietario de tu panadería.';
    updateSubmitState();
}

async function getProviderSessionToken() {
    const result = await neonAuth.getSession();
    if (result.error) throw new Error(result.error.message || 'No se pudo consultar la sesión de Neon Auth.');
    return result.data?.session?.token || null;
}

async function exchangeProviderSession() {
    const token = await getProviderSessionToken();
    if (!token) return false;
    const response = await fetch(tenantPath('/api/security/neon/session'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || 'Neon Auth no habilitó el acceso a PANAPP.');
    const adminPath = globalLogin ? `/t/${encodeURIComponent(result.tenant)}/admin` : tenantPath('/admin');
    window.location.replace(adminPath);
    return true;
}

async function checkSession() {
    try {
        const statusPath = globalLogin ? '/api/security/status' : tenantPath('/api/security/status');
        const response = await fetch(statusPath, { cache: 'no-store' });
        const status = await response.json();
        if (!response.ok) throw new Error(status.detail || 'No se pudo consultar la sesión.');
        if (status.authenticated) {
            const adminPath = globalLogin ? `/t/${encodeURIComponent(status.tenant)}/admin` : tenantPath('/admin');
            window.location.replace(adminPath);
            return;
        }
        if (await exchangeProviderSession()) return;
        title.textContent = 'Inicia sesión';
        tenantConfigured = Boolean(status.configured);
        instructions.textContent = status.configured || globalLogin
            ? globalLogin
                ? 'Ingresa el correo habilitado por el propietario de tu panadería.'
                : `Accede al panel de ${status.tenant?.name || 'tu panadería'}.`
            : 'Esta panadería no tiene un administrador habilitado. Un propietario debe configurarlo en Super Admin.';
        adminSetupLink.classList.toggle('hidden', globalLogin || status.configured);
        authModeToggle.classList.toggle('hidden', !globalLogin && !status.configured);
        updateSubmitState();
    } catch (error) {
        instructions.textContent = 'No se pudo conectar con PANAPP. Comprueba el servidor y la conexión a la base de datos.';
        showError(error.message || 'No se pudo consultar la sesión.');
    }
}

form.addEventListener('submit', async event => {
    event.preventDefault();
    errorMessage.classList.add('hidden');
    const username = emailInput.value.trim();
    const password = passwordInput.value;
    if (!username || !emailInput.checkValidity() || !password) {
        showError('Escribe un correo válido y tu contraseña.');
        emailInput.focus();
        return;
    }
    submitButton.disabled = true;
    submitButton.textContent = createAccount ? 'Creando cuenta…' : 'Verificando…';
    try {
        const result = createAccount
            ? await neonAuth.signUp.email({ email: username, password, name: username.split('@')[0] })
            : await neonAuth.signIn.email({ email: username, password });
        if (result.error) throw new Error(result.error.message || 'Neon Auth no pudo validar la cuenta.');
        if (await exchangeProviderSession()) return;
        if (createAccount) {
            showError('Cuenta creada. Verifica el correo y vuelve a iniciar sesión para acceder a PANAPP.');
        } else {
            throw new Error('Neon Auth no devolvió una sesión válida.');
        }
    } catch (error) {
        showError(error.message || 'No se pudo validar el acceso.');
        updateSubmitState();
    }
});

authModeToggle.addEventListener('click', () => {
    createAccount = !createAccount;
    errorMessage.classList.add('hidden');
    updateAuthMode();
});

emailInput.addEventListener('input', updateSubmitState);
passwordInput.addEventListener('input', updateSubmitState);

document.getElementById('togglePassword').addEventListener('click', event => {
    const button = event.currentTarget;
    const visible = passwordInput.type === 'password';
    passwordInput.type = visible ? 'text' : 'password';
    button.setAttribute('aria-label', visible ? 'Ocultar contraseña' : 'Mostrar contraseña');
    button.querySelector('i').className = visible ? 'fa-regular fa-eye-slash' : 'fa-regular fa-eye';
});

checkSession();
