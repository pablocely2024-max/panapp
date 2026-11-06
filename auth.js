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
let mode = 'sign-in';
let passwordResetToken = new URLSearchParams(window.location.search).get('token');
const invitationToken = new URLSearchParams(window.location.hash.slice(1)).get('invite') || '';
const otpInput = document.getElementById('authOtp');
const resetPasswordInput = document.getElementById('authResetPassword');
const resetConfirmInput = document.getElementById('authResetConfirm');

function updateSubmitState() {
    const validEmail = emailInput.value.trim() && emailInput.checkValidity();
    const validTenantAccess = globalLogin || tenantConfigured;
    const valid = {
        'sign-in': validEmail && passwordInput.value.length > 0,
        'sign-up': validEmail && passwordInput.value.length >= 8 && passwordInput.value.length <= 128,
        'verify-email': validEmail && /^\d{4,8}$/.test(otpInput.value.trim()),
        'forgot-password': validEmail,
        'reset-password': Boolean(passwordResetToken)
            && resetPasswordInput.value.length >= 8
            && resetPasswordInput.value.length <= 128
            && resetPasswordInput.value === resetConfirmInput.value
    }[mode];
    submitButton.disabled = !valid || (!validTenantAccess && ['sign-in', 'sign-up'].includes(mode));
}

function showError(message) {
    errorMessage.textContent = message;
    errorMessage.classList.remove('hidden');
}

function updateAuthMode() {
    const passwordMode = mode === 'sign-in' || mode === 'sign-up';
    const resetMode = mode === 'reset-password';
    document.getElementById('authEmailField').classList.toggle('hidden', resetMode);
    document.getElementById('authPasswordField').classList.toggle('hidden', !passwordMode);
    document.getElementById('authOtpField').classList.toggle('hidden', mode !== 'verify-email');
    document.getElementById('authResendVerification').classList.toggle('hidden', mode !== 'verify-email');
    document.getElementById('authResetPasswordField').classList.toggle('hidden', !resetMode);
    document.getElementById('authResetConfirmField').classList.toggle('hidden', !resetMode);
    document.getElementById('authForgotPassword').classList.toggle(
        'hidden',
        mode !== 'sign-in' || (!globalLogin && !tenantConfigured)
    );
    authModeToggle.classList.toggle(
        'hidden',
        !passwordMode || (!globalLogin && !tenantConfigured)
    );
    document.getElementById('authBackToLogin').classList.toggle('hidden', passwordMode);
    emailInput.readOnly = mode === 'verify-email' || resetMode;

    const titles = {
        'sign-in': 'Inicia sesión',
        'sign-up': 'Crea tu cuenta',
        'verify-email': 'Verifica tu correo',
        'forgot-password': 'Recupera tu contraseña',
        'reset-password': 'Crea una contraseña nueva'
    };
    const buttons = {
        'sign-in': 'Entrar al panel',
        'sign-up': 'Crear cuenta Neon Auth',
        'verify-email': 'Verificar código',
        'forgot-password': 'Enviar enlace de recuperación',
        'reset-password': 'Guardar contraseña nueva'
    };
    title.textContent = titles[mode];
    submitButton.textContent = buttons[mode];
    authModeToggle.textContent = mode === 'sign-up'
        ? 'Ya tengo una cuenta Neon Auth'
        : '¿Tu correo ya fue habilitado? Crea tu contraseña de Neon Auth';
    updateSubmitState();
}

function setMode(nextMode) {
    mode = nextMode;
    errorMessage.classList.add('hidden');
    updateAuthMode();
}

async function getProviderSessionToken() {
    const result = await neonAuth.getSession();
    if (result.error) throw new Error(result.error.message || 'No se pudo consultar la sesión de Neon Auth.');
    return result.data?.session?.token || null;
}

async function exchangeProviderSession() {
    const token = await getProviderSessionToken();
    if (!token) return false;
    const headers = { Authorization: `Bearer ${token}` };
    if (invitationToken) headers['X-PANAPP-Invitation'] = invitationToken;
    const response = await fetch(tenantPath('/api/security/neon/session'), {
        method: 'POST',
        headers
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || 'Neon Auth no habilitó el acceso a PANAPP.');
    const adminPath = globalLogin ? `/t/${encodeURIComponent(result.tenant)}/admin` : tenantPath('/admin');
    window.location.replace(adminPath);
    return true;
}

function readableAuthError(error) {
    const message = error?.message || 'No se pudo validar el acceso.';
    if (/invalid origin/i.test(message)) {
        return `Neon Auth rechazó el origen. Agrega https://${window.location.host} en sus orígenes permitidos y vuelve a intentar.`;
    }
    return message;
}

async function validateLegacyPassword(email, password) {
    const response = await fetch(tenantPath('/api/security/legacy-credentials'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: email, password })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || 'No se pudo verificar la contraseña anterior.');
    return result;
}

async function checkSession() {
    try {
        if (passwordResetToken) {
            setMode('reset-password');
            instructions.textContent = 'Elige una contraseña nueva. El enlace de recuperación vence en 15 minutos.';
            return;
        }
        if (new URLSearchParams(window.location.search).has('error')) {
            setMode('forgot-password');
            instructions.textContent = 'El enlace venció o no es válido. Puedes solicitar uno nuevo.';
            return;
        }
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
        tenantConfigured = Boolean(status.configured);
        instructions.textContent = status.configured || globalLogin
            ? globalLogin
                ? 'Ingresa el correo habilitado por el propietario de tu panadería.'
                : invitationToken
                    ? 'Tu invitación está activa. Crea una cuenta nueva o inicia sesión si ya tienes una.'
                    : `Accede al panel de ${status.tenant?.name || 'tu panadería'}.`
            : 'Esta panadería no tiene un administrador habilitado. Un propietario debe configurarlo en Super Admin.';
        adminSetupLink.classList.toggle('hidden', globalLogin || status.configured);
        setMode(invitationToken && !globalLogin ? 'sign-up' : 'sign-in');
    } catch (error) {
        instructions.textContent = 'No se pudo conectar con PANAPP. Comprueba el servidor y la conexión a la base de datos.';
        showError(error.message || 'No se pudo consultar la sesión.');
    }
}

form.addEventListener('submit', async event => {
    event.preventDefault();
    errorMessage.classList.add('hidden');
    const email = emailInput.value.trim().toLowerCase();
    if (mode !== 'reset-password' && (!email || !emailInput.checkValidity())) {
        showError('Escribe un correo válido.');
        emailInput.focus();
        return;
    }
    submitButton.disabled = true;
    submitButton.textContent = 'Procesando…';
    try {
        if (mode === 'sign-up') {
            if (passwordInput.value.length < 8 || passwordInput.value.length > 128) {
                throw new Error('La contraseña debe tener entre 8 y 128 caracteres.');
            }
            const result = await neonAuth.signUp.email({
                email,
                password: passwordInput.value,
                name: email.split('@')[0]
            });
            if (result.error) throw new Error(result.error.message || 'No se pudo crear la cuenta.');
            if (result.data?.user?.emailVerified) {
                if (await exchangeProviderSession()) return;
                setMode('sign-in');
                instructions.textContent = 'Cuenta creada. Inicia sesión para continuar.';
            } else {
                emailInput.value = email;
                setMode('verify-email');
                instructions.textContent = 'Ingresa el código que Neon Auth envió a tu correo.';
            }
        } else if (mode === 'sign-in') {
            const result = await neonAuth.signIn.email({ email, password: passwordInput.value });
            if (result.error) {
                if (/invalid origin/i.test(result.error.message || '')) {
                    throw new Error(readableAuthError(result.error));
                }
                try {
                    await validateLegacyPassword(email, passwordInput.value);
                } catch (legacyError) {
                    throw new Error(legacyError.message || 'Neon Auth no pudo validar la cuenta.');
                }
                const migration = await neonAuth.signUp.email({
                    email,
                    password: passwordInput.value,
                    name: email.split('@')[0]
                });
                if (migration.error) {
                    throw new Error(
                        'La contraseña anterior fue verificada, pero no se pudo migrar la cuenta. Usa “¿Olvidaste tu contraseña?” o contacta al administrador.'
                    );
                }
                if (migration.data?.user?.emailVerified) {
                    if (await exchangeProviderSession()) return;
                    throw new Error('Verificamos tu correo, pero Neon Auth no devolvió una sesión.');
                }
                setMode('verify-email');
                instructions.textContent = 'Verificamos tu contraseña anterior. Ingresa el código enviado a tu correo para terminar la migración.';
                return;
            }
            if (!await exchangeProviderSession()) {
                throw new Error('Neon Auth no devolvió una sesión verificada.');
            }
        } else if (mode === 'verify-email') {
            const result = await neonAuth.emailOtp.verifyEmail({
                email,
                otp: otpInput.value.trim()
            });
            if (result.error) throw new Error(result.error.message || 'El código no es válido.');
            if (result.data?.session && await exchangeProviderSession()) return;
            setMode('sign-in');
            instructions.textContent = 'Correo verificado. Inicia sesión para entrar al panel.';
        } else if (mode === 'forgot-password') {
            const result = await neonAuth.requestPasswordReset({
                email,
                redirectTo: `${window.location.origin}${tenantPath('/login')}`
            });
            if (result.error) throw new Error(result.error.message || 'Neon Auth no pudo enviar el enlace.');
            instructions.textContent = 'Si el correo corresponde a una cuenta, recibirás un enlace de recuperación. Revisa también spam.';
        } else if (mode === 'reset-password') {
            if (!passwordResetToken) throw new Error('El enlace de recuperación no es válido o ya venció.');
            if (resetPasswordInput.value.length < 8 || resetPasswordInput.value.length > 128) {
                throw new Error('La contraseña debe tener entre 8 y 128 caracteres.');
            }
            if (resetPasswordInput.value !== resetConfirmInput.value) {
                throw new Error('Las contraseñas no coinciden.');
            }
            const result = await neonAuth.resetPassword({
                newPassword: resetPasswordInput.value,
                token: passwordResetToken
            });
            if (result.error) throw new Error(result.error.message || 'No se pudo cambiar la contraseña.');
            passwordResetToken = null;
            window.history.replaceState({}, '', window.location.pathname);
            passwordInput.value = '';
            resetPasswordInput.value = '';
            resetConfirmInput.value = '';
            setMode('sign-in');
            instructions.textContent = 'Contraseña actualizada. Inicia sesión con la nueva contraseña.';
        }
    } catch (error) {
        showError(readableAuthError(error));
    } finally {
        updateSubmitState();
    }
});

authModeToggle.addEventListener('click', () => {
    setMode(mode === 'sign-up' ? 'sign-in' : 'sign-up');
});

document.getElementById('authForgotPassword').addEventListener('click', () => {
    setMode('forgot-password');
    instructions.textContent = 'Te enviaremos un enlace de un solo uso si el correo pertenece a una cuenta.';
});

document.getElementById('authResendVerification').addEventListener('click', async () => {
    try {
        const result = await neonAuth.emailOtp.sendVerificationOtp({
            email: emailInput.value.trim().toLowerCase(),
            type: 'email-verification'
        });
        if (result.error) throw new Error(result.error.message || 'No se pudo reenviar el código.');
        instructions.textContent = 'Si la cuenta aún requiere verificación, se envió un nuevo código.';
    } catch (error) {
        showError(readableAuthError(error));
    }
});

document.getElementById('authBackToLogin').addEventListener('click', () => {
    passwordResetToken = null;
    window.history.replaceState({}, '', window.location.pathname);
    setMode('sign-in');
    instructions.textContent = 'Ingresa el correo habilitado por el propietario de tu panadería.';
});

[emailInput, passwordInput, otpInput, resetPasswordInput, resetConfirmInput]
    .forEach(input => input.addEventListener('input', updateSubmitState));

document.getElementById('togglePassword').addEventListener('click', event => {
    const button = event.currentTarget;
    const visible = passwordInput.type === 'password';
    passwordInput.type = visible ? 'text' : 'password';
    button.setAttribute('aria-label', visible ? 'Ocultar contraseña' : 'Mostrar contraseña');
    button.querySelector('i').className = visible ? 'fa-regular fa-eye-slash' : 'fa-regular fa-eye';
});

checkSession();
