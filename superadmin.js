// Capa 1: administración global de clientes, planes, pagos y métricas SaaS.
const loginPanel = document.getElementById('loginPanel');
const dashboardPanel = document.getElementById('dashboardPanel');
const tenantTable = document.getElementById('tenantTable');
let availablePlans = [];
let archivedTenantsView = false;
let inactivityTimer = null;
const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000;

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

function startInactivityTimeout() {
    let lastActivitySignal = 0;
    const recordActivity = () => {
        window.clearTimeout(inactivityTimer);
        inactivityTimer = window.setTimeout(async () => {
            try {
                await api('/api/superadmin/logout', { method: 'POST', body: '{}' });
            } catch (error) {
                console.warn('No se pudo revocar la sesión al vencer por inactividad.', error);
            }
            window.location.replace('/superadmin?session=expired');
        }, INACTIVITY_TIMEOUT_MS);

        const now = Date.now();
        if (now - lastActivitySignal < 30000) return;
        lastActivitySignal = now;
        fetch('/api/superadmin/activity', { method: 'POST' })
            .then(response => {
                if (response.status === 401) window.location.replace('/superadmin?session=expired');
                else if (!response.ok) console.error('No se pudo renovar la actividad de la sesión.');
            })
            .catch(error => console.error('No se pudo renovar la actividad de la sesión.', error));
    };

    ['pointerdown', 'keydown', 'scroll', 'touchstart', 'mousemove'].forEach(eventName => {
        document.addEventListener(eventName, recordActivity, { passive: true });
    });
    recordActivity();
}

function showAccessDetails(element, result, fallbackMessage) {
    if (!result.temporary_password || !result.admin_login_url || !result.menu_url || !result.menu_qr_url) {
        throw new Error('El servidor no entregó la contraseña temporal y los enlaces. Actualiza la aplicación y vuelve a intentarlo.');
    }
    showMessage(element, result.access_message || fallbackMessage);
    if (result.temporary_password) {
        const password = document.createElement('div');
        password.className = 'mt-4 rounded-xl border border-emerald-200 bg-white p-4';
        const label = document.createElement('p');
        label.className = 'font-bold text-slate-900';
        label.textContent = 'Contraseña para entrar a la administración';
        const value = document.createElement('code');
        value.className = 'mt-2 block select-all break-all rounded-lg bg-emerald-50 px-3 py-3 font-mono text-lg font-bold text-emerald-900';
        value.textContent = result.temporary_password;
        const hint = document.createElement('p');
        hint.className = 'mt-2 text-xs text-slate-600';
        hint.textContent = 'Guárdala y compártela con el cliente. Podrá cambiarla después desde Seguridad.';
        password.append(label, value, hint);
        element.append(password);
    }

    [
        ['menu_url', 'Abrir menú del cliente'],
        ['menu_qr_url', 'Abrir o descargar el QR del menú'],
        ['admin_login_url', 'Enlace de acceso a administración']
    ].forEach(([key, label]) => {
        if (!result[key]) return;
        const link = document.createElement('a');
        link.href = result[key];
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.className = 'mt-2 block break-all font-bold underline';
        link.textContent = label;
        element.append(link);
    });
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

async function archiveTenant(tenant) {
    if (!window.confirm(`¿Borrar y ocultar ${tenant.name}? Se dará de baja y se conservarán sus datos; podrás restaurarla después.`)) return;
    await api(`/api/superadmin/tenants/${encodeURIComponent(tenant.slug)}/archive`, { method: 'POST', body: '{}' });
    await refreshDashboard();
}

async function restoreTenant(tenant) {
    await api(`/api/superadmin/tenants/${encodeURIComponent(tenant.slug)}/restore`, { method: 'POST', body: '{}' });
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

async function loadMonthlyReport() {
    const month = document.getElementById('reportMonth').value;
    const message = document.getElementById('reportMessage');
    const table = document.getElementById('reportPaymentTable');
    if (!/^\d{4}-\d{2}$/.test(month)) {
        showMessage(message, 'Selecciona un mes válido para consultar el informe.', true);
        return;
    }

    const showTableMessage = text => {
        const row = document.createElement('tr');
        const cell = tableCell(text);
        cell.colSpan = 4;
        row.append(cell);
        table.replaceChildren(row);
    };
    showTableMessage('Cargando pagos…');
    try {
        const report = await api(`/api/superadmin/reports/subscription-revenue?month=${encodeURIComponent(month)}`);
        document.getElementById('reportTotal').textContent = money(report.total);
        document.getElementById('reportPaymentCount').textContent = report.payment_count;
        document.getElementById('reportTenantCount').textContent = new Set(
            report.payments.map(payment => payment.tenant_slug)
        ).size;
        if (!report.payments.length) {
            showTableMessage(`No hay pagos confirmados en ${month}.`);
            showMessage(message, `Sin ingresos registrados para ${month}.`);
            return;
        }
        table.replaceChildren(...report.payments.map(payment => {
            const row = document.createElement('tr');
            row.append(
                tableCell(payment.paid_at.replace('T', ' ').slice(0, 16)),
                tableCell(payment.tenant_name),
                tableCell(money(payment.amount)),
                tableCell(payment.reference || '—')
            );
            return row;
        }));
        showMessage(message, `Resumen de ${month}: pagos confirmados en hora de Colombia.`);
    } catch (error) {
        document.getElementById('reportTotal').textContent = '—';
        document.getElementById('reportPaymentCount').textContent = '—';
        document.getElementById('reportTenantCount').textContent = '—';
        showTableMessage('No se pudo cargar el informe.');
        showMessage(message, error.message || 'No se pudo consultar el informe.', true);
    }
}

function configureTenantAdmin(tenant) {
    const form = document.getElementById('tenantAdminForm');
    form.dataset.slug = tenant.slug;
    document.getElementById('tenantAdminEmail').value = tenant.admin_email || '';
    document.getElementById('tenantAdminTitle').textContent = `Administrador · ${tenant.name}`;
    const message = document.getElementById('tenantAdminMessage');
    message.classList.add('hidden');
    message.replaceChildren();
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
    row.append(nameCell, tableCell(tenant.archived ? 'Baja · datos conservados' : tenant.status), tableCell(tenant.plan_name || 'Sin plan'));

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
    if (tenant.archived) {
        const restore = document.createElement('button');
        restore.type = 'button';
        restore.className = 'rounded-lg border border-emerald-200 px-3 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-50';
        restore.textContent = 'Restaurar panadería';
        restore.addEventListener('click', () => restoreTenant(tenant).catch(showGlobalError));
        actionWrap.append(restore);
        actions.append(actionWrap);
        row.append(actions);
        return row;
    }

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
    adminButton.textContent = 'Ver / generar contraseña';
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
    const archive = document.createElement('button');
    archive.type = 'button';
    archive.className = 'rounded-lg border border-red-300 px-3 py-2 text-xs font-bold text-red-800 hover:bg-red-50';
    archive.textContent = 'Borrar panadería';
    archive.addEventListener('click', () => archiveTenant(tenant).catch(showGlobalError));
    actionWrap.append(archive);
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
    document.getElementById('tenantListTitle').textContent = archivedTenantsView ? 'Panaderías dadas de baja' : 'Panaderías';
    document.getElementById('archivedTenantsButton').textContent = archivedTenantsView ? 'Ver panaderías activas' : 'Ver panaderías dadas de baja';
    listError.classList.add('hidden');
    try {
        const [tenants] = await Promise.all([
            api(`/api/superadmin/tenants?archived=${archivedTenantsView}`),
            loadOverview()
        ]);
        tenantTable.replaceChildren(...tenants.map(createTenantRow));
    } catch (error) {
        showMessage(listError, error.message || 'No se pudo cargar el listado de panaderías.', true);
    }
}

function formatColombiaDate(value) {
    return new Date(value).toLocaleString('es-CO', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'America/Bogota'
    }) + ' · Colombia';
}

async function loadSupportMessages() {
    const list = document.getElementById('supportMessageList');
    const error = document.getElementById('supportInboxError');
    error.classList.add('hidden');
    try {
        const messages = await api('/api/superadmin/support/messages');
        if (!messages.length) {
            const empty = document.createElement('p');
            empty.className = 'rounded-xl border border-dashed border-slate-200 p-5 text-sm text-slate-500';
            empty.textContent = 'No hay mensajes de soporte.';
            list.replaceChildren(empty);
            return;
        }
        list.replaceChildren(...messages.map(message => {
            const card = document.createElement('article');
            card.className = 'support-ticket';
            const heading = document.createElement('div');
            heading.className = 'flex flex-wrap items-start justify-between gap-2';
            const title = document.createElement('h3');
            title.className = 'font-bold text-slate-900';
            title.textContent = message.subject;
            const statusLabel = document.createElement('span');
            statusLabel.className = 'rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-900';
            statusLabel.textContent = message.status === 'in_progress' ? 'En seguimiento' : message.status === 'resolved' ? 'Resuelto' : 'Abierto';
            heading.append(title, statusLabel);
            const from = document.createElement('p');
            from.className = 'mt-2 text-xs font-semibold text-slate-500';
            from.textContent = `${message.bakery_name} · ${message.slug} · ${message.sender} · ${formatColombiaDate(message.created_at)}`;
            const body = document.createElement('p');
            body.className = 'mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700';
            body.textContent = message.message;
            const actions = document.createElement('div');
            actions.className = 'mt-4 flex flex-wrap items-center gap-2';
            const select = document.createElement('select');
            select.className = 'rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm';
            [['open', 'Abierto'], ['in_progress', 'En seguimiento'], ['resolved', 'Resuelto']].forEach(([value, label]) => {
                const option = document.createElement('option');
                option.value = value;
                option.textContent = label;
                option.selected = value === message.status;
                select.append(option);
            });
            const save = document.createElement('button');
            save.type = 'button';
            save.className = 'rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-700';
            save.textContent = 'Guardar estado';
            save.addEventListener('click', async () => {
                save.disabled = true;
                try {
                    await api(`/api/superadmin/support/messages/${encodeURIComponent(message.id)}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ status: select.value })
                    });
                    await loadSupportMessages();
                } catch (requestError) {
                    showMessage(error, requestError.message || 'No se pudo actualizar el mensaje.', true);
                } finally {
                    save.disabled = false;
                }
            });
            actions.append(select, save);
            card.append(heading, from, body, actions);
            return card;
        }));
    } catch (requestError) {
        showMessage(error, requestError.message || 'No se pudo cargar la bandeja de soporte.', true);
        list.replaceChildren();
    }
}

async function loadMaintenanceNotices() {
    const list = document.getElementById('maintenanceNoticeList');
    const error = document.getElementById('maintenanceNoticesError');
    error.classList.add('hidden');
    try {
        const notices = await api('/api/superadmin/maintenance-notices');
        if (!notices.length) {
            const empty = document.createElement('p');
            empty.className = 'rounded-xl border border-dashed border-slate-200 p-5 text-sm text-slate-500';
            empty.textContent = 'No hay avisos programados.';
            list.replaceChildren(empty);
            return;
        }
        list.replaceChildren(...notices.map(notice => {
            const card = document.createElement('article');
            card.className = 'maintenance-notice';
            const title = document.createElement('h4');
            title.className = 'font-bold text-slate-900';
            title.textContent = notice.title;
            const message = document.createElement('p');
            message.className = 'mt-1 whitespace-pre-wrap text-sm leading-5 text-slate-600';
            message.textContent = notice.message;
            const scheduled = document.createElement('time');
            scheduled.className = 'mt-2 block text-xs font-semibold text-slate-500';
            scheduled.dateTime = notice.scheduled_at;
            scheduled.textContent = formatColombiaDate(notice.scheduled_at);
            const cancel = document.createElement('button');
            cancel.type = 'button';
            cancel.className = 'mt-3 rounded-lg border border-red-200 px-3 py-2 text-xs font-bold text-red-800 hover:bg-red-50';
            cancel.textContent = 'Cancelar aviso';
            cancel.addEventListener('click', async () => {
                if (!window.confirm(`¿Cancelar el aviso “${notice.title}”?`)) return;
                cancel.disabled = true;
                try {
                    await api(`/api/superadmin/maintenance-notices/${encodeURIComponent(notice.id)}`, { method: 'DELETE' });
                    await loadMaintenanceNotices();
                } catch (requestError) {
                    showMessage(error, requestError.message || 'No se pudo cancelar el aviso.', true);
                } finally {
                    cancel.disabled = false;
                }
            });
            card.append(title, message, scheduled, cancel);
            return card;
        }));
    } catch (requestError) {
        showMessage(error, requestError.message || 'No se pudieron cargar los avisos.', true);
        list.replaceChildren();
    }
}

async function showDashboard() {
    loginPanel.classList.add('hidden');
    dashboardPanel.classList.remove('hidden');
    document.getElementById('logoutButton').classList.remove('hidden');
    startInactivityTimeout();
    try {
        await loadPlans();
        await refreshDashboard();
        await loadMonthlyReport();
        await Promise.all([loadSupportMessages(), loadMaintenanceNotices()]);
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
        showAccessDetails(message, result, 'Panadería creada.');
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
        showAccessDetails(message, result, 'Acceso administrador configurado.');
    } catch (error) {
        showMessage(message, error.message || 'No se pudo guardar el administrador.', true);
    }
});

document.getElementById('refreshButton').addEventListener('click', refreshDashboard);
document.getElementById('archivedTenantsButton').addEventListener('click', () => {
    archivedTenantsView = !archivedTenantsView;
    refreshDashboard();
});
document.getElementById('downloadReportButton').addEventListener('click', downloadMonthlyReport);
const reportDateParts = new Intl.DateTimeFormat('en', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit'
}).formatToParts(new Date());
document.getElementById('reportMonth').value = `${reportDateParts.find(part => part.type === 'year').value}-${reportDateParts.find(part => part.type === 'month').value}`;
document.getElementById('reportMonth').addEventListener('change', loadMonthlyReport);
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

if (new URLSearchParams(window.location.search).get('session') === 'expired') {
    showMessage(document.getElementById('loginError'), 'La sesión se cerró después de cinco minutos sin actividad.', true);
}
checkSession();
