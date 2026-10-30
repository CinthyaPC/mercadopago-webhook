
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

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Servidor iniciado en puerto", PORT);
});
