'use strict';

/**
 * api/index.js — ÚNICA Serverless Function JS do projeto.
 *
 * Motivo de existir: o plano Hobby da Vercel conta CADA arquivo dentro de
 * /api como uma function separada, limite de 12. Tínhamos 12 endpoints JS
 * + 3 funções Python (api/quant/*.py) = 15, estourando o limite.
 *
 * Solução: os 12 handlers continuam existindo (lógica intacta, zero
 * reescrita de regra de negócio) mas moveram de /api para /src/routes — a
 * Vercel só varre /api, então esses arquivos não contam mais como function
 * individual. Este arquivo os importa e registra num Express app só, que
 * a Vercel enxerga como 1 function. As URLs continuam EXATAMENTE as
 * mesmas (ver vercel.json → rewrites), então nada muda pra quem consome
 * a API (scanner.html, aprovar.html, resultados.html, cron da Vercel).
 *
 * Os 3 arquivos Python (api/quant/futebol.py, basquete.py, beisebol.py)
 * NÃO entram aqui — Python não roda dentro de um Express Node — e
 * continuam como functions próprias (mais simples, e 1 + 3 = 4 functions
 * no total, longe do limite de 12).
 */

const express = require('express');

const app = express();
app.use(express.json());

// --- Painel do dia / aprovação ---
app.get('/api/5-do-dia', require('../src/routes/cincoDoDia'));
app.get('/api/lista-do-dia', require('../src/routes/listaDoDia'));
app.post('/api/aprovar-jogos', require('../src/routes/aprovarJogos'));
app.post('/api/rodar-rodada', require('../src/routes/rodarRodada'));
app.post('/api/publicar-ghost', require('../src/routes/publicarGhost'));

// --- Feedback / ROI ---
// registrarResultado.js atende GET (lista pendentes) e POST (grava resultado)
// no mesmo handler — registra as duas verbas apontando pro mesmo arquivo.
app.get('/api/registrar-resultado', require('../src/routes/registrarResultado'));
app.post('/api/registrar-resultado', require('../src/routes/registrarResultado'));
app.get('/api/roi-mensal', require('../src/routes/roiMensal'));

// --- Cron (Vercel Cron chama esses paths via GET, ver vercel.json → crons) ---
app.get('/api/cron/coleta-noturna', require('../src/routes/cronColetaNoturna'));
app.get('/api/cron/coleta-odds', require('../src/routes/cronColetaOdds'));

// --- Scanner (Radar → SmartCenter) ---
app.post('/api/scanner/processar', require('../src/routes/scannerProcessar'));
app.post('/api/scanner/analisar', require('../src/routes/scannerAnalisar'));
app.post('/api/scanner/publicar', require('../src/routes/scannerPublicar'));

// Rota não mapeada — ajuda a debugar rewrite errado em vez de um 404 mudo.
app.use((req, res) => {
  res.status(404).json({ sucesso: false, erro: `Rota não encontrada: ${req.method} ${req.originalUrl}` });
});

module.exports = app;
