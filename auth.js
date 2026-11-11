// Inicio de sesión y verificación de correo para administradores de panadería.
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
const otpInput = document.getElementById('authOtp');
const resetPasswordInput = document.getElementById('authResetPassword');
const resetConfirmInput = document.getElementById('authResetConfirm');
let tenantConfigured = false;
let activeTenant = null;
let mode = 'sign-in';

function updateSubmitState() {
    const validEmail = emailInput.value.trim() && emailInput.checkValidity();
    const valid = {
        'sign-in': validEmail && passwordInput.value.length > 0,
        'request-code': validEmail,
        'verify-email': validEmail
            && /^\d{6}$/.test(otpInput.value.trim())
            && resetPasswordInput.value.length >= 12
            && resetPasswordInput.value.length <= 128
            && resetPasswordInput.value === resetConfirmInput.value,
        'change-password': resetPasswordInput.value.length >= 12
            && resetPasswordInput.value.length <= 128
            && resetPasswordInput.value === resetConfirmInput.value
    }[mode];
    submitButton.disabled = !valid || (!globalLogin && !tenantConfigured);
}

function showError(message) {
    errorMessage.textContent = message;
    errorMessage.classList.remove('hidden');
}

function updateAuthMode() {
    const verifying = mode === 'verify-email';
    const changingPassword = mode === 'change-password';
    const editingPassword = verifying || changingPassword;
    document.getElementById('authEmailField').classList.toggle('hidden', changingPassword);
    document.getElementById('authPasswordField').classList.toggle('hidden', mode !== 'sign-in');
    document.getElementById('authOtpField').classList.toggle('hidden', !verifying);
    document.getElementById('authResendVerification').classList.toggle('hidden', !verifying);
    document.getElementById('authResetPasswordField').classList.toggle('hidden', !editingPassword);
    document.getElementById('authResetConfirmField').classList.toggle('hidden', !editingPassword);
    document.getElementById('authForgotPassword').classList.toggle(
        'hidden',
        mode !== 'sign-in' || (!globalLogin && !tenantConfigured)
    );
    authModeToggle.classList.toggle(
        'hidden',
        !['sign-in', 'request-code'].includes(mode) || (!globalLogin && !tenantConfigured)
    );
    document.getElementById('authBackToLogin').classList.toggle('hidden', mode === 'sign-in' || changingPassword);
    emailInput.readOnly = verifying || changingPassword;
    passwordInput.required = mode === 'sign-in';
    otpInput.required = verifying;
    resetPasswordInput.required = editingPassword;
    resetConfirmInput.required = editingPassword;

    const titles = {
        'sign-in': 'Inicia sesión',
        'request-code': 'Verifica tu correo',
        'verify-email': 'Verifica tu correo',
        'change-password': 'Cambia tu contraseña temporal'
    };
    const buttons = {
        'sign-in': 'Entrar al panel',
        'request-code': 'Enviar código al correo',
        'verify-email': 'Verificar código y guardar contraseña',
        'change-password': 'Guardar contraseña nueva'
    };
    title.textContent = titles[mode];
    submitButton.textContent = buttons[mode];
    authModeToggle.textContent = mode === 'request-code'
        ? 'Volver a iniciar sesión'
        : '¿Primera vez o olvidaste la contraseña? Recibir código por correo';
    updateSubmitState();
}

function setMode(nextMode) {
    mode = nextMode;
    errorMessage.classList.add('hidden');
    updateAuthMode();
}

async function postAuth(path, body) {
    const response = await fetch(tenantPath(path), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || 'No se pudo completar la autenticación.');
    return result;
}

function redirectToAdmin(result) {
    activeTenant = result.tenant || activeTenant;
    if (result.must_change_password) {
        emailInput.value = result.username || emailInput.value;
        instructions.textContent = 'Por seguridad, crea una contraseña personal para continuar al panel.';
        setMode('change-password');
        resetPasswordInput.focus();
        return;
    }
    const adminPath = globalLogin
        ? `/t/${encodeURIComponent(activeTenant)}/admin`
        : tenantPath('/admin');
    window.location.replace(adminPath);
}

async function requestEmailCode(email) {
    const result = await postAuth('/api/security/email-code', { username: email });
    setMode('verify-email');
    instructions.textContent = result.message || 'Si el correo está autorizado, recibirás un código de seis dígitos. Revisa también spam.';
    otpInput.focus();
}

async function checkSession() {
    try {
        const statusPath = globalLogin ? '/api/security/status' : tenantPath('/api/security/status');
        const response = await fetch(statusPath, { cache: 'no-store' });
        const status = await response.json();
        if (!response.ok) throw new Error(status.detail || 'No se pudo consultar la sesión.');
        if (status.authenticated) {
            activeTenant = status.tenant || null;
            if (status.must_change_password) {
                emailInput.value = status.username || '';
                instructions.textContent = 'Por seguridad, crea una contraseña personal para continuar al panel.';
                setMode('change-password');
                return;
            }
            redirectToAdmin(status);
            return;
        }
        tenantConfigured = Boolean(status.configured);
        instructions.textContent = status.configured || globalLogin
            ? globalLogin
                ? 'Ingresa el correo habilitado por el propietario de tu panadería.'
                : `Accede al panel de ${status.tenant?.name || 'tu panadería'}. Si es tu primer ingreso, solicita un código al correo autorizado.`
            : 'Esta panadería no tiene un administrador habilitado. Un propietario debe configurarlo en Super Admin.';
        adminSetupLink.classList.toggle('hidden', globalLogin || status.configured);
        setMode('sign-in');
    } catch (error) {
        instructions.textContent = 'No se pudo conectar con PANAPP. Comprueba el servidor y la conexión a la base de datos.';
        showError(error.message || 'No se pudo consultar la sesión.');
    }
}

form.addEventListener('submit', async event => {
    event.preventDefault();
    errorMessage.classList.add('hidden');
    if (mode === 'change-password') {
        submitButton.disabled = true;
        submitButton.textContent = 'Guardando…';
        try {
            if (resetPasswordInput.value.length < 12 || resetPasswordInput.value.length > 128) {
                throw new Error('La contraseña debe tener entre 12 y 128 caracteres.');
            }
            if (resetPasswordInput.value !== resetConfirmInput.value) {
                throw new Error('Las contraseñas no coinciden.');
            }
            const passwordPath = tenantBasePath || (activeTenant ? `/t/${encodeURIComponent(activeTenant)}` : '');
            if (!passwordPath) throw new Error('No se pudo identificar la panadería de esta sesión.');
            const result = await postAuth(`${passwordPath}/api/security/password`, {
                new_password: resetPasswordInput.value
            });
            redirectToAdmin(result);
        } catch (error) {
            showError(error.message || 'No se pudo guardar la contraseña.');
        } finally {
            updateAuthMode();
        }
        return;
    }
    const email = emailInput.value.trim().toLowerCase();
    if (!email || !emailInput.checkValidity()) {
        showError('Escribe un correo válido.');
        emailInput.focus();
        return;
    }
    submitButton.disabled = true;
    submitButton.textContent = 'Procesando…';
    try {
        if (mode === 'sign-in') {
            const result = await postAuth('/api/security/login', {
                username: email,
                password: passwordInput.value
            });
            redirectToAdmin(result);
        } else if (mode === 'request-code') {
            await requestEmailCode(email);
        } else if (mode === 'verify-email') {
            if (resetPasswordInput.value.length < 12 || resetPasswordInput.value.length > 128) {
                throw new Error('La contraseña debe tener entre 12 y 128 caracteres.');
            }
            if (resetPasswordInput.value !== resetConfirmInput.value) {
                throw new Error('Las contraseñas no coinciden.');
            }
            const result = await postAuth('/api/security/email-code/verify', {
                username: email,
                code: otpInput.value.trim(),
                password: resetPasswordInput.value
            });
            redirectToAdmin(result);
        }
    } catch (error) {
        showError(error.message || 'No se pudo validar el acceso.');
    } finally {
        updateAuthMode();
    }
});

authModeToggle.addEventListener('click', () => {
    setMode(mode === 'request-code' ? 'sign-in' : 'request-code');
    instructions.textContent = mode === 'request-code'
        ? 'Te enviaremos un código de un solo uso al correo autorizado. Después podrás crear o cambiar tu contraseña.'
        : 'Ingresa el correo y la contraseña de tu panadería.';
});

document.getElementById('authForgotPassword').addEventListener('click', () => {
    setMode('request-code');
    instructions.textContent = 'Te enviaremos un código de un solo uso al correo autorizado. Después podrás crear una contraseña nueva.';
});

document.getElementById('authResendVerification').addEventListener('click', async () => {
    try {
        await requestEmailCode(emailInput.value.trim().toLowerCase());
    } catch (error) {
        showError(error.message || 'No se pudo enviar el código.');
    }
});

document.getElementById('authBackToLogin').addEventListener('click', () => {
    setMode('sign-in');
    emailInput.readOnly = false;
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
