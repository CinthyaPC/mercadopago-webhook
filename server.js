
const express = require("express");
const crypto = require("crypto");

const app = express();
app.use(express.json({ limit: "20kb" }));

const PORT = process.env.PORT || 3000;
const MP_API = "https://api.mercadopago.com";

const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const MP_USER_ID = process.env.MP_USER_ID;
const ADMIN_KEY = process.env.ADMIN_KEY;
const ESP32_API_KEY = process.env.ESP32_API_KEY;

// Identificadores exclusivos de producción
const STORE_EXTERNAL_ID = "sistemastecniiprod";
const POS_EXTERNAL_ID = "caja1sistemastecnii";

const STORE_NAME = "Sistemas Tecn II";
const POS_NAME = "Caja 1 Sistemas Tecn II";

function checkConfig() {
  const missing = [
    ["MP_ACCESS_TOKEN", MP_ACCESS_TOKEN],
    ["MP_USER_ID", MP_USER_ID],
    ["ADMIN_KEY", ADMIN_KEY],
    ["ESP32_API_KEY", ESP32_API_KEY]
  ].filter(([, value]) => !value).map(([name]) => name);

  if (missing.length) {
    throw new Error("Faltan variables en Render: " + missing.join(", "));
  }
}

async function mpRequest(path, options = {}) {
  const response = await fetch(`${MP_API}${path}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {})
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(
      data.message || data.error || `Error HTTP ${response.status}`
    );
    error.status = response.status;
    error.details = data;
    throw error;
  }

  return data;
}

function adminAuth(req, res, next) {
  if (req.get("x-admin-key") !== ADMIN_KEY) {
    return res.status(401).json({ error: "Clave de administrador incorrecta" });
  }
  next();
}

function esp32Auth(req, res, next) {
  if (req.get("x-device-key") !== ESP32_API_KEY) {
    return res.status(401).json({ error: "Dispositivo no autorizado" });
  }
  next();
}

function uuidV4(value) {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

app.get("/", (req, res) => {
  res.send("Servidor Mercado Pago de producción funcionando");
});

// CONFIGURAR SUCURSAL Y CAJA DE PRODUCCIÓN
app.post("/admin/configurar-produccion", adminAuth, async (req, res) => {
  try {
    checkConfig();

    // Buscar sucursal. Un 404 store_not_found significa que aún no existe.
    let stores = [];

    try {
      const result = await mpRequest(
        `/users/${MP_USER_ID}/stores/search?external_id=${STORE_EXTERNAL_ID}`
      );
      stores = Array.isArray(result.results) ? result.results : [];
    } catch (error) {
      if (
        error.status !== 404 ||
        error.details?.error !== "store_not_found"
      ) {
        throw error;
      }
    }

    let store = stores.find(
      item => item.external_id === STORE_EXTERNAL_ID
    );

    // Crear sucursal si no existe.
    if (!store) {
      store = await mpRequest(`/users/${MP_USER_ID}/stores`, {
        method: "POST",
        body: {
          name: STORE_NAME,
          external_id: STORE_EXTERNAL_ID,
          location: {
            street_name: "San Matías",
            street_number: "88",
            city_name: "San Fernando del Valle de Catamarca",
            state_name: "Catamarca",
            latitude: -28.495044,
            longitude: -65.803691,
            reference: "San Matías 88"
          }
        }
      });
    }

    if (!store.id) {
      throw new Error("La API no devolvió el ID de la sucursal");
    }

    // Buscar caja por identificador externo y sucursal.
    const posSearch = await mpRequest(
      `/v2/pos?external_id=${POS_EXTERNAL_ID}&store_id=${encodeURIComponent(String(store.id))}`
    );

    const positions = Array.isArray(posSearch.data)
      ? posSearch.data
      : [];

    let pos = positions.find(item =>
      item.external_id === POS_EXTERNAL_ID &&
      String(item.store_id) === String(store.id)
    );

    // Crear caja si no existe.
    if (!pos) {
      pos = await mpRequest("/v2/pos", {
        method: "POST",
        headers: {
          "X-Idempotency-Key": crypto.randomUUID()
        },
        body: {
          name: POS_NAME,
          store_id: String(store.id),
          external_id: POS_EXTERNAL_ID,
          config: {
            qr: {
              operating_mode: "pdv"
            }
          }
        }
      });
    }

    if (!pos.id) {
      throw new Error("La API no devolvió el ID de la caja");
    }

    if (pos.status !== "active") {
      throw new Error(`La caja no está activa. Estado: ${pos.status}`);
    }

    if (!pos.qr_response?.image) {
      throw new Error("La caja no devolvió la imagen del QR");
    }

    res.json({
      resultado: "Configuración de producción correcta",
      sucursal: {
        nombre: store.name,
        id: store.id,
        external_id: STORE_EXTERNAL_ID
      },
      caja: {
        nombre: pos.name,
        id: pos.id,
        external_id: POS_EXTERNAL_ID,
        estado: pos.status
      },
      qr: {
        imagen: pos.qr_response.image,
        codigo: pos.qr_response.qr_code,
        plantilla_pdf: pos.qr_response.template_document,
        plantilla_imagen: pos.qr_response.template_image
      }
    });

  } catch (error) {
    console.error("CONFIGURACIÓN:", error.details || error.message);
    res.status(error.status || 500).json({
      error: "No se pudo configurar la sucursal y la caja",
      detalle: error.details || error.message
    });
  }
});

// CREAR ORDEN DE COBRO DESDE EL ESP32
app.post("/esp32/crear-orden", esp32Auth, async (req, res) => {
  try {
    checkConfig();

    const monto = Number(req.body.monto);
    const requestId = req.body.request_id;

    if (!Number.isFinite(monto) || monto <= 0 || monto > 1000000) {
      return res.status(400).json({
        error: "Importe inválido. Debe ser mayor que cero y hasta $1.000.000."
      });
    }

    if (!uuidV4(requestId)) {
      return res.status(400).json({
        error: "request_id debe ser un UUID versión 4."
      });
    }

    const importe = monto.toFixed(2);

    const order = await mpRequest("/v1/orders", {
      method: "POST",
      headers: {
        "X-Idempotency-Key": requestId
      },
      body: {
        type: "qr",
        total_amount: importe,
        description: "Compra - Caja 1 Sistemas Tecn II",
        external_reference: `ESP32-${requestId}`,
        expiration_time: "PT15M",
        config: {
          qr: {
            external_pos_id: POS_EXTERNAL_ID,
            mode: "static"
          }
        },
        transactions: {
          payments: [
            { amount: importe }
          ]
        }
      }
    });

    res.status(201).json({
      order_id: order.id,
      monto: importe,
      estado: order.status,
      referencia: order.external_reference
    });

  } catch (error) {
    console.error("CREAR ORDEN:", error.details || error.message);
    res.status(error.status || 500).json({
      error: "No se pudo crear la orden",
      detalle: error.details || error.message
    });
  }
});

// CONSULTAR EL ESTADO REAL DE LA ORDEN EN MERCADO PAGO
app.get("/esp32/estado/:orderId", esp32Auth, async (req, res) => {
  try {
    checkConfig();

    const orderId = req.params.orderId;

    if (!/^[A-Za-z0-9_-]{10,60}$/.test(orderId)) {
      return res.status(400).json({ error: "ID de orden inválido" });
    }

    const order = await mpRequest(
      `/v1/orders/${encodeURIComponent(orderId)}`
    );

    // La orden debe pertenecer a esta integración.
    if (
      typeof order.external_reference !== "string" ||
      !order.external_reference.startsWith("ESP32-")
    ) {
      return res.status(403).json({
        error: "La orden no pertenece a este sistema",
        paid: false
      });
    }

    const payments = order.transactions?.payments || [];
    const payment = payments[0];

    const paid =
      order.status === "processed" &&
      order.status_detail === "processed" &&
      payment?.status === "processed" &&
      payment?.status_detail === "accredited" &&
      Number(order.total_amount) > 0 &&
      Math.abs(
        Number(order.total_amount) - Number(payment.amount)
      ) < 0.01;

    res.json({
      order_id: order.id,
      estado: order.status,
      detalle: order.status_detail,
      estado_pago: payment?.status || null,
      detalle_pago: payment?.status_detail || null,
      monto: order.total_amount,
      paid
    });

  } catch (error) {
    console.error("CONSULTAR PAGO:", error.details || error.message);
    res.status(error.status || 500).json({
      error: "No se pudo verificar el pago",
      paid: false,
      detalle: error.details || error.message
    });
  }
});

// Errores de formato JSON
app.use((error, req, res, next) => {
  if (error instanceof SyntaxError && error.status === 400) {
    return res.status(400).json({ error: "El JSON enviado no es válido" });
  }
  next(error);
});

app.listen(PORT, () => {
  console.log(`Servidor de producción activo en puerto ${PORT}`);
});
