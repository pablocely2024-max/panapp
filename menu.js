// Frontend público del menú; solo consume el catálogo reducido de /api/menu.
const tenantBasePath = window.location.pathname.match(/^\/(?:t|m)\/[^/]+/)?.[0] || '';
const tenantPath = path => `${tenantBasePath}${path}`;
const menuState = {
    category: 'Todos',
    query: '',
    products: [],
    phone: '',
    selectedProduct: null
};

const categoryMap = [
    { label: 'Panes', terms: ['pan', 'panadería', 'panaderia'] },
    { label: 'Repostería', terms: ['repostería', 'reposteria', 'pastelería', 'pasteleria', 'torta', 'postre'] },
    { label: 'Bebidas', terms: ['bebida', 'café', 'cafe', 'jugo', 'chocolate'] },
    { label: 'Desayunos', terms: ['desayuno', 'combo'] }
];

function normalizeText(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es');
}

function publicCategory(value) {
    const category = normalizeText(value);
    return categoryMap.find(item => item.terms.some(term => category.includes(normalizeText(term))))?.label || 'Otros';
}

function money(value, currency) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return 'Precio no disponible';
    try {
        return new Intl.NumberFormat('es-CO', {
            style: 'currency',
            currency: /^[A-Z]{3}$/.test(currency || '') ? currency : 'COP',
            maximumFractionDigits: 0
        }).format(amount);
    } catch {
        return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(amount);
    }
}

function createCategoryButton(category) {
    const button = document.createElement('button');
    const selected = menuState.category === category;
    button.type = 'button';
    button.textContent = category;
    button.className = selected
        ? 'shrink-0 rounded-full bg-slate-900 px-5 py-2.5 text-sm font-bold text-white'
        : 'shrink-0 rounded-full border border-amber-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:border-amber-500 hover:text-amber-800';
    button.setAttribute('aria-pressed', String(selected));
    button.addEventListener('click', () => {
        menuState.category = category;
        renderMenu();
    });
    return button;
}

function createProductCard(product, currency) {
    const card = document.createElement('article');
    card.className = 'rounded-2xl border border-amber-100 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md';

    const category = document.createElement('span');
    category.className = 'text-xs font-bold uppercase tracking-wider text-amber-700';
    category.textContent = publicCategory(product.categoria);

    const name = document.createElement('h3');
    name.className = 'mt-3 text-lg font-bold text-slate-900';
    name.textContent = product.nombre || 'Producto';

    const price = document.createElement('p');
    price.className = 'mt-2 text-xl font-extrabold text-slate-800';
    price.textContent = money(product.precio, currency);

    const footer = document.createElement('div');
    footer.className = 'mt-5 flex items-center justify-between gap-3 border-t border-slate-100 pt-4';
    const availability = document.createElement('span');
    availability.className = 'text-xs font-semibold text-emerald-700';
    availability.textContent = 'Disponible hoy';
    footer.append(availability);

    const order = document.createElement('button');
    order.type = 'button';
    order.className = 'rounded-lg bg-green-700 px-3 py-2 text-xs font-bold text-white hover:bg-green-800';
    order.textContent = 'Pedir';
    order.addEventListener('click', () => openOrderDialog(product, currency));
    footer.append(order);

    card.append(category, name, price, footer);
    return card;
}

function renderMenu(currency = 'COP') {
    const categories = ['Todos', ...new Set(menuState.products.map(product => publicCategory(product.categoria)))];
    const categoryContainer = document.getElementById('menuCategories');
    categoryContainer.replaceChildren(...categories.map(createCategoryButton));

    const query = normalizeText(menuState.query);
    const products = menuState.products.filter(product => {
        const available = product.disponible !== false;
        const matchesCategory = menuState.category === 'Todos' || publicCategory(product.categoria) === menuState.category;
        const matchesSearch = normalizeText(`${product.nombre} ${product.categoria}`).includes(query);
        return available && matchesCategory && matchesSearch;
    });
    document.getElementById('menuProducts').replaceChildren(...products.map(product => createProductCard(product, currency)));
    document.getElementById('menuEmpty').classList.toggle('hidden', products.length > 0);
}

function updateBusiness(business) {
    document.getElementById('menuBusinessName').textContent = business.nombre || 'Panadería PANAPP';
    document.getElementById('menuFooterBusiness').textContent = business.nombre || 'PANAPP';
    document.getElementById('menuBusinessTagline').textContent = business.eslogan || 'Recién hecho para ti';
    document.getElementById('menuBusinessType').textContent = business.tipo || 'Panadería artesanal';
    document.getElementById('menuBusinessDescription').textContent = business.descripcion || 'Productos frescos, preparados cada día.';
    document.getElementById('menuBusinessHours').textContent = business.horario || '';

    const location = document.getElementById('menuBusinessLocation');
    const locationText = [business.direccion, business.ciudad].filter(Boolean).join(' · ');
    location.classList.toggle('hidden', !locationText);
    location.lastChild.textContent = locationText;

    const phone = menuState.phone || '';
    const contact = document.getElementById('menuWhatsApp');
    contact.classList.toggle('hidden', !phone);
    if (phone) {
        contact.href = `https://wa.me/${phone.replace(/\D/g, '')}`;
    }
}

async function loadMenu() {
    const error = document.getElementById('menuError');
    try {
        const response = await fetch(tenantPath('/api/menu'), { cache: 'no-store' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || `Error HTTP ${response.status}`);
        menuState.products = Array.isArray(result.products) ? result.products : [];
        menuState.phone = result.whatsapp || '';
        updateBusiness(result.business || {});
        renderMenu(result.business?.moneda || 'COP');
        error.classList.add('hidden');
        document.getElementById('menuUpdatedAt').textContent = 'Catálogo sincronizado con la panadería.';
    } catch (requestError) {
        error.textContent = 'No se pudo cargar el menú. Comprueba tu conexión e inténtalo de nuevo.';
        error.classList.remove('hidden');
        document.getElementById('menuUpdatedAt').textContent = 'No fue posible actualizar el catálogo.';
        console.error('Error al consultar el menú público.', requestError);
    }
}

function openOrderDialog(product, currency) {
    menuState.selectedProduct = product;
    document.getElementById('orderProductName').textContent = product.nombre || 'Producto';
    document.getElementById('orderProductPrice').textContent = money(product.precio, currency);
    document.getElementById('orderQuantity').value = '1';
    document.getElementById('orderError').classList.add('hidden');
    document.getElementById('menuOrderDialog').showModal();
}

function updateOrderTypeFields() {
    const type = document.getElementById('orderType').value;
    const table = document.getElementById('orderTableNumber');
    const address = document.getElementById('orderAddress');
    document.getElementById('orderTableField').classList.toggle('hidden', type !== 'table');
    document.getElementById('orderAddressField').classList.toggle('hidden', type !== 'delivery');
    table.required = type === 'table';
    address.required = type === 'delivery';
}

async function submitMenuOrder(event) {
    event.preventDefault();
    const product = menuState.selectedProduct;
    if (!product) return;
    const button = document.getElementById('submitMenuOrder');
    const error = document.getElementById('orderError');
    const type = document.getElementById('orderType').value;
    const payload = {
        customer_name: document.getElementById('orderCustomerName').value.trim(),
        order_type: type,
        table_number: type === 'table' ? Number(document.getElementById('orderTableNumber').value) : null,
        delivery_address: type === 'delivery' ? document.getElementById('orderAddress').value.trim() : '',
        items: [{ product_id: product.id, quantity: Number(document.getElementById('orderQuantity').value) }]
    };
    button.disabled = true;
    button.textContent = 'Registrando pedido…';
    error.classList.add('hidden');
    try {
        const response = await fetch(tenantPath('/api/menu/orders'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.detail || 'No se pudo registrar el pedido.');
        document.getElementById('menuOrderDialog').close();
        if (result.whatsapp_url) {
            window.location.assign(result.whatsapp_url);
        } else {
            document.getElementById('menuUpdatedAt').textContent = 'Pedido registrado. Contacta con la panadería para confirmar la entrega.';
        }
    } catch (requestError) {
        error.textContent = requestError.message || 'No se pudo registrar el pedido.';
        error.classList.remove('hidden');
    } finally {
        button.disabled = false;
        button.textContent = 'Enviar pedido';
    }
}

document.getElementById('menuSearch').addEventListener('input', event => {
    menuState.query = event.currentTarget.value.slice(0, 100);
    renderMenu();
});

document.getElementById('menuOrderForm').addEventListener('submit', submitMenuOrder);
document.getElementById('orderType').addEventListener('change', updateOrderTypeFields);
document.getElementById('closeOrderDialog').addEventListener('click', () => {
    document.getElementById('menuOrderDialog').close();
});
updateOrderTypeFields();
loadMenu();
window.setInterval(loadMenu, 15_000);
