
const express = require("express");
const crypto = require("crypto");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const MP_API = "https://api.mercadopago.com";

const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const MP_USER_ID = process.env.MP_USER_ID;
const ADMIN_KEY = process.env.ADMIN_KEY;
const ESP32_API_KEY = process.env.ESP32_API_KEY;

// Identificadores exclusivos de PRODUCCIÓN
const STORE_EXTERNAL_ID = "sistemastecniiprod";
const POS_EXTERNAL_ID = "caja1sistemastecnii";

const STORE_NAME = "Sistemas Tecn II";
const POS_NAME = "Caja 1 Sistemas Tecn II";

function checkConfiguration() {
  const missing = [];
  if (!MP_ACCESS_TOKEN) missing.push("MP_ACCESS_TOKEN");
  if (!MP_USER_ID) missing.push("MP_USER_ID");
  if (!ADMIN_KEY) missing.push("ADMIN_KEY");
  if (!ESP32_API_KEY) missing.push("ESP32_API_KEY");

  if (missing.length) {
    throw new Error("Faltan variables de entorno: " + missing.join(", "));
  }
}

async function mpRequest(path, options = {}) {
  const response = await fetch(MP_API + path, {
    ...options,
    headers: {
      Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(
      data.message || data.error || `Mercado Pago respondió HTTP ${response.status}`
    );
    error.status = response.status;
    error.details = data;
    throw error;
  }

  return data;
}

function requireAdmin(req, res, next) {
  if (req.get("x-admin-key") !== ADMIN_KEY) {
    return res.status(401).json({ error: "No autorizado" });
  }
  next();
}

function requireESP32(req, res, next) {
  if (req.get("x-device-key") !== ESP32_API_KEY) {
    return res.status(401).json({ error: "Dispositivo no autorizado" });
  }
  next();
}

function uuidValido(value) {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

// Estado del servidor
app.get("/", (req, res) => {
  res.send("Servidor Mercado Pago de producción funcionando");
});

// 1. Crear o recuperar la sucursal y la Caja 1.
// Ejecutar esta ruta UNA SOLA VEZ desde el administrador.
app.post("/admin/configurar-produccion", requireAdmin, async (req, res) => {
  try {
    checkConfiguration();

    // Buscar la sucursal por su identificador externo.
    const storeSearch = await mpRequest(
      `/users/${MP_USER_ID}/stores/search?external_id=${STORE_EXTERNAL_ID}`
    );

    const stores = Array.isArray(storeSearch)
      ? storeSearch.flatMap(item => item.results || [])
      : (storeSearch.results || []);

    let store = stores.find(item =>
      item.external_id === STORE_EXTERNAL_ID
    );

    // Si no existe, crearla.
    if (!store) {
      store = await mpRequest(`/users/${MP_USER_ID}/stores`, {
        method: "POST",
        body: JSON.stringify({
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
        })
      });
    }

    if (!store.id) {
      throw new Error("Mercado Pago no devolvió el ID de la sucursal");
    }

    // Buscar la caja dentro de esa sucursal.
    const posSearch = await mpRequest(
      `/v2/pos?external_id=${POS_EXTERNAL_ID}&store_id=${store.id}`
    );

    let pos = (posSearch.data || []).find(item =>
      item.external_id === POS_EXTERNAL_ID &&
      String(item.store_id) === String(store.id)
    );

    // Si no existe, crearla en modo atendido (PDV).
    if (!pos) {
      pos = await mpRequest("/v2/pos", {
        method: "POST",
        headers: {
          "X-Idempotency-Key": crypto.randomUUID()
        },
        body: JSON.stringify({
          name: POS_NAME,
          store_id: String(store.id),
          external_id: POS_EXTERNAL_ID,
          config: {
            qr: {
              operating_mode: "pdv"
            }
          }
        })
      });
    }

    if (!pos.id || !pos.qr_response || !pos.qr_response.image) {
      throw new Error("La caja no devolvió su QR. Revisá la respuesta de Mercado Pago.");
    }

    if (pos.status !== "active") {
      throw new Error("La Caja 1 no está activa en Mercado Pago");
    }

    res.json({
      resultado: "Sucursal y caja de producción configuradas",
      sucursal: {
        nombre: STORE_NAME,
        id: store.id,
        external_id: STORE_EXTERNAL_ID
      },
      caja: {
        nombre: POS_NAME,
        id: pos.id,
        external_id: POS_EXTERNAL_ID,
        estado: pos.status
      },
      qr: {
        imagen: pos.qr_response.image,
        plantilla_pdf: pos.qr_response.template_document,
        plantilla_imagen: pos.qr_response.template_image
      }
    });

  } catch (error) {
    console.error("Error configurando producción:", error.details || error.message);
    res.status(error.status || 500).json({
      error: "No se pudo configurar la sucursal y la caja",
      detalle: error.details || error.message
    });
  }
});

// 2. Crear una orden de cobro.
// El ESP32 debe enviar un request_id UUID v4 único por cada cobro.
app.post("/esp32/crear-orden", requireESP32, async (req, res) => {
  try {
    checkConfiguration();

    const { monto, request_id } = req.body;

    if (!Number.isFinite(monto) || monto <= 0 || monto > 1000000) {
      return res.status(400).json({
        error: "El monto debe ser mayor que cero y no superar $1.000.000"
      });
    }

    if (!uuidValido(request_id)) {
      return res.status(400).json({
        error: "request_id debe ser un UUID versión 4"
      });
    }

    const montoPesos = Number(monto).toFixed(2);
    const referencia = `ESP32-${request_id}`;

    const order = await mpRequest("/v1/orders", {
      method: "POST",
      headers: {
        "X-Idempotency-Key": request_id
      },
      body: JSON.stringify({
        type: "qr",
        total_amount: montoPesos,
        description: "Compra - Caja 1 Sistemas Tecn II",
        external_reference: referencia,
        expiration_time: "PT15M",
        config: {
          qr: {
            external_pos_id: POS_EXTERNAL_ID,
            mode: "static"
          }
        },
        transactions: {
          payments: [
            {
              amount: montoPesos
            }
          ]
        }
      })
    });

    res.status(201).json({
      order_id: order.id,
      monto: montoPesos,
      estado: order.status,
      vence_en: order.expiration_time || null
    });

  } catch (error) {
    console.error("Error creando orden:", error.details || error.message);
    res.status(error.status || 500).json({
      error: "No se pudo crear la orden de pago",
      detalle: error.details || error.message
    });
  }
});

// 3. Consultar directamente a Mercado Pago si el pago fue acreditado.
app.get("/esp32/estado/:orderId", requireESP32, async (req, res) => {
  try {
    checkConfiguration();

    const orderId = req.params.orderId;

    if (!/^ORD[A-Za-z0-9]{26}$/.test(orderId)) {
      return res.status(400).json({ error: "ID de orden inválido" });
    }

    const order = await mpRequest(
      `/v1/orders/${encodeURIComponent(orderId)}`
    );

    // Comprobar que la orden pertenece a este sistema.
    if (
      typeof order.external_reference !== "string" ||
      !order.external_reference.startsWith("ESP32-")
    ) {
      return res.status(403).json({
        error: "La orden no pertenece a este sistema",
        paid: false
      });
    }

    const payment = order.transactions &&
      order.transactions.payments &&
      order.transactions.payments[0];

    const montoOrden = Number(order.total_amount);
    const montoPago = payment ? Number(payment.amount) : NaN;

    const acreditado =
      order.status === "processed" &&
      payment &&
      payment.status === "processed" &&
      payment.status_detail === "accredited" &&
      Number.isFinite(montoOrden) &&
      Number.isFinite(montoPago) &&
      Math.abs(montoOrden - montoPago) < 0.01;

    res.json({
      order_id: order.id,
      estado: order.status,
      estado_pago: payment ? payment.status : null,
      detalle_pago: payment ? payment.status_detail : null,
      monto: order.total_amount,
      paid: Boolean(acreditado)
    });

  } catch (error) {
    console.error("Error consultando orden:", error.details || error.message);
    res.status(error.status || 500).json({
      error: "No se pudo verificar el pago",
      paid: false,
      detalle: error.details || error.message
    });
  }
});

// Errores de JSON
app.use((error, req, res, next) => {
  if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
    return res.status(400).json({ error: "JSON inválido" });
  }
  next(error);
});

app.listen(PORT, () => {
  console.log(`Servidor activo en puerto ${PORT}`);
});
