'use strict';

const express = require('express');
const { processarPartidaRadar } = require('./src/radarProcessor');

const app = express();
app.use(express.json({ limit: '1mb' }));

/**
 * POST /processar-partida
 * Body: payload do Radar Engine (ver contrato de entrada no README)
 */
app.post('/processar-partida', async (req, res) => {
  const resultado = await processarPartidaRadar(req.body);

  // Erro de validação de payload = 400 (culpa do chamador)
  // Erro de infraestrutura/parse da IA = 502 (culpa do upstream/Gemini)
  // Sucesso = 200
  let statusCode = 200;
  if (!resultado.sucesso) {
    statusCode = resultado.etapa === 'validacao' ? 400 : 502;
  }

  res.status(statusCode).json(resultado);
});

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Moneyball + Radar Engine rodando na porta ${PORT}`);
});

module.exports = app;
