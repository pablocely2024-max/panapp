// Inicio de sesión para administradores de panadería.
const tenantBasePath = window.location.pathname.match(/^\/t\/[^/]+/)?.[0] || '';
const tenantPath = path => `${tenantBasePath}${path}`;
const globalLogin = !tenantBasePath;
const form = document.getElementById('authForm');
const emailInput = document.getElementById('authEmail');
const passwordInput = document.getElementById('authPassword');
const submitButton = document.getElementById('authSubmit');
const errorMessage = document.getElementById('authError');
const instructions = document.getElementById('authInstructions');
const adminSetupLink = document.getElementById('adminSetupLink');
let tenantConfigured = false;

function updateSubmitState() {
    const validEmail = emailInput.value.trim() && emailInput.checkValidity();
    submitButton.disabled = !validEmail || passwordInput.value.length === 0
        || (!globalLogin && !tenantConfigured);
}

function showError(message) {
    errorMessage.textContent = message;
    errorMessage.classList.remove('hidden');
}

async function postAuth(path, body) {
    const response = await fetch(tenantPath(path), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || 'No se pudo completar el inicio de sesión.');
    return result;
}

function redirectToAdmin(result) {
    const adminPath = globalLogin
        ? `/t/${encodeURIComponent(result.tenant)}/admin`
        : tenantPath('/admin');
    window.location.replace(adminPath);
}

async function checkSession() {
    try {
        const statusPath = globalLogin ? '/api/security/status' : tenantPath('/api/security/status');
        const response = await fetch(statusPath, { cache: 'no-store' });
        const status = await response.json();
        if (!response.ok) throw new Error(status.detail || 'No se pudo consultar la sesión.');
        if (status.authenticated) {
            redirectToAdmin(status);
            return;
        }

        tenantConfigured = Boolean(status.configured);
        instructions.textContent = globalLogin
            ? 'Ingresa el correo habilitado por el propietario y la contraseña que te entregaron.'
            : tenantConfigured
                ? `Accede al panel de ${status.tenant?.name || 'tu panadería'} con el correo y la contraseña que te entregaron.`
                : 'Esta panadería no tiene un administrador habilitado. Un propietario debe configurarlo en Super Admin.';
        adminSetupLink.classList.toggle('hidden', globalLogin || tenantConfigured);
        updateSubmitState();
    } catch (error) {
        instructions.textContent = 'No se pudo conectar con PANAPP. Comprueba el servidor y la conexión a la base de datos.';
        showError(error.message || 'No se pudo consultar la sesión.');
    }
}

form.addEventListener('submit', async event => {
    event.preventDefault();
    errorMessage.classList.add('hidden');
    const email = emailInput.value.trim().toLowerCase();
    if (!email || !emailInput.checkValidity()) {
        showError('Escribe un correo válido.');
        emailInput.focus();
        return;
    }

    submitButton.disabled = true;
    submitButton.textContent = 'Ingresando…';
    try {
        const result = await postAuth('/api/security/login', {
            username: email,
            password: passwordInput.value
        });
        redirectToAdmin(result);
    } catch (error) {
        showError(error.message || 'No se pudo validar el acceso.');
    } finally {
        submitButton.textContent = 'Entrar al panel';
        updateSubmitState();
    }
});

[emailInput, passwordInput].forEach(input => input.addEventListener('input', updateSubmitState));

document.getElementById('togglePassword').addEventListener('click', event => {
    const button = event.currentTarget;
    const visible = passwordInput.type === 'password';
    passwordInput.type = visible ? 'text' : 'password';
    button.setAttribute('aria-label', visible ? 'Ocultar contraseña' : 'Mostrar contraseña');
    button.querySelector('i').className = visible ? 'fa-regular fa-eye-slash' : 'fa-regular fa-eye';
});

checkSession();
