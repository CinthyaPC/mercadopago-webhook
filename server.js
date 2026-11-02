
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

// Datos de la sucursal y Caja 1 ya creadas en Mercado Pago
const STORE_EXTERNAL_ID = "sistemastecniiprod";
const POS_EXTERNAL_ID = "caja1sistemastecnii";


// --------------------------------------------------
// VERIFICAR CONFIGURACIÓN
// --------------------------------------------------

function checkConfig() {
  const missing = [];

  if (!MP_ACCESS_TOKEN) missing.push("MP_ACCESS_TOKEN");
  if (!MP_USER_ID) missing.push("MP_USER_ID");
  if (!ADMIN_KEY) missing.push("ADMIN_KEY");
  if (!ESP32_API_KEY) missing.push("ESP32_API_KEY");

  if (missing.length > 0) {
    throw new Error(
      "Faltan variables de entorno: " + missing.join(", ")
    );
  }
}


// --------------------------------------------------
// COMUNICACIÓN CON MERCADO PAGO
// --------------------------------------------------

async function mpRequest(path, options = {}) {
  const response = await fetch(MP_API + path, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...(options.body
      ? { body: JSON.stringify(options.body) }
      : {})
  });

  const responseText = await response.text();

  let data;

  try {
    data = responseText ? JSON.parse(responseText) : {};
  } catch {
    data = { message: responseText };
  }

  if (!response.ok) {
    const error = new Error("Error en Mercado Pago");
    error.status = response.status;
    error.details = data;
    throw error;
  }

  return data;
}


// --------------------------------------------------
// AUTENTICACIÓN
// --------------------------------------------------

function adminAuth(req, res, next) {
  if (req.headers["x-admin-key"] !== ADMIN_KEY) {
    return res.status(401).json({
      error: "No autorizado"
    });
  }

  next();
}


function esp32Auth(req, res, next) {
  if (req.headers["x-device-key"] !== ESP32_API_KEY) {
    return res.status(401).json({
      error: "Dispositivo no autorizado"
    });
  }

  next();
}


// --------------------------------------------------
// VALIDACIONES
// --------------------------------------------------

function esUUIDv4(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}


function validarMonto(value) {
  const monto = Number(value);

  if (!Number.isFinite(monto) || monto <= 0 || monto > 1000000) {
    return null;
  }

  return monto.toFixed(2);
}


// --------------------------------------------------
// INICIO / ESTADO DEL SERVIDOR
// --------------------------------------------------

app.get("/", (req, res) => {
  res.json({
    servidor: "Sistemas Tecn II",
    estado: "funcionando",
    sucursal: STORE_EXTERNAL_ID,
    caja: POS_EXTERNAL_ID
  });
});


// --------------------------------------------------
// PRUEBA: CREAR UNA ORDEN REAL DE $50
// --------------------------------------------------

app.post("/prueba/cobrar-50", adminAuth, async (req, res) => {
  try {
    checkConfig();

    const requestId = crypto.randomUUID();
    const importe = "50.00";

    const order = await mpRequest("/v1/orders", {
      method: "POST",

      headers: {
        "X-Idempotency-Key": requestId
      },

      body: {
        type: "qr",
        total_amount: importe,
        description: "Prueba de cobro - Sistemas Tecn II",
        external_reference: `PRUEBA-${requestId}`,
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
              amount: importe
            }
          ]
        }
      }
    });

    res.status(201).json({
      mensaje: "Orden creada correctamente",
      order_id: order.id,
      monto: order.total_amount,
      estado: order.status,
      referencia: order.external_reference
    });

  } catch (error) {
    console.error(
      "ERROR PRUEBA:",
      error.details || error.message
    );

    res.status(error.status || 500).json({
      error: "No se pudo crear la orden",
      detalle: error.details || error.message
    });
  }
});


// --------------------------------------------------
// ESP32: CREAR UNA ORDEN CON EL MONTO INDICADO
// --------------------------------------------------

app.post("/esp32/crear-orden", esp32Auth, async (req, res) => {
  try {
    checkConfig();

    const importe = validarMonto(req.body.monto);
    const requestId = req.body.request_id;

    if (!importe) {
      return res.status(400).json({
        error: "El monto no es válido"
      });
    }

    if (!esUUIDv4(requestId)) {
      return res.status(400).json({
        error: "request_id debe ser un UUID versión 4"
      });
    }

    const order = await mpRequest("/v1/orders", {
      method: "POST",

      headers: {
        "X-Idempotency-Key": requestId
      },

      body: {
        type: "qr",
        total_amount: importe,
        description: "Compra - Sistemas Tecn II",
        external_reference: `ESP32-${requestId}`,
        expiration_time: "PT3M",

        config: {
          qr: {
            external_pos_id: POS_EXTERNAL_ID,
            mode: "static"
          }
        },

        transactions: {
          payments: [
            {
              amount: importe
            }
          ]
        }
      }
    });

    res.status(201).json({
      mensaje: "Orden creada",
      order_id: order.id,
      monto: order.total_amount,
      estado: order.status,
      referencia: order.external_reference
    });

  } catch (error) {
    console.error(
      "ERROR CREAR ORDEN:",
      error.details || error.message
    );

    res.status(error.status || 500).json({
      error: "No se pudo crear la orden",
      detalle: error.details || error.message
    });
  }
});


// --------------------------------------------------
// ESP32: CONSULTAR SI LA ORDEN FUE PAGADA
// --------------------------------------------------

app.get("/esp32/estado/:orderId", esp32Auth, async (req, res) => {
  try {
    checkConfig();

    const orderId = req.params.orderId;

    if (!orderId || !/^[a-zA-Z0-9_-]+$/.test(orderId)) {
      return res.status(400).json({
        error: "Identificador de orden no válido"
      });
    }

    const order = await mpRequest(
      `/v1/orders/${encodeURIComponent(orderId)}`
    );

    // Verificar que la orden pertenezca a este sistema
    if (
      typeof order.external_reference !== "string" ||
      !order.external_reference.startsWith("ESP32-")
    ) {
      return res.status(403).json({
        error: "La orden no pertenece a este dispositivo"
      });
    }

    // Mercado Pago informa la acreditación en el estado
    // de la orden: processed / accredited.
    const pagado =
      order.status === "processed" &&
      order.status_detail === "accredited";

    res.json({
      order_id: order.id,
      monto: order.total_amount,
      estado: order.status,
      detalle: order.status_detail,
      pagado: pagado
    });

  } catch (error) {
    console.error(
      "ERROR CONSULTAR PAGO:",
      error.details || error.message
    );

    res.status(error.status || 500).json({
      error: "No se pudo consultar el pago",
      detalle: error.details || error.message
    });
  }
});


// --------------------------------------------------
// ERRORES GENERALES
// --------------------------------------------------

app.use((req, res) => {
  res.status(404).json({
    error: "Ruta no encontrada"
  });
});


// --------------------------------------------------
// INICIAR SERVIDOR
// --------------------------------------------------

app.listen(PORT, () => {
  console.log(`Servidor funcionando en puerto ${PORT}`);
});
