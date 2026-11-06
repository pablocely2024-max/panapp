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

function showInvitationResult(element, result, fallbackMessage) {
    showMessage(element, result.invitation_message || fallbackMessage);
    if (!result.invitation_url) return;
    const link = document.createElement('a');
    link.href = result.invitation_url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.className = 'mt-2 block break-all font-bold underline';
    link.textContent = 'Abrir o copiar enlace de invitación';
    element.append(document.createElement('br'), link);
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
                tableCell(new Date(payment.paid_at || payment.created_at).toLocaleString('es-CO')),
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

async function downloadMonthlyReport() {
    const month = document.getElementById('reportMonth').value;
    const message = document.getElementById('reportMessage');
    if (!/^\d{4}-\d{2}$/.test(month)) {
        showMessage(message, 'Selecciona el mes del informe.', true);
        return;
    }
    try {
        const response = await fetch(`/api/superadmin/reports/subscription-revenue.csv?month=${encodeURIComponent(month)}`, {
            cache: 'no-store'
        });
        if (!response.ok) {
            const result = await response.json();
            throw new Error(result.detail || `Error HTTP ${response.status}`);
        }
        const file = URL.createObjectURL(await response.blob());
        const link = document.createElement('a');
        link.href = file;
        link.download = `panapp-ingresos-${month}.csv`;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(file), 1000);
        showMessage(message, `Informe de ingresos de ${month} descargado.`);
    } catch (error) {
        showMessage(message, error.message || 'No se pudo descargar el informe.', true);
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
    const menuPath = tenant.menu_token
        ? `/m/${encodeURIComponent(tenant.menu_token)}`
        : `/t/${encodeURIComponent(tenant.slug)}/menu`;
    const menuUrl = new URL(menuPath, window.location.origin);
    const name = document.createElement('a');
    name.href = menuUrl.href;
    name.target = '_blank';
    name.rel = 'noopener noreferrer';
    name.className = 'font-bold text-slate-900 underline decoration-amber-400 underline-offset-4';
    name.textContent = tenant.name;
    const slug = document.createElement('span');
    slug.className = 'mt-1 block text-xs text-slate-500';
    slug.textContent = `Identificador interno: ${tenant.slug}`;
    const menuLink = document.createElement('a');
    menuLink.href = menuUrl.href;
    menuLink.target = '_blank';
    menuLink.rel = 'noopener noreferrer';
    menuLink.className = 'mt-2 block max-w-sm break-all text-xs text-sky-800 underline';
    menuLink.textContent = menuUrl.href;
    const qrLink = document.createElement('a');
    qrLink.href = `${menuPath}/qr.svg`;
    qrLink.download = `${tenant.slug}-menu-qr.svg`;
    qrLink.className = 'mt-1 inline-block text-xs font-bold text-amber-800 underline';
    qrLink.textContent = 'Descargar QR del menú';
    nameCell.append(name, slug, menuLink, qrLink);
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

const tenantForm = document.getElementById('tenantForm');
const tenantNameInput = tenantForm.elements.namedItem('name');
const tenantSlugInput = tenantForm.elements.namedItem('slug');
let tenantSlugManuallyEdited = false;

function slugFromName(name) {
    return name.normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 63)
        .replace(/-+$/g, '');
}

tenantNameInput.addEventListener('input', () => {
    if (!tenantSlugManuallyEdited) tenantSlugInput.value = slugFromName(tenantNameInput.value);
});
tenantSlugInput.addEventListener('input', () => {
    tenantSlugManuallyEdited = true;
});

tenantForm.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const message = document.getElementById('tenantFormMessage');
    const values = Object.fromEntries(new FormData(form).entries());
    try {
        const result = await api('/api/superadmin/tenants', { method: 'POST', body: JSON.stringify(values) });
        form.reset();
        tenantSlugManuallyEdited = false;
        showInvitationResult(message, result, 'Panadería creada.');
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
        showInvitationResult(message, result, 'Correo autorizado.');
    } catch (error) {
        showMessage(message, error.message || 'No se pudo guardar el administrador.', true);
    }
});

document.getElementById('refreshButton').addEventListener('click', refreshDashboard);
document.getElementById('downloadReportButton').addEventListener('click', downloadMonthlyReport);
const reportDateParts = new Intl.DateTimeFormat('en', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit'
}).formatToParts(new Date());
document.getElementById('reportMonth').value = `${reportDateParts.find(part => part.type === 'year').value}-${reportDateParts.find(part => part.type === 'month').value}`;
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
