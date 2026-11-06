// Capa 1: administración global de clientes, planes, pagos y métricas SaaS.
const loginPanel = document.getElementById('loginPanel');
const dashboardPanel = document.getElementById('dashboardPanel');
const tenantTable = document.getElementById('tenantTable');
let availablePlans = [];

async function api(path, options = {}) {
    const response = await fetch(path, {
        cache: 'no-store',
        ...options,
        headers: {
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...(options.headers || {})
        }
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || `Error HTTP ${response.status}`);
    return result;
}

function showMessage(element, message, isError = false) {
    element.textContent = message;
    element.classList.remove('hidden', 'bg-red-50', 'text-red-800', 'bg-emerald-50', 'text-emerald-800');
    element.classList.add(isError ? 'bg-red-50' : 'bg-emerald-50', isError ? 'text-red-800' : 'text-emerald-800');
}

function money(value) {
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(value) || 0);
}

function tableCell(text) {
    const cell = document.createElement('td');
    cell.className = 'px-3 py-4 align-top text-slate-700';
    cell.textContent = text;
    return cell;
}

async function loadPlans() {
    availablePlans = await api('/api/superadmin/plans');
    const select = document.getElementById('planSelect');
    select.replaceChildren(...availablePlans.map(plan => {
        const option = document.createElement('option');
        option.value = plan.code;
        option.textContent = `${plan.name} · ${money(plan.monthly_amount)}/mes · ${money(plan.annual_amount)}/año`;
        return option;
    }));
}

async function loadOverview() {
    const overview = await api('/api/superadmin/overview');
    document.getElementById('activeTenants').textContent = overview.active_tenants;
    document.getElementById('mrrValue').textContent = money(overview.mrr);
    const status = document.getElementById('databaseStatus');
    status.textContent = overview.database === 'connected' ? 'PostgreSQL · conectado' : 'PostgreSQL · sin conexión';
    status.classList.toggle('bg-emerald-50', overview.database === 'connected');
    status.classList.toggle('text-emerald-800', overview.database === 'connected');
    status.classList.toggle('bg-red-50', overview.database !== 'connected');
    status.classList.toggle('text-red-800', overview.database !== 'connected');
}

async function updateTenantStatus(tenant, status) {
    await api(`/api/superadmin/tenants/${encodeURIComponent(tenant.slug)}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status })
    });
    await refreshDashboard();
}

async function changeSubscription(tenant, plan, billingPeriod) {
    await api(`/api/superadmin/tenants/${encodeURIComponent(tenant.slug)}/subscription`, {
        method: 'PUT',
        body: JSON.stringify({ plan, billing_period: billingPeriod })
    });
    await refreshDashboard();
}

async function recordPayment(tenant) {
    const amountInput = window.prompt(`Valor recibido para ${tenant.name} (COP):`);
    if (amountInput === null) return;
    const amount = Number(amountInput);
    if (!Number.isFinite(amount) || amount < 0) throw new Error('Escribe un valor de pago válido.');
    const reference = window.prompt('Referencia del pago (opcional):') || '';
    await api(`/api/superadmin/tenants/${encodeURIComponent(tenant.slug)}/payments`, {
        method: 'POST',
        body: JSON.stringify({ amount, reference, status: 'paid' })
    });
    await refreshDashboard();
}

async function showPayments(tenant) {
    const table = document.getElementById('paymentTable');
    const error = document.getElementById('paymentsError');
    document.getElementById('paymentsTitle').textContent = `Pagos · ${tenant.name}`;
    error.classList.add('hidden');
    table.replaceChildren();
    document.getElementById('paymentsDialog').showModal();
    try {
        const payments = await api(`/api/superadmin/tenants/${encodeURIComponent(tenant.slug)}/payments`);
        table.replaceChildren(...payments.map(payment => {
            const row = document.createElement('tr');
            row.append(
                tableCell(new Date(payment.created_at).toLocaleDateString('es-CO')),
                tableCell(money(payment.amount)),
                tableCell(payment.status),
                tableCell(payment.reference || '—')
            );
            return row;
        }));
        if (!payments.length) {
            const row = document.createElement('tr');
            row.append(tableCell('No hay pagos registrados.'), tableCell(''), tableCell(''), tableCell(''));
            table.append(row);
        }
    } catch (requestError) {
        showMessage(error, requestError.message || 'No se pudo consultar la facturación.', true);
    }
}

function configureTenantAdmin(tenant) {
    const form = document.getElementById('tenantAdminForm');
    form.dataset.slug = tenant.slug;
    document.getElementById('tenantAdminTitle').textContent = `Administrador · ${tenant.name}`;
    document.getElementById('tenantAdminMessage').classList.add('hidden');
    document.getElementById('tenantAdminDialog').showModal();
}

function createTenantRow(tenant) {
    const row = document.createElement('tr');
    const nameCell = document.createElement('td');
    nameCell.className = 'px-3 py-4';
    const name = document.createElement('a');
    name.href = `/t/${encodeURIComponent(tenant.slug)}/menu`;
    name.target = '_blank';
    name.rel = 'noopener noreferrer';
    name.className = 'font-bold text-slate-900 underline decoration-amber-400 underline-offset-4';
    name.textContent = tenant.name;
    const slug = document.createElement('span');
    slug.className = 'mt-1 block text-xs text-slate-500';
    slug.textContent = `/t/${tenant.slug}`;
    nameCell.append(name, slug);
    row.append(nameCell, tableCell(tenant.status), tableCell(tenant.plan_name || 'Sin plan'));

    const billingCell = document.createElement('td');
    billingCell.className = 'px-3 py-4 align-top text-slate-700';
    const period = tenant.billing_period === 'annual' ? 'Anual' : 'Mensual';
    const planPrice = tenant.billing_period === 'annual' ? tenant.annual_amount : tenant.monthly_amount;
    billingCell.textContent = `${period} · ${planPrice == null ? '—' : money(planPrice)}`;
    row.append(billingCell);

    const actions = document.createElement('td');
    actions.className = 'px-3 py-4';
    const actionWrap = document.createElement('div');
    actionWrap.className = 'flex min-w-[380px] flex-wrap gap-2';
    const statusButton = document.createElement('button');
    statusButton.type = 'button';
    statusButton.className = 'rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold hover:bg-slate-50';
    statusButton.textContent = tenant.status === 'active' ? 'Suspender' : 'Activar';
    statusButton.addEventListener('click', () => updateTenantStatus(tenant, tenant.status === 'active' ? 'suspended' : 'active').catch(showGlobalError));

    const plan = document.createElement('select');
    plan.className = 'max-w-32 rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs';
    availablePlans.forEach(item => {
        const option = document.createElement('option');
        option.value = item.code;
        option.textContent = item.name;
        option.selected = item.code === tenant.plan_code;
        plan.append(option);
    });
    const periodSelect = document.createElement('select');
    periodSelect.className = 'rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs';
    [['monthly', 'Mensual'], ['annual', 'Anual']].forEach(([value, label]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        option.selected = value === tenant.billing_period;
        periodSelect.append(option);
    });
    const savePlan = document.createElement('button');
    savePlan.type = 'button';
    savePlan.className = 'rounded-lg bg-amber-700 px-3 py-2 text-xs font-bold text-white hover:bg-amber-800';
    savePlan.textContent = 'Actualizar plan';
    savePlan.addEventListener('click', () => changeSubscription(tenant, plan.value, periodSelect.value).catch(showGlobalError));
    const payment = document.createElement('button');
    payment.type = 'button';
    payment.className = 'rounded-lg border border-emerald-200 px-3 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-50';
    payment.textContent = 'Registrar pago';
    payment.addEventListener('click', () => recordPayment(tenant).catch(showGlobalError));
    const paymentHistory = document.createElement('button');
    paymentHistory.type = 'button';
    paymentHistory.className = 'rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold hover:bg-slate-50';
    paymentHistory.textContent = 'Ver pagos';
    paymentHistory.addEventListener('click', () => showPayments(tenant));
    const tenantLogin = document.createElement('a');
    tenantLogin.href = `/t/${encodeURIComponent(tenant.slug)}/login`;
    tenantLogin.className = 'rounded-lg border border-sky-200 px-3 py-2 text-xs font-bold text-sky-800 hover:bg-sky-50';
    tenantLogin.textContent = 'Ingresar admin';
    const adminButton = document.createElement('button');
    adminButton.type = 'button';
    adminButton.className = 'rounded-lg border border-amber-200 px-3 py-2 text-xs font-bold text-amber-900 hover:bg-amber-50';
    adminButton.textContent = 'Configurar admin';
    adminButton.addEventListener('click', () => configureTenantAdmin(tenant));
    actionWrap.append(statusButton, plan, periodSelect, savePlan, payment, paymentHistory, tenantLogin, adminButton);
    if (tenant.status !== 'canceled') {
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'rounded-lg border border-red-200 px-3 py-2 text-xs font-bold text-red-800 hover:bg-red-50';
        cancel.textContent = 'Cancelar';
        cancel.addEventListener('click', () => updateTenantStatus(tenant, 'canceled').catch(showGlobalError));
        actionWrap.append(cancel);
    }
    actions.append(actionWrap);
    row.append(actions);
    return row;
}

function showGlobalError(error) {
    const message = document.getElementById('globalError');
    showMessage(message, error.message || 'No se pudo completar la operación.', true);
}

async function refreshDashboard() {
    const listError = document.getElementById('tenantListError');
    listError.classList.add('hidden');
    try {
        const [tenants] = await Promise.all([
            api('/api/superadmin/tenants'),
            loadOverview()
        ]);
        tenantTable.replaceChildren(...tenants.map(createTenantRow));
    } catch (error) {
        showMessage(listError, error.message || 'No se pudo cargar el listado de panaderías.', true);
    }
}

async function showDashboard() {
    loginPanel.classList.add('hidden');
    dashboardPanel.classList.remove('hidden');
    document.getElementById('logoutButton').classList.remove('hidden');
    try {
        await loadPlans();
        await refreshDashboard();
    } catch (error) {
        showGlobalError(error);
    }
}

async function checkSession() {
    try {
        const status = await api('/api/superadmin/status');
        if (status.authenticated && status.role === 'SUPERADMIN') await showDashboard();
    } catch (error) {
        const message = document.getElementById('loginError');
        showMessage(message, error.message || 'No se pudo consultar la sesión.', true);
    }
}

document.getElementById('loginForm').addEventListener('submit', async event => {
    event.preventDefault();
    const error = document.getElementById('loginError');
    error.classList.add('hidden');
    try {
        await api('/api/superadmin/login', {
            method: 'POST',
            body: JSON.stringify({
                username: document.getElementById('loginEmail').value.trim(),
                password: document.getElementById('loginPassword').value
            })
        });
        await showDashboard();
    } catch (requestError) {
        showMessage(error, requestError.message || 'No se pudo iniciar sesión.', true);
    }
});

document.getElementById('tenantForm').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const message = document.getElementById('tenantFormMessage');
    const values = Object.fromEntries(new FormData(form).entries());
    try {
        await api('/api/superadmin/tenants', { method: 'POST', body: JSON.stringify(values) });
        form.reset();
        showMessage(message, 'Panadería creada. El administrador debe registrarse con el correo autorizado y verificarlo en Neon Auth.');
        await refreshDashboard();
    } catch (error) {
        showMessage(message, error.message || 'No se pudo crear la panadería.', true);
    }
});

document.getElementById('tenantAdminForm').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const message = document.getElementById('tenantAdminMessage');
    message.classList.add('hidden');
    try {
        const result = await api(`/api/superadmin/tenants/${encodeURIComponent(form.dataset.slug)}/admin`, {
            method: 'POST',
            body: JSON.stringify({
                username: document.getElementById('tenantAdminEmail').value.trim()
            })
        });
        showMessage(message, `Correo autorizado. El administrador debe crear su cuenta y verificarla en /t/${result.slug}/login.`);
    } catch (error) {
        showMessage(message, error.message || 'No se pudo guardar el administrador.', true);
    }
});

document.getElementById('refreshButton').addEventListener('click', refreshDashboard);
document.getElementById('logoutButton').addEventListener('click', async () => {
    try {
        await api('/api/superadmin/logout', { method: 'POST', body: '{}' });
        window.location.reload();
    } catch (error) {
        showGlobalError(error);
    }
});
document.getElementById('closePaymentsDialog').addEventListener('click', () => {
    document.getElementById('paymentsDialog').close();
});
['closeTenantAdminDialog', 'cancelTenantAdminDialog'].forEach(id => {
    document.getElementById(id).addEventListener('click', () => {
        document.getElementById('tenantAdminDialog').close();
    });
});

checkSession();
