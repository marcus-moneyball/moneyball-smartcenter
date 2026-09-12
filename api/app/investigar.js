'use strict';

const fs = require('fs');
const path = require('path');
const { exigirAuthBasica } = require('../../src/basicAuth');
const { chamarGeminiComImagem } = require('../../src/chamarGeminiComImagem');

const PROMPTS_NEXUS = {
  futebol: fs.readFileSync(path.join(__dirname, '../../src/prompts/nexus-futebol.md'), 'utf-8'),
  mlb: fs.readFileSync(path.join(__dirname, '../../src/prompts/nexus-mlb.md'), 'utf-8'),
  nba_wnba: fs.readFileSync(path.join(__dirname, '../../src/prompts/nexus-nba-wnba.md'), 'utf-8'),
};

/**
 * POST /api/app/investigar
 * Body: {
 *   esporte: 'futebol' | 'mlb' | 'nba_wnba',
 *   imagemStats: { data: base64SemPrefixo, mimeType: 'image/png' },
 *   confronto: { match, league },
 *   mercados_visiveis_no_print: [...],  -- o "cardápio" já lido pelo Radar
 *   contexto_ocr: '...'
 * }
 */
module.exports = async function handler(req, res) {
  if (!exigirAuthBasica(req, res)) return;
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  try {
    const { esporte, imagemStats, confronto, mercados_visiveis_no_print, contexto_ocr } = req.body || {};

    const promptNexus = PROMPTS_NEXUS[esporte];
    if (!promptNexus) {
      return res.status(400).json({ sucesso: false, erro: `Esporte "${esporte}" não reconhecido (use futebol, mlb ou nba_wnba).` });
    }
    if (!imagemStats?.data) {
      return res.status(400).json({ sucesso: false, erro: 'Envie o print de stats em "imagemStats".' });
    }

    const contextoAdicional = `CONFRONTO A INVESTIGAR: ${confronto?.match} (${confronto?.league})
CARDÁPIO DE ODDS DISPONÍVEL (lido do print de odds -- NÃO é fonte de verdade, só o menu de opções): ${JSON.stringify(mercados_visiveis_no_print || [])}
TEXTO ADICIONAL DO PRINT DE ODDS: ${contexto_ocr || '(nenhum)'}

---

`;

    const resultado = await chamarGeminiComImagem(contextoAdicional + promptNexus, [imagemStats]);
    return res.status(200).json({ sucesso: true, nexus: resultado });
  } catch (erro) {
    console.warn(`[APP INVESTIGAR] Falha: ${erro.message}`);
    return res.status(500).json({ sucesso: false, erro: erro.message });
  }
};
