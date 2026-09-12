'use strict';

const { exigirAuthBasica } = require('../../src/basicAuth');

/**
 * POST /api/app/publicar
 * Body: { confronto, radar, nexus, publicar }
 *
 * Existe só pra não expor o CRON_SECRET no navegador -- o app chama esse
 * endpoint (protegido por Basic Auth), que por sua vez chama o
 * /api/radar/partida real já com a senha certa, do lado do servidor.
 */
module.exports = async function handler(req, res) {
  if (!exigirAuthBasica(req, res)) return;
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  try {
    const baseUrl = `https://${req.headers.host}`;
    const resposta = await fetch(`${baseUrl}/api/radar/partida`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.CRON_SECRET}`,
      },
      body: JSON.stringify(req.body),
    });

    const dados = await resposta.json();
    return res.status(resposta.status).json(dados);
  } catch (erro) {
    console.warn(`[APP PUBLICAR] Falha: ${erro.message}`);
    return res.status(500).json({ sucesso: false, erro: erro.message });
  }
};
