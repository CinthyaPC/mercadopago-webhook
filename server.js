
const express = require("express");

const app = express();
const crypto = require("crypto");

app.use(express.json());

const STORE_ID = "82632443";
const POS_EXTERNAL_ID = "caja1sistemastecnii";

// Página principal
app.get("/", (req, res) => {
  res.send("Servidor Mercado Pago funcionando");
});

// Notificaciones de Mercado Pago
app.post("/webhooks/mercadopago", (req, res) => {
  console.log("NOTIFICACION MERCADO PAGO");
  console.log("Tipo:", req.query.type);
  console.log("ID:", req.query["data.id"]);
  console.log("Datos:", req.body);

  res.sendStatus(200);
});

// Función para proteger las rutas administrativas
function adminAutorizado(req, res) {
  if (
    !process.env.ADMIN_KEY ||
    req.get("x-admin-key") !== process.env.ADMIN_KEY
  ) {
    res.sendStatus(401);
    return false;
  }

  return true;
}

// Consultar cajas de producción
app.get("/admin/cajas", async (req, res) => {
  if (!adminAutorizado(req, res)) return;

  try {
    const response = await fetch(
      "https://api.mercadopago.com/v2/pos?limit=30&offset=0",
      {
        headers: {
          Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`
        }
      }
    );

    const data = await response.json();
    res.status(response.status).json(data);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Consultar cuenta de producción
app.get("/admin/mi-cuenta", async (req, res) => {
  if (!adminAutorizado(req, res)) return;

  try {
    const response = await fetch(
      "https://api.mercadopago.com/users/me",
      {
        headers: {
          Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`
        }
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    res.json({
      user_id: data.id,
      nickname: data.nickname
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Consultar sucursales de producción
app.get("/admin/locales", async (req, res) => {
  if (!adminAutorizado(req, res)) return;

  try {
    const userId = process.env.MP_USER_ID;

    if (!userId || !process.env.MP_ACCESS_TOKEN) {
      return res.status(500).json({
        error: "Faltan las credenciales de producción"
      });
    }

    const response = await fetch(
      `https://api.mercadopago.com/users/${userId}/stores/search`,
      {
        headers: {
          Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`
        }
      }
    );

    const data = await response.json();
    res.status(response.status).json(data);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Verificar sucursal y cajas de prueba
app.get("/admin/verificar-prueba", async (req, res) => {
  if (!adminAutorizado(req, res)) return;

  const token = process.env.MP_TEST_ACCESS_TOKEN;

  if (!token) {
    return res.status(500).json({
      error: "Falta MP_TEST_ACCESS_TOKEN"
    });
  }

  try {
    const [storeResponse, posResponse] = await Promise.all([
      fetch(
        `https://api.mercadopago.com/stores/${STORE_ID}`,
        {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      ),

      fetch(
        "https://api.mercadopago.com/v2/pos?limit=30&offset=0",
        {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      )
    ]);

    const storeData = await storeResponse.json();
    const posData = await posResponse.json();

    const cajas = Array.isArray(posData.data)
      ? posData.data.filter(
          caja => String(caja.store_id) === STORE_ID
        )
      : [];

    res.json({
      sucursal: {
        status: storeResponse.status,
        datos: storeData
      },
      cajas: {
        status: posResponse.status,
        resultados: cajas
      }
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Crear Caja 1 de prueba
app.post("/admin/crear-caja", async (req, res) => {
  if (!adminAutorizado(req, res)) return;

  const token = process.env.MP_TEST_ACCESS_TOKEN;

  if (!token) {
    return res.status(500).json({
      error: "Falta MP_TEST_ACCESS_TOKEN"
    });
  }

  try {
    const response = await fetch(
      "https://api.mercadopago.com/v2/pos",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",

          // Mantener esta clave para esta misma creación.
          "X-Idempotency-Key":
            "6e5e9c21-6a80-4e2d-9a11-826324430001"
        },
        body: JSON.stringify({
          name: "Caja 1 Sistemas Tecn II",
          store_id: STORE_ID,
          external_id: POS_EXTERNAL_ID,
          config: {
            qr: {
              operating_mode: "pdv"
            }
          }
        })
      }
    );

    const data = await response.json();
    res.status(response.status).json(data);

  } catch (error) {
    console.error("Error creando caja:", error.message);

    res.status(500).json({
      error: "No se pudo crear la caja de prueba"
    });
  }
});

// Inicio del servidor
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Servidor iniciado en puerto", PORT);
});
