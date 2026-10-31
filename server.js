
const express = require("express");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Credenciales y datos guardados en Render
const ADMIN_KEY = process.env.ADMIN_KEY;
const MP_TEST_ACCESS_TOKEN = process.env.MP_TEST_ACCESS_TOKEN;
const POS_ID = "140168467";

// Comprobar que el administrador está autorizado
function verificarAdmin(req, res, next) {
  const clave = req.headers["x-admin-key"];

  if (!ADMIN_KEY || clave !== ADMIN_KEY) {
    return res.status(401).json({
      error: "No autorizado"
    });
  }

  next();
}

// Página principal
app.get("/", (req, res) => {
  res.send("Servidor Mercado Pago funcionando");
});

// Consultar la caja y obtener los datos de su QR
app.get("/admin/caja", verificarAdmin, async (req, res) => {
  try {
    if (!MP_TEST_ACCESS_TOKEN) {
      return res.status(500).json({
        error: "Falta configurar MP_TEST_ACCESS_TOKEN en Render"
      });
    }

    const respuesta = await fetch(
      `https://api.mercadopago.com/v2/pos/${POS_ID}`,
      {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${MP_TEST_ACCESS_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );

    const datos = await respuesta.json();

    if (!respuesta.ok) {
      return res.status(respuesta.status).json({
        error: "Mercado Pago no pudo consultar la caja",
        detalle: datos
      });
    }

    return res.json({
      caja: {
        id: datos.id,
        nombre: datos.name,
        estado: datos.status,
        sucursal: datos.store_id
      },
      qr: datos.qr_response || null,
      configuracion: datos.config || null
    });

  } catch (error) {
    console.error("Error consultando caja:", error);

    return res.status(500).json({
      error: "Error interno al consultar la caja"
    });
  }
});

// Mantener la ruta anterior de verificación
app.get("/admin/verificar-prueba", verificarAdmin, async (req, res) => {
  try {
    if (!MP_TEST_ACCESS_TOKEN) {
      return res.status(500).json({
        error: "Falta configurar MP_TEST_ACCESS_TOKEN"
      });
    }

    const respuesta = await fetch(
      `https://api.mercadopago.com/v2/pos/${POS_ID}`,
      {
        headers: {
          "Authorization": `Bearer ${MP_TEST_ACCESS_TOKEN}`
        }
      }
    );

    const datos = await respuesta.json();

    return res.status(respuesta.status).json({
      caja: datos
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error: "No se pudo verificar la caja"
    });
  }
});

// Recepción inicial de notificaciones de Mercado Pago
app.post("/webhooks/mercadopago", (req, res) => {
  console.log("Notificación recibida:", req.body);

  res.sendStatus(200);
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`Servidor funcionando en puerto ${PORT}`);
});
