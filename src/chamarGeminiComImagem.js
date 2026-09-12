'use strict';

const { GoogleGenAI } = require('@google/genai');

let cliente = null;
function getCliente() {
  if (cliente) return cliente;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  cliente = new GoogleGenAI({ apiKey });
  return cliente;
}

/**
 * @param {string} promptTexto - instrução (o documento do Radar ou do Nexus, geralmente)
 * @param {Array<{data: string, mimeType: string}>} imagens - imagens em base64 (sem o prefixo data:...)
 * @returns {Promise<Object>} JSON parseado da resposta -- lança erro se não vier JSON válido
 */
async function chamarGeminiComImagem(promptTexto, imagens = []) {
  const genAI = getCliente();
  if (!genAI) throw new Error('GEMINI_API_KEY não configurada.');

  const contents = [
    ...imagens.map((img) => ({ inlineData: { mimeType: img.mimeType, data: img.data } })),
    { text: promptTexto },
  ];

  const resultado = await genAI.models.generateContent({
    model: 'gemini-3.5-flash',
    contents,
    config: { temperature: 0 },
  });

  const texto = resultado.text.trim().replace(/^```json\s*|\s*```$/g, '');
  return JSON.parse(texto);
}

module.exports = { chamarGeminiComImagem };
