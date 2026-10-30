const express = require("express");

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Servidor Mercado Pago funcionando");
});

app.post("/webhooks/mercadopago", (req, res) => {
  console.log("NOTIFICACION MERCADO PAGO");
  console.log("Tipo:", req.query.type);
  console.log("ID:", req.query["data.id"]);
  console.log("Datos:", req.body);

  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Servidor iniciado en puerto", PORT);
});
