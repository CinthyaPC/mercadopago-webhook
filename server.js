
const express = require("express");

const app = express();
app.use(express.json());

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

// Consulta privada de cajas
app.get("/admin/cajas", async (req, res) => {
  const adminKey = process.env.ADMIN_KEY;
  const receivedKey = req.get("x-admin-key");

  if (!adminKey || receivedKey !== adminKey) {
    return res.sendStatus(401);
  }

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

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    res.json(data);
  } catch (error) {
    console.error("Error consultando cajas:", error.message);
    res.status(500).json({ error: "Error al consultar Mercado Pago" });
  }
});

app.get("/admin/mi-cuenta", async (req, res) => {
  if (!process.env.ADMIN_KEY ||
      req.get("x-admin-key") !== process.env.ADMIN_KEY) {
    return res.sendStatus(401);
  }

  try {
    const response = await fetch("https://api.mercadopago.com/users/me", {
      headers: {
        Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`
      }
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data.message || "Error consultando la cuenta"
      });
    }

    res.json({
      user_id: data.id,
      nickname: data.nickname
    });
  } catch (error) {
    res.status(500).json({ error: "Error de conexión" });
  }
});

app.get("/admin/locales", async (req, res) => {
  if (!process.env.ADMIN_KEY ||
      req.get("x-admin-key") !== process.env.ADMIN_KEY) {
    return res.sendStatus(401);
  }

  try {
    const userId = process.env.MP_USER_ID;

    if (!userId) {
      return res.status(500).json({
        error: "Falta configurar MP_USER_ID en Render"
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
    res.status(500).json({
      error: "Error consultando sucursales"
    });
  }
});

app.post("/admin/crear-sucursal", async (req, res) => {
  if (!process.env.ADMIN_KEY ||
      req.get("x-admin-key") !== process.env.ADMIN_KEY) {
    return res.sendStatus(401);
  }

  const token = process.env.MP_TEST_ACCESS_TOKEN;
  const userId = process.env.MP_TEST_USER_ID;

  if (!token || !userId) {
    return res.status(500).json({
      error: "Faltan las credenciales de prueba en Render"
    });
  }

  try {
    const response = await fetch(
      `https://api.mercadopago.com/users/${userId}/stores`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          name: "Sistemas Tecn II",
          business_hours: {
            monday: [{ open: "00:00", close: "23:59" }],
            tuesday: [{ open: "00:00", close: "23:59" }],
            wednesday: [{ open: "00:00", close: "23:59" }],
            thursday: [{ open: "00:00", close: "23:59" }],
            friday: [{ open: "00:00", close: "23:59" }],
            saturday: [{ open: "00:00", close: "23:59" }],
            sunday: [{ open: "00:00", close: "23:59" }]
          },
          location: {
            street_name: "San Martín",
            street_number: "717",
            city_name: "San Fernando del Valle de Catamarca",
            state_name: "Catamarca",
            latitude: -28.46945,
            longitude: -65.77659,
            reference: "Proyecto académico - ubicación simulada"
          },
          external_id: "sistemas-tecn-ii"
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    res.json(data);

  } catch (error) {
    console.error("Error creando sucursal:", error.message);
    res.status(500).json({
      error: "No se pudo conectar con Mercado Pago"
    });
  }
});


app.post("/admin/crear-caja", async (req, res) => {
  if (!process.env.ADMIN_KEY ||
      req.get("x-admin-key") !== process.env.ADMIN_KEY) {
    return res.sendStatus(401);
  }

  try {
    const response = await fetch(
      "https://api.mercadopago.com/v2/pos",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.MP_TEST_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
          "X-Idempotency-Key": require("crypto").randomUUID()
        },
        body: JSON.stringify({
          name: "Caja 1 Sistemas Tecn II",
          store_id: "82632443",
          external_id: "caja1sistemastecnii",
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
    res.status(500).json({
      error: error.message
    });
  }
});
  }

  try {
    const response = await fetch(
      "https://api.mercadopago.com/pos",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          name: "Caja 1 - Sistemas Tecn II",
          fixed_amount: false,
          store_id: 82632443,
          external_id: "caja-1-sistemas-tecn-ii",
          category: 621102
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    res.json(data);

  } catch (error) {
    res.status(500).json({
      error: "Error creando caja de prueba"
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Servidor iniciado en puerto", PORT);
});
