// Controlador exclusivo del módulo 2: panel de administración protegido por sesión.
const tenantBasePath = window.location.pathname.match(/^\/t\/[^/]+/)?.[0] || '';
const tenantPath = path => `${tenantBasePath}${path}`;
const STORAGE_KEY = `panapp-datos-v1:${window.location.host}:${tenantBasePath || window.location.pathname}`;
const configuracionInicial = { urlPublica: '', whatsapp: '' };
const perfilEmpresaInicial = {
    id: `PAN-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    nombre: 'Panadería PANAPP',
    razonSocial: 'PANAPP S.A.S.',
    tipo: 'Panadería artesanal',
    eslogan: 'Horneado con tiempo, para disfrutar sin prisa.',
    descripcion: 'Pan de masa dorada, recetas honestas y una vitrina que cambia cada mañana.',
    nit: '',
    nitDV: '',
    regimenFiscal: '',
    moneda: 'COP',
    email: '',
    telefono: '',
    direccion: '',
    ciudad: 'Yopal',
    departamento: 'Casanare',
    dianResolucion: '',
    dianPrefijo: '',
    dianRango: '',
    dianVigencia: '',
    horario: ''
};

const productosCatalogoIniciales = [
    { id: 1, nombre: 'Croissant de mantequilla', categoria: 'Panadería', stock: 45, stockMinimo: 15, costoProd: 1200, precio: 3500 },
    { id: 2, nombre: 'Pan de bono tradicional', categoria: 'Panadería', stock: 120, stockMinimo: 30, costoProd: 800, precio: 2000 },
    { id: 3, nombre: 'Pastel de pollo', categoria: 'Panadería', stock: 20, stockMinimo: 8, costoProd: 2100, precio: 4500 },
    { id: 4, nombre: 'Torta genovesa (porción)', categoria: 'Pastelería', stock: 12, stockMinimo: 5, costoProd: 3000, precio: 7000 },
    { id: 5, nombre: 'Pan aliñado', categoria: 'Panadería', stock: 60, stockMinimo: 15, costoProd: 500, precio: 1500 },
    { id: 6, nombre: 'Pan rollo', categoria: 'Panadería', stock: 60, stockMinimo: 15, costoProd: 450, precio: 1200 },
    { id: 7, nombre: 'Pan queso', categoria: 'Panadería', stock: 40, stockMinimo: 12, costoProd: 900, precio: 2500 },
    { id: 8, nombre: 'Pandebono', categoria: 'Panadería', stock: 60, stockMinimo: 15, costoProd: 850, precio: 2200 },
    { id: 9, nombre: 'Buñuelo', categoria: 'Panadería', stock: 60, stockMinimo: 15, costoProd: 650, precio: 1800 },
    { id: 10, nombre: 'Almojábana', categoria: 'Panadería', stock: 40, stockMinimo: 12, costoProd: 900, precio: 2500 },
    { id: 11, nombre: 'Mogolla chicharrona', categoria: 'Panadería', stock: 30, stockMinimo: 10, costoProd: 1100, precio: 3000 },
    { id: 12, nombre: 'Torta 3 leches (porción)', categoria: 'Pastelería', stock: 12, stockMinimo: 4, costoProd: 3200, precio: 7500 },
    { id: 13, nombre: 'Torta 3 leches (entera)', categoria: 'Pastelería', stock: 3, stockMinimo: 1, costoProd: 42000, precio: 95000 },
    { id: 14, nombre: 'Milhoja de arequipe', categoria: 'Pastelería', stock: 15, stockMinimo: 5, costoProd: 2500, precio: 6000 },
    { id: 15, nombre: 'Dona glaseada', categoria: 'Pastelería', stock: 24, stockMinimo: 8, costoProd: 1000, precio: 3500 },
    { id: 16, nombre: 'Brazo de monja', categoria: 'Pastelería', stock: 10, stockMinimo: 3, costoProd: 2400, precio: 6000 },
    { id: 28, nombre: 'Bravo de monja', categoria: 'Pastelería', stock: 10, stockMinimo: 3, costoProd: 2400, precio: 6000 },
    { id: 17, nombre: 'Cheesecake de frutos rojos', categoria: 'Pastelería', stock: 8, stockMinimo: 3, costoProd: 4000, precio: 9000 },
    { id: 18, nombre: 'Genoise decorada', categoria: 'Pastelería', stock: 2, stockMinimo: 1, costoProd: 48000, precio: 110000 },
    { id: 19, nombre: 'Tinto tintero', categoria: 'Bebidas', stock: 100, stockMinimo: 25, costoProd: 350, precio: 1500 },
    { id: 20, nombre: 'Café con leche', categoria: 'Bebidas', stock: 60, stockMinimo: 15, costoProd: 900, precio: 3500 },
    { id: 21, nombre: 'Capuchino', categoria: 'Bebidas', stock: 40, stockMinimo: 10, costoProd: 1400, precio: 5000 },
    { id: 22, nombre: 'Chocolate caliente con queso', categoria: 'Bebidas', stock: 40, stockMinimo: 10, costoProd: 1800, precio: 5500 },
    { id: 23, nombre: 'Jugo natural de naranja', categoria: 'Bebidas', stock: 30, stockMinimo: 8, costoProd: 1800, precio: 6000 },
    { id: 24, nombre: 'Gaseosa', categoria: 'Bebidas', stock: 48, stockMinimo: 12, costoProd: 2200, precio: 4000 },
    { id: 25, nombre: 'Agua embotellada', categoria: 'Bebidas', stock: 48, stockMinimo: 12, costoProd: 1200, precio: 2500 },
    { id: 26, nombre: 'Desayuno llanero', categoria: 'Combos y desayunos', stock: 12, stockMinimo: 4, costoProd: 6500, precio: 15000 },
    { id: 27, nombre: 'Combo pandebono + tinto', categoria: 'Combos y desayunos', stock: 20, stockMinimo: 6, costoProd: 1200, precio: 3200 }
].map(producto => ({ ...producto, impuesto: 'sin_clasificar' }));

const insumosCatalogoIniciales = [
    { nombre: 'Harina de trigo fortificada', stock: '5 sacos · 250 Kg', stockMinimo: '1 saco · 50 Kg', costo: 4200, presentacion: 'Saco de 50 Kg' },
    { nombre: 'Levadura fresca', stock: '10 Kg', stockMinimo: '2 Kg', costo: 12000 },
    { nombre: 'Levadura seca', stock: '5 Kg', stockMinimo: '1 Kg', costo: 28000 },
    { nombre: 'Mantequilla industrial', stock: '45 Kg', stockMinimo: '10 Kg', costo: 18500 },
    { nombre: 'Margarina para hojaldre', stock: '30 Kg', stockMinimo: '8 Kg', costo: 14500 },
    { nombre: 'Queso costeño molido', stock: '15 Kg', stockMinimo: '4 Kg', costo: 24000 },
    { nombre: 'Arepa de queso', stock: '30 un.', stockMinimo: '8 un.', costo: 2500 },
    { nombre: 'Queso doble crema', stock: '12 Kg', stockMinimo: '3 Kg', costo: 26000 },
    { nombre: 'Esencia de vainilla', stock: '5 L', stockMinimo: '1 L', costo: 18000 },
    { nombre: 'Arequipe por balde', stock: '4 baldes', stockMinimo: '1 balde', costo: 95000 },
    { nombre: 'Azúcar refinada', stock: '100 Kg', stockMinimo: '25 Kg', costo: 3800 },
    { nombre: 'Huevos (cubeta de 30)', stock: '20 cubetas', stockMinimo: '5 cubetas', costo: 14500, presentacion: 'Cubeta de 30 unidades' },
    { nombre: 'Vasos desechables', stock: '1000 un.', stockMinimo: '200 un.', costo: 90 },
    { nombre: 'Cajas de cartón para tortas', stock: '100 un.', stockMinimo: '20 un.', costo: 1800, presentacion: 'Unidad' }
].map((insumo, indice) => ({ id: indice + 1, ...insumo, fechaVencimiento: '' }));

const datosIniciales = {
    productos: productosCatalogoIniciales,
    insumos: insumosCatalogoIniciales,
    proveedores: [
        { id: 1, empresa: 'Molinos del Casanare S.A.S', material: 'Harinas y levaduras', precio: 'Variable según mercado', contacto: '310-123-4567', estado: 'Activo' },
        { id: 2, empresa: 'Lácteos El Llano', material: 'Quesos y mantequillas', precio: 'Contrato anual', contacto: '320-987-6543', estado: 'Activo' },
        { id: 3, empresa: 'Empaques de Colombia', material: 'Cajas y bolsas de papel', precio: 'Precio fijo', contacto: '315-444-5555', estado: 'Inactivo' }
    ],
    encargos: [
        { id: 1, cliente: 'Familia Ramírez', detalle: 'Torta 3 Leches (30 pax) - Decoración Spiderman', fecha: '2026-10-25', abono: 50000, total: 120000, estado: 'PENDIENTE' },
        { id: 2, cliente: 'Empresa TechNova', detalle: '100 panes de bono + 100 mini croissants', fecha: '2026-10-18', abono: 150000, total: 150000, estado: 'PAGADO' }
    ],
    ventas: [],
    mermas: []
};

let db = cargarDatos();
let catalogoActualizado = false;
db = migrarCatalogoInicial(db);
let grafica = null;
let graficaInforme = null;
let filtroActual = '';
let configuracionMenu = { ...configuracionInicial, ...(db.configuracionMenu || {}) };
configuracionMenu.urlPublica = normalizarUrlPublica(configuracionMenu.urlPublica);
db.configuracionMenu = configuracionMenu;
let perfilEmpresa = { ...perfilEmpresaInicial, ...(db.perfilEmpresa || {}) };
let revisionServidor = 0;
let escriturasPendientes = 0;
let colaEscrituraServidor = Promise.resolve();
let sincronizandoServidor = false;
let intervaloSincronizacion = null;

function cargarDatos() {
    try {
        const guardados = JSON.parse(localStorage.getItem(STORAGE_KEY));
        if (guardados && Array.isArray(guardados.productos)) {
            return { ...datosIniciales, ...guardados };
        }
    } catch (error) {
        console.warn('No se pudieron recuperar los datos locales.', error);
    }
    return structuredClone(datosIniciales);
}

function migrarCatalogoInicial(datos) {
    const catalogo = { ...datosIniciales, ...datos };
    catalogo.ventas = Array.isArray(datos.ventas) ? datos.ventas : [];
    catalogo.mermas = Array.isArray(datos.mermas) ? datos.mermas : [];
    catalogo.productos = Array.isArray(datos.productos) ? datos.productos : structuredClone(productosCatalogoIniciales);
    catalogo.insumos = Array.isArray(datos.insumos) ? datos.insumos : structuredClone(insumosCatalogoIniciales);
    catalogo.proveedores = Array.isArray(datos.proveedores) ? datos.proveedores : structuredClone(datosIniciales.proveedores);

    const normalizarNombre = nombre => String(nombre || '').trim().toLocaleLowerCase('es');
    const porNombreProducto = new Map(productosCatalogoIniciales.map(producto => [normalizarNombre(producto.nombre), producto]));
    catalogo.productos = catalogo.productos.map(producto => {
        const referencia = porNombreProducto.get(normalizarNombre(producto.nombre));
        return {
            ...referencia,
            ...producto,
            categoria: producto.categoria || referencia?.categoria || 'Especiales',
            stockMinimo: Number.isFinite(Number(producto.stockMinimo)) ? Number(producto.stockMinimo) : (referencia?.stockMinimo || 15),
            impuesto: producto.impuesto || 'sin_clasificar'
        };
    });
    const productosExistentes = new Set(catalogo.productos.map(producto => normalizarNombre(producto.nombre)));
    let siguienteProducto = Math.max(0, ...catalogo.productos.map(producto => Number(producto.id) || 0)) + 1;
    productosCatalogoIniciales.forEach(producto => {
        if (!productosExistentes.has(normalizarNombre(producto.nombre))) {
            catalogo.productos.push({ ...producto, id: siguienteProducto++ });
        }
    });

    const porNombreInsumo = new Map(insumosCatalogoIniciales.map(insumo => [normalizarNombre(insumo.nombre), insumo]));
    catalogo.insumos = catalogo.insumos.map(insumo => ({
        ...porNombreInsumo.get(normalizarNombre(insumo.nombre)),
        ...insumo,
        stockMinimo: insumo.stockMinimo || porNombreInsumo.get(normalizarNombre(insumo.nombre))?.stockMinimo || '',
        fechaVencimiento: insumo.fechaVencimiento || ''
    }));
    const insumosExistentes = new Set(catalogo.insumos.map(insumo => normalizarNombre(insumo.nombre)));
    let siguienteInsumo = Math.max(0, ...catalogo.insumos.map(insumo => Number(insumo.id) || 0)) + 1;
    insumosCatalogoIniciales.forEach(insumo => {
        if (!insumosExistentes.has(normalizarNombre(insumo.nombre))) {
            catalogo.insumos.push({ ...insumo, id: siguienteInsumo++ });
        }
    });
    catalogo.proveedores = catalogo.proveedores.map(proveedor => ({ ...proveedor, historialPrecios: proveedor.historialPrecios || [] }));
    catalogoActualizado = !datos.catalogoVersion;
    catalogo.catalogoVersion = 2;
    return catalogo;
}

function guardarDatos() {
    try {
        db.configuracionMenu = configuracionMenu;
        db.perfilEmpresa = perfilEmpresa;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
    } catch (error) {
        console.warn('No se pudieron guardar los cambios en este navegador.', error);
    }
    guardarEnServidor();
}

function normalizarUrlPublica(url) {
    const valor = String(url || '').trim();
    if (!valor) return '';
    try {
        const direccion = new URL(valor);
        if (direccion.protocol !== 'https:'
            || direccion.username
            || direccion.password
            || ['localhost', '127.0.0.1', '[::1]'].includes(direccion.hostname)) return '';
        direccion.search = '';
        direccion.hash = '';
        return `${direccion.origin}${direccion.pathname.replace(/\/+$/, '')}`;
    } catch {
        return '';
    }
}

function servidorLocalActivo() {
    return ['http:', 'https:'].includes(window.location.protocol);
}

function movimientoReducido() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function animarTextos(contenedor) {
    if (movimientoReducido() || !window.Motion?.animate || !contenedor) return;
    const textos = [...contenedor.querySelectorAll('h1, h2, h3, .store-eyebrow, .company-form-title, .report-panel-heading')];
    if (!textos.length) return;
    const delay = window.Motion.stagger ? window.Motion.stagger(0.025) : 0.025;
    window.Motion.animate(textos, { opacity: [0, 1], y: [9, 0] }, {
        duration: 0.42,
        delay,
        ease: 'easeOut'
    });
}

function animarModulo(idModulo) {
    if (movimientoReducido()) return;
    const seccion = document.getElementById(idModulo);
    if (!seccion) return;
    if (window.gsap) {
        window.gsap.fromTo(seccion, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.36, ease: 'power2.out', clearProps: 'transform' });
        const tarjetas = seccion.querySelectorAll('.report-metrics article, .report-panel, .company-form-section, .security-status-panel');
        if (tarjetas.length) {
            window.gsap.fromTo(tarjetas, { opacity: 0, y: 14 }, {
                opacity: 1,
                y: 0,
                duration: 0.4,
                stagger: 0.055,
                delay: 0.08,
                ease: 'power2.out',
                clearProps: 'transform'
            });
        }
    }
    animarTextos(seccion);
}

function actualizarEstadoServidor(texto, conectado) {
    const estado = document.getElementById('estadoServidor');
    if (!estado) return;
    estado.textContent = texto;
    estado.classList.toggle('server-connected', Boolean(conectado));
    estado.classList.toggle('server-disconnected', !conectado);
}

function guardarEnServidor() {
    if (!servidorLocalActivo()) return;
    const snapshot = JSON.stringify(db);
    escriturasPendientes += 1;
    colaEscrituraServidor = colaEscrituraServidor.then(async () => {
        const response = await fetch(tenantPath('/api/state'), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: JSON.parse(snapshot) })
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const resultado = await response.json();
        revisionServidor = resultado.revision;
        actualizarEstadoServidor('PostgreSQL · sincronizado', true);
    }).catch(error => {
        console.error('No se pudo sincronizar con PostgreSQL.', error);
        actualizarEstadoServidor('Sin conexión a PostgreSQL · cambios locales conservados', false);
    }).finally(() => {
        escriturasPendientes = Math.max(0, escriturasPendientes - 1);
    });
}

async function sincronizarDesdeServidor(forzar = false) {
    if (!servidorLocalActivo() || sincronizandoServidor || (escriturasPendientes > 0 && !forzar)) return;
    sincronizandoServidor = true;
    try {
        const response = await fetch(tenantPath('/api/state'), { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const resultado = await response.json();
        if (resultado.data && (forzar || resultado.revision > revisionServidor)) {
            db = migrarCatalogoInicial({ ...datosIniciales, ...resultado.data });
            const configuracionRemota = { ...configuracionInicial, ...(db.configuracionMenu || {}) };
            const urlPublicaRemota = normalizarUrlPublica(configuracionRemota.urlPublica);
            const necesitaMigracion = catalogoActualizado
                || !db.perfilEmpresa
                || configuracionRemota.urlPublica !== urlPublicaRemota;
            configuracionMenu = { ...configuracionRemota, urlPublica: urlPublicaRemota };
            perfilEmpresa = { ...perfilEmpresaInicial, ...(db.perfilEmpresa || {}) };
            db.configuracionMenu = configuracionMenu;
            db.perfilEmpresa = perfilEmpresa;
            revisionServidor = resultado.revision;
            try { localStorage.setItem(STORAGE_KEY, JSON.stringify(db)); } catch (error) {
                console.warn('PostgreSQL conserva los datos, pero no se pudo actualizar el caché local.', error);
            }
            renderizarTodo();
            generarQR();
            iniciarGrafica();
            if (necesitaMigracion) {
                catalogoActualizado = false;
                guardarDatos();
            }
        } else if (!resultado.data && revisionServidor === 0) {
            await new Promise(resolve => setTimeout(resolve, 120));
            if (escriturasPendientes === 0) guardarDatos();
        }
        actualizarEstadoServidor('PostgreSQL · sincronizado', true);
    } catch (error) {
        console.error('No se pudo consultar PostgreSQL.', error);
        actualizarEstadoServidor('Sin conexión a PostgreSQL · cambios locales conservados', false);
    } finally {
        sincronizandoServidor = false;
    }
}

function formatoCOP(valor) {
    return new Intl.NumberFormat('es-CO', {
        style: 'currency', currency: perfilEmpresa.moneda || 'COP', maximumFractionDigits: 0
    }).format(Number(valor) || 0);
}

function escapar(texto) {
    return String(texto ?? '').replace(/[&<>"']/g, caracter => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[caracter]);
}

function actualizarPerfilEmpresa(forzar = false) {
    const formulario = document.getElementById('formPerfilEmpresa');
    if (formulario && (forzar || !formulario.contains(document.activeElement))) {
        const campos = {
            perfilNombre: perfilEmpresa.nombre,
            perfilTipo: perfilEmpresa.tipo,
            perfilEslogan: perfilEmpresa.eslogan,
            perfilDescripcion: perfilEmpresa.descripcion,
            perfilNit: perfilEmpresa.nit,
            perfilRazonSocial: perfilEmpresa.razonSocial,
            perfilNitDV: perfilEmpresa.nitDV,
            perfilRegimenFiscal: perfilEmpresa.regimenFiscal,
            perfilDianResolucion: perfilEmpresa.dianResolucion,
            perfilDianPrefijo: perfilEmpresa.dianPrefijo,
            perfilDianRango: perfilEmpresa.dianRango,
            perfilDianVigencia: perfilEmpresa.dianVigencia,
            perfilMoneda: perfilEmpresa.moneda,
            perfilEmail: perfilEmpresa.email,
            perfilTelefono: perfilEmpresa.telefono,
            perfilDireccion: perfilEmpresa.direccion,
            perfilCiudad: perfilEmpresa.ciudad,
            perfilHorario: perfilEmpresa.horario,
            urlPublicaMenu: configuracionMenu.urlPublica,
            whatsappLocal: configuracionMenu.whatsapp,
            perfilIdEmpresa: perfilEmpresa.id
        };
        Object.entries(campos).forEach(([id, valor]) => {
            const campo = document.getElementById(id);
            if (campo) campo.value = valor || '';
        });
    }

    const nombre = perfilEmpresa.nombre || perfilEmpresaInicial.nombre;
    const textos = {
        marcaMenu: nombre,
        pieMenuEmpresa: nombre,
        esloganMarcaMenu: perfilEmpresa.eslogan || 'HECHO FRESCO CADA DÍA',
        tipoMenu: (perfilEmpresa.tipo || 'Negocio local').toLocaleUpperCase('es'),
        nombreEmpresaSidebar: nombre,
        tipoEmpresaSidebar: perfilEmpresa.tipo || 'Empresa local',
        descripcionMenu: perfilEmpresa.descripcion || 'Conoce nuestros productos y novedades del día.',
        empresaInformeMarca: `${nombre.toLocaleUpperCase('es')} · INFORME DE OPERACIÓN`,
        empresaInformePie: `${nombre} · Informe interno de operación`
    };
    Object.entries(textos).forEach(([id, texto]) => {
        const elemento = document.getElementById(id);
        if (elemento) elemento.textContent = texto;
    });
    const datosInforme = document.getElementById('empresaInformeDatos');
    if (datosInforme) {
        const nit = perfilEmpresa.nit ? `NIT ${perfilEmpresa.nit}${perfilEmpresa.nitDV ? `-${perfilEmpresa.nitDV}` : ''}` : 'NIT pendiente de configurar';
        datosInforme.textContent = [perfilEmpresa.razonSocial || nombre, nit, perfilEmpresa.direccion, [perfilEmpresa.ciudad, perfilEmpresa.departamento].filter(Boolean).join(', '), perfilEmpresa.telefono, perfilEmpresa.email].filter(Boolean).join(' · ');
    }

    const ubicacion = [perfilEmpresa.direccion, perfilEmpresa.ciudad].filter(Boolean).join(' · ');
    const panelDireccion = document.getElementById('direccionVisibleMenu');
    const direccionDestacada = document.getElementById('direccionDestacada');
    const ciudadDestacada = document.getElementById('ciudadDestacada');
    const enlaceMapa = document.getElementById('enlaceMapa');
    const ubicacionMenu = document.getElementById('ubicacionMenu');
    const horarioMenu = document.getElementById('horarioMenu');
    const contactoMenu = document.getElementById('contactoMenu');
    const contactoContenedor = document.querySelector('.store-contact');
    if (direccionDestacada) direccionDestacada.textContent = perfilEmpresa.direccion || 'Dirección por confirmar';
    if (ciudadDestacada) ciudadDestacada.textContent = perfilEmpresa.ciudad || '';
    if (panelDireccion) panelDireccion.classList.toggle('hidden', !ubicacion);
    if (enlaceMapa) enlaceMapa.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ubicacion)}`;
    if (ubicacionMenu) ubicacionMenu.textContent = ubicacion;
    if (horarioMenu) horarioMenu.textContent = perfilEmpresa.horario || '';
    if (contactoMenu) {
        const telefono = perfilEmpresa.telefono.replace(/\D/g, '');
        const correo = perfilEmpresa.email.trim();
        contactoMenu.classList.toggle('hidden', !telefono && !correo);
        contactoMenu.href = telefono ? `tel:${telefono}` : `mailto:${correo}`;
        contactoMenu.textContent = telefono ? `Llamar · ${perfilEmpresa.telefono}` : correo;
    }
    if (contactoContenedor) contactoContenedor.classList.toggle('hidden', !ubicacion && !perfilEmpresa.horario && !(perfilEmpresa.telefono || perfilEmpresa.email));
    const textoMoneda = document.getElementById('textoMonedaMenu');
    if (textoMoneda) textoMoneda.textContent = `Precios expresados en ${perfilEmpresa.moneda || 'COP'}. Elige tus favoritos y arma tu pedido.`;
}

function guardarPerfilEmpresa(evento) {
    evento.preventDefault();
    const formulario = document.getElementById('formPerfilEmpresa');
    const valores = new FormData(formulario);
    const nombre = String(valores.get('nombre') || '').trim();
    const url = normalizarUrlPublica(valores.get('urlPublica'));
    const whatsapp = String(valores.get('whatsapp') || '').replace(/\D/g, '');
    if (!nombre) {
        alert('El nombre comercial es obligatorio.');
        document.getElementById('perfilNombre').focus();
        return;
    }
    if (String(valores.get('urlPublica') || '').trim() && !url) {
        alert('La dirección pública debe ser una URL HTTPS válida.');
        document.getElementById('urlPublicaMenu').focus();
        return;
    }
    if (whatsapp && (whatsapp.length < 10 || whatsapp.length > 15)) {
        alert('El WhatsApp debe incluir el código de país y tener entre 10 y 15 dígitos.');
        document.getElementById('whatsappLocal').focus();
        return;
    }

    perfilEmpresa = {
        ...perfilEmpresa,
        nombre,
        razonSocial: String(valores.get('razonSocial') || '').trim(),
        tipo: String(valores.get('tipo') || '').trim(),
        eslogan: String(valores.get('eslogan') || '').trim(),
        descripcion: String(valores.get('descripcion') || '').trim(),
        nit: String(valores.get('nit') || '').trim(),
        nitDV: String(valores.get('nitDV') || '').trim(),
        regimenFiscal: String(valores.get('regimenFiscal') || '').trim(),
        dianResolucion: String(valores.get('dianResolucion') || '').trim(),
        dianPrefijo: String(valores.get('dianPrefijo') || '').trim(),
        dianRango: String(valores.get('dianRango') || '').trim(),
        dianVigencia: String(valores.get('dianVigencia') || '').trim(),
        moneda: String(valores.get('moneda') || 'COP'),
        email: String(valores.get('email') || '').trim(),
        telefono: String(valores.get('telefono') || '').trim(),
        direccion: String(valores.get('direccion') || '').trim(),
        ciudad: String(valores.get('ciudad') || '').trim(),
        horario: String(valores.get('horario') || '').trim()
    };
    configuracionMenu.urlPublica = url;
    configuracionMenu.whatsapp = whatsapp;
    guardarDatos();
    actualizarPerfilEmpresa(true);
    renderizarTodo();
    generarQR();
    iniciarGrafica();
    const estado = document.getElementById('estadoPerfilEmpresa');
    estado.textContent = servidorLocalActivo()
        ? `Perfil de ${perfilEmpresa.nombre} enviado a PostgreSQL. El ID ${perfilEmpresa.id} identifica este negocio.`
        : `Perfil de ${perfilEmpresa.nombre} guardado en este navegador. El ID ${perfilEmpresa.id} identifica este negocio.`;
}

async function cambiarClaveAdministrador(evento) {
    evento.preventDefault();
    const actual = document.getElementById('claveActual').value;
    const nueva = document.getElementById('claveNueva').value;
    const confirmar = document.getElementById('claveNuevaConfirmar').value;
    const estado = document.getElementById('estadoCambioClave');
    if (nueva !== confirmar) {
        estado.textContent = 'La nueva contraseña y su confirmación no coinciden.';
        return;
    }
    try {
        const { neonAuth } = await import(tenantPath('/neon-auth.js'));
        const result = await neonAuth.changePassword({
            currentPassword: actual,
            newPassword: nueva,
            revokeOtherSessions: true
        });
        if (result.error) throw new Error(result.error.message || 'No se pudo cambiar la contraseña en Neon Auth.');
        document.getElementById('formCambiarClave').reset();
        estado.textContent = 'Contraseña actualizada en Neon Auth. Vuelve a iniciar sesión si se cerraron otras sesiones.';
    } catch (requestError) {
        estado.textContent = requestError.message;
    }
}

async function cerrarSesion() {
    try {
        const { neonAuth } = await import(tenantPath('/neon-auth.js'));
        const providerResult = await neonAuth.signOut();
        if (providerResult.error) throw new Error(providerResult.error.message || 'No se pudo cerrar la sesión de Neon Auth.');
        if (servidorLocalActivo()) {
            const response = await fetch(tenantPath('/api/security/logout'), {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.detail || 'No se pudo cerrar la sesión de PANAPP.');
        }
        window.location.replace(tenantPath('/login'));
    } catch (error) {
        alert(error.message || 'No se pudo cerrar la sesión.');
    }
}

function mostrarModulo(idModulo, boton) {
    document.querySelectorAll('.seccion-modulo').forEach(seccion => {
        seccion.classList.add('hidden');
        seccion.classList.remove('block');
    });
    document.getElementById(idModulo)?.classList.replace('hidden', 'block');
    document.querySelectorAll('.menu-btn').forEach(elemento => {
        elemento.className = 'w-full text-left px-4 py-3 rounded-xl text-sm font-semibold text-gray-400 hover:text-white hover:bg-slate-800 flex items-center gap-3 transition-all menu-btn';
    });
    if (boton) {
        boton.className = 'w-full text-left px-4 py-3 rounded-xl text-sm font-bold bg-brand-600 text-white shadow-md flex items-center gap-3 transition-all menu-btn';
    }
    animarModulo(idModulo);
    if (idModulo === 'secInforme') renderizarInforme();
    if (idModulo === 'secSeguridad') actualizarResumenSeguridad();
}

async function actualizarResumenSeguridad() {
    const resumen = document.getElementById('resumenSeguridad');
    if (!resumen) return;
    if (!servidorLocalActivo()) {
        resumen.textContent = 'La seguridad del servidor está disponible al ejecutar PANAPP con start-panapp.ps1.';
        return;
    }
    try {
        const response = await fetch(tenantPath('/api/security/status'), { cache: 'no-store' });
        const status = await response.json();
        resumen.textContent = status.authenticated
            ? `Sesión protegida activa${status.username ? ` para ${status.username}` : ''}. La sesión se cierra al reiniciar el servidor o después de ocho horas.`
            : 'No hay una sesión administradora activa en este navegador.';
    } catch {
        resumen.textContent = 'No se pudo consultar el estado de la sesión.';
    }
}

async function inicializarApp() {
    renderizarTodo();
    generarQR();
    iniciarGrafica();
    actualizarEstadoServidor(servidorLocalActivo() ? 'Conectando a PostgreSQL…' : 'Solo almacenamiento de este navegador', false);
    await sincronizarDesdeServidor(true);
    if (servidorLocalActivo() && !intervaloSincronizacion) {
        intervaloSincronizacion = window.setInterval(() => sincronizarDesdeServidor(), 2000);
    }
}

function renderizarTodo() {
    actualizarPerfilEmpresa();
    const hoy = new Date();
    const fechaHoy = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
    const mesActual = fechaHoy.slice(0, 7);
    const ventas = Array.isArray(db.ventas) ? db.ventas : [];
    const mermas = Array.isArray(db.mermas) ? db.mermas : [];
    const ventasDeHoy = ventas.filter(venta => String(venta.fecha || '').slice(0, 10) === fechaHoy);
    const ventasDelMes = ventas.filter(venta => String(venta.fecha || '').slice(0, 7) === mesActual);
    const sumaVentas = registros => registros.reduce((total, venta) => total + (Number(venta.total) || 0), 0);
    const mermasDelMes = mermas.filter(merma => String(merma.fecha || '').slice(0, 7) === mesActual);
    const valorMerma = mermasDelMes.reduce((total, merma) => total + (Number(merma.costo ?? merma.valor) || 0), 0);
    const productosVendidos = new Map();
    ventasDelMes.forEach(venta => {
        const lineas = Array.isArray(venta.items) ? venta.items : Array.isArray(venta.productos) ? venta.productos : [];
        lineas.forEach(linea => {
            const nombre = String(linea.nombre || linea.producto || 'Producto');
            productosVendidos.set(nombre, (productosVendidos.get(nombre) || 0) + (Number(linea.cantidad) || 0));
        });
    });
    const masVendido = [...productosVendidos.entries()].sort((a, b) => b[1] - a[1])[0];
    const alertasStock = db.productos.filter(producto => Number(producto.stock) <= Number(producto.stockMinimo || 0)).length;
    const activos = db.encargos.filter(encargo => !['PAGADO', 'ENTREGADO'].includes(encargo.estado)).length;
    document.getElementById('kpiEncargos').textContent = activos;
    document.getElementById('kpiVentasHoy').textContent = formatoCOP(sumaVentas(ventasDeHoy));
    document.getElementById('kpiVentasMes').textContent = formatoCOP(sumaVentas(ventasDelMes));
    document.getElementById('kpiMasVendido').textContent = masVendido ? `${masVendido[0]} · ${masVendido[1]}` : 'Sin registros';
    document.getElementById('kpiMerma').textContent = formatoCOP(valorMerma);
    document.getElementById('kpiStockBajo').textContent = alertasStock;
    document.getElementById('textoResumen').textContent = `${ventasDeHoy.length} venta${ventasDeHoy.length === 1 ? '' : 's'} registrada${ventasDeHoy.length === 1 ? '' : 's'} hoy, ${formatoCOP(sumaVentas(ventasDeHoy))}. ${alertasStock ? `${alertasStock} producto${alertasStock === 1 ? '' : 's'} requiere${alertasStock === 1 ? '' : 'n'} reposición.` : 'No hay alertas de stock bajo.'} Hay ${activos} encargo${activos === 1 ? '' : 's'} pendiente${activos === 1 ? '' : 's'}.`;
    document.getElementById('fechaInforme').textContent = `Informe actualizado: ${new Intl.DateTimeFormat('es-CO', { dateStyle: 'long' }).format(new Date())}. Valores en ${perfilEmpresa.moneda}.`;

    const productos = document.getElementById('tbProductosInv');
    productos.innerHTML = db.productos.map(producto => `
        <tr class="hover:bg-slate-50">
            <td class="p-3 font-bold text-slate-700">${escapar(producto.nombre)}</td>
            <td class="p-3"><span class="stock-pill ${producto.stock <= 15 ? 'stock-low' : ''}">${Number(producto.stock) || 0} un.</span></td>
            <td class="p-3 text-red-600 font-medium">${formatoCOP(producto.costoProd)}</td>
        </tr>`).join('');

    document.getElementById('tbInsumosInv').innerHTML = db.insumos.map(insumo => `
        <tr class="hover:bg-slate-50">
            <td class="p-3 font-bold text-slate-700">${escapar(insumo.nombre)}</td>
            <td class="p-3 font-mono text-sm">${escapar(insumo.stock)}</td>
            <td class="p-3 text-red-600 font-medium">${formatoCOP(insumo.costo)}</td>
        </tr>`).join('');

    const menu = document.getElementById('tbMenuEditable');
    menu.innerHTML = db.productos.map(producto => `
        <tr class="hover:bg-slate-50">
            <td class="p-3 font-bold text-slate-700">${escapar(producto.nombre)}</td>
            <td class="p-3"><label class="sr-only" for="inputPrecio_${producto.id}">Precio de ${escapar(producto.nombre)}</label><input type="number" min="0" step="100" id="inputPrecio_${producto.id}" value="${Number(producto.precio) || 0}" class="w-full pl-3 pr-3 py-2 border border-gray-200 rounded-lg font-bold text-slate-700"></td>
            <td class="p-3 text-right"><button onclick="guardarNuevoPrecio(${Number(producto.id)})" class="bg-slate-900 text-white font-bold px-4 py-2 rounded-lg text-xs">Guardar precio</button></td>
        </tr>`).join('');
    document.getElementById('tbProveedores').innerHTML = db.proveedores.map(proveedor => `
        <tr class="hover:bg-slate-50">
            <td class="p-4 font-bold text-slate-700">${escapar(proveedor.empresa)}</td>
            <td class="p-4 text-gray-500">${escapar(proveedor.material)}</td>
            <td class="p-4 font-medium text-slate-600">${escapar(proveedor.precio)}</td>
            <td class="p-4 font-mono text-xs text-brand-600">${escapar(proveedor.contacto)}</td>
            <td class="p-4 text-right"><button onclick="alternarProveedor(${Number(proveedor.id)})" class="status-pill ${proveedor.estado === 'Activo' ? 'status-active' : 'status-inactive'}">${escapar(proveedor.estado)} · cambiar</button></td>
        </tr>`).join('');

    document.getElementById('tbEncargos').innerHTML = db.encargos.map(encargo => `
        <tr class="hover:bg-slate-50">
            <td class="p-4 font-bold text-slate-700">${escapar(encargo.cliente)}</td>
            <td class="p-4 text-sm text-gray-600 max-w-xs">${escapar(encargo.detalle)}</td>
            <td class="p-4 font-mono text-xs">${escapar(encargo.fecha)}</td>
            <td class="p-4 font-bold"><span class="text-emerald-700">${formatoCOP(encargo.abono)}</span><br><span class="text-xs text-slate-500">Saldo: ${formatoCOP(Math.max(0, encargo.total - encargo.abono))} / ${formatoCOP(encargo.total)}</span></td>
            <td class="p-4 text-right"><button onclick="avanzarEncargo(${Number(encargo.id)})" class="status-pill ${claseEstado(encargo.estado)}" ${['PAGADO', 'ENTREGADO'].includes(encargo.estado) ? 'disabled' : ''}>${escapar(encargo.estado)}</button></td>
        </tr>`).join('');

    aplicarFiltro(filtroActual);
    if (document.getElementById('secInforme')?.classList.contains('block')) renderizarInforme();
}

function claseEstado(estado) {
    if (estado === 'PAGADO') return 'status-paid';
    if (estado === 'ENTREGADO') return 'status-done';
    if (estado === 'LISTO') return 'status-ready';
    return 'status-pending';
}

function registrarVenta() {
    const nombre = prompt('Nombre del producto vendido:')?.trim();
    if (!nombre) return;
    const producto = db.productos.find(item => item.nombre.toLocaleLowerCase('es') === nombre.toLocaleLowerCase('es'));
    if (!producto) {
        alert('No encontramos ese producto en el inventario.');
        return;
    }
    const cantidad = Number(prompt(`Unidades vendidas de ${producto.nombre}:`, '1'));
    if (!Number.isInteger(cantidad) || cantidad < 1) {
        alert('Ingresa una cantidad válida de unidades.');
        return;
    }
    if (cantidad > Number(producto.stock)) {
        alert(`Solo hay ${Number(producto.stock) || 0} unidades disponibles en inventario.`);
        return;
    }
    const precio = Number(prompt(`Precio de venta por unidad (COP):`, String(producto.precio)));
    if (!Number.isFinite(precio) || precio <= 0) {
        alert('Ingresa un precio de venta válido.');
        return;
    }
    db.ventas.push({
        id: Date.now(),
        fecha: new Date().toISOString(),
        total: Math.round(precio * cantidad),
        items: [{ id: producto.id, nombre: producto.nombre, cantidad, precio: Math.round(precio) }]
    });
    producto.stock = Number(producto.stock) - cantidad;
    guardarDatos();
    renderizarTodo();
}

function registrarMerma() {
    const nombre = prompt('Nombre del producto que se perdió o dañó:')?.trim();
    if (!nombre) return;
    const producto = db.productos.find(item => item.nombre.toLocaleLowerCase('es') === nombre.toLocaleLowerCase('es'));
    if (!producto) {
        alert('No encontramos ese producto en el inventario.');
        return;
    }
    const cantidad = Number(prompt(`Unidades perdidas de ${producto.nombre}:`, '1'));
    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > Number(producto.stock)) {
        alert(`Ingresa una cantidad entera entre 1 y las ${Number(producto.stock) || 0} unidades disponibles.`);
        return;
    }
    db.mermas.push({
        id: Date.now(),
        fecha: new Date().toISOString(),
        productoId: producto.id,
        nombre: producto.nombre,
        cantidad,
        costo: Math.round((Number(producto.costoProd) || 0) * cantidad)
    });
    producto.stock = Number(producto.stock) - cantidad;
    guardarDatos();
    renderizarTodo();
}

function guardarNuevoPrecio(id) {
    const entrada = document.getElementById(`inputPrecio_${id}`);
    const precio = Number(entrada?.value);
    const producto = db.productos.find(item => item.id === id);
    if (!producto || !Number.isFinite(precio) || precio <= 0) {
        alert('Ingrese un precio mayor que cero.');
        entrada?.focus();
        return;
    }
    producto.precio = Math.round(precio);
    guardarDatos();
    renderizarTodo();
    alert(`Precio actualizado a ${formatoCOP(precio)}. El menú público ya refleja el cambio.`);
}

function agregarElemento(tipo) {
    const siguienteId = lista => Math.max(0, ...lista.map(item => Number(item.id) || 0)) + 1;
    if (tipo === 'producto') {
        const nombre = prompt('Nombre del producto:')?.trim();
        if (!nombre) return;
        const stock = Number(prompt('Unidades disponibles:', '0'));
        const costoProd = Number(prompt('Costo de producción por unidad (COP):', '0'));
        const precio = Number(prompt('Precio de venta (COP):', '0'));
        if (![stock, costoProd, precio].every(valor => Number.isFinite(valor) && valor >= 0) || precio === 0) return alert('Revise stock, costo y precio; el precio debe ser mayor que cero.');
        db.productos.push({ id: siguienteId(db.productos), nombre, stock, costoProd, precio });
    } else if (tipo === 'insumo') {
        const nombre = prompt('Nombre del insumo:')?.trim();
        if (!nombre) return;
        const stock = prompt('Existencia y unidad (ejemplo: 25 Kg):')?.trim();
        const costo = Number(prompt('Costo por Kg/Lt (COP):', '0'));
        if (!stock || !Number.isFinite(costo) || costo < 0) return alert('Ingrese una existencia y un costo válidos.');
        db.insumos.push({ id: siguienteId(db.insumos), nombre, stock, costo });
    } else if (tipo === 'proveedor') {
        const empresa = prompt('Nombre de la empresa:')?.trim();
        if (!empresa) return;
        const material = prompt('Material o servicio principal:')?.trim();
        const contacto = prompt('Teléfono o contacto:')?.trim();
        const precio = prompt('Condición comercial o precio pactado:')?.trim();
        if (!material || !contacto || !precio) return alert('Complete material, contacto y condición comercial.');
        db.proveedores.push({ id: siguienteId(db.proveedores), empresa, material, contacto, precio, estado: 'Activo' });
    } else if (tipo === 'encargo') {
        const cliente = prompt('Nombre del cliente:')?.trim();
        if (!cliente) return;
        const detalle = prompt('Detalle del pedido:')?.trim();
        const fecha = prompt('Fecha de entrega (AAAA-MM-DD):', new Date().toISOString().slice(0, 10));
        const total = Number(prompt('Valor total (COP):', '0'));
        const abono = Number(prompt('Abono recibido (COP):', '0'));
        if (!detalle || !/^\d{4}-\d{2}-\d{2}$/.test(fecha || '') || !Number.isFinite(total) || !Number.isFinite(abono) || total <= 0 || abono < 0 || abono > total) return alert('Revise detalle, fecha, total y abono. El abono no puede superar el total.');
        db.encargos.push({ id: siguienteId(db.encargos), cliente, detalle, fecha, total, abono, estado: abono >= total ? 'PAGADO' : 'PENDIENTE' });
    }
    guardarDatos();
    renderizarTodo();
}

function alternarProveedor(id) {
    const proveedor = db.proveedores.find(item => item.id === id);
    if (!proveedor) return;
    proveedor.estado = proveedor.estado === 'Activo' ? 'Inactivo' : 'Activo';
    guardarDatos();
    renderizarTodo();
}

function avanzarEncargo(id) {
    const encargo = db.encargos.find(item => item.id === id);
    if (!encargo || ['PAGADO', 'ENTREGADO'].includes(encargo.estado)) return;
    encargo.estado = encargo.estado === 'PENDIENTE' ? 'EN PREPARACIÓN' : encargo.estado === 'EN PREPARACIÓN' ? 'LISTO' : 'ENTREGADO';
    guardarDatos();
    renderizarTodo();
}

function filtrarGlobal(valor) {
    filtroActual = valor.trim().toLocaleLowerCase('es');
    aplicarFiltro(filtroActual);
}

function aplicarFiltro(filtro) {
    document.querySelectorAll('#appPrincipal tbody tr').forEach(fila => {
        fila.hidden = Boolean(filtro) && !fila.textContent.toLocaleLowerCase('es').includes(filtro);
    });
}

function generarQR() {
    const contenedor = document.getElementById('codigoQR');
    if (!contenedor) return;
    contenedor.innerHTML = '';
    const botonDescarga = document.getElementById('descargarQR');
    const estado = document.getElementById('estadoQR');
    if (!configuracionMenu.urlPublica) {
        if (estado) estado.textContent = 'Para crear un QR que abra en otros teléfonos, publica la página y pega aquí su dirección HTTPS.';
        if (botonDescarga) botonDescarga.disabled = true;
        return;
    }
    if (typeof QRCode === 'undefined') {
        if (estado) estado.textContent = 'No se cargó el generador de QR. Comprueba la conexión a internet.';
        return;
    }
    const destino = new URL(configuracionMenu.urlPublica);
    const routeSlug = tenantBasePath.match(/^\/t\/([^/]+)/)?.[1];
    if (routeSlug) {
        destino.pathname = `${tenantBasePath}/menu`;
    } else if (destino.hostname === window.location.hostname) {
        destino.pathname = '/menu';
    } else if (!destino.pathname.replace(/\/+$/, '').endsWith('/menu')) {
        destino.pathname = `${destino.pathname.replace(/\/+$/, '')}/menu`;
    }
    destino.search = '';
    new QRCode(contenedor, { text: destino.toString(), width: 192, height: 192, colorDark: '#20352c', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.H });
    if (estado) estado.textContent = `QR listo. Al escanearlo se abrirá ${destino.origin}.`;
    if (botonDescarga) botonDescarga.disabled = false;
}

function iniciarGrafica() {
    const lienzo = document.getElementById('graficaGeneral');
    if (!lienzo || typeof Chart === 'undefined') return;
    if (grafica) grafica.destroy();
    const hoy = new Date();
    const meses = Array.from({ length: 6 }, (_, index) => new Date(hoy.getFullYear(), hoy.getMonth() - 5 + index, 1));
    const ventas = Array.isArray(db.ventas) ? db.ventas : [];
    grafica = new Chart(lienzo.getContext('2d'), {
        type: 'line',
        data: {
            labels: meses.map(mes => new Intl.DateTimeFormat('es-CO', { month: 'short' }).format(mes)),
            datasets: [
                {
                    label: `Ventas (${perfilEmpresa.moneda})`,
                    data: meses.map(mes => {
                        const periodo = `${mes.getFullYear()}-${String(mes.getMonth() + 1).padStart(2, '0')}`;
                        return ventas
                            .filter(venta => String(venta.fecha || '').slice(0, 7) === periodo)
                            .reduce((total, venta) => total + (Number(venta.total) || 0), 0);
                    }),
                    borderColor: '#d97706',
                    backgroundColor: 'rgba(217, 119, 6, 0.12)',
                    fill: true,
                    tension: 0.32,
                    borderWidth: 3
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'top' } },
            scales: { y: { beginAtZero: true, ticks: { callback: valor => formatoCOP(valor) } } }
        }
    });
}

function exportarCSV(tipo) {
    const campos = {
        productos: ['nombre', 'stock', 'costoProd', 'precio'],
        insumos: ['nombre', 'stock', 'costo'],
        proveedores: ['empresa', 'material', 'precio', 'contacto', 'estado'],
        encargos: ['cliente', 'detalle', 'fecha', 'abono', 'total', 'estado']
    };
    const filas = db[tipo];
    if (!filas || !campos[tipo]) return;
    const csv = [campos[tipo].join(';'), ...filas.map(fila => campos[tipo].map(campo => `"${String(fila[campo] ?? '').replaceAll('"', '""')}"`).join(';'))].join('\r\n');
    const enlace = document.createElement('a');
    enlace.href = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }));
    enlace.download = `panapp-${tipo}.csv`;
    enlace.click();
    URL.revokeObjectURL(enlace.href);
}

function descargarPDF() {
    if (typeof html2pdf === 'undefined') {
        alert('No se pudo cargar el exportador PDF. Revise su conexión a internet e inténtelo de nuevo.');
        return;
    }
    html2pdf().set({
        margin: 0.5,
        filename: 'Informe_Ejecutivo_PANAPP.pdf',
        image: { type: 'jpeg', quality: 0.96 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'in', format: 'letter', orientation: 'landscape' }
    }).from(document.getElementById('areaReporte')).save();
}

async function protegerPanelAdmin() {
    try {
        const response = await fetch(tenantPath('/api/security/status'), { cache: 'no-store' });
        const status = await response.json();
        if (response.status === 401 || (response.ok && (!status.authenticated || status.role !== 'ADMIN_PANADERIA'))) {
            window.location.replace(tenantPath('/login'));
            return;
        }
        if (!response.ok) throw new Error(status.detail || 'No se pudo validar la sesión.');
        const userLabel = document.getElementById('usuarioSesion');
        if (userLabel) userLabel.textContent = status.username || 'Administrador';
        await inicializarApp();
    } catch (error) {
        console.error('No se pudo validar la sesión administrativa.', error);
        actualizarEstadoServidor('No se pudo validar la sesión', false);
    }
}

document.addEventListener('DOMContentLoaded', protegerPanelAdmin);

function guardarConfiguracionMenu() {
    const url = document.getElementById('urlPublicaMenu').value.trim();
    const telefono = document.getElementById('whatsappLocal').value.replace(/\D/g, '');
    const urlValida = normalizarUrlPublica(url);
    if (!urlValida) {
        alert('Escribe una dirección pública HTTPS válida para el menú.');
        return;
    }
    if (telefono && (telefono.length < 10 || telefono.length > 15)) {
        alert('El WhatsApp debe incluir código de país y tener entre 10 y 15 dígitos, sin el signo +.');
        return;
    }
    configuracionMenu = { urlPublica: urlValida, whatsapp: telefono };
    guardarDatos();
    generarQR();
}

function descargarCodigoQR() {
    const canvas = document.querySelector('#codigoQR canvas');
    if (!canvas) return;
    const enlace = document.createElement('a');
    enlace.download = 'PANAPP-menu-QR.png';
    enlace.href = canvas.toDataURL('image/png');
    enlace.click();
}

function renderizarInforme() {
    const hoy = new Date();
    const periodo = document.getElementById('periodoInforme')?.value || '30';
    const hasta = new Date(hoy);
    hasta.setDate(hoy.getDate() + (periodo === 'todo' ? 36500 : Number(periodo)));
    const encargos = db.encargos.filter(encargo => {
        const fecha = new Date(`${encargo.fecha}T12:00:00`);
        return !Number.isNaN(fecha.getTime()) && fecha >= new Date(hoy.toDateString()) && fecha <= hasta;
    }).sort((a, b) => a.fecha.localeCompare(b.fecha));
    const total = encargos.reduce((suma, encargo) => suma + Number(encargo.total || 0), 0);
    const abonos = encargos.reduce((suma, encargo) => suma + Number(encargo.abono || 0), 0);
    const saldo = encargos.reduce((suma, encargo) => suma + Math.max(0, Number(encargo.total || 0) - Number(encargo.abono || 0)), 0);
    const pendientes = encargos.filter(encargo => !['PAGADO', 'ENTREGADO'].includes(encargo.estado));
    const bajos = db.productos.filter(producto => Number(producto.stock) <= 15);
    document.getElementById('reporteCantidad').textContent = encargos.length;
    document.getElementById('reporteValor').textContent = formatoCOP(total);
    document.getElementById('reporteAbonos').textContent = formatoCOP(abonos);
    document.getElementById('reporteSaldo').textContent = formatoCOP(saldo);
    document.getElementById('reportePendientes').textContent = `${pendientes.length} por completar`;
    document.getElementById('fechaInformeDetalle').textContent = new Intl.DateTimeFormat('es-CO', { dateStyle: 'long' }).format(hoy);
    document.getElementById('pieInforme').textContent = `Generado el ${new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' }).format(hoy)} · ${perfilEmpresa.moneda}`;
    document.getElementById('lecturaInforme').textContent = encargos.length ? `${pendientes.length} encargos siguen activos. Los saldos pendientes suman ${formatoCOP(saldo)}; confirma abonos antes de la entrega y prioriza las fechas más próximas.` : 'No hay encargos registrados en el período seleccionado. Amplía el rango o captura nuevos pedidos para construir el análisis.';
    document.getElementById('alertasInforme').innerHTML = `<span><i class="fa-solid fa-clock"></i> ${pendientes.length} pedidos requieren seguimiento</span><span><i class="fa-solid fa-box-open"></i> ${bajos.length} productos con 15 unidades o menos</span>`;
    document.getElementById('resumenStock').textContent = bajos.length ? `${bajos.length} productos están en nivel de reposición (15 unidades o menos).` : 'No hay productos por debajo del umbral configurado de 15 unidades.';
    document.getElementById('listaStockBajo').innerHTML = bajos.length ? bajos.map(producto => `<span><b>${escapar(producto.nombre)}</b><strong>${Number(producto.stock)} un.</strong></span>`).join('') : '<span class="stock-ok"><i class="fa-solid fa-circle-check"></i> Existencias dentro del umbral</span>';
    document.getElementById('tbInformeEncargos').innerHTML = encargos.length ? encargos.map(encargo => `<tr><td>${new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${encargo.fecha}T12:00:00`))}</td><td><strong>${escapar(encargo.cliente)}</strong><small>${escapar(encargo.detalle)}</small></td><td><span class="report-state ${claseEstado(encargo.estado)}">${escapar(encargo.estado)}</span></td><td>${formatoCOP(encargo.total)}</td><td>${formatoCOP(encargo.abono)}</td><td><strong>${formatoCOP(Math.max(0, encargo.total - encargo.abono))}</strong></td></tr>`).join('') : '<tr><td colspan="6" class="report-no-data">Sin encargos en este período.</td></tr>';
    document.getElementById('tbInformeProductos').innerHTML = db.productos.map(producto => {
        const margenUnidad = Number(producto.precio) - Number(producto.costoProd);
        const porcentaje = Number(producto.precio) ? `${(margenUnidad / Number(producto.precio) * 100).toFixed(1).replace('.', ',')}%` : '—';
        return `<tr><td><strong>${escapar(producto.nombre)}</strong></td><td>${formatoCOP(producto.precio)}</td><td>${formatoCOP(producto.costoProd)}</td><td><strong>${formatoCOP(margenUnidad)}</strong><small>${porcentaje} del precio</small></td></tr>`;
    }).join('');
    const canvas = document.getElementById('graficaEstadosEncargo');
    if (canvas && typeof Chart !== 'undefined') {
        if (graficaInforme) graficaInforme.destroy();
        const estados = ['PENDIENTE', 'EN PREPARACIÓN', 'LISTO', 'PAGADO', 'ENTREGADO'];
        const valores = estados.map(estado => encargos.filter(encargo => encargo.estado === estado).length);
        graficaInforme = new Chart(canvas.getContext('2d'), { type: 'doughnut', data: { labels: estados, datasets: [{ data: valores, backgroundColor: ['#e7a641', '#5c8a77', '#68a9bd', '#28745f', '#aebbb2'], borderWidth: 0, hoverOffset: 5 }] }, options: { maintainAspectRatio: false, cutout: '68%', plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, padding: 18 } } } } });
    }
}

function descargarInformePDF() {
    if (typeof html2pdf === 'undefined') {
        alert('El exportador PDF no se cargó. Comprueba tu conexión a internet.');
        return;
    }
    html2pdf().set({ margin: 0.35, filename: 'PANAPP-informe-de-gestion.pdf', image: { type: 'jpeg', quality: 0.96 }, html2canvas: { scale: 2, useCORS: true }, jsPDF: { unit: 'in', format: 'a4', orientation: 'landscape' } }).from(document.getElementById('informeImprimible')).save();
}

window.addEventListener('storage', event => {
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    try {
        db = { ...datosIniciales, ...JSON.parse(event.newValue) };
        configuracionMenu = { ...configuracionInicial, ...(db.configuracionMenu || {}) };
        perfilEmpresa = { ...perfilEmpresaInicial, ...(db.perfilEmpresa || {}) };
        renderizarTodo();
        generarQR();
        iniciarGrafica();
    } catch (error) {
        console.warn('No se pudo sincronizar la pestaña con los cambios recientes.', error);
    }
});
