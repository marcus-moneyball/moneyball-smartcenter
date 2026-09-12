'use strict';

const fs = require('fs');
const path = require('path');
const { exigirAuthBasica } = require('../../src/basicAuth');
const { chamarGeminiComImagem } = require('../../src/chamarGeminiComImagem');

const PROMPT_RADAR = fs.readFileSync(path.join(__dirname, '../../src/prompts/radar-v3.md'), 'utf-8');

/**
 * POST /api/app/triagem
 * Body: { imagens: [{ data: base64SemPrefixo, mimeType: 'image/png' }] }
 */
module.exports = async function handler(req, res) {
  if (!exigirAuthBasica(req, res)) return;
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  try {
    const { imagens } = req.body || {};
    if (!Array.isArray(imagens) || imagens.length === 0) {
      return res.status(400).json({ sucesso: false, erro: 'Envie ao menos uma imagem em "imagens".' });
    }

    const resultado = await chamarGeminiComImagem(PROMPT_RADAR, imagens);
    return res.status(200).json({ sucesso: true, radar: resultado });
  } catch (erro) {
    console.warn(`[APP TRIAGEM] Falha: ${erro.message}`);
    return res.status(500).json({ sucesso: false, erro: erro.message });
  }
};
